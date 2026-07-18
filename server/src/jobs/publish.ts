import type Database from "better-sqlite3";
import type { BlobStore } from "../blobs/store";
import { compileVenueBundle, CoreCompileError } from "../core/native";

/** Persisted into `versions.error` (and mirrored into `jobs.error`) verbatim as JSON. */
interface StructuredError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Thrown when the version row identified by `versionId` no longer matches
 * the identity snapshot taken before compilation started — e.g. its venue
 * was deleted (cascading the version row) and a fresh row was inserted
 * while the long `await compile` was in flight. SQLite reuses a freed
 * INTEGER PRIMARY KEY rowid once the table's max rowid row is gone, so
 * `versionId` alone is never a safe target across that await. Never a
 * genuine compile/domain failure.
 */
class StaleVersionError extends Error {
  constructor(versionId: number) {
    super(`version ${versionId} was replaced during compilation`);
    this.name = "StaleVersionError";
  }
}

function toStructuredError(error: unknown): StructuredError {
  if (error instanceof CoreCompileError) {
    return error.details === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, details: error.details };
  }
  if (error instanceof StaleVersionError) {
    return { code: "stale_version", message: error.message };
  }
  return { code: "internal_error", message: error instanceof Error ? error.message : String(error) };
}

interface PublishRow {
  id: number;
  venueId: number;
  seq: number;
  hash: string;
  status: string;
  tenantSlug: string;
  venueSlug: string;
}

type PublishCompileFn = typeof compileVenueBundle;

export function makePublishRunner(
  db: Database.Database,
  blobs: BlobStore,
  compile: PublishCompileFn = compileVenueBundle,
) {
  return async (payloadJson: string): Promise<{ versionId: number }> => {
    const { versionId } = JSON.parse(payloadJson) as { versionId: number };
    const version = db
      .prepare(
        `SELECT vr.id AS id, vr.venue_id AS venueId, vr.seq AS seq, vr.source_blob_hash AS hash,
                vr.status AS status, t.slug AS tenantSlug, v.slug AS venueSlug
         FROM versions vr
         JOIN venues v ON v.id = vr.venue_id
         JOIN tenants t ON t.id = v.tenant_id
         WHERE vr.id = ?`,
      )
      .get(versionId) as PublishRow | undefined;
    if (!version) {
      throw new Error(`version ${versionId} not found`);
    }

    // Identity snapshot taken *before* the long `await compile`. Every
    // write below is scoped to this exact (id, venue_id, seq,
    // source_blob_hash, status) tuple and requires exactly one changed
    // row, so a row that reused `versionId` after a cascade delete +
    // recreate is never published onto, nor marked failed, by a compile
    // that was never actually running against it.
    const identityWhere = "id = ? AND venue_id = ? AND seq = ? AND source_blob_hash = ? AND status = ?";
    const identityParams = [version.id, version.venueId, version.seq, version.hash, version.status] as const;

    try {
      const source = blobs.read(version.hash);
      const { bundle, stats } = await compile(source, {
        datasetId: `${version.tenantSlug}/${version.venueSlug}`,
        version: version.seq,
      });
      // Content-addressed: safe to persist even if this row turns out to
      // be stale below — the blob then simply has no referencing row.
      const { hash: bundleHash, size } = blobs.put(bundle);
      const published = db.transaction(() => {
        db.prepare("INSERT OR IGNORE INTO blobs (hash, size) VALUES (?, ?)").run(bundleHash, size);
        const result = db
          .prepare(
            `UPDATE versions SET status = 'published', bundle_hash = ?, stats_json = ?, error = NULL
             WHERE ${identityWhere}`,
          )
          .run(bundleHash, JSON.stringify(stats), ...identityParams);
        return result.changes === 1;
      })();
      if (!published) {
        throw new StaleVersionError(version.id);
      }
      return { versionId };
    } catch (error) {
      // Domain (invalid IMDF), bridge (native/FFI), blob-store, DB, and
      // stale-identity failures all land here: the source blob is never
      // touched, and this write only ever targets the exact row
      // snapshotted above, so a replacement row that reused `versionId`
      // is never marked failed by a compile that was never really its own.
      const structured = toStructuredError(error);
      db.prepare(`UPDATE versions SET status = 'failed', bundle_hash = NULL, error = ? WHERE ${identityWhere}`).run(
        JSON.stringify(structured),
        ...identityParams,
      );
      throw new Error(JSON.stringify(structured));
    }
  };
}
