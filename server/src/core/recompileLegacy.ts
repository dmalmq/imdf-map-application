import type Database from "better-sqlite3";
import type { BlobStore } from "../blobs/store";
import { compileVenueBundle } from "./native";

interface LegacyRow {
  id: number;
  seq: number;
  sourceHash: string;
  tenantSlug: string;
  venueSlug: string;
}

type CompileFn = typeof compileVenueBundle;

/**
 * Recompiles Phase One rows published by the pre-Task-5 runner, whose bundle
 * hashes still alias their retained source hashes. Runs sequentially in
 * `(venue_id, seq)` order so a shared
 * dataset never races itself, and updates each row only after its
 * compiled bytes are durably content-addressed.
 *
 * Called from `buildApp` after migration and blob-store construction but
 * before the job queue or any route registers, so a half-migrated row can
 * never be served under the bundle route/MIME type: on the first row that
 * fails to compile, this logs the exact version id and rethrows, leaving
 * that row (and every row after it) unchanged rather than silently
 * serving mislabeled ZIP bytes as a bundle.
 */
export async function recompileLegacyPublished(
  db: Database.Database,
  blobs: BlobStore,
  log: (message: string) => void = console.error,
  compile: CompileFn = compileVenueBundle,
): Promise<void> {
  const rows = db
    .prepare(
      `SELECT vr.id AS id, vr.seq AS seq, vr.source_blob_hash AS sourceHash,
              t.slug AS tenantSlug, v.slug AS venueSlug
       FROM versions vr
       JOIN venues v ON v.id = vr.venue_id
       JOIN tenants t ON t.id = v.tenant_id
       WHERE vr.status = 'published' AND vr.bundle_hash = vr.source_blob_hash
       ORDER BY vr.venue_id ASC, vr.seq ASC`,
    )
    .all() as LegacyRow[];

  for (const row of rows) {
    try {
      const source = blobs.read(row.sourceHash);
      const { bundle, stats } = await compile(source, {
        datasetId: `${row.tenantSlug}/${row.venueSlug}`,
        version: row.seq,
      });
      const { hash: bundleHash, size } = blobs.put(bundle);
      db.transaction(() => {
        db.prepare("INSERT OR IGNORE INTO blobs (hash, size) VALUES (?, ?)").run(bundleHash, size);
        db.prepare("UPDATE versions SET bundle_hash = ?, stats_json = ? WHERE id = ?").run(
          bundleHash,
          JSON.stringify(stats),
          row.id,
        );
      })();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      log(`legacy bundle backfill failed for version ${row.id}: ${reason}`);
      throw error;
    }
  }
}
