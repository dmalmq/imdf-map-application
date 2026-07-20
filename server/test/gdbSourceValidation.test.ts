import { TextReader, Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { validateGdbArchive } from "../src/gdb/sourceValidation";

function systemCatalog(): Uint8Array {
  const bytes = new Uint8Array(41);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 3, true);
  view.setBigUint64(24, BigInt(bytes.byteLength), true);
  view.setBigUint64(32, 40n, true);
  return bytes;
}

async function archiveWithRoots(...roots: string[]): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const root of roots) {
    await writer.add(
      `${root}/a00000001.gdbtable`,
      new Uint8ArrayReader(systemCatalog()),
    );
    await writer.add(`${root}/a00000001.gdbtablx`, new TextReader("index"));
  }
  return writer.close();
}

describe("validateGdbArchive", () => {
  it("accepts one FileGDB root with a valid system catalog header", async () => {
    const result = await validateGdbArchive(await archiveWithRoots("Station.gdb"));
    expect(result).toEqual({ rootName: "Station.gdb" });
  });

  it("rejects archives containing multiple FileGDB roots", async () => {
    await expect(
      validateGdbArchive(await archiveWithRoots("First.gdb", "Second.gdb")),
    ).rejects.toMatchObject({ code: "invalid_geodatabase" });
  });

  it("rejects a corrupt system catalog header", async () => {
    const writer = new ZipWriter(new Uint8ArrayWriter());
    await writer.add(
      "Station.gdb/a00000001.gdbtable",
      new TextReader("not a catalog"),
    );
    await writer.add("Station.gdb/a00000001.gdbtablx", new TextReader("index"));

    await expect(validateGdbArchive(await writer.close())).rejects.toMatchObject({
      code: "invalid_geodatabase",
    });
  });
});
