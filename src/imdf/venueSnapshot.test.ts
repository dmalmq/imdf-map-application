import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BlobReader,
  BlobWriter,
  TextReader,
  TextWriter,
  ZipReader,
  ZipWriter,
  configure,
} from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { ArchiveError } from "../errors/ArchiveError";
import { normalizeVenue } from "./normalizeVenue";
import type { FeatureType, ImdfManifest, LoadedVenue, ParsedImdfArchive } from "./types";
import { readVenueSnapshot, writeVenueSnapshot } from "./venueSnapshot";

configure({ useWebWorkers: false });

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "tests",
  "fixtures",
  "minimal-imdf",
);

async function loadFixtureVenue(): Promise<LoadedVenue> {
  const manifest = JSON.parse(
    await readFile(path.join(FIXTURE_DIR, "manifest.json"), "utf8"),
  ) as ImdfManifest;
  const collections: ParsedImdfArchive["collections"] = {};
  for (const name of await readdir(FIXTURE_DIR)) {
    if (!name.endsWith(".geojson")) {
      continue;
    }
    collections[name.replace(/\.geojson$/, "") as FeatureType] = JSON.parse(
      await readFile(path.join(FIXTURE_DIR, name), "utf8"),
    ) as GeoJSON.FeatureCollection;
  }
  return normalizeVenue({ manifest, collections });
}

async function snapshotBlob(snapshot: unknown): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  await writer.add("snapshot.json", new TextReader(JSON.stringify(snapshot)));
  return writer.close();
}

async function snapshotPayload(blob: Blob): Promise<Record<string, unknown>> {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const [entry] = await reader.getEntries();
    if (entry === undefined || entry.directory) {
      throw new Error("snapshot.json missing from generated snapshot");
    }
    const parsed = JSON.parse(await entry.getData(new TextWriter())) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("snapshot.json did not contain an object");
    }
    return parsed as Record<string, unknown>;
  } finally {
    await reader.close();
  }
}

describe("venueSnapshot", () => {
  it("round-trips a LoadedVenue byte-for-byte including Maps and sourceProperties", async () => {
    const venue = await loadFixtureVenue();
    const first = [...venue.featuresById.values()][0];
    expect(first).toBeDefined();
    first!.sourceProperties = {
      OBJECTID: 1,
      FLOOR: "1F",
      幅員: null,
      __gdb_database: "gdb-1",
      __gdb_layer: "net_path",
    };
    const blob = await writeVenueSnapshot(venue, "JRTokyoSta.gdb");
    const restored = await readVenueSnapshot(blob);
    expect(restored.featuresById).toBeInstanceOf(Map);
    expect(restored.renderFeaturesByLevel).toBeInstanceOf(Map);
    expect(restored.boundsByLevel).toBeInstanceOf(Map);
    expect(restored.enrichmentByFeatureId).toBeInstanceOf(Map);
    expect(restored).toEqual(venue);
    const restoredFirst = restored.featuresById.get(first!.id);
    expect(Object.entries(restoredFirst!.sourceProperties)).toEqual(
      Object.entries(first!.sourceProperties),
    );
  });

  it("rejects a non-zip blob as invalid_archive", async () => {
    await expect(readVenueSnapshot(new Blob(["not a zip"]))).rejects.toMatchObject({
      code: "invalid_archive",
    });
  });

  it("rejects a zip without snapshot.json as missing_required_file", async () => {
    const writer = new ZipWriter(new BlobWriter("application/zip"));
    await writer.add("other.json", new TextReader("{}"));
    const blob = await writer.close();
    await expect(readVenueSnapshot(blob)).rejects.toMatchObject({
      code: "missing_required_file",
    });
  });

  it("rejects a future schemaVersion as snapshot_version_mismatch", async () => {
    const venue = await loadFixtureVenue();
    const blob = await writeVenueSnapshot(venue, "x.gdb");
    const reader = new ZipReader(new BlobReader(blob));
    const [entry] = await reader.getEntries();
    if (entry === undefined || entry.directory) {
      throw new Error("snapshot.json missing from generated snapshot");
    }
    const text = await entry.getData(new TextWriter());
    await reader.close();
    const bad = await snapshotBlob({ ...(JSON.parse(text) as object), schemaVersion: 999 });
    const error = await readVenueSnapshot(bad).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ArchiveError);
    expect((error as ArchiveError).code).toBe("snapshot_version_mismatch");
  });

  it("rejects a snapshot missing required venue arrays as invalid_archive", async () => {
    const bad = await snapshotBlob({
      schemaVersion: 1,
      kind: "venue-snapshot",
      venue: { levels: [], featuresById: [] },
    });
    await expect(readVenueSnapshot(bad)).rejects.toMatchObject({ code: "invalid_archive" });
  });

  it("rejects duplicate snapshot.json entries as invalid_archive", async () => {
    const writer = new ZipWriter(new BlobWriter("application/zip"));
    await writer.add("snapshot.json", new TextReader("{}"));
    await writer.add("duplicat.json", new TextReader("{}"));
    const bytes = new Uint8Array(await (await writer.close()).arrayBuffer());
    const from = new TextEncoder().encode("duplicat.json");
    const to = new TextEncoder().encode("snapshot.json");
    for (let index = 0; index <= bytes.length - from.length; index += 1) {
      if (from.every((byte, offset) => bytes[index + offset] === byte)) {
        bytes.set(to, index);
      }
    }
    await expect(readVenueSnapshot(new Blob([bytes]))).rejects.toMatchObject({
      code: "invalid_archive",
    });
  });

  it("rejects malformed map entries as invalid_archive", async () => {
    const bad = await snapshotBlob({
      schemaVersion: 1,
      kind: "venue-snapshot",
      venue: {
        manifest: {},
        venue: {},
        levels: [],
        featuresById: ["bad"],
        renderFeaturesByLevel: [],
        searchEntries: [],
        boundsByLevel: [],
        enrichmentByFeatureId: [],
        warnings: [],
      },
    });
    await expect(readVenueSnapshot(bad)).rejects.toMatchObject({ code: "invalid_archive" });
  });
  it("rejects missing snapshot metadata as invalid_archive", async () => {
    const bad = await snapshotBlob({
      schemaVersion: 1,
      kind: "venue-snapshot",
      generatedAt: "not-a-date",
      sourceName: "",
      venue: {
        manifest: {},
        venue: {},
        levels: [],
        featuresById: [],
        renderFeaturesByLevel: [],
        searchEntries: [],
        boundsByLevel: [],
        enrichmentByFeatureId: [],
        warnings: [],
      },
    });
    await expect(readVenueSnapshot(bad)).rejects.toMatchObject({ code: "invalid_archive" });
  });

  it("rejects shallow LoadedVenue objects and duplicate map keys", async () => {
    const shallow = await snapshotBlob({
      schemaVersion: 1,
      kind: "venue-snapshot",
      generatedAt: "2026-01-01T00:00:00.000Z",
      sourceName: "x.gdb",
      venue: {
        manifest: {},
        venue: {},
        levels: [{}],
        featuresById: [],
        renderFeaturesByLevel: [["ordinal:0", {}]],
        searchEntries: [{}],
        boundsByLevel: [],
        enrichmentByFeatureId: [],
        warnings: [{}],
      },
    });
    await expect(readVenueSnapshot(shallow)).rejects.toMatchObject({ code: "invalid_archive" });

    const payload = await snapshotPayload(
      await writeVenueSnapshot(await loadFixtureVenue(), "x.gdb"),
    );
    const serialized = payload["venue"];
    if (typeof serialized !== "object" || serialized === null || Array.isArray(serialized)) {
      throw new Error("generated venue missing");
    }
    const features = (serialized as Record<string, unknown>)["featuresById"];
    if (!Array.isArray(features) || features[0] === undefined) {
      throw new Error("generated features missing");
    }
    features.push(features[0]);
    await expect(readVenueSnapshot(await snapshotBlob(payload))).rejects.toMatchObject({
      code: "invalid_archive",
    });
  });

  it("enforces snapshot byte and source-name limits", async () => {
    class OversizeBlob extends Blob {
      override get size(): number {
        return 600 * 1024 * 1024 + 1;
      }
    }
    await expect(readVenueSnapshot(new OversizeBlob())).rejects.toMatchObject({
      code: "archive_too_large",
    });
    const venue = await loadFixtureVenue();
    await expect(writeVenueSnapshot(venue, "")).rejects.toMatchObject({
      code: "invalid_archive",
    });
    await expect(writeVenueSnapshot(venue, "x".repeat(201))).rejects.toMatchObject({
      code: "invalid_archive",
    });
  });

  it("rejects encrypted snapshots and stops after 101 entries", async () => {
    const encryptedWriter = new ZipWriter(new BlobWriter("application/zip"));
    await encryptedWriter.add("snapshot.json", new TextReader("{}"));
    const encryptedBytes = new Uint8Array(
      await (await encryptedWriter.close()).arrayBuffer(),
    );
    for (let index = 0; index <= encryptedBytes.length - 10; index += 1) {
      const local =
        encryptedBytes[index] === 0x50 &&
        encryptedBytes[index + 1] === 0x4b &&
        encryptedBytes[index + 2] === 0x03 &&
        encryptedBytes[index + 3] === 0x04;
      const central =
        encryptedBytes[index] === 0x50 &&
        encryptedBytes[index + 1] === 0x4b &&
        encryptedBytes[index + 2] === 0x01 &&
        encryptedBytes[index + 3] === 0x02;
      if (local) encryptedBytes[index + 6] = (encryptedBytes[index + 6] ?? 0) | 1;
      if (central) encryptedBytes[index + 8] = (encryptedBytes[index + 8] ?? 0) | 1;
    }
    await expect(readVenueSnapshot(new Blob([encryptedBytes]))).rejects.toMatchObject({
      code: "invalid_archive",
    });

    const crowdedWriter = new ZipWriter(new BlobWriter("application/zip"));
    for (let index = 0; index < 101; index += 1) {
      await crowdedWriter.add(`entry-${index}.json`, new TextReader("{}"));
    }
    await expect(readVenueSnapshot(await crowdedWriter.close())).rejects.toMatchObject({
      code: "archive_too_large",
    });
  });

});
