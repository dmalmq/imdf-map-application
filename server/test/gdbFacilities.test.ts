/**
 * Combined GDB import: point-facility extraction unit tests plus the
 * `POST /api/gdb/inspect-facilities` and facilities-aware
 * `POST /api/gdb/publish` route tests.
 *
 * gdal3.js is faked at the `../src/gdb/gdal` module boundary (the real WASM
 * runtime never sees these synthetic archives — see gdbRoutes.test.ts for why
 * crafted archives must not reach it), and `compileVenueBundle` is faked at
 * the `../src/core/native` boundary so the publish job records exactly which
 * facilities GeoJSON the compile step received. Mirrors gdbNetwork.test.ts.
 */
import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as NativeModule from "../src/core/native";
import type * as GdalModule from "../src/gdb/gdal";
import { extractFacilitiesGeoJson } from "../src/gdb/facilities";
import { GdbSourceError } from "../src/gdb/sourceValidation";
import { cleanupTestApps, loginCookie, makeTestApp } from "./helpers";

interface CountRow {
  n: number;
}
/** Mutable fake-GDAL/compile state, hoisted so the mock factories can close over it. */
const fake = vi.hoisted(() => ({
  ogrinfoLayers: [] as Array<Record<string, unknown>>,
  /** GeoJSON text served by the fake `ogr2ogr`, keyed by requested layer name. */
  layerOutputs: new Map<string, string>(),
  /** GeoJSON text served by the fake `getFileBytes`, keyed by ogr2ogr output name. */
  files: new Map<string, string>(),
  /** `(source, metadata)` seen by the fake `compileVenueBundle`. */
  compileCalls: [] as Array<{ source: unknown; metadata: Record<string, unknown> }>,
}));

vi.mock("../src/gdb/gdal", async (importOriginal) => {
  const actual = await importOriginal<typeof GdalModule>();
  const fakeGdal = {
    open: async (path: string) => ({ datasets: [{ path }] }),
    ogrinfo: async () => ({ layers: fake.ogrinfoLayers }),
    ogr2ogr: async (_dataset: unknown, args: string[], outputName: string) => {
      const layerName = args[args.length - 1] ?? "";
      const content = fake.layerOutputs.get(layerName);
      if (content === undefined) {
        throw new Error(`fake gdal: no output registered for layer ${layerName}`);
      }
      fake.files.set(outputName, content);
      return { local: outputName };
    },
    getFileBytes: async (output: { local?: string }) => {
      const content = fake.files.get(String(output?.local));
      if (content === undefined) {
        throw new Error("fake gdal: unknown output file");
      }
      return new TextEncoder().encode(content);
    },
    close: async () => undefined,
    drivers: { vector: {} },
  };
  return { ...actual, getGdal: async () => fakeGdal };
});

vi.mock("../src/core/native", async (importOriginal) => {
  const actual = await importOriginal<typeof NativeModule>();
  return {
    ...actual,
    compileVenueBundle: async (source: unknown, metadata: Record<string, unknown>) => {
      fake.compileCalls.push({ source, metadata });
      return {
        bundle: Buffer.from("kvb-fake-bundle"),
        stats: { levels: 1, features: 1 },
        warnings: [],
      };
    },
  };
});

function featureCollection(features: unknown[]): string {
  return JSON.stringify({ type: "FeatureCollection", features });
}

const FACILITIES_GEOJSON = featureCollection([
  { type: "Feature", properties: { floor: "1" }, geometry: { type: "Point", coordinates: [139.0, 35.0] } },
  { type: "Feature", properties: { floor: "2" }, geometry: { type: "Point", coordinates: [139.0005, 35.0] } },
  { type: "Feature", properties: { floor: "1" }, geometry: { type: "Point", coordinates: [139.0, 35.0005] } },
  { type: "Feature", properties: { floor: "2" }, geometry: { type: "Point", coordinates: [139.0005, 35.0005] } },
]);

const JUNCTIONS_GEOJSON = featureCollection([
  { type: "Feature", properties: { FLOOR: "1" }, geometry: { type: "Point", coordinates: [139.0, 35.0] } },
]);

const PATHS_GEOJSON = featureCollection([
  {
    type: "Feature",
    properties: { FLOOR: "1" },
    geometry: { type: "LineString", coordinates: [[139.0, 35.0], [139.0005, 35.0]] },
  },
]);

const LEVELS_GEOJSON = featureCollection([
  {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[[139.0, 35.0], [139.001, 35.0], [139.001, 35.001], [139.0, 35.001], [139.0, 35.0]]],
    },
  },
]);

const FACILITY_LAYERS = [
  { name: "Facility_Merge" },
  { name: "net_junction" },
  { name: "net_path" },
];

/** Zip that passes `validateGdbArchive`: one `.gdb` root with a well-formed system catalog header. */
async function validGdbZipBytes(rootName = "facilities.gdb"): Promise<Uint8Array> {
  const catalog = new Uint8Array(48);
  const view = new DataView(catalog.buffer);
  view.setUint32(0, 3, true); // FileGDB header version
  view.setBigUint64(24, 48n, true); // declaredSize === entry size
  view.setBigUint64(32, 40n, true); // fieldDescriptionOffset within [40, size)
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add(`${rootName}/a00000001.gdbtable`, new Uint8ArrayReader(catalog));
  await writer.add(`${rootName}/a00000001.gdbtablx`, new Uint8ArrayReader(new Uint8Array([1, 2, 3, 4])));
  return writer.close();
}

function multipartZip(bytes: Uint8Array): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const boundary = "----kirikoGdbFacilitiesBoundary";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="facilities.gdb.zip"\r\n` +
      `Content-Type: application/zip\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, Buffer.from(bytes), tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

/** Store bytes as a content-addressed blob exactly like the inspect endpoints do. */
function putBlob(app: FastifyInstance, bytes: Uint8Array): string {
  const { hash, size } = app.blobs.put(bytes);
  app.db.prepare("INSERT OR IGNORE INTO blobs (hash, size) VALUES (?, ?)").run(hash, size);
  return hash;
}

async function createVenue(app: FastifyInstance, cookie: string, name = "Facility Venue"): Promise<number> {
  const response = await app.inject({
    method: "POST",
    url: "/api/venues",
    headers: { cookie },
    payload: { name },
  });
  expect(response.statusCode).toBe(201);
  return (response.json().venue as { id: number }).id;
}

const PUBLISH_PLAN = {
  venueName: "Facility Venue",
  buildings: [{ id: "b1", name: "Building 1" }],
  layers: [
    {
      key: { databaseId: "gdb-1", layerName: "Levels" },
      included: true,
      targetType: "level",
      buildingId: "b1",
      levelRule: { kind: "fixed", label: "1", ordinal: 1 },
      idField: null,
      ordinalField: null,
      shortNameField: null,
      nameField: null,
      categoryField: null,
    },
  ],
};

beforeEach(() => {
  fake.ogrinfoLayers = [...FACILITY_LAYERS];
  fake.layerOutputs.clear();
  fake.files.clear();
  fake.compileCalls.length = 0;
  fake.layerOutputs.set("Facility_Merge", FACILITIES_GEOJSON);
  fake.layerOutputs.set("net_junction", JUNCTIONS_GEOJSON);
  fake.layerOutputs.set("net_path", PATHS_GEOJSON);
  fake.layerOutputs.set("Levels", LEVELS_GEOJSON);
});

afterEach(cleanupTestApps);

describe("extractFacilitiesGeoJson", () => {
  it("returns the facility count, sorted distinct floors, and the raw GeoJSON text", async () => {
    const result = await extractFacilitiesGeoJson("/tmp/fake-facilities.gdb.zip");

    expect(result.facilityCount).toBe(4);
    expect(result.floors).toEqual(["1", "2"]);
    expect(result.geojson).toBe(FACILITIES_GEOJSON);
  });

  it("throws GdbSourceError missing_facility_layer when the facility layer is absent", async () => {
    fake.ogrinfoLayers = [{ name: "net_junction" }, { name: "Concourse" }];

    const error = await extractFacilitiesGeoJson("/tmp/fake-facilities.gdb.zip").then(
      () => null,
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(GdbSourceError);
    expect((error as GdbSourceError).code).toBe("missing_facility_layer");
  });
});

describe("POST /api/gdb/inspect-facilities", () => {
  it("stages the upload and returns the facility summary", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const multipart = multipartZip(await validGdbZipBytes());

    const response = await app.inject({
      method: "POST",
      url: "/api/gdb/inspect-facilities",
      headers: { cookie, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as {
      facilitiesBlobHash: string;
      facilityCount: number;
      floors: string[];
    };
    expect(body.facilitiesBlobHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.facilityCount).toBe(4);
    expect(body.floors).toEqual(["1", "2"]);
    // The staged blob is content-addressed and retrievable for the later publish.
    expect(app.blobs.has(body.facilitiesBlobHash)).toBe(true);
  });

  it("rejects an archive without the facility layer as 400 missing_facility_layer", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    fake.ogrinfoLayers = [{ name: "Concourse" }, { name: "Rooms" }];
    const multipart = multipartZip(await validGdbZipBytes());

    const response = await app.inject({
      method: "POST",
      url: "/api/gdb/inspect-facilities",
      headers: { cookie, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "missing_facility_layer" });
  });

  it("rejects a non-geodatabase archive before GDAL", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add("facilities.gdb/a00000001.gdbtable", new TextReader("not a geodatabase"));
    const multipart = multipartZip(await writer.close());

    const response = await app.inject({
      method: "POST",
      url: "/api/gdb/inspect-facilities",
      headers: { cookie, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "invalid_geodatabase" });
  });
});

describe("POST /api/gdb/publish with facilitiesBlobHash", () => {
  it("compiles with the extracted facilities GeoJSON and publishes one gdb version", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venueId = await createVenue(app, cookie);
    const blobHash = putBlob(app, await validGdbZipBytes("venue.gdb"));
    const networkBlobHash = putBlob(app, await validGdbZipBytes("net.gdb"));
    const facilitiesBlobHash = putBlob(app, await validGdbZipBytes("facilities.gdb"));

    const response = await app.inject({
      method: "POST",
      url: "/api/gdb/publish",
      headers: { cookie },
      payload: { venueId, blobHash, networkBlobHash, facilitiesBlobHash, plan: PUBLISH_PLAN },
    });

    expect(response.statusCode, response.body).toBe(202);
    const accepted = response.json() as { jobId: string; versionId: number; seq: number };
    expect(accepted.seq).toBe(1);

    await app.queue.idle();

    expect(fake.compileCalls.length).toBe(1);
    const { metadata } = fake.compileCalls[0]!;
    expect(metadata["facilitiesGeoJson"]).toBe(FACILITIES_GEOJSON);
    expect(metadata["networkJunctionsGeoJson"]).toBe(JUNCTIONS_GEOJSON);
    expect(metadata["networkPathsGeoJson"]).toBe(PATHS_GEOJSON);
    expect(metadata["version"]).toBe(1);

    const version = app.db
      .prepare("SELECT status, source_kind AS sourceKind FROM versions WHERE id = ?")
      .get(accepted.versionId) as { status: string; sourceKind: string };
    expect(version.status).toBe("published");
    expect(version.sourceKind).toBe("gdb");
  });

  it("leaves a facilities-less publish exactly as before", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venueId = await createVenue(app, cookie);
    const blobHash = putBlob(app, await validGdbZipBytes("venue.gdb"));

    const response = await app.inject({
      method: "POST",
      url: "/api/gdb/publish",
      headers: { cookie },
      payload: { venueId, blobHash, plan: PUBLISH_PLAN },
    });

    expect(response.statusCode, response.body).toBe(202);
    await app.queue.idle();

    expect(fake.compileCalls.length).toBe(1);
    const { metadata } = fake.compileCalls[0]!;
    expect(metadata["facilitiesGeoJson"]).toBeUndefined();
    expect(metadata["networkJunctionsGeoJson"]).toBeUndefined();
    expect(metadata["networkPathsGeoJson"]).toBeUndefined();
  });

  it("404s on a missing facilities blob and publishes nothing", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venueId = await createVenue(app, cookie);
    const blobHash = putBlob(app, await validGdbZipBytes("venue.gdb"));

    const response = await app.inject({
      method: "POST",
      url: "/api/gdb/publish",
      headers: { cookie },
      payload: { venueId, blobHash, facilitiesBlobHash: "0".repeat(64), plan: PUBLISH_PLAN },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "facilities_blob_not_found" });
    const versionCount = app.db
      .prepare("SELECT COUNT(*) AS n FROM versions")
      .get() as CountRow;
    expect(versionCount.n).toBe(0);
  });

  it("400s with missing_facility_layer on a facilities archive without the layer, publishing nothing", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venueId = await createVenue(app, cookie);
    const blobHash = putBlob(app, await validGdbZipBytes("venue.gdb"));
    const facilitiesBlobHash = putBlob(app, await validGdbZipBytes("facilities.gdb"));
    fake.ogrinfoLayers = [{ name: "net_junction" }];

    const response = await app.inject({
      method: "POST",
      url: "/api/gdb/publish",
      headers: { cookie },
      payload: { venueId, blobHash, facilitiesBlobHash, plan: PUBLISH_PLAN },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: "missing_facility_layer" });
    const versionCount = app.db
      .prepare("SELECT COUNT(*) AS n FROM versions")
      .get() as CountRow;
    expect(versionCount.n).toBe(0);
  });
});

describe("GDB publish persists reprocess inputs", () => {
  it("stores raw GDB blob, plan, and bundle-input refs on the version row", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const venueId = await createVenue(app, cookie);
    const blobHash = putBlob(app, await validGdbZipBytes("venue.gdb"));
    const networkBlobHash = putBlob(app, await validGdbZipBytes("net.gdb"));
    const facilitiesBlobHash = putBlob(app, await validGdbZipBytes("facilities.gdb"));

    const response = await app.inject({
      method: "POST",
      url: "/api/gdb/publish",
      headers: { cookie },
      payload: { venueId, blobHash, networkBlobHash, facilitiesBlobHash, plan: PUBLISH_PLAN },
    });
    expect(response.statusCode, response.body).toBe(202);
    const { versionId } = response.json() as { versionId: number };
    await app.queue.idle();

    const row = app.db
      .prepare(
        "SELECT gdb_source_blob_hash AS g, gdb_plan_json AS p, net_junctions_blob_hash AS j, net_paths_blob_hash AS t, facilities_blob_hash AS f FROM versions WHERE id = ?",
      )
      .get(versionId) as { g: string; p: string; j: string; t: string; f: string };
    expect(row.g).toBe(blobHash);
    expect(JSON.parse(row.p).layers.length).toBeGreaterThan(0);
    expect(row.j).toMatch(/^[0-9a-f]{64}$/);
    expect(row.t).toMatch(/^[0-9a-f]{64}$/);
    expect(row.f).toMatch(/^[0-9a-f]{64}$/);
  });
});
