import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileImdf } from "@kiriko/node";
import { describe, expect, it } from "vitest";
import { buildMinimalImdfZip } from "../../tests/fixtures/buildMinimalImdfZip";
import { CoreCompileError, compileVenueBundle, type NativeCompileResponse } from "../src/core/native";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures");
const KVB_MAGIC = Buffer.from([0x4b, 0x56, 0x42, 0x00]); // "KVB\0"

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

  it("stays off the event loop: another timer fires while a large-ish compile is in flight", async () => {
    const source = Buffer.from(await buildMinimalImdfZip());
    let timerFired = false;
    const timer = new Promise<void>((resolve) => {
      setImmediate(() => {
        timerFired = true;
        resolve();
      });
    });
    await Promise.all([compileImdf(source, "minimal", 1), timer]);
    expect(timerFired).toBe(true);
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

  it("rejects a malformed success payload missing the bundle field", async () => {
    const fake = async (): Promise<NativeCompileResponse> => ({
      ok: true,
      statsJson: "{}",
      warningsJson: "[]",
    });
    await expect(
      compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake),
    ).rejects.toMatchObject({ name: "CoreCompileError", code: "bridge_error" });
  });

  it("rejects a malformed success payload whose statsJson is not valid JSON", async () => {
    const fake = async (): Promise<NativeCompileResponse> => ({
      ok: true,
      bundle: Buffer.alloc(0),
      statsJson: "not json",
      warningsJson: "[]",
    });
    await expect(
      compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake),
    ).rejects.toMatchObject({ name: "CoreCompileError", code: "bridge_error" });
  });

  it("rejects a malformed success payload whose statsJson has the wrong shape", async () => {
    const fake = async (): Promise<NativeCompileResponse> => ({
      ok: true,
      bundle: Buffer.alloc(0),
      statsJson: JSON.stringify({ levels: "3", features: 27 }),
      warningsJson: "[]",
    });
    await expect(
      compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake),
    ).rejects.toMatchObject({ name: "CoreCompileError", code: "bridge_error" });
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

  it("rejects a failure payload missing errorJson", async () => {
    const fake = async (): Promise<NativeCompileResponse> => ({ ok: false });
    await expect(
      compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake),
    ).rejects.toMatchObject({ name: "CoreCompileError", code: "bridge_error" });
  });

  it("rejects a failure payload whose errorJson is not valid JSON", async () => {
    const fake = async (): Promise<NativeCompileResponse> => ({ ok: false, errorJson: "not json" });
    await expect(
      compileVenueBundle(Buffer.from(""), { datasetId: "x", version: 1 }, fake),
    ).rejects.toMatchObject({ name: "CoreCompileError", code: "bridge_error" });
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
});
