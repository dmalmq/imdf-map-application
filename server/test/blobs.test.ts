import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BlobStore } from "../src/blobs/store";

let dir: string;
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("BlobStore", () => {
  it("stores content-addressed, idempotent, readable", () => {
    dir = mkdtempSync(join(tmpdir(), "kiriko-blob-"));
    const store = new BlobStore(dir);
    const bytes = new TextEncoder().encode("kiriko");
    const a = store.put(bytes);
    const b = store.put(bytes);
    expect(a.hash).toBe(b.hash);
    expect(a.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.size).toBe(6);
    expect(store.has(a.hash)).toBe(true);
    expect(store.read(a.hash).toString()).toBe("kiriko");
    expect(store.path(a.hash)).toContain(join("blobs", "sha256", a.hash.slice(0, 2), a.hash));
  });
});
