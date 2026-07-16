import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogEntry, CommentRecord, SessionRecord, UserRecord } from "./types.js";

export const DATASET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Catalog row as persisted; contentHash names the immutable blob generation and never leaves the server. */
export interface StoredCatalogEntry extends CatalogEntry {
  contentHash: string;
}

export interface BlobLease {
  entry: StoredCatalogEntry;
  path: string;
  release(): Promise<void>;
}

/** Read + parse a JSON file. A missing file yields the fallback; parse/permission/I/O errors propagate. */
async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
  return JSON.parse(raw) as T;
}

export class PlatformStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly catalog = new Map<string, StoredCatalogEntry>();
  private readonly users = new Map<string, UserRecord>();
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly deletedDatasets = new Set<string>();
  private readonly blobLeases = new Map<string, number>();
  private readonly retiredBlobs = new Set<string>();

  private constructor(private readonly dataDir: string) {}

  static async open(dataDir: string): Promise<PlatformStore> {
    const store = new PlatformStore(dataDir);
    await mkdir(path.join(dataDir, "blobs"), { recursive: true });
    await mkdir(path.join(dataDir, "comments"), { recursive: true });
    const rows = await readJsonFile<StoredCatalogEntry[]>(store.file("catalog.json"), []);
    // The catalog + contentHash is authoritative. Every blob file that is not the
    // referenced generation of a cataloged dataset (superseded generations, orphaned
    // writes from an interrupted put/delete, temp files) is unreferenced and removed.
    const blobDir = path.join(dataDir, "blobs");
    const referenced = new Set(rows.map((row) => `${row.id}.${row.contentHash}.zip`));
    const present = new Set<string>();
    for (const name of await readdir(blobDir)) {
      if (referenced.has(name)) {
        present.add(name);
      } else {
        await rm(path.join(blobDir, name), { force: true });
      }
    }
    for (const row of rows) {
      if (present.has(`${row.id}.${row.contentHash}.zip`)) {
        store.catalog.set(row.id, row);
      } else {
        console.warn(`[store] dropping catalog entry without blob: ${row.id}`);
      }
    }
    await store.recoverComments(new Set(store.catalog.keys()));
    for (const user of await readJsonFile<UserRecord[]>(store.file("users.json"), [])) {
      store.users.set(user.username, user);
    }
    for (const session of await readJsonFile<SessionRecord[]>(store.file("sessions.json"), [])) {
      store.sessions.set(session.token, session);
    }
    return store;
  }

  private file(name: string): string {
    return path.join(this.dataDir, name);
  }

  /** Reject any id that is not a bare slug before it can reach the filesystem. */
  private assertDatasetId(id: string): void {
    if (!DATASET_ID_RE.test(id)) {
      throw new Error(`invalid dataset id: ${JSON.stringify(id)}`);
    }
  }

  /** Immutable, content-addressed path of one blob generation. */
  private blobFile(id: string, contentHash: string): string {
    return path.join(this.dataDir, "blobs", `${id}.${contentHash}.zip`);
  }

  /** Path of the current generation of a dataset's blob. Throws if the id is unknown. */
  blobPath(id: string): string {
    this.assertDatasetId(id);
    const entry = this.catalog.get(id);
    if (!entry) {
      throw new Error(`unknown dataset: ${JSON.stringify(id)}`);
    }
    return this.blobFile(id, entry.contentHash);
  }

  /** Capture the current hash/path pair without retaining the generation. */
  getBlobSnapshot(id: string): { entry: StoredCatalogEntry; path: string } | undefined {
    this.assertDatasetId(id);
    const entry = this.catalog.get(id);
    if (!entry) {
      return undefined;
    }
    return { entry, path: this.blobFile(id, entry.contentHash) };
  }

  /**
   * Retain the current immutable generation until the caller releases it. HTTP readers use
   * this so overwrite/delete can reclaim old generations promptly without racing a response
   * that has resolved the path but has not finished streaming it.
   */
  acquireBlob(id: string): BlobLease | undefined {
    const snapshot = this.getBlobSnapshot(id);
    if (snapshot === undefined) return undefined;
    const { path: blobPath } = snapshot;
    this.blobLeases.set(blobPath, (this.blobLeases.get(blobPath) ?? 0) + 1);
    let released = false;
    return {
      ...snapshot,
      release: async () => {
        if (released) return;
        released = true;
        await this.enqueue(async () => {
          const count = this.blobLeases.get(blobPath) ?? 0;
          if (count > 1) {
            this.blobLeases.set(blobPath, count - 1);
            return;
          }
          this.blobLeases.delete(blobPath);
          if (this.retiredBlobs.delete(blobPath)) {
            await rm(blobPath, { force: true }).catch((error: unknown) => {
              console.warn(`[store] failed to reclaim blob ${blobPath}: ${String(error)}`);
            });
          }
        });
      },
    };
  }

  private commentsPath(id: string): string {
    this.assertDatasetId(id);
    return path.join(this.dataDir, "comments", `${id}.json`);
  }

  /** All mutations run through one queue; each file write is temp + rename. */
  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work, work);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async atomicWrite(file: string, data: string | Buffer): Promise<void> {
    const tmp = `${file}.tmp-${randomUUID()}`;
    await writeFile(tmp, data);
    await rename(tmp, file);
  }

  /** Reclaim an unreferenced generation now, or after its last active reader releases it. */
  private async retireBlob(blobPath: string): Promise<void> {
    if ((this.blobLeases.get(blobPath) ?? 0) > 0) {
      this.retiredBlobs.add(blobPath);
      return;
    }
    await rm(blobPath, { force: true }).catch((error: unknown) => {
      console.warn(`[store] failed to reclaim blob ${blobPath}: ${String(error)}`);
    });
  }

  /**
   * Reconcile comment files against the persisted catalog. Comment files for ids no longer
   * cataloged are removed so old comments cannot resurface if the id is reused; partial
   * `.tmp-*` writes and any other stray file are dropped. Live comments of a cataloged id
   * are authoritative and kept.
   */
  private async recoverComments(catalogIds: Set<string>): Promise<void> {
    const dir = path.join(this.dataDir, "comments");
    for (const name of await readdir(dir)) {
      const live = /^(.+)\.json$/.exec(name);
      if (live) {
        if (!catalogIds.has(live[1] as string)) {
          await rm(path.join(dir, name), { force: true });
        }
      } else {
        await rm(path.join(dir, name), { force: true });
      }
    }
  }

  listCatalog(): CatalogEntry[] {
    return [...this.catalog.values()]
      .map(({ contentHash: _hash, ...entry }) => entry)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  getEntry(id: string): StoredCatalogEntry | undefined {
    return this.catalog.get(id);
  }

  putDataset(meta: Omit<CatalogEntry, "updatedAt">, blob: Buffer): Promise<CatalogEntry> {
    return this.enqueue(async () => {
      this.assertDatasetId(meta.id);
      const contentHash = createHash("sha256").update(blob).digest("hex");
      const stored: StoredCatalogEntry = {
        ...meta,
        updatedAt: new Date().toISOString(),
        contentHash,
      };
      const newBlob = this.blobFile(meta.id, contentHash);
      const previous = this.catalog.get(meta.id);
      // A create or reuse (id absent) starts with a durable empty comments file, written
      // before the catalog commit, so recovery treats live comments as authoritative and a
      // reused id cannot resurface old comments. A true overwrite keeps its comments.
      const isNew = previous === undefined;
      const commentsPath = this.commentsPath(meta.id);
      // Write a new immutable generation completely before touching the catalog. A retained
      // generation may already exist after an earlier overwrite/delete; this attempt does not
      // own it and must never remove it during rollback.
      let createdGeneration = false;
      try {
        try {
          await stat(newBlob);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            throw error;
          }
          await this.atomicWrite(newBlob, blob);
          createdGeneration = true;
        }
        if (isNew) {
          await this.atomicWrite(commentsPath, JSON.stringify([], null, 2));
        }
        const rows = [...this.catalog.values()].filter((entry) => entry.id !== meta.id);
        rows.push(stored);
        await this.atomicWrite(this.file("catalog.json"), JSON.stringify(rows, null, 2));
      } catch (error) {
        // Roll back only a generation created by this attempt. An existing same-hash path can
        // be a retained snapshot from an older catalog generation.
        if (createdGeneration) {
          await rm(newBlob, { force: true });
        }
        if (isNew) {
          await rm(commentsPath, { force: true });
        }
        throw error;
      }
      // Catalog is the durable commit point: advance memory, cancel any pending retirement
      // when an older hash becomes current again, then reclaim the superseded generation once
      // its active readers (if any) drain.
      this.catalog.set(meta.id, stored);
      this.deletedDatasets.delete(meta.id);
      this.retiredBlobs.delete(newBlob);
      if (previous !== undefined && previous.contentHash !== contentHash) {
        await this.retireBlob(this.blobFile(meta.id, previous.contentHash));
      }
      const { contentHash: _hash, ...entry } = stored;
      return entry;
    });
  }

  deleteDataset(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      this.assertDatasetId(id);
      const entry = this.catalog.get(id);
      if (!entry) {
        return false;
      }
      const rows = [...this.catalog.values()].filter((row) => row.id !== id);
      await this.atomicWrite(this.file("catalog.json"), JSON.stringify(rows, null, 2));
      // Committed: advance memory and retire the immutable generation. Active leases keep it
      // readable until their response streams close; otherwise it is reclaimed immediately.
      // Startup GC remains the crash-recovery fallback. Comments are fixed-path and cleaned
      // best-effort, while the deleted marker makes them immediately unobservable.
      this.catalog.delete(id);
      this.deletedDatasets.add(id);
      await this.retireBlob(this.blobFile(id, entry.contentHash));
      await rm(this.commentsPath(id), { force: true }).catch((error: unknown) => {
        console.warn(`[store] failed to remove comments for ${id}: ${String(error)}`);
      });
      return true;
    });
  }

  async listComments(datasetId: string): Promise<CommentRecord[]> {
    const commentsPath = this.commentsPath(datasetId);
    if (this.deletedDatasets.has(datasetId)) {
      return [];
    }
    return readJsonFile<CommentRecord[]>(commentsPath, []);
  }

  addComment(
    datasetId: string,
    input: Omit<CommentRecord, "id" | "createdAt">,
  ): Promise<CommentRecord> {
    return this.enqueue(async () => {
      const commentsPath = this.commentsPath(datasetId);
      const record: CommentRecord = {
        ...input,
        id: randomUUID(),
        createdAt: new Date().toISOString(),
      };
      const all = await readJsonFile<CommentRecord[]>(commentsPath, []);
      all.push(record);
      await this.atomicWrite(commentsPath, JSON.stringify(all, null, 2));
      return record;
    });
  }

  deleteComment(datasetId: string, commentId: string): Promise<CommentRecord | null> {
    return this.enqueue(async () => {
      const commentsPath = this.commentsPath(datasetId);
      const all = await readJsonFile<CommentRecord[]>(commentsPath, []);
      const index = all.findIndex((comment) => comment.id === commentId);
      if (index === -1) {
        return null;
      }
      const [removed] = all.splice(index, 1);
      await this.atomicWrite(commentsPath, JSON.stringify(all, null, 2));
      return removed ?? null;
    });
  }

  findUser(username: string): UserRecord | undefined {
    return this.users.get(username);
  }

  upsertUser(user: UserRecord): Promise<void> {
    return this.enqueue(async () => {
      const rows = [...this.users.values()].filter((row) => row.username !== user.username);
      rows.push(user);
      await this.atomicWrite(this.file("users.json"), JSON.stringify(rows, null, 2));
      this.users.set(user.username, user);
    });
  }

  findSession(token: string): SessionRecord | undefined {
    return this.sessions.get(token);
  }

  addSession(session: SessionRecord): Promise<void> {
    return this.enqueue(async () => {
      const rows = [...this.sessions.values()].filter((row) => row.token !== session.token);
      rows.push(session);
      await this.atomicWrite(this.file("sessions.json"), JSON.stringify(rows, null, 2));
      this.sessions.set(session.token, session);
    });
  }

  deleteSession(token: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.sessions.has(token)) {
        return;
      }
      const rows = [...this.sessions.values()].filter((row) => row.token !== token);
      await this.atomicWrite(this.file("sessions.json"), JSON.stringify(rows, null, 2));
      this.sessions.delete(token);
    });
  }
}
