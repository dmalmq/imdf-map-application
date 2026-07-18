import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class BlobStore {
  private readonly root: string;

  constructor(dataDir: string) {
    this.root = join(dataDir, "blobs", "sha256");
  }

  path(hash: string): string {
    return join(this.root, hash.slice(0, 2), hash);
  }

  has(hash: string): boolean {
    return existsSync(this.path(hash));
  }

  read(hash: string): Buffer {
    return readFileSync(this.path(hash));
  }

  put(bytes: Uint8Array): { hash: string; size: number } {
    const hash = createHash("sha256").update(bytes).digest("hex");
    const target = this.path(hash);
    if (!existsSync(target)) {
      const dir = join(this.root, hash.slice(0, 2));
      mkdirSync(dir, { recursive: true });
      const tmp = join(dir, `.tmp-${randomBytes(6).toString("hex")}`);
      writeFileSync(tmp, bytes);
      renameSync(tmp, target);
    }
    return { hash, size: bytes.byteLength };
  }
}
