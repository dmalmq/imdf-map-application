import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchiveError, archiveErrorCopy } from "../errors/ArchiveError";
import type {
  GdbConversionResult,
  GdbInspection,
  GdbMappingPlan,
} from "./types";

const { FakeWorker } = vi.hoisted(() => {
  class FakeWorker extends EventTarget {
    static instances: FakeWorker[] = [];
    posted: unknown[] = [];
    terminated = false;
    constructor() {
      super();
      FakeWorker.instances.push(this);
    }
    postMessage(message: unknown): void {
      this.posted.push(message);
    }
    terminate(): void {
      this.terminated = true;
    }
  }
  return { FakeWorker };
});

vi.mock("./gdb.worker?worker", () => ({ default: FakeWorker }));

const { createGdbImportSession, gdbSelectionName } = await import("./loadGdb");

afterEach(() => {
  FakeWorker.instances.length = 0;
});

function fileStub(name: string, webkitRelativePath = ""): File {
  return { name, webkitRelativePath, size: 8 } as unknown as File;
}

function lastWorker(): InstanceType<typeof FakeWorker> {
  const worker = FakeWorker.instances.at(-1);
  if (!worker) throw new Error("no worker created");
  return worker;
}

function emit(worker: InstanceType<typeof FakeWorker>, data: unknown): void {
  worker.dispatchEvent(new MessageEvent("message", { data }));
}

/** Drain queued microtasks so a serialized request posts and registers. */
async function flush(): Promise<void> {
  // The request queue chains through Promise microtasks only (no real timers),
  // so a few microtask turns deterministically settle the next queued `run`.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

const INSPECTION: GdbInspection = {
  sourceName: "venue",
  databases: [{ id: "gdb-1", name: "a.gdb" }],
  layers: [],
  warnings: [],
};

const CONVERSION: GdbConversionResult = { layers: [], warnings: [] };

const PLAN: GdbMappingPlan = { venueName: "venue", buildings: [], layers: [] };

// A realistic inspection whose layer descriptors lack a FeatureCollection, so
// delivering it to a pending convert must be rejected as a protocol fault.
const POPULATED_INSPECTION: GdbInspection = {
  sourceName: "venue",
  databases: [{ id: "gdb-1", name: "a.gdb" }],
  layers: [
    {
      key: { databaseId: "gdb-1", layerName: "L" },
      databaseName: "a.gdb",
      featureCount: 1,
      geometryFamily: "polygon",
      fields: [],
    },
  ],
  warnings: [],
};

describe("createGdbImportSession", () => {
  it("posts a directory inspect payload with normalized descriptors", async () => {
    const session = createGdbImportSession("directory", [
      fileStub("a00000009.gdbtable", "parent/a.gdb/a00000009.gdbtable"),
    ]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();

    expect(worker.posted[0]).toEqual({
      id: 1,
      type: "inspect",
      mode: "directory",
      files: [
        {
          file: expect.anything(),
          name: "a00000009.gdbtable",
          relativePath: "parent/a.gdb/a00000009.gdbtable",
        },
      ],
    });

    emit(worker, { id: 1, ok: true, result: INSPECTION });
    await expect(promise).resolves.toEqual(INSPECTION);
    session.dispose();
  });

  it("posts an archive inspect payload using file names as relative paths", async () => {
    const session = createGdbImportSession("archive", [fileStub("venue.gdb.zip")]);
    // dispose() below rejects this pending call; swallow the abort here.
    session.inspect().catch(() => {});
    await flush();
    const worker = lastWorker();
    expect(worker.posted[0]).toMatchObject({
      id: 1,
      type: "inspect",
      mode: "archive",
      files: [{ name: "venue.gdb.zip", relativePath: "venue.gdb.zip" }],
    });
    session.dispose();
  });

  it("serializes requests: convert posts only after inspect settles", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const inspectPromise = session.inspect();
    const convertPromise = session.convert(PLAN);
    await flush();
    const worker = lastWorker();

    // Only the inspect request has been posted; convert waits its turn.
    expect(worker.posted).toHaveLength(1);
    expect(worker.posted[0]).toMatchObject({ id: 1, type: "inspect" });

    emit(worker, { id: 1, ok: true, result: INSPECTION });
    await expect(inspectPromise).resolves.toEqual(INSPECTION);
    await flush();

    // Now convert is posted with the next monotonic id.
    expect(worker.posted).toHaveLength(2);
    expect(worker.posted[1]).toMatchObject({ id: 2, type: "convert", plan: PLAN });
    emit(worker, { id: 2, ok: true, result: CONVERSION });
    await expect(convertPromise).resolves.toEqual(CONVERSION);
    session.dispose();
  });

  it("maps a fatal inspect error code to a typed ArchiveError with details", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    emit(lastWorker(), {
      id: 1,
      ok: false,
      error: {
        code: "invalid_geodatabase",
        name: "ArchiveError",
        message: "bad gdb",
        recoverable: false,
        details: { reason: "no_layers" },
      },
    });
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArchiveError);
    expect((error as ArchiveError).code).toBe("invalid_geodatabase");
    expect((error as ArchiveError).message).toBe(archiveErrorCopy.invalid_geodatabase);
    expect((error as ArchiveError).details).toMatchObject({
      reason: "no_layers",
      workerCode: "invalid_geodatabase",
      workerMessage: "bad gdb",
    });
    session.dispose();
  });

  it("maps the too-large inspect error code", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    emit(lastWorker(), {
      id: 1,
      ok: false,
      error: {
        code: "gdb_too_large",
        name: "ArchiveError",
        message: "too large",
        recoverable: false,
      },
    });
    await expect(promise).rejects.toMatchObject({ code: "gdb_too_large" });
    session.dispose();
  });

  it("maps any recoverable convert failure (incl. generated cap) to gdb_conversion_failed", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.convert(PLAN);
    await flush();
    emit(lastWorker(), {
      id: 1,
      ok: false,
      error: {
        code: "gdb_too_large",
        name: "ArchiveError",
        message: "generated budget exceeded",
        recoverable: true,
        details: { generatedBytes: 123 },
      },
    });
    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ArchiveError);
    expect((error as ArchiveError).code).toBe("gdb_conversion_failed");
    expect((error as ArchiveError).message).toBe(archiveErrorCopy.gdb_conversion_failed);
    expect((error as ArchiveError).details).toMatchObject({
      generatedBytes: 123,
      workerCode: "gdb_too_large",
      workerMessage: "generated budget exceeded",
    });
    // A recoverable failure is not terminal — the session stays usable.
    expect(lastWorker().terminated).toBe(false);
    session.dispose();
  });

  it("treats a malformed message as a terminal worker fault", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();
    emit(worker, { unexpected: true });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
    // Future calls after a terminal fault reject with worker_failed.
    await expect(session.inspect()).rejects.toMatchObject({ code: "worker_failed" });
  });

  it("treats a mis-shaped success result ({}) as worker_failed", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();
    emit(worker, { id: 1, ok: true, result: {} });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it("treats an inspection with empty database objects as worker_failed", async () => {
    // Shallow array checks would accept this; deep validation must not open review.
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();
    emit(worker, {
      id: 1,
      ok: true,
      result: { sourceName: "x", databases: [{}], layers: [], warnings: [] },
    });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it("treats an inspection with invalid layer descriptors as worker_failed", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();
    emit(worker, {
      id: 1,
      ok: true,
      result: {
        sourceName: "venue",
        databases: [{ id: "gdb-1", name: "a.gdb" }],
        layers: [
          {
            key: { databaseId: "gdb-1", layerName: "Floor" },
            databaseName: "a.gdb",
            featureCount: "1",
            geometryFamily: "polygon",
            fields: [],
          },
        ],
        warnings: [],
      },
    });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it("treats an inspection with unknown geometry family as worker_failed", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();
    emit(worker, {
      id: 1,
      ok: true,
      result: {
        sourceName: "venue",
        databases: [{ id: "gdb-1", name: "a.gdb" }],
        layers: [
          {
            key: { databaseId: "gdb-1", layerName: "Floor" },
            databaseName: "a.gdb",
            featureCount: 1,
            geometryFamily: "multipolygon",
            fields: [{ name: "id", type: "String" }],
          },
        ],
        warnings: [],
      },
    });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it("treats an inspection with non-string warnings as worker_failed", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();
    emit(worker, {
      id: 1,
      ok: true,
      result: {
        sourceName: "venue",
        databases: [{ id: "gdb-1", name: "a.gdb" }],
        layers: [],
        warnings: [1],
      },
    });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it("treats an inspection layer whose databaseId is unknown as worker_failed", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();
    emit(worker, {
      id: 1,
      ok: true,
      result: {
        sourceName: "venue",
        databases: [{ id: "gdb-1", name: "a.gdb" }],
        layers: [
          {
            key: { databaseId: "gdb-9", layerName: "Floor" },
            databaseName: "a.gdb",
            featureCount: 1,
            geometryFamily: "polygon",
            fields: [],
          },
        ],
        warnings: [],
      },
    });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it("accepts a fully populated valid inspection payload", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    emit(lastWorker(), { id: 1, ok: true, result: POPULATED_INSPECTION });
    await expect(promise).resolves.toEqual(POPULATED_INSPECTION);
    session.dispose();
  });

  it("treats an unknown response id as a terminal worker fault", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();
    emit(worker, { id: 999, ok: true, result: INSPECTION });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it("treats an inspection payload delivered to convert as worker_failed", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.convert(PLAN);
    await flush();
    const worker = lastWorker();
    emit(worker, { id: 1, ok: true, result: POPULATED_INSPECTION });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it("treats an empty inspection delivered to convert as worker_failed", async () => {
    // Empty layers make `layers.every` vacuously true; inspection-only keys
    // (sourceName/databases) must still force a terminal fault.
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.convert(PLAN);
    await flush();
    const worker = lastWorker();
    emit(worker, { id: 1, ok: true, result: INSPECTION });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it.each([
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["negative", -1],
    ["fraction", 1.5],
  ] as const)(
    "treats convert skippedGeometryCount=%s as worker_failed",
    async (_label, skippedGeometryCount) => {
      const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
      const promise = session.convert(PLAN);
      await flush();
      const worker = lastWorker();
      emit(worker, {
        id: 1,
        ok: true,
        result: {
          layers: [
            {
              key: { databaseId: "gdb-1", layerName: "L" },
              featureCollection: { type: "FeatureCollection", features: [] },
              skippedGeometryCount,
            },
          ],
          warnings: [],
        },
      });
      await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
      expect(worker.terminated).toBe(true);
    },
  );

  it.each([0, 3] as const)(
    "accepts convert skippedGeometryCount=%s",
    async (skippedGeometryCount) => {
      const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
      const promise = session.convert(PLAN);
      await flush();
      const result = {
        layers: [
          {
            key: { databaseId: "gdb-1", layerName: "L" },
            featureCollection: { type: "FeatureCollection", features: [] },
            skippedGeometryCount,
          },
        ],
        warnings: [],
      };
      emit(lastWorker(), { id: 1, ok: true, result });
      await expect(promise).resolves.toEqual(result);
      session.dispose();
    },
  );

  it("treats an error payload missing name as worker_failed", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();
    emit(worker, {
      id: 1,
      ok: false,
      error: { code: "invalid_geodatabase", message: "no name", recoverable: false },
    });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it("treats invalid (non-object) error details as worker_failed", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();
    emit(worker, {
      id: 1,
      ok: false,
      error: {
        code: "invalid_geodatabase",
        name: "ArchiveError",
        message: "bad details",
        recoverable: false,
        details: "oops",
      },
    });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it("treats a recoverable error on a pending inspect as a phase mismatch", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();
    emit(worker, {
      id: 1,
      ok: false,
      error: {
        code: "gdb_conversion_failed",
        name: "ArchiveError",
        message: "recoverable on inspect",
        recoverable: true,
      },
    });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it("treats a fatal (non-recoverable) error on a pending convert as a phase mismatch", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.convert(PLAN);
    await flush();
    const worker = lastWorker();
    emit(worker, {
      id: 1,
      ok: false,
      error: {
        code: "invalid_geodatabase",
        name: "ArchiveError",
        message: "fatal on convert",
        recoverable: false,
      },
    });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it("treats an inspect error with a convert-only code as worker_failed", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();
    emit(worker, {
      id: 1,
      ok: false,
      error: {
        code: "gdb_conversion_failed",
        name: "ArchiveError",
        message: "wrong code for inspect",
        recoverable: false,
      },
    });
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(worker.terminated).toBe(true);
  });

  it("rejects pending calls on a worker error event", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    lastWorker().dispatchEvent(new Event("error"));
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
    expect(lastWorker().terminated).toBe(true);
  });

  it("rejects pending calls on a messageerror event", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    lastWorker().dispatchEvent(new MessageEvent("messageerror"));
    await expect(promise).rejects.toMatchObject({ code: "worker_failed" });
  });

  it("dispose terminates the worker, rejects pending with AbortError, and is idempotent", async () => {
    const session = createGdbImportSession("directory", [fileStub("x", "a.gdb/x")]);
    const promise = session.inspect();
    await flush();
    const worker = lastWorker();

    session.dispose();
    expect(worker.terminated).toBe(true);
    const error = await promise.catch((e: unknown) => e);
    expect((error as DOMException).name).toBe("AbortError");

    expect(() => session.dispose()).not.toThrow();

    await expect(session.inspect()).rejects.toMatchObject({ name: "AbortError" });
    await expect(session.convert(PLAN)).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("gdbSelectionName", () => {
  it("uses the common first path segment for a folder selection", () => {
    expect(
      gdbSelectionName([
        fileStub("a00000009.gdbtable", "NW,POI_20260702/a.gdb/a00000009.gdbtable"),
        fileStub("b00000009.gdbtable", "NW,POI_20260702/b.gdb/b00000009.gdbtable"),
      ]),
    ).toBe("NW,POI_20260702");
  });

  it("uses the single archive filename for one archive", () => {
    expect(gdbSelectionName([fileStub("station.gdb.zip")])).toBe("station.gdb.zip");
  });

  it("uses a count template for multiple archives", () => {
    expect(
      gdbSelectionName([fileStub("a.zip"), fileStub("b.zip"), fileStub("c.zip")]),
    ).toBe("3 GDB archives");
  });
});
