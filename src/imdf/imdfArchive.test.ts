import {
  BlobWriter,
  TextReader,
  Uint8ArrayReader,
  ZipWriter,
  configure,
} from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { ArchiveError } from "../errors/ArchiveError";
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ENTRY_UNCOMPRESSED_BYTES,
  MAX_TOTAL_UNCOMPRESSED_BYTES,
} from "./archiveLimits";
import { loadArchive } from "./imdf.worker";
import type { ImdfWorkerResponse } from "./loadImdfArchive";
import {
  buildMinimalImdfZip,
  patchZipEntryName,
} from "../../tests/fixtures/buildMinimalImdfZip";

configure({ useWebWorkers: false });

const VENUE_JA = "東京駅テスト会場";
const VENUE_EN = "Tokyo Station Test Venue";
const VENUE_ID = "a1000001-0000-4000-8000-000000000001";

function asFile(bytes: Uint8Array, name = "venue.zip"): File {
  // Copy into a fresh ArrayBuffer-backed view so File/Blob always receives a plain buffer.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new File([copy], name, { type: "application/zip" });
}

/**
 * `loadArchive` throws ArchiveError on the worker path; the message handler
 * serializes those into `{type:"failed"}`. Tests exercise the same boundary
 * by mapping throws to the worker response shape.
 */
async function tryLoadArchive(file: File): Promise<ImdfWorkerResponse> {
  try {
    return await loadArchive(file);
  } catch (error) {
    if (error instanceof ArchiveError) {
      if (error.details !== undefined) {
        return {
          type: "failed",
          error: {
            code: error.code,
            message: error.message,
            details: error.details,
          },
        };
      }
      return {
        type: "failed",
        error: { code: error.code, message: error.message },
      };
    }
    throw error;
  }
}

async function buildZip(
  entries: Record<string, string | Uint8Array>,
  options?: { password: string },
): Promise<Uint8Array> {
  const password = options?.password;
  const writerOptions =
    password !== undefined
      ? {
          level: 0,
          extendedTimestamp: false as const,
          password,
          encryptionStrength: 3 as const,
        }
      : {
          level: 0,
          extendedTimestamp: false as const,
        };
  const writer = new ZipWriter(new BlobWriter("application/zip"), writerOptions);
  const names = Object.keys(entries).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const name of names) {
    const value = entries[name];
    if (value === undefined) {
      continue;
    }
    const reader =
      typeof value === "string"
        ? new TextReader(value)
        : new Uint8ArrayReader(value);
    const entryOptions =
      password !== undefined
        ? {
            level: 0,
            extendedTimestamp: false as const,
            password,
            encryptionStrength: 3 as const,
          }
        : {
            level: 0,
            extendedTimestamp: false as const,
          };
    await writer.add(name, reader, entryOptions);
  }
  const blob = await writer.close();
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Patch every local-file and central-directory uncompressed-size field for a
 * named stored entry so declared size exceeds archive limits while content stays tiny.
 */
function patchDeclaredUncompressedSize(
  zipBytes: Uint8Array,
  entryName: string,
  uncompressedSize: number,
): Uint8Array {
  const nameBytes = new TextEncoder().encode(entryName);
  const out = new Uint8Array(zipBytes);
  let patched = 0;

  for (let i = 0; i + 4 <= out.length; i++) {
    const sig =
      out[i]! |
      (out[i + 1]! << 8) |
      (out[i + 2]! << 16) |
      (out[i + 3]! << 24);

    let nameOffset = -1;
    let sizeOffset = -1;
    if (sig === 0x04034b50) {
      // local file header: uncompressed size at +22, name at +30
      sizeOffset = i + 22;
      nameOffset = i + 30;
    } else if (sig === 0x02014b50) {
      // central directory: uncompressed size at +24, name at +46
      sizeOffset = i + 24;
      nameOffset = i + 46;
    } else {
      continue;
    }

    if (nameOffset + nameBytes.length > out.length) {
      continue;
    }
    let match = true;
    for (let j = 0; j < nameBytes.length; j++) {
      if (out[nameOffset + j] !== nameBytes[j]) {
        match = false;
        break;
      }
    }
    if (!match) {
      continue;
    }

    out[sizeOffset] = uncompressedSize & 0xff;
    out[sizeOffset + 1] = (uncompressedSize >>> 8) & 0xff;
    out[sizeOffset + 2] = (uncompressedSize >>> 16) & 0xff;
    out[sizeOffset + 3] = (uncompressedSize >>> 24) & 0xff;
    patched += 1;
  }

  if (patched < 2) {
    throw new Error(
      `patchDeclaredUncompressedSize: expected ≥2 headers for "${entryName}", found ${patched}`,
    );
  }
  return out;
}

describe("IMDF archive boundary (loadArchive)", () => {
  it("loads the minimal fixture and extracts real venue label bytes", async () => {
    const bytes = await buildMinimalImdfZip();
    const result = await tryLoadArchive(asFile(bytes));
    expect(result.type).toBe("loaded");
    if (result.type !== "loaded") {
      return;
    }
    expect(result.venue.venue.labels["ja-JP"]).toBe(VENUE_JA);
    expect(result.venue.venue.labels["en"]).toBe(VENUE_EN);
    expect(result.venue.venue.id).toBe(VENUE_ID);
  });

  it("rejects archives with more than MAX_ARCHIVE_ENTRIES entries", async () => {
    const entries: Record<string, string> = {};
    for (let i = 0; i < MAX_ARCHIVE_ENTRIES + 1; i++) {
      entries[`e${String(i).padStart(3, "0")}.txt`] = "x";
    }
    const bytes = await buildZip(entries);
    const result = await tryLoadArchive(asFile(bytes));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "archive_too_large" },
    });
  });

  it("rejects a tiny entry whose declared uncompressed size exceeds the per-entry limit", async () => {
    const bytes = await buildZip({ "big.json": "{}" });
    const patched = patchDeclaredUncompressedSize(
      bytes,
      "big.json",
      MAX_ENTRY_UNCOMPRESSED_BYTES + 1,
    );
    const result = await tryLoadArchive(asFile(patched));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "archive_too_large" },
    });
  });

  it("rejects when declared total uncompressed size exceeds the total limit", async () => {
    // Four entries each declaring just under the per-entry limit so the sum
    // exceeds MAX_TOTAL_UNCOMPRESSED_BYTES while content remains tiny.
    const perEntry = Math.floor(MAX_TOTAL_UNCOMPRESSED_BYTES / 3);
    expect(perEntry).toBeLessThanOrEqual(MAX_ENTRY_UNCOMPRESSED_BYTES);
    expect(perEntry * 4).toBeGreaterThan(MAX_TOTAL_UNCOMPRESSED_BYTES);

    let bytes = await buildZip({
      "a.json": "{}",
      "b.json": "{}",
      "c.json": "{}",
      "d.json": "{}",
    });
    for (const name of ["a.json", "b.json", "c.json", "d.json"]) {
      bytes = patchDeclaredUncompressedSize(bytes, name, perEntry);
    }
    const result = await tryLoadArchive(asFile(bytes));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "archive_too_large" },
    });
  });

  it("rejects unsafe paths: parent traversal", async () => {
    const safe = await buildMinimalImdfZip({
      extraEntries: { "evil_path.js": "{}" },
    });
    const evil = patchZipEntryName(safe, "evil_path.js", "../evil.json");
    const result = await tryLoadArchive(asFile(evil));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "unsafe_archive_path" },
    });
  });

  it("rejects unsafe paths: absolute path", async () => {
    const safe = await buildMinimalImdfZip({
      extraEntries: { "abs_.json": "{}" },
    });
    const evil = patchZipEntryName(safe, "abs_.json", "/abs.json");
    const result = await tryLoadArchive(asFile(evil));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "unsafe_archive_path" },
    });
  });

  it("rejects unsafe paths: backslash", async () => {
    const safe = await buildMinimalImdfZip({
      extraEntries: { "a.b.json": "{}" },
    });
    const evil = patchZipEntryName(safe, "a.b.json", "a\\b.json");
    const result = await tryLoadArchive(asFile(evil));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "unsafe_archive_path" },
    });
  });

  it("rejects unsafe paths: embedded NUL", async () => {
    const safe = await buildMinimalImdfZip({
      extraEntries: { "a.b.json": "{}" },
    });
    const evil = patchZipEntryName(safe, "a.b.json", "a\0b.json");
    const result = await tryLoadArchive(asFile(evil));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "unsafe_archive_path" },
    });
  });

  it("rejects duplicate case-folded entry names", async () => {
    const bytes = await buildMinimalImdfZip({
      extraEntries: { "Manifest.json": '{"version":"1.0.0","language":"ja"}' },
    });
    const result = await tryLoadArchive(asFile(bytes));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "invalid_archive" },
    });
  });

  it("rejects encrypted entries", async () => {
    const bytes = await buildZip(
      {
        "manifest.json": '{"version":"1.0.0","language":"ja"}',
        "venue.geojson": '{"type":"FeatureCollection","features":[]}',
        "address.geojson": '{"type":"FeatureCollection","features":[]}',
      },
      { password: "secret" },
    );
    const result = await tryLoadArchive(asFile(bytes));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "invalid_archive" },
    });
  });

  it("rejects corrupt or truncated ZIP bytes", async () => {
    const valid = await buildMinimalImdfZip();
    const truncated = valid.slice(0, Math.min(32, valid.length));
    const result = await tryLoadArchive(asFile(truncated));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "invalid_archive" },
    });
  });

  it("rejects non-ZIP bytes that use a .zip filename", async () => {
    const bytes = new TextEncoder().encode("this is not a zip archive");
    const result = await tryLoadArchive(asFile(bytes, "fake.zip"));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "unsupported_file" },
    });
  });

  it("rejects a non-.zip filename even with ZIP magic", async () => {
    const bytes = await buildMinimalImdfZip();
    const result = await tryLoadArchive(asFile(bytes, "venue.imdf"));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "unsupported_file" },
    });
  });

  it("rejects archives missing required IMDF files", async () => {
    const missingManifest = await tryLoadArchive(
      asFile(await buildMinimalImdfZip({ omitEntries: ["manifest.json"] })),
    );
    expect(missingManifest).toMatchObject({
      type: "failed",
      error: { code: "missing_required_file" },
    });

    const missingVenue = await tryLoadArchive(
      asFile(await buildMinimalImdfZip({ omitEntries: ["venue.geojson"] })),
    );
    expect(missingVenue).toMatchObject({
      type: "failed",
      error: { code: "missing_required_file" },
    });

    const missingAddress = await tryLoadArchive(
      asFile(await buildMinimalImdfZip({ omitEntries: ["address.geojson"] })),
    );
    expect(missingAddress).toMatchObject({
      type: "failed",
      error: { code: "missing_required_file" },
    });
  });

  it("rejects invalid JSON in an IMDF entry", async () => {
    const bytes = await buildMinimalImdfZip({
      replaceEntries: { "manifest.json": "{not-json" },
    });
    const result = await tryLoadArchive(asFile(bytes));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "invalid_json" },
    });
  });

  it("rejects an unsupported manifest version", async () => {
    const bytes = await buildMinimalImdfZip({
      replaceEntries: {
        "manifest.json": JSON.stringify({
          version: "2.0.0",
          language: "ja-JP",
        }),
      },
    });
    const result = await tryLoadArchive(asFile(bytes));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "invalid_manifest_version" },
    });
  });

  it("rejects duplicate feature IDs across files", async () => {
    const duplicateAddress = {
      type: "FeatureCollection",
      features: [
        {
          id: VENUE_ID,
          type: "Feature",
          feature_type: "address",
          geometry: null,
          properties: {
            address: "1-1 Marunouchi",
            unit: null,
            locality: "Tokyo",
            province: "Tokyo",
            country: "JP",
            postal_code: null,
            postal_code_ext: null,
          },
        },
      ],
    };
    const bytes = await buildMinimalImdfZip({
      replaceEntries: {
        "address.geojson": JSON.stringify(duplicateAddress),
      },
    });
    const result = await tryLoadArchive(asFile(bytes));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "duplicate_feature_id" },
    });
  });

  it("rejects a top-level feature_type that does not match the filename", async () => {
    const mismatched = {
      type: "FeatureCollection",
      features: [
        {
          id: "e1000001-0000-4000-8000-0000000000a1",
          type: "Feature",
          feature_type: "unit",
          geometry: {
            type: "Point",
            coordinates: [139.7674, 35.6811],
          },
          properties: {
            category: "toilet",
            name: { "ja-JP": "トイレ", en: "Restroom" },
            unit_ids: ["c1000011-0000-4000-8000-00000000011f"],
          },
        },
      ],
    };
    const bytes = await buildMinimalImdfZip({
      replaceEntries: {
        "amenity.geojson": JSON.stringify(mismatched),
      },
    });
    const result = await tryLoadArchive(asFile(bytes));
    expect(result).toMatchObject({
      type: "failed",
      error: { code: "invalid_feature_collection" },
    });
  });

  it("loads with an unknown safe root entry and records unknown_archive_entry", async () => {
    const bytes = await buildMinimalImdfZip({
      extraEntries: { "extra.txt": "not imdf" },
    });
    const result = await tryLoadArchive(asFile(bytes));
    expect(result.type).toBe("loaded");
    if (result.type !== "loaded") {
      return;
    }
    const unknown = result.venue.warnings.filter(
      (warning) => warning.code === "unknown_archive_entry",
    );
    expect(unknown).toHaveLength(1);
    expect(unknown[0]?.archiveEntry).toBe("extra.txt");
    // Entry was not parsed as IMDF: venue still loads and retains fixture labels.
    expect(result.venue.venue.labels["en"]).toBe(VENUE_EN);
  });
});
