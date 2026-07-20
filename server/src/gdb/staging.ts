/**
 * Stage a content-addressed blob to a temporary `.gdb.zip` path so gdal3.js
 * recognizes the archive format. gdal3.js's OpenFileGDB driver sniffs the
 * `.gdb.zip` / `.zip` extension on the input path; the blob store names blobs
 * by bare SHA-256 hash with no extension, so a direct `gdal.open(blobPath)`
 * fails with an opaque Emscripten `FS error`.
 */
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const STAGE_ROOT = join(tmpdir(), "kiriko-gdb-stage");

/**
 * Copy the blob at `blobPath` into a uniquely named temp `.gdb.zip` and
 * return that path. The UUID suffix prevents concurrent requests for the same
 * content hash from deleting each other's staged file.
 */
export function stageGdbBlobForGdal(blobPath: string, hash: string): string {
  mkdirSync(STAGE_ROOT, { recursive: true });
  const staged = join(STAGE_ROOT, `${hash}-${randomUUID()}.gdb.zip`);
  copyFileSync(blobPath, staged);
  return staged;
}

/** Best-effort removal after GDAL closes the staged dataset. */
export function removeStagedGdb(stagedPath: string): void {
  rmSync(stagedPath, { force: true });
}
