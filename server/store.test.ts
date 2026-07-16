// @vitest-environment node
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import type { PathLike, RmOptions } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PlatformStore } from "./store";
import type { CatalogEntry } from "./types";

const mockCtl = vi.hoisted(() => ({
  rejectRmSubstring: null as string | null,
  onCatalogCommit: null as (() => Promise<void>) | null,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as {
    rm: (target: PathLike, options?: RmOptions) => Promise<void>;
    rename: (from: PathLike, to: PathLike) => Promise<void>;
  } & Record<string, unknown>;
  return {
    ...actual,
    rm: (target: PathLike, options?: RmOptions): Promise<void> =>
      mockCtl.rejectRmSubstring !== null && String(target).includes(mockCtl.rejectRmSubstring)
        ? Promise.reject(new Error("cleanup boom"))
        : actual.rm(target, options),
    rename: async (from: PathLike, to: PathLike): Promise<void> => {
      if (mockCtl.onCatalogCommit && String(to).endsWith("catalog.json")) {
        await mockCtl.onCatalogCommit();
      }
      return actual.rename(from, to);
    },
  };
});

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "gis-store-"));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

const META: Omit<CatalogEntry, "updatedAt"> = {
  id: "tokyo-station",
  name: "東京駅",
  kind: "venue-snapshot",
  levelCount: 15,
  featureCount: 17521,
  sourceName: "JRTokyoSta.gdb",
};

const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);

describe("PlatformStore", () => {
  it("puts a dataset, lists it without contentHash, and persists the blob", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    const entry = await store.putDataset(META, ZIP);
    expect(entry.updatedAt).toMatch(/^\d{4}-/);
    expect("contentHash" in entry).toBe(false);
    expect(store.listCatalog()).toEqual([entry]);
    expect(await readFile(store.blobPath("tokyo-station"))).toEqual(ZIP);
    expect(store.getEntry("tokyo-station")?.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("overwrite replaces the entry; delete removes blob, entry, and comments", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    await store.putDataset({ ...META, name: "Tokyo v2" }, ZIP);
    expect(store.listCatalog()).toHaveLength(1);
    expect(store.listCatalog()[0]?.name).toBe("Tokyo v2");
    await store.addComment("tokyo-station", { author: "alice", text: "hi" });
    expect(await store.deleteDataset("tokyo-station")).toBe(true);
    expect(store.listCatalog()).toEqual([]);
    expect(await store.listComments("tokyo-station")).toEqual([]);
    expect(await store.deleteDataset("tokyo-station")).toBe(false);
  });

  it("comments append with server-assigned id/createdAt and delete by id", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    const created = await store.addComment("any", { author: "alice", text: "first", lngLat: [139.76, 35.68], levelId: "ordinal:0" });
    expect(created.id).toMatch(/[0-9a-f-]{36}/);
    expect(await store.listComments("any")).toEqual([created]);
    expect(await store.deleteComment("any", created.id)).toEqual(created);
    expect(await store.deleteComment("any", created.id)).toBeNull();
  });

  it("does not append a comment after the targeted dataset generation changes", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const original = store.getBlobSnapshot("tokyo-station")?.entry;
    expect(original).toBeDefined();
    if (original === undefined) return;
    await store.putDataset(META, Buffer.from([0x50, 0x4b, 0x03, 0x04, 9]));
    expect(
      await store.addComment(
        "tokyo-station",
        { author: "alice", text: "stale" },
        original,
      ),
    ).toBeUndefined();
    expect(await store.listComments("tokyo-station")).toEqual([]);
  });

  it("drops catalog entries whose blob is missing at boot", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const catalogFile = path.join(dir, "catalog.json");
    const rows = JSON.parse(await readFile(catalogFile, "utf8")) as unknown[];
    await writeFile(
      catalogFile,
      JSON.stringify([...rows, { ...META, id: "dangling", updatedAt: "2026-01-01T00:00:00.000Z", contentHash: "0".repeat(64) }]),
    );
    const danglingComments = path.join(dir, "comments", "dangling.json");
    await writeFile(
      danglingComments,
      JSON.stringify([{ id: "old", author: "alice", text: "stale", createdAt: "2026-01-01" }]),
    );
    const reopened = await PlatformStore.open(dir);
    expect(reopened.listCatalog().map((entry) => entry.id)).toEqual(["tokyo-station"]);
    expect(await reopened.listComments("dangling")).toEqual([]);
    expect(existsSync(danglingComments)).toBe(false);
  });

  it("persists users and sessions across reopen", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.upsertUser({ username: "admin", role: "admin", salt: "aa", passwordHash: "bb" });
    await store.addSession({ token: "t1", username: "admin", createdAt: "2026-01-01T00:00:00.000Z" });
    const reopened = await PlatformStore.open(dir);
    expect(reopened.findUser("admin")?.role).toBe("admin");
    expect(reopened.findSession("t1")?.username).toBe("admin");
    await reopened.deleteSession("t1");
    expect(reopened.findSession("t1")).toBeUndefined();
  });

  it("rejects traversal and malformed dataset ids on every path and mutation op", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    for (const bad of ["../evil", "/etc/passwd", "a/b", "UPPER", "", ".", "a".repeat(65)]) {
      expect(() => store.blobPath(bad)).toThrow();
      expect(() => store.getBlobSnapshot(bad)).toThrow();
      expect(() => store.acquireBlob(bad)).toThrow();
      await expect(store.putDataset({ ...META, id: bad }, ZIP)).rejects.toThrow();
      await expect(store.deleteDataset(bad)).rejects.toThrow();
      await expect(store.listComments(bad)).rejects.toThrow();
      await expect(store.addComment(bad, { author: "a", text: "b" })).rejects.toThrow();
      await expect(store.deleteComment(bad, "x")).rejects.toThrow();
    }
  });

  it("propagates a corrupt catalog file at boot instead of silently discarding data", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    await writeFile(path.join(dir, "catalog.json"), "{ not json");
    await expect(PlatformStore.open(dir)).rejects.toThrow();
  });

  it("rolls back a new put when catalog persistence fails, leaving no orphan blob or comments", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await mkdir(path.join(dir, "catalog.json"));
    await expect(store.putDataset(META, ZIP)).rejects.toThrow();
    expect(await readdir(path.join(dir, "blobs"))).toEqual([]);
    expect(existsSync(path.join(dir, "comments", "tokyo-station.json"))).toBe(false);
    expect(store.getEntry("tokyo-station")).toBeUndefined();
    expect(store.listCatalog()).toEqual([]);
  });

  it("rolls back an overwrite when catalog persistence fails, preserving the old generation and entry", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    await rm(path.join(dir, "catalog.json"));
    await mkdir(path.join(dir, "catalog.json"));
    await expect(store.putDataset({ ...META, name: "v2" }, Buffer.from([9, 9, 9]))).rejects.toThrow();
    expect(await readFile(store.blobPath("tokyo-station"))).toEqual(ZIP);
    expect(store.getEntry("tokyo-station")?.name).toBe("東京駅");
    expect(await readdir(path.join(dir, "blobs"))).toHaveLength(1);
  });

  it("does not mutate in-memory users or sessions when persistence fails", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await mkdir(path.join(dir, "users.json"));
    await mkdir(path.join(dir, "sessions.json"));
    await expect(
      store.upsertUser({ username: "admin", role: "admin", salt: "a", passwordHash: "b" }),
    ).rejects.toThrow();
    await expect(
      store.addSession({ token: "t1", username: "admin", createdAt: "2026-01-01T00:00:00.000Z" }),
    ).rejects.toThrow();
    expect(store.findUser("admin")).toBeUndefined();
    expect(store.findSession("t1")).toBeUndefined();
  });

  it("keeps a leased superseded generation until release, then reclaims it", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const captured = store.acquireBlob("tokyo-station");
    expect(captured).toBeDefined();
    if (!captured) return;
    const V2 = Buffer.from([1, 2, 3, 4]);
    await store.putDataset({ ...META, name: "v2" }, V2);
    expect(existsSync(captured.path)).toBe(true);
    expect(sha256(await readFile(captured.path))).toBe(captured.entry.contentHash);
    expect(await readFile(store.blobPath("tokyo-station"))).toEqual(V2);
    await captured.release();
    expect(existsSync(captured.path)).toBe(false);
    expect(await readdir(path.join(dir, "blobs"))).toHaveLength(1);
  });

  it("does not reclaim a leased generation that becomes current again", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const captured = store.acquireBlob("tokyo-station");
    expect(captured).toBeDefined();
    if (!captured) return;
    await store.putDataset({ ...META, name: "v2" }, Buffer.from([9, 8, 7, 6]));
    await store.putDataset(META, ZIP);
    expect(store.blobPath("tokyo-station")).toBe(captured.path);
    await captured.release();
    expect(await readFile(captured.path)).toEqual(ZIP);
    expect(await readdir(path.join(dir, "blobs"))).toEqual([path.basename(captured.path)]);
  });

  it("removes unreferenced blob generations and orphans at boot", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const current = path.basename(store.blobPath("tokyo-station"));
    await writeFile(path.join(dir, "blobs", "tokyo-station.deadbeef.zip"), ZIP);
    await writeFile(path.join(dir, "blobs", "ghost.cafef00d.zip"), ZIP);
    const reopened = await PlatformStore.open(dir);
    expect(await readdir(path.join(dir, "blobs"))).toEqual([current]);
    expect(reopened.listCatalog().map((entry) => entry.id)).toEqual(["tokyo-station"]);
    expect(await readFile(reopened.blobPath("tokyo-station"))).toEqual(ZIP);
  });

  it("keeps a leased deleted generation until release, then reclaims it", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const captured = store.acquireBlob("tokyo-station");
    expect(captured).toBeDefined();
    if (!captured) return;
    expect(await store.deleteDataset("tokyo-station")).toBe(true);
    expect(existsSync(captured.path)).toBe(true);
    expect(sha256(await readFile(captured.path))).toBe(captured.entry.contentHash);
    await captured.release();
    expect(existsSync(captured.path)).toBe(false);
    expect(await readdir(path.join(dir, "blobs"))).toEqual([]);
  });

  it("keeps a delete committed even when comment cleanup fails", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    await store.addComment("tokyo-station", { author: "alice", text: "hi" });
    mockCtl.rejectRmSubstring = ".json";
    try {
      expect(await store.deleteDataset("tokyo-station")).toBe(true);
    } finally {
      mockCtl.rejectRmSubstring = null;
    }
    expect(store.listCatalog()).toEqual([]);
    expect(store.getEntry("tokyo-station")).toBeUndefined();
    expect(await store.listComments("tokyo-station")).toEqual([]);
  });

  it("removes orphan comments for a deleted id so a reused id starts clean", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    await store.addComment("tokyo-station", { author: "alice", text: "old" });
    // Simulate a committed delete whose blob/comment cleanup was lost.
    await rm(store.blobPath("tokyo-station"), { force: true });
    await writeFile(path.join(dir, "catalog.json"), JSON.stringify([]));
    const reopened = await PlatformStore.open(dir);
    await reopened.putDataset(META, ZIP);
    expect(await reopened.listComments("tokyo-station")).toEqual([]);
  });

  it("durably prevents comment resurrection when delete AND reuse cleanup both fail", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    await store.addComment("tokyo-station", { author: "alice", text: "old" });
    // Keep every comment rm failing across the delete and the in-process reuse.
    mockCtl.rejectRmSubstring = ".json";
    try {
      expect(await store.deleteDataset("tokyo-station")).toBe(true);
      await store.putDataset(META, ZIP);
    } finally {
      mockCtl.rejectRmSubstring = null;
    }
    const reopened = await PlatformStore.open(dir);
    expect(await reopened.listComments("tokyo-station")).toEqual([]);
  });

  it("keeps every blob snapshot a matching readable pair during a paused put overwrite", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const before = store.getBlobSnapshot("tokyo-station");
    expect(before).toBeDefined();
    if (!before) return;
    const V2 = Buffer.from([9, 8, 7, 6, 5]);
    const reached = deferred();
    const release = deferred();
    mockCtl.onCatalogCommit = async () => {
      reached.resolve();
      await release.promise;
    };
    const putPromise = store.putDataset({ ...META, name: "v2" }, V2);
    try {
      await reached.promise;
      // Commit is paused: a fresh snapshot still resolves the prior generation, and the
      // earlier snapshot remains valid. Every snapshot's hash must match the bytes at its path.
      const during = store.getBlobSnapshot("tokyo-station");
      expect(during).toBeDefined();
      if (!during) return;
      expect(during.entry.contentHash).toBe(before.entry.contentHash);
      for (const snap of [before, during]) {
        expect(sha256(await readFile(snap.path))).toBe(snap.entry.contentHash);
      }
      expect(await readFile(during.path)).toEqual(ZIP);
      release.resolve();
      await putPromise;
    } finally {
      mockCtl.onCatalogCommit = null;
      release.resolve();
    }
    const after = store.getBlobSnapshot("tokyo-station");
    expect(after).toBeDefined();
    if (!after) return;
    expect(after.entry.contentHash).not.toBe(before.entry.contentHash);
    const afterBytes = await readFile(after.path);
    expect(sha256(afterBytes)).toBe(after.entry.contentHash);
    expect(afterBytes).toEqual(V2);
  });

  it("does not delete a retained generation when republishing it fails", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const retained = store.acquireBlob("tokyo-station");
    expect(retained).toBeDefined();
    if (!retained) return;
    const V2 = Buffer.from([9, 8, 7, 6, 5]);
    await store.putDataset({ ...META, name: "v2" }, V2);
    mockCtl.onCatalogCommit = async () => {
      throw new Error("catalog boom");
    };
    try {
      await expect(store.putDataset(META, ZIP)).rejects.toThrow("catalog boom");
    } finally {
      mockCtl.onCatalogCommit = null;
    }
    const retainedBytes = await readFile(retained.path);
    expect(retainedBytes).toEqual(ZIP);
    expect(sha256(retainedBytes)).toBe(retained.entry.contentHash);
    await retained.release();
    expect(existsSync(retained.path)).toBe(false);
  });

  it("keeps a blob snapshot readable and matching through a paused delete", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const snap = store.getBlobSnapshot("tokyo-station");
    expect(snap).toBeDefined();
    if (!snap) return;
    const reached = deferred();
    const release = deferred();
    mockCtl.onCatalogCommit = async () => {
      reached.resolve();
      await release.promise;
    };
    const delPromise = store.deleteDataset("tokyo-station");
    try {
      await reached.promise;
      // Commit is paused: the entry is still resolvable and the captured snapshot still reads
      // its own bytes.
      expect(store.getEntry("tokyo-station")).toBeDefined();
      expect(sha256(await readFile(snap.path))).toBe(snap.entry.contentHash);
      release.resolve();
      expect(await delPromise).toBe(true);
    } finally {
      mockCtl.onCatalogCommit = null;
      release.resolve();
    }
    expect(store.getEntry("tokyo-station")).toBeUndefined();
  });
});
