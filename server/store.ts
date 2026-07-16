import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CatalogEntry, CommentRecord, SessionRecord, UserRecord } from "./types";

export const DATASET_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Catalog row as persisted; contentHash backs the blob ETag and never leaves the server. */
export interface StoredCatalogEntry extends CatalogEntry {
  contentHash: string;
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

  private constructor(private readonly dataDir: string) {}

  static async open(dataDir: string): Promise<PlatformStore> {
    const store = new PlatformStore(dataDir);
    await mkdir(path.join(dataDir, "blobs"), { recursive: true });
    await mkdir(path.join(dataDir, "comments"), { recursive: true });
    const rows = await readJsonFile<StoredCatalogEntry[]>(store.file("catalog.json"), []);
    const blobs = new Set(await readdir(path.join(dataDir, "blobs")));
    for (const row of rows) {
      if (blobs.has(`${row.id}.zip`)) {
        store.catalog.set(row.id, row);
      } else {
        console.warn(`[store] dropping catalog entry without blob: ${row.id}`);
      }
    }
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

  blobPath(id: string): string {
    this.assertDatasetId(id);
    return path.join(this.dataDir, "blobs", `${id}.zip`);
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
      const stored: StoredCatalogEntry = {
        ...meta,
        updatedAt: new Date().toISOString(),
        contentHash: createHash("sha256").update(blob).digest("hex"),
      };
      const blobPath = this.blobPath(meta.id);
      // Preserve the prior blob so a failed catalog write can be rolled back to a
      // consistent (blob, catalog) pair rather than leaving the two disagreeing.
      const backup = this.catalog.has(meta.id) ? `${blobPath}.bak-${randomUUID()}` : null;
      if (backup) {
        await rename(blobPath, backup);
      }
      try {
        await this.atomicWrite(blobPath, blob);
        const rows = [...this.catalog.values()].filter((entry) => entry.id !== meta.id);
        rows.push(stored);
        await this.atomicWrite(this.file("catalog.json"), JSON.stringify(rows, null, 2));
      } catch (error) {
        // Roll back to the prior (blob, catalog) pair. Remove the just-written blob
        // first so restoring the backup cannot collide with Windows rename-replace
        // semantics and strand the pair.
        await rm(blobPath, { force: true });
        if (backup) {
          await rename(backup, blobPath);
        }
        throw error;
      }
      // The catalog write above is the durable commit point; advance the in-memory
      // view immediately so a failed backup cleanup cannot turn a committed put into
      // a rejection. Backup removal is best-effort housekeeping only.
      this.catalog.set(meta.id, stored);
      if (backup) {
        await rm(backup, { force: true }).catch((error: unknown) => {
          console.warn(`[store] failed to remove blob backup ${backup}: ${String(error)}`);
        });
      }
      const { contentHash: _hash, ...entry } = stored;
      return entry;
    });
  }

  deleteDataset(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      this.assertDatasetId(id);
      if (!this.catalog.has(id)) {
        return false;
      }
      const rows = [...this.catalog.values()].filter((entry) => entry.id !== id);
      await this.atomicWrite(this.file("catalog.json"), JSON.stringify(rows, null, 2));
      this.catalog.delete(id);
      await rm(this.blobPath(id), { force: true });
      await rm(this.commentsPath(id), { force: true });
      return true;
    });
  }

  async listComments(datasetId: string): Promise<CommentRecord[]> {
    return readJsonFile<CommentRecord[]>(this.commentsPath(datasetId), []);
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
