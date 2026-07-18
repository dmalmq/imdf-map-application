import type Database from "better-sqlite3";
import type { BlobStore } from "../blobs/store";
import { compileVenueBundle, CoreCompileError } from "../core/native";

/** Persisted into `versions.error` (and mirrored into `jobs.error`) verbatim as JSON. */
interface StructuredError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

function toStructuredError(error: unknown): StructuredError {
  if (error instanceof CoreCompileError) {
    return error.details === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, details: error.details };
  }
  return { code: "internal_error", message: error instanceof Error ? error.message : String(error) };
}

interface PublishRow {
  id: number;
  seq: number;
  hash: string;
  tenantSlug: string;
  venueSlug: string;
}

export function makePublishRunner(db: Database.Database, blobs: BlobStore) {
  return async (payloadJson: string): Promise<{ versionId: number }> => {
    const { versionId } = JSON.parse(payloadJson) as { versionId: number };
    const version = db
      .prepare(
        `SELECT vr.id AS id, vr.seq AS seq, vr.source_blob_hash AS hash,
                t.slug AS tenantSlug, v.slug AS venueSlug
         FROM versions vr
         JOIN venues v ON v.id = vr.venue_id
         JOIN tenants t ON t.id = v.tenant_id
         WHERE vr.id = ?`,
      )
      .get(versionId) as PublishRow | undefined;
    if (!version) {
      throw new Error(`version ${versionId} not found`);
    }
    try {
      const source = blobs.read(version.hash);
      const { bundle, stats } = await compileVenueBundle(source, {
        datasetId: `${version.tenantSlug}/${version.venueSlug}`,
        version: version.seq,
      });
      const { hash: bundleHash, size } = blobs.put(bundle);
      db.transaction(() => {
        db.prepare("INSERT OR IGNORE INTO blobs (hash, size) VALUES (?, ?)").run(bundleHash, size);
        db.prepare(
          "UPDATE versions SET status = 'published', bundle_hash = ?, stats_json = ?, error = NULL WHERE id = ?",
        ).run(bundleHash, JSON.stringify(stats), versionId);
      })();
      return { versionId };
    } catch (error) {
      // Domain (invalid IMDF), bridge (native/FFI), blob-store, and DB
      // failures all land here: the source blob is never touched, only
      // the publication state is cleared and the failure is recorded as a
      // stable `{code,message,details?}` JSON string.
      const structured = toStructuredError(error);
      db.prepare("UPDATE versions SET status = 'failed', bundle_hash = NULL, error = ? WHERE id = ?").run(
        JSON.stringify(structured),
        versionId,
      );
      throw new Error(JSON.stringify(structured));
    }
  };
}
