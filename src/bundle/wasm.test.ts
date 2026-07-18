import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { decodeBundle, initKirikoWasm } from "./wasm";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../tests/fixtures");

async function readGoldenBundle(): Promise<Uint8Array> {
  const bytes = await readFile(join(FIXTURES_DIR, "minimal.kvb"));
  return new Uint8Array(bytes);
}

/** Flips one byte to produce each stable `kvb1` corruption case. */
function corrupt(bytes: Uint8Array, mutate: (b: Uint8Array) => void): Uint8Array {
  const copy = new Uint8Array(bytes);
  mutate(copy);
  return copy;
}

beforeAll(async () => {
  await initKirikoWasm();
});

describe("decodeBundle", () => {
  it("decodes the golden fixture into the full venue DTO", async () => {
    const bytes = await readGoldenBundle();
    const response = decodeBundle(bytes);

    expect(response.ok).toBe(true);
    const venue = response.venue!;
    expect(venue.venueId).toBe("a1000001-0000-4000-8000-000000000001");
    expect(venue.levels.map((l) => l.ordinal)).toEqual([1, 0, -1]);
    expect(venue.features).toHaveLength(27);
    expect(venue.warnings).toHaveLength(5);
    expect(venue.stats).toEqual({ levels: 3, features: 27 });
    expect(response.error).toBeNull();
  });

  it("decodes complete source properties, including nulls and unknown keys", async () => {
    const bytes = await readGoldenBundle();
    const response = decodeBundle(bytes);
    const occupant = response.venue!.features.find(
      (f) => f.id === "a1000008-0000-4000-8000-0000000000c1",
    )!;

    expect(occupant.sourceProperties.category).toBe("shopping");
    expect(occupant.sourceProperties.anchor_id).toBe("a1000007-0000-4000-8000-0000000000a1");
    expect(occupant.sourceProperties.hours).toBe("Mo-Fr 10:00-20:00");
    expect(occupant.sourceProperties.phone).toBeNull();
    expect(occupant.sourceProperties.website).toBeNull();

    const venueFeature = response.venue!.features.find(
      (f) => f.id === "a1000001-0000-4000-8000-000000000001",
    )!;
    expect(venueFeature.sourceProperties.address_id).toBe("a1000002-0000-4000-8000-000000000002");
  });

  it("represents boundsByLevel as [levelId, bounds][] tuples", async () => {
    const bytes = await readGoldenBundle();
    const response = decodeBundle(bytes);
    expect(Array.isArray(response.venue!.boundsByLevel)).toBe(true);
    for (const entry of response.venue!.boundsByLevel) {
      expect(entry).toHaveLength(2);
      const [levelId, bounds] = entry;
      expect(typeof levelId).toBe("string");
      expect(bounds).toHaveLength(4);
      for (const n of bounds) {
        expect(typeof n).toBe("number");
      }
    }
  });

  it("returns plain objects (not Maps) for labels and source properties", async () => {
    const bytes = await readGoldenBundle();
    const response = decodeBundle(bytes);
    const feature = response.venue!.features[0]!;
    expect(feature.sourceProperties).not.toBeInstanceOf(Map);
    expect(feature.labels).not.toBeInstanceOf(Map);
  });

  it.each([
    ["invalid_bundle", (b: Uint8Array) => (b[0] = (b[0] ?? 0) ^ 0xff)],
    [
      "unsupported_bundle_version",
      (b: Uint8Array) => {
        b[4] = 2;
        b[5] = 0;
      },
    ],
    ["bundle_integrity_failed", (b: Uint8Array) => (b[20] = (b[20] ?? 0) ^ 0xff)],
    [
      "bundle_too_large",
      (b: Uint8Array) => {
        const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
        view.setBigUint64(12, 512n * 1024n * 1024n + 1n, true);
      },
    ],
  ] as const)("returns the stable %s error code for crafted corruption", async (code, mutate) => {
    const bytes = corrupt(await readGoldenBundle(), mutate);
    const response = decodeBundle(bytes);
    expect(response.ok).toBe(false);
    expect(response.venue).toBeNull();
    expect(response.error?.code).toBe(code);
  });

  it("never throws for domain failures", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    expect(() => decodeBundle(bytes)).not.toThrow();
  });
});

describe("initKirikoWasm", () => {
  it("is idempotent across repeated calls", async () => {
    await initKirikoWasm();
    await initKirikoWasm();
    const bytes = await readGoldenBundle();
    expect(decodeBundle(bytes).ok).toBe(true);
  });
});
