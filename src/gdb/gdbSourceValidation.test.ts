import {
  BlobWriter,
  TextReader,
  ZipReader,
  ZipWriter,
  configure,
  type Entry,
} from "@zip.js/zip.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ArchiveError } from "../errors/ArchiveError";
import {
  GDB_MAX_COMPRESSED_BYTES,
  GDB_MAX_FILE_BYTES,
  GDB_MAX_SELECTED_FILES,
  GDB_MAX_TOTAL_BYTES,
  stagedGroupRoot,
  validateGdbSources,
  type GdbSourceGroup,
} from "./gdbSourceValidation";
import type { GdbSourceFile } from "./types";

afterEach(() => {
  vi.restoreAllMocks();
});

configure({ useWebWorkers: false });

/** Directory descriptor backed by a size-only File stub (no bytes read here). */
function dirFile(relativePath: string, size = 16): GdbSourceFile {
  const name = relativePath.split("/").pop() ?? relativePath;
  const file = { size, name } as unknown as File;
  return { file, name, relativePath };
}

/** Compressed-archive descriptor stub (used only when size short-circuits). */
function archiveStub(name: string, size: number): GdbSourceFile {
  const file = { size, name } as unknown as File;
  return { file, name, relativePath: name };
}

async function buildZip(
  entries: Record<string, string>,
  options?: { password?: string },
): Promise<Uint8Array> {
  const password = options?.password;
  const base = { level: 0 as const, extendedTimestamp: false as const };
  const writerOptions = password !== undefined
    ? { ...base, password, encryptionStrength: 3 as const }
    : base;
  const writer = new ZipWriter(new BlobWriter("application/zip"), writerOptions);
  for (const [name, value] of Object.entries(entries)) {
    await writer.add(name, new TextReader(value), writerOptions);
  }
  const blob = await writer.close();
  return new Uint8Array(await blob.arrayBuffer());
}

function zipFile(bytes: Uint8Array, name: string): GdbSourceFile {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const file = new File([copy], name, { type: "application/zip" });
  return { file, name, relativePath: name };
}

/** Patch every local + central declared uncompressed-size field for an entry. */
function patchDeclaredUncompressedSize(
  zipBytes: Uint8Array,
  entryName: string,
  uncompressedSize: number,
): Uint8Array {
  const nameBytes = new TextEncoder().encode(entryName);
  const out = new Uint8Array(zipBytes);
  let patched = 0;
  for (let i = 0; i + 4 <= out.length; i++) {
    const sig = out[i]! | (out[i + 1]! << 8) | (out[i + 2]! << 16) | (out[i + 3]! << 24);
    let nameOffset = -1;
    let sizeOffset = -1;
    if (sig === 0x04034b50) {
      sizeOffset = i + 22;
      nameOffset = i + 30;
    } else if (sig === 0x02014b50) {
      sizeOffset = i + 24;
      nameOffset = i + 46;
    } else {
      continue;
    }
    if (nameOffset + nameBytes.length > out.length) continue;
    let match = true;
    for (let j = 0; j < nameBytes.length; j++) {
      if (out[nameOffset + j] !== nameBytes[j]) {
        match = false;
        break;
      }
    }
    if (!match) continue;
    out[sizeOffset] = uncompressedSize & 0xff;
    out[sizeOffset + 1] = (uncompressedSize >>> 8) & 0xff;
    out[sizeOffset + 2] = (uncompressedSize >>> 16) & 0xff;
    out[sizeOffset + 3] = (uncompressedSize >>> 24) & 0xff;
    patched += 1;
  }
  if (patched < 2) {
    throw new Error(`expected >=2 headers for "${entryName}", found ${patched}`);
  }
  return out;
}

describe("validateGdbSources — directory mode", () => {
  it("groups multiple .gdb roots deterministically and ignores stray files", async () => {
    const result = await validateGdbSources("directory", [
      dirFile("parent/b.gdb/a00000009.gdbtable"),
      dirFile("parent/a.gdb/a00000009.gdbtable"),
      dirFile("parent/notes.mxd"),
      dirFile("parent/a.gdb/gdb"),
    ]);

    expect(result.mode).toBe("directory");
    expect(result.groups.map((g) => g.databaseId)).toEqual(["gdb-1", "gdb-2"]);
    expect(result.groups[0]!.name).toBe("a.gdb");
    expect(result.groups[1]!.name).toBe("b.gdb");
    // Stray .mxd is not staged under any group.
    expect(result.groups[0]!.files).toHaveLength(2);
    expect(result.groups[1]!.files).toHaveLength(1);
  });

  it("keeps same-basename .gdb roots as distinct databases by path", async () => {
    const result = await validateGdbSources("directory", [
      dirFile("parent/b/network.gdb/a00000009.gdbtable"),
      dirFile("parent/a/network.gdb/a00000009.gdbtable"),
      dirFile("parent/a/network.gdb/gdb"),
    ]);

    expect(result.groups).toHaveLength(2);
    expect(result.groups.map((g) => g.databaseId)).toEqual(["gdb-1", "gdb-2"]);
    // Sorted by normalized relative path: parent/a/... before parent/b/...
    expect(result.groups[0]!.name).toBe("network.gdb");
    expect(result.groups[0]!.relativePath).toBe("parent/a/network.gdb");
    expect(result.groups[1]!.name).toBe("network.gdb");
    expect(result.groups[1]!.relativePath).toBe("parent/b/network.gdb");
    expect(result.groups[0]!.files).toHaveLength(2);
    expect(result.groups[1]!.files).toHaveLength(1);
  });

  it("rejects a selection with no .gdb root", async () => {
    await expect(
      validateGdbSources("directory", [dirFile("parent/notes.mxd")]),
    ).rejects.toMatchObject({ code: "invalid_geodatabase" });
  });

  it("rejects an empty selection", async () => {
    await expect(validateGdbSources("directory", [])).rejects.toBeInstanceOf(ArchiveError);
  });

  it("rejects unsafe relative path segments", async () => {
    await expect(
      validateGdbSources("directory", [dirFile("a.gdb/../../etc/passwd")]),
    ).rejects.toMatchObject({ code: "invalid_geodatabase" });
  });

  it("rejects more than the selected-file count limit", async () => {
    const files: GdbSourceFile[] = [];
    for (let i = 0; i <= GDB_MAX_SELECTED_FILES; i++) {
      files.push(dirFile(`a.gdb/file${i}`));
    }
    await expect(
      validateGdbSources("directory", files),
    ).rejects.toMatchObject({ code: "gdb_too_large" });
  });

  it("rejects a single staged file above the per-file limit", async () => {
    await expect(
      validateGdbSources("directory", [dirFile("a.gdb/huge", GDB_MAX_FILE_BYTES + 1)]),
    ).rejects.toMatchObject({ code: "gdb_too_large" });
  });

  it("rejects staged bytes above the total limit", async () => {
    await expect(
      validateGdbSources("directory", [
        dirFile("a.gdb/one", GDB_MAX_FILE_BYTES),
        dirFile("a.gdb/two", GDB_MAX_FILE_BYTES),
        dirFile("a.gdb/three", GDB_MAX_FILE_BYTES),
      ]),
    ).rejects.toMatchObject({ code: "gdb_too_large" });
  });

  it("accepts a total exactly at the limit", async () => {
    // 200 + 200 + 100 = 500 MiB total, each within the 200 MiB per-file cap.
    const result = await validateGdbSources("directory", [
      dirFile("a.gdb/one", GDB_MAX_FILE_BYTES),
      dirFile("a.gdb/two", GDB_MAX_FILE_BYTES),
      dirFile("a.gdb/three", GDB_MAX_TOTAL_BYTES - 2 * GDB_MAX_FILE_BYTES),
    ]);
    expect(result.groups).toHaveLength(1);
  });
});

describe("validateGdbSources — archive mode", () => {
  it("groups multiple archives deterministically by normalized path", async () => {
    const zipB = zipFile(await buildZip({ "b.gdb/a00000009.gdbtable": "x" }), "zb.zip");
    const zipA = zipFile(await buildZip({ "a.gdb/a00000009.gdbtable": "x" }), "za.zip");

    const result = await validateGdbSources("archive", [zipB, zipA]);
    expect(result.mode).toBe("archive");
    expect(result.groups.map((g) => g.databaseId)).toEqual(["gdb-1", "gdb-2"]);
    expect(result.groups[0]!.relativePath).toBe("za.zip");
    expect(result.groups[0]!.name).toBe("a.gdb");
    expect(result.groups[1]!.name).toBe("b.gdb");
  });

  it("requires exactly one .gdb root per archive", async () => {
    const bad = zipFile(
      await buildZip({ "a.gdb/x": "1", "b.gdb/y": "2" }),
      "multi.zip",
    );
    await expect(
      validateGdbSources("archive", [bad]),
    ).rejects.toMatchObject({ code: "invalid_geodatabase" });
  });

  it("rejects an archive with no .gdb root", async () => {
    const bad = zipFile(await buildZip({ "notes/readme.txt": "1" }), "none.zip");
    await expect(
      validateGdbSources("archive", [bad]),
    ).rejects.toMatchObject({ code: "invalid_geodatabase" });
  });

  it("rejects a non-zip selection", async () => {
    await expect(
      validateGdbSources("archive", [archiveStub("data.tar", 10)]),
    ).rejects.toMatchObject({ code: "invalid_geodatabase" });
  });

  it("rejects encrypted archive entries", async () => {
    const enc = zipFile(
      await buildZip({ "a.gdb/x": "secret" }, { password: "pw" }),
      "enc.zip",
    );
    await expect(
      validateGdbSources("archive", [enc]),
    ).rejects.toMatchObject({ code: "invalid_geodatabase" });
  });

  it("rejects unsafe archive entry paths", async () => {
    const unsafe = zipFile(
      await buildZip({ "a.gdb/x": "1", "a.gdb/../../evil": "2" }),
      "unsafe.zip",
    );
    await expect(
      validateGdbSources("archive", [unsafe]),
    ).rejects.toMatchObject({ code: "invalid_geodatabase" });
  });

  it("rejects Windows drive-qualified absolute ZIP entry paths", async () => {
    const drivePaths = [
      "C:/parent/data.gdb/a00000001.gdbtable",
      "c:/parent/data.gdb/a00000001.gdbtable",
      "D:\\parent\\data.gdb\\a00000001.gdbtable",
    ];
    for (const entryPath of drivePaths) {
      const bad = zipFile(
        await buildZip({ [entryPath]: "x" }),
        "drive.zip",
      );
      await expect(
        validateGdbSources("archive", [bad]),
      ).rejects.toMatchObject({ code: "invalid_geodatabase" });
    }

    const good = zipFile(
      await buildZip({ "parent/data.gdb/a00000001.gdbtable": "x" }),
      "relative.zip",
    );
    await expect(validateGdbSources("archive", [good])).resolves.toMatchObject({
      mode: "archive",
      groups: [{ name: "data.gdb" }],
    });
  });

  it("rejects compressed archives above the total compressed limit", async () => {
    await expect(
      validateGdbSources("archive", [
        archiveStub("a.zip", GDB_MAX_COMPRESSED_BYTES),
        archiveStub("b.zip", 1),
      ]),
    ).rejects.toMatchObject({ code: "gdb_too_large" });
  });

  it("rejects a declared-uncompressed entry above the per-file limit", async () => {
    const raw = await buildZip({ "a.gdb/big": "tiny" });
    const patched = patchDeclaredUncompressedSize(raw, "a.gdb/big", GDB_MAX_FILE_BYTES + 1);
    await expect(
      validateGdbSources("archive", [zipFile(patched, "big.zip")]),
    ).rejects.toMatchObject({ code: "gdb_too_large" });
  });
});

function fakeEntry(filename: string, uncompressedSize = 1, encrypted = false): Entry {
  return {
    filename,
    uncompressedSize,
    compressedSize: uncompressedSize,
    encrypted,
    directory: false,
  } as unknown as Entry;
}

/** Async generator stub for ZipReader.getEntriesGenerator mocks. */
function entriesGenerator(entries: readonly Entry[]): AsyncGenerator<Entry, boolean> {
  return (async function* () {
    for (const entry of entries) {
      yield entry;
    }
    return false;
  })();
}

/** Real (Blob-backed) zip File with an overridden `size` — no giant buffer. */
function sizedZipFile(name: string, size: number): GdbSourceFile {
  const file = new File([new Uint8Array(8)], name, { type: "application/zip" });
  Object.defineProperty(file, "size", { value: size });
  return { file, name, relativePath: name };
}

describe("stagedGroupRoot", () => {
  it("stages equal-basename directory databases under distinct databaseId roots", () => {
    const a: GdbSourceGroup = {
      databaseId: "gdb-1",
      name: "network.gdb",
      relativePath: "parent/a/network.gdb",
      files: [],
    };
    const b: GdbSourceGroup = {
      databaseId: "gdb-2",
      name: "network.gdb",
      relativePath: "parent/b/network.gdb",
      files: [],
    };
    const pa = stagedGroupRoot("/input/x", "directory", a);
    const pb = stagedGroupRoot("/input/x", "directory", b);
    expect(pa).toBe("/input/x/gdb-1/network.gdb");
    expect(pb).toBe("/input/x/gdb-2/network.gdb");
    expect(pa).not.toBe(pb);
  });

  it("stages equal-basename archives under distinct roots retaining .gdb.zip", () => {
    const file = { name: "foo.zip" } as unknown as File;
    const a: GdbSourceGroup = {
      databaseId: "gdb-1",
      name: "foo.gdb",
      relativePath: "foo.zip",
      files: [{ file, name: "foo.zip", relativePath: "foo.zip" }],
    };
    const b: GdbSourceGroup = { ...a, databaseId: "gdb-2" };
    expect(stagedGroupRoot("/input/x", "archive", a)).toBe("/input/x/gdb-1/foo.gdb.zip");
    expect(stagedGroupRoot("/input/x", "archive", b)).toBe("/input/x/gdb-2/foo.gdb.zip");
  });
});

describe("validateGdbSources — archive root identity + boundaries", () => {
  it("rejects distinct .gdb roots sharing a basename under different parents", async () => {
    const bad = zipFile(await buildZip({ "a/foo.gdb/x": "1", "b/foo.gdb/y": "2" }), "dup.zip");
    await expect(
      validateGdbSources("archive", [bad]),
    ).rejects.toMatchObject({ code: "invalid_geodatabase" });
  });

  it("rejects unreadable/corrupt zip bytes as invalid_geodatabase", async () => {
    const garbage = new File([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], "bad.zip", {
      type: "application/zip",
    });
    await expect(
      validateGdbSources("archive", [{ file: garbage, name: "bad.zip", relativePath: "bad.zip" }]),
    ).rejects.toMatchObject({ code: "invalid_geodatabase" });
  });

  it("archive entry count: exactly the limit passes; one over fails", async () => {
    const container = zipFile(await buildZip({ "a.gdb/x": "1" }), "c.zip");
    const make = (n: number): Entry[] =>
      Array.from({ length: n }, (_, i) => fakeEntry(`a.gdb/f${i}`));
    const spy = vi.spyOn(ZipReader.prototype, "getEntriesGenerator");

    spy.mockReturnValueOnce(entriesGenerator(make(GDB_MAX_SELECTED_FILES)));
    await expect(validateGdbSources("archive", [container])).resolves.toBeDefined();

    spy.mockReturnValueOnce(entriesGenerator(make(GDB_MAX_SELECTED_FILES + 1)));
    await expect(
      validateGdbSources("archive", [container]),
    ).rejects.toMatchObject({ code: "gdb_too_large" });
  });

  it("rejects >10k archive entries without collecting beyond the limit", async () => {
    const container = zipFile(await buildZip({ "a.gdb/x": "1" }), "overflow.zip");
    let yielded = 0;
    vi.spyOn(ZipReader.prototype, "getEntriesGenerator").mockImplementation(
      async function* () {
        for (let i = 0; i < GDB_MAX_SELECTED_FILES + 50; i++) {
          yielded += 1;
          yield fakeEntry(`a.gdb/f${i}`);
        }
        return false;
      },
    );

    await expect(
      validateGdbSources("archive", [container]),
    ).rejects.toMatchObject({ code: "gdb_too_large" });

    // Stop at limit+1; never drain remaining generator entries.
    expect(yielded).toBe(GDB_MAX_SELECTED_FILES + 1);
  });

  it("archive per-entry uncompressed: at the limit passes; one over fails", async () => {
    const container = zipFile(await buildZip({ "a.gdb/x": "1" }), "c.zip");
    const spy = vi.spyOn(ZipReader.prototype, "getEntriesGenerator");

    spy.mockReturnValueOnce(entriesGenerator([fakeEntry("a.gdb/big", GDB_MAX_FILE_BYTES)]));
    await expect(validateGdbSources("archive", [container])).resolves.toBeDefined();

    spy.mockReturnValueOnce(entriesGenerator([fakeEntry("a.gdb/big", GDB_MAX_FILE_BYTES + 1)]));
    await expect(
      validateGdbSources("archive", [container]),
    ).rejects.toMatchObject({ code: "gdb_too_large" });
  });

  it("archive aggregate uncompressed: at the limit passes; one over fails", async () => {
    const container = zipFile(await buildZip({ "a.gdb/x": "1" }), "c.zip");
    const third = GDB_MAX_TOTAL_BYTES - 2 * GDB_MAX_FILE_BYTES;
    const spy = vi.spyOn(ZipReader.prototype, "getEntriesGenerator");

    spy.mockReturnValueOnce(
      entriesGenerator([
        fakeEntry("a.gdb/1", GDB_MAX_FILE_BYTES),
        fakeEntry("a.gdb/2", GDB_MAX_FILE_BYTES),
        fakeEntry("a.gdb/3", third),
      ]),
    );
    await expect(validateGdbSources("archive", [container])).resolves.toBeDefined();

    spy.mockReturnValueOnce(
      entriesGenerator([
        fakeEntry("a.gdb/1", GDB_MAX_FILE_BYTES),
        fakeEntry("a.gdb/2", GDB_MAX_FILE_BYTES),
        fakeEntry("a.gdb/3", third + 1),
      ]),
    );
    await expect(
      validateGdbSources("archive", [container]),
    ).rejects.toMatchObject({ code: "gdb_too_large" });
  });

  it("archive compressed total: at the limit passes; one over fails", async () => {
    vi.spyOn(ZipReader.prototype, "getEntriesGenerator").mockImplementation(() =>
      entriesGenerator([fakeEntry("a.gdb/x")]),
    );
    await expect(
      validateGdbSources("archive", [sizedZipFile("a.zip", GDB_MAX_COMPRESSED_BYTES)]),
    ).resolves.toBeDefined();
    await expect(
      validateGdbSources("archive", [sizedZipFile("a.zip", GDB_MAX_COMPRESSED_BYTES + 1)]),
    ).rejects.toMatchObject({ code: "gdb_too_large" });
  });
});

describe("validateGdbSources — directory boundaries", () => {
  it("directory count: exactly the limit passes; one over fails", async () => {
    const atLimit: GdbSourceFile[] = Array.from({ length: GDB_MAX_SELECTED_FILES }, (_, i) =>
      dirFile(`a.gdb/f${i}`),
    );
    await expect(validateGdbSources("directory", atLimit)).resolves.toBeDefined();
    await expect(
      validateGdbSources("directory", [...atLimit, dirFile("a.gdb/extra")]),
    ).rejects.toMatchObject({ code: "gdb_too_large" });
  });

  it("directory per-file: at the limit passes; one over fails", async () => {
    await expect(
      validateGdbSources("directory", [dirFile("a.gdb/f", GDB_MAX_FILE_BYTES)]),
    ).resolves.toBeDefined();
    await expect(
      validateGdbSources("directory", [dirFile("a.gdb/f", GDB_MAX_FILE_BYTES + 1)]),
    ).rejects.toMatchObject({ code: "gdb_too_large" });
  });

  it("directory aggregate: one over the total limit fails", async () => {
    await expect(
      validateGdbSources("directory", [
        dirFile("a.gdb/1", GDB_MAX_FILE_BYTES),
        dirFile("a.gdb/2", GDB_MAX_FILE_BYTES),
        dirFile("a.gdb/3", GDB_MAX_TOTAL_BYTES - 2 * GDB_MAX_FILE_BYTES + 1),
      ]),
    ).rejects.toMatchObject({ code: "gdb_too_large" });
  });
});
