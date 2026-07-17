import { describe, expect, it } from "vitest";
import { buildMinimalImdfZip } from "../../tests/fixtures/buildMinimalImdfZip";
import { ImdfValidationError, validateImdfArchive } from "../src/imdf/validateArchive";

describe("validateImdfArchive", () => {
  it("accepts the minimal fixture and reports stats", async () => {
    const stats = await validateImdfArchive(await buildMinimalImdfZip());
    expect(stats.levels).toBe(3);
    expect(stats.features).toBeGreaterThan(10);
    expect(stats.language).toBe("ja-JP");
    expect(stats.venueName).toBe("東京駅テスト会場");
  });

  it("rejects non-zip bytes with not_zip", async () => {
    await expect(validateImdfArchive(new TextEncoder().encode("nope"))).rejects.toMatchObject({
      code: "not_zip",
    });
  });

  it("rejects a zip without manifest.json with missing_file", async () => {
    const { BlobWriter, TextReader, ZipWriter } = await import("@zip.js/zip.js");
    const writer = new ZipWriter(new BlobWriter("application/zip"));
    await writer.add("venue.geojson", new TextReader('{"type":"FeatureCollection","features":[]}'));
    const blob = await writer.close();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await expect(validateImdfArchive(bytes)).rejects.toMatchObject({ code: "missing_file" });
  });
});
