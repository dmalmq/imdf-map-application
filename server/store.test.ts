// @vitest-environment node
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PlatformStore } from "./store";
import type { CatalogEntry } from "./types";
import type { PathLike, RmOptions } from "node:fs";

const mockCtl = vi.hoisted(() => ({ rejectRmSubstring: null as string | null }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = (await importOriginal()) as {
    rm: (target: PathLike, options?: RmOptions) => Promise<void>;
  } & Record<string, unknown>;
  return {
    ...actual,
    rm: (target: PathLike, options?: RmOptions): Promise<void> =>
      mockCtl.rejectRmSubstring !== null && String(target).includes(mockCtl.rejectRmSubstring)
        ? Promise.reject(new Error("cleanup boom"))
        : actual.rm(target, options),
  };
});

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "gis-store-"));
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
    const reopened = await PlatformStore.open(dir);
    expect(reopened.listCatalog().map((entry) => entry.id)).toEqual(["tokyo-station"]);
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

  it("rolls back a new put when catalog persistence fails, leaving no orphan blob", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await mkdir(path.join(dir, "catalog.json"));
    await expect(store.putDataset(META, ZIP)).rejects.toThrow();
    expect(existsSync(store.blobPath("tokyo-station"))).toBe(false);
    expect(store.getEntry("tokyo-station")).toBeUndefined();
    expect(store.listCatalog()).toEqual([]);
  });

  it("rolls back an overwrite when catalog persistence fails, preserving the old blob and entry", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const original = await readFile(store.blobPath("tokyo-station"));
    await rm(path.join(dir, "catalog.json"));
    await mkdir(path.join(dir, "catalog.json"));
    await expect(store.putDataset({ ...META, name: "v2" }, Buffer.from([9, 9, 9]))).rejects.toThrow();
    expect(await readFile(store.blobPath("tokyo-station"))).toEqual(original);
    expect(store.getEntry("tokyo-station")?.name).toBe("東京駅");
    expect(await readdir(path.join(dir, "blobs"))).toEqual(["tokyo-station.zip"]);
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

  it("keeps an overwrite committed even when post-commit backup cleanup fails", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const NEW = Buffer.from([1, 2, 3, 4]);
    mockCtl.rejectRmSubstring = ".bak-";
    try {
      const entry = await store.putDataset({ ...META, name: "v2", featureCount: 42 }, NEW);
      expect(entry.name).toBe("v2");
    } finally {
      mockCtl.rejectRmSubstring = null;
    }
    expect(store.getEntry("tokyo-station")?.name).toBe("v2");
    expect(store.getEntry("tokyo-station")?.featureCount).toBe(42);
    expect(await readFile(store.blobPath("tokyo-station"))).toEqual(NEW);
    expect(store.listCatalog()[0]?.name).toBe("v2");
  });

  it("recovers an overwrite interrupted after the new blob is published (before catalog commit)", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const blob = store.blobPath("tokyo-station");
    // Crash state: old blob moved to a backup, new content published, catalog still v1.
    await rename(blob, `${blob}.bak-crash`);
    await writeFile(blob, Buffer.from([7, 7, 7]));
    const reopened = await PlatformStore.open(dir);
    expect(reopened.getEntry("tokyo-station")?.name).toBe("東京駅");
    expect(await readFile(reopened.blobPath("tokyo-station"))).toEqual(ZIP);
    expect(await readdir(path.join(dir, "blobs"))).toEqual(["tokyo-station.zip"]);
  });

  it("recovers an overwrite interrupted after the old blob was moved aside", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const blob = store.blobPath("tokyo-station");
    // Crash state: old blob moved to backup, new blob never published, catalog still v1.
    await rename(blob, `${blob}.bak-crash`);
    const reopened = await PlatformStore.open(dir);
    expect(reopened.getEntry("tokyo-station")?.name).toBe("東京駅");
    expect(await readFile(reopened.blobPath("tokyo-station"))).toEqual(ZIP);
    expect(await readdir(path.join(dir, "blobs"))).toEqual(["tokyo-station.zip"]);
  });

  it("cleans a stale backup left after a committed overwrite, retaining the new blob", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const V2 = Buffer.from([9, 9, 9]);
    await store.putDataset({ ...META, name: "v2" }, V2);
    const blob = store.blobPath("tokyo-station");
    await writeFile(`${blob}.bak-stale`, ZIP);
    const reopened = await PlatformStore.open(dir);
    expect(reopened.getEntry("tokyo-station")?.name).toBe("v2");
    expect(await readFile(reopened.blobPath("tokyo-station"))).toEqual(V2);
    expect(await readdir(path.join(dir, "blobs"))).toEqual(["tokyo-station.zip"]);
  });

  it("keeps a delete committed and comments gone even when tombstone cleanup fails", async () => {
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
    expect(await store.listComments("tokyo-station")).toEqual([]);
  });

  it("removes orphan comments for a deleted id so a reused id starts clean", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    await store.addComment("tokyo-station", { author: "alice", text: "old" });
    // Simulate a delete whose committed catalog persisted but blob/comment cleanup was lost.
    await writeFile(path.join(dir, "catalog.json"), JSON.stringify([]));
    await rm(store.blobPath("tokyo-station"), { force: true });
    const reopened = await PlatformStore.open(dir);
    await reopened.putDataset(META, ZIP);
    expect(await reopened.listComments("tokyo-station")).toEqual([]);
  });

  it("restores a pre-commit delete tombstone for a still-cataloged entry", async () => {
    const dir = await tempDir();
    const store = await PlatformStore.open(dir);
    await store.putDataset(META, ZIP);
    const created = await store.addComment("tokyo-station", { author: "alice", text: "keep" });
    const blob = store.blobPath("tokyo-station");
    const comments = path.join(dir, "comments", "tokyo-station.json");
    // Crash state: delete moved blob + comments aside but never committed the catalog.
    await rename(blob, `${blob}.tomb-crash`);
    await rename(comments, `${comments}.tomb-crash`);
    const reopened = await PlatformStore.open(dir);
    expect(reopened.getEntry("tokyo-station")?.name).toBe("東京駅");
    expect(await readFile(reopened.blobPath("tokyo-station"))).toEqual(ZIP);
    expect(await reopened.listComments("tokyo-station")).toEqual([created]);
  });
});
