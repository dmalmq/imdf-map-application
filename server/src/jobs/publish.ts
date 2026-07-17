import type Database from "better-sqlite3";
import type { BlobStore } from "../blobs/store";
import { validateImdfArchive } from "../imdf/validateArchive";

export function makePublishRunner(db: Database.Database, blobs: BlobStore) {
  return async (payloadJson: string): Promise<{ versionId: number }> => {
    const { versionId } = JSON.parse(payloadJson) as { versionId: number };
    const version = db
      .prepare("SELECT id, source_blob_hash AS hash FROM versions WHERE id = ?")
      .get(versionId) as { id: number; hash: string } | undefined;
    if (!version) {
      throw new Error(`version ${versionId} not found`);
    }
    try {
      const stats = await validateImdfArchive(blobs.read(version.hash));
      db.prepare(
        "UPDATE versions SET status = 'published', bundle_hash = source_blob_hash, stats_json = ? WHERE id = ?",
      ).run(JSON.stringify(stats), versionId);
      return { versionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      db.prepare("UPDATE versions SET status = 'failed', error = ? WHERE id = ?").run(
        message,
        versionId,
      );
      throw error;
    }
  };
}
