import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeStagedGdb, stageGdbBlobForGdal } from "../src/gdb/staging";

const cleanups: string[] = [];

afterEach(() => {
  for (const path of cleanups.splice(0)) {
    rmSync(path, { recursive: true, force: true });
  }
});

describe("GDB blob staging", () => {
  it("adds the extension GDAL requires and removes the staged copy", () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "kiriko-gdb-stage-source-"));
    cleanups.push(sourceDir);
    const source = join(sourceDir, "extensionless-hash");
    const bytes = Buffer.from("gdb zip bytes");
    writeFileSync(source, bytes);

    const staged = stageGdbBlobForGdal(source, "a".repeat(64));

    const stagedAgain = stageGdbBlobForGdal(source, "a".repeat(64));
    cleanups.push(stagedAgain);

    expect(stagedAgain).not.toBe(staged);
    expect(stagedAgain).toMatch(/\.gdb\.zip$/);
    expect(staged).toMatch(/\.gdb\.zip$/);
    expect(readFileSync(staged)).toEqual(bytes);
    expect(existsSync(staged)).toBe(true);

    removeStagedGdb(staged);
    expect(existsSync(staged)).toBe(false);
  });
});
