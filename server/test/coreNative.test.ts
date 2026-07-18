import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileImdf } from "@kiriko/node";
import { describe, expect, it } from "vitest";
import { buildMinimalImdfZip } from "../../tests/fixtures/buildMinimalImdfZip";
import { CoreCompileError, compileVenueBundle, type NativeCompileResponse } from "../src/core/native";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures");
const KVB_MAGIC = Buffer.from([0x4b, 0x56, 0x42, 0x00]); // "KVB\0"
const LEVEL_1F = "b1000001-0000-4000-8000-0000000000b1";

function syntheticUnitId(i: number): string {
  // 8-4-4-4-12 hex groups, exactly `is_valid_feature_id`'s 36-byte contract.
  return `f${i.toString(16).padStart(7, "0")}-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
}

/**
 * A valid IMDF archive with `count` synthetic unit features (in addition to
 * the minimal fixture's other collections), used only to make native
 * compile take long enough that an event-loop-blocking regression would be
 * unmistakable (see the "off the event loop" test below). Timed
 * empirically: 4000 features ~ 80ms of native compute, several orders of
 * magnitude longer than a single `setImmediate` tick.
 */
async function buildExpensiveImdfZip(count: number): Promise<Buffer> {
  const features = [];
  for (let i = 0; i < count; i++) {
    const lon = 139.76 + (i % 100) * 0.0001;
    const lat = 35.68 + Math.floor(i / 100) * 0.0001;
    features.push({
      id: syntheticUnitId(i),
      type: "Feature",
      feature_type: "unit",
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [lon, lat],
            [lon + 0.00005, lat],
            [lon + 0.00005, lat + 0.00005],
            [lon, lat + 0.00005],
            [lon, lat],
          ],
        ],
      },
      properties: {
        category: "room",
        restriction: null,
        accessibility: null,
        name: { en: `Room ${i}` },
        alt_name: null,
        display_point: { type: "Point", coordinates: [lon + 0.000025, lat + 0.000025] },
        level_id: LEVEL_1F,
      },
    });
  }
  const collection = { type: "FeatureCollection", features };
  const zip = await buildMinimalImdfZip({
    replaceEntries: { "unit.geojson": JSON.stringify(collection) },
  });
  return Buffer.from(zip);
}

describe("@kiriko/node compileImdf (raw native contract)", () => {
  it("resolves ok:true with the exact committed golden bundle bytes, stats, and warnings", async () => {
    const source = Buffer.from(await buildMinimalImdfZip());
    const golden = await readFile(join(FIXTURES_DIR, "minimal.kvb"));

    const response = await compileImdf(source, "minimal", 1);

    expect(response.ok).toBe(true);
    expect(response.bundle?.subarray(0, 4)).toEqual(KVB_MAGIC);
    expect(response.bundle).toEqual(golden);

    const stats = JSON.parse(response.statsJson ?? "null") as { levels: number; features: number };
    expect(stats).toEqual({ levels: 3, features: 27 });

    const warnings = JSON.parse(response.warningsJson ?? "null") as Array<{
      code: string;
      featureId?: string;
    }>;
    expect(warnings).toHaveLength(5);
    expect(warnings.map((w) => w.code).sort()).toEqual(
      [
        "missing_display_point",
        "missing_display_point",
        "missing_display_point",
        "missing_locale",
        "unresolved_reference",
      ].sort(),
    );
    expect(response.errorJson).toBeUndefined();
  });

  it("produces byte-identical bundles for repeated compilation of the same source", async () => {
    const source = Buffer.from(await buildMinimalImdfZip());
    const first = await compileImdf(source, "minimal", 1);
    const second = await compileImdf(source, "minimal", 1);
    expect(first.bundle).toEqual(second.bundle);
  });

  it("resolves ok:false with unsupported_file for invalid ZIP bytes, never rejecting or crashing", async () => {
    const response = await compileImdf(Buffer.from("not a zip"), "minimal", 1);
    expect(response.ok).toBe(false);
    expect(response.bundle).toBeUndefined();
    const error = JSON.parse(response.errorJson ?? "null") as { code: string; message: string };
    expect(error.code).toBe("unsupported_file");
  });

  it("compiles off the Node.js event loop: a setImmediate macrotask runs before the compile promise settles", async () => {
    // Construction: `settled` only flips inside the promise's `.then`
    // (a microtask that can only run once napi resolves the deferred,
    // which for `AsyncTask` requires a full round trip through libuv's
    // thread pool — never within the same synchronous turn as the call).
    // `setImmediate` schedules its callback for this event loop's "check"
    // phase. If `compute()` ever blocked the main thread synchronously
    // instead of running on the thread pool, no macrotask (including this
    // one) could run until it returned, and — combined with the ~80ms
    // "expensive" input — `settled` would already be `true` by the time
    // the immediate fires. This asserts explicit ordering, not timing.
    const source = await buildExpensiveImdfZip(4000);
    let settled = false;
    const compilePromise = compileImdf(source, "minimal", 1).then((r) => {
      settled = true;
      return r;
    });
    const timerFiredBeforeSettle = await new Promise<boolean>((resolve) => {
      setImmediate(() => resolve(!settled));
    });
    const result = await compilePromise;
    expect(result.ok).toBe(true);
    expect(timerFiredBeforeSettle).toBe(true);
  });
});

describe("compileVenueBundle", () => {
  it("returns bundle bytes, stats, and warnings for a valid archive", async () => {
    const source = Buffer.from(await buildMinimalImdfZip());
    const result = await compileVenueBundle(source, { datasetId: "minimal", version: 1 });
    expect(result.bundle.subarray(0, 4)).toEqual(KVB_MAGIC);
    expect(result.stats).toEqual({ levels: 3, features: 27 });
    expect(result.warnings).toHaveLength(5);
    expect(result.warnings[0]).toHaveProperty("code");
    expect(result.warnings[0]).toHaveProperty("message");
  });

  it("throws CoreCompileError with the native domain code and message for invalid ZIP bytes", async () => {
    const source = Buffer.from("not a zip");
    await expect(compileVenueBundle(source, { datasetId: "x", version: 1 })).rejects.toMatchObject({
      name: "CoreCompileError",
      code: "unsupported_file",
    });
  });

  // -- Untrusted native envelope: the whole resolved value, not just its
  // -- declared fields, must be validated field-by-field before use.
  describe("treats the native envelope as untrusted", () => {
    const cases: Array<[string, unknown]> = [
      ["null", null],
      ["an array", ["ok"]],
      ["a string", "ok"],
      ["a number", 1],
      ["missing ok", { bundle: Buffer.alloc(0), statsJson: "{}", warningsJson: "[]" }],
      ["ok:true with bundle absent entirely", { ok: true, statsJson: "{}", warningsJson: "[]" }],
      ["a truthy non-boolean ok", { ok: "yes", bundle: Buffer.alloc(0), statsJson: "{}", warningsJson: "[]" }],
      ["a numeric ok", { ok: 1, bundle: Buffer.alloc(0), statsJson: "{}", warningsJson: "[]" }],
      [
        "a non-Buffer bundle (plain Uint8Array)",
        { ok: true, bundle: new Uint8Array([1, 2, 3]), statsJson: "{}", warningsJson: "[]" },
      ],
      ["a string bundle", { ok: true, bundle: "not-a-buffer", statsJson: "{}", warningsJson: "[]" }],
      ["a non-string statsJson", { ok: true, bundle: Buffer.alloc(0), statsJson: 42, warningsJson: "[]" }],
      ["a non-string warningsJson", { ok: true, bundle: Buffer.alloc(0), statsJson: "{}", warningsJson: null }],
      ["a non-string errorJson", { ok: false, errorJson: 42 }],
      ["a missing errorJson", { ok: false }],
    ];

    it.each(cases)("rejects with bridge_error, never a raw TypeError, when the envelope is %s", async (_, raw) => {
      const fake = async (): Promise<unknown> => raw;
      let caught: unknown;
      try {
        await compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CoreCompileError);
      expect((caught as CoreCompileError).code).toBe("bridge_error");
    });

    it("normalizes a raw thrown error from the native function into CoreCompileError", async () => {
      const fake = async (): Promise<unknown> => {
        throw new TypeError("napi bridge exploded");
      };
      let caught: unknown;
      try {
        await compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CoreCompileError);
      expect(caught).not.toBeInstanceOf(TypeError);
      expect((caught as CoreCompileError).code).toBe("bridge_error");
      expect((caught as CoreCompileError).message).toContain("napi bridge exploded");
    });
  });

  // -- statsJson: levels/features must be well-formed u32 integers.
  describe("validates statsJson numeric bounds", () => {
    const badStats: Array<[string, unknown]> = [
      ["a negative levels", { levels: -1, features: 1 }],
      ["a fractional features", { levels: 1, features: 1.5 }],
      ["a levels above u32::MAX", { levels: 0x1_0000_0000, features: 1 }],
      ["a non-numeric features", { levels: 1, features: "1" }],
    ];

    it.each(badStats)("rejects %s", async (_, stats) => {
      const fake = async (): Promise<NativeCompileResponse> => ({
        ok: true,
        bundle: Buffer.alloc(0),
        statsJson: JSON.stringify(stats),
        warningsJson: "[]",
      });
      await expect(
        compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake),
      ).rejects.toMatchObject({ name: "CoreCompileError", code: "bridge_error" });
    });

    it("rejects statsJson that is not valid JSON at all", async () => {
      const fake = async (): Promise<NativeCompileResponse> => ({
        ok: true,
        bundle: Buffer.alloc(0),
        statsJson: "{not json",
        warningsJson: "[]",
      });
      await expect(
        compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake),
      ).rejects.toMatchObject({ name: "CoreCompileError", code: "bridge_error" });
    });

    it("rejects statsJson that parses to a non-object (an array)", async () => {
      const fake = async (): Promise<NativeCompileResponse> => ({
        ok: true,
        bundle: Buffer.alloc(0),
        statsJson: JSON.stringify([1, 2]),
        warningsJson: "[]",
      });
      await expect(
        compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake),
      ).rejects.toMatchObject({ name: "CoreCompileError", code: "bridge_error" });
    });

    it("accepts the u32 boundary value 0xFFFFFFFF", async () => {
      const fake = async (): Promise<NativeCompileResponse> => ({
        ok: true,
        bundle: Buffer.alloc(0),
        statsJson: JSON.stringify({ levels: 0xffff_ffff, features: 0 }),
        warningsJson: "[]",
      });
      const result = await compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake);
      expect(result.stats).toEqual({ levels: 0xffff_ffff, features: 0 });
    });
  });

  it("rejects a malformed success payload whose warningsJson entry has an unknown code", async () => {
    const fake = async (): Promise<NativeCompileResponse> => ({
      ok: true,
      bundle: Buffer.alloc(0),
      statsJson: JSON.stringify({ levels: 1, features: 1 }),
      warningsJson: JSON.stringify([{ code: "not_a_real_code", message: "?" }]),
    });
    await expect(
      compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake),
    ).rejects.toMatchObject({ name: "CoreCompileError", code: "bridge_error" });
  });

  // -- Optional warning fields: absent is fine, present-but-wrong-type must
  // -- be rejected rather than silently dropped.
  describe("validates optional warning fields instead of silently erasing them", () => {
    it("accepts a warning with featureId/archiveEntry absent", async () => {
      const fake = async (): Promise<NativeCompileResponse> => ({
        ok: true,
        bundle: Buffer.alloc(0),
        statsJson: JSON.stringify({ levels: 1, features: 1 }),
        warningsJson: JSON.stringify([{ code: "missing_locale", message: "m" }]),
      });
      const result = await compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake);
      expect(result.warnings).toEqual([{ code: "missing_locale", message: "m" }]);
    });

    it("accepts a warning with string featureId/archiveEntry present", async () => {
      const fake = async (): Promise<NativeCompileResponse> => ({
        ok: true,
        bundle: Buffer.alloc(0),
        statsJson: JSON.stringify({ levels: 1, features: 1 }),
        warningsJson: JSON.stringify([
          { code: "missing_locale", message: "m", featureId: "f1", archiveEntry: "unit.geojson" },
        ]),
      });
      const result = await compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake);
      expect(result.warnings).toEqual([
        { code: "missing_locale", message: "m", featureId: "f1", archiveEntry: "unit.geojson" },
      ]);
    });

    it.each([
      ["a numeric featureId", { featureId: 42 }],
      ["a numeric archiveEntry", { archiveEntry: 42 }],
      ["a null featureId", { featureId: null }],
      ["an object archiveEntry", { archiveEntry: {} }],
    ])("rejects %s rather than silently dropping it", async (_, extra) => {
      const fake = async (): Promise<NativeCompileResponse> => ({
        ok: true,
        bundle: Buffer.alloc(0),
        statsJson: JSON.stringify({ levels: 1, features: 1 }),
        warningsJson: JSON.stringify([{ code: "missing_locale", message: "m", ...extra }]),
      });
      await expect(
        compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake),
      ).rejects.toMatchObject({ name: "CoreCompileError", code: "bridge_error" });
    });
  });

  it("rejects a failure payload whose errorJson is not valid JSON", async () => {
    const fake = async (): Promise<NativeCompileResponse> => ({ ok: false, errorJson: "not json" });
    await expect(
      compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake),
    ).rejects.toMatchObject({ name: "CoreCompileError", code: "bridge_error" });
  });

  // -- Optional error `details`: absent is fine, present must be a
  // -- non-null non-array record; wrong types are rejected.
  describe("validates optional error details instead of silently erasing them", () => {
    it("accepts an error with details absent", async () => {
      const fake = async (): Promise<NativeCompileResponse> => ({
        ok: false,
        errorJson: JSON.stringify({ code: "unsafe_archive_path", message: "unsafe path" }),
      });
      let caught: unknown;
      try {
        await compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CoreCompileError);
      expect((caught as CoreCompileError).details).toBeUndefined();
    });

    it("preserves details from a structured native error", async () => {
      const fake = async (): Promise<NativeCompileResponse> => ({
        ok: false,
        errorJson: JSON.stringify({
          code: "unsafe_archive_path",
          message: "unsafe path",
          details: { entry: "../evil" },
        }),
      });
      let caught: unknown;
      try {
        await compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(CoreCompileError);
      expect((caught as CoreCompileError).code).toBe("unsafe_archive_path");
      expect((caught as CoreCompileError).details).toEqual({ entry: "../evil" });
    });

    it.each([
      ["an array", ["not", "a", "record"]],
      ["a string", "nope"],
      ["a number", 42],
    ])("rejects details that is %s rather than silently dropping it", async (_, badDetails) => {
      const fake = async (): Promise<NativeCompileResponse> => ({
        ok: false,
        errorJson: JSON.stringify({ code: "unsafe_archive_path", message: "unsafe path", details: badDetails }),
      });
      await expect(
        compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake),
      ).rejects.toMatchObject({ name: "CoreCompileError", code: "bridge_error" });
    });
  });
});
