import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { afterEach, describe, expect, it } from "vitest";
import { cleanupTestApps, loginCookie, makeTestApp } from "./helpers";

async function fakeGdbZip(): Promise<Uint8Array> {
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("fake.gdb/a00000001.gdbtable", new TextReader("not a geodatabase"));
  return writer.close();
}

function multipartZip(bytes: Uint8Array): {
  payload: Buffer;
  headers: Record<string, string>;
} {
  const boundary = "----kirikoGdbRouteBoundary";
  const head = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="fake.gdb.zip"\r\n` +
      `Content-Type: application/zip\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    payload: Buffer.concat([head, Buffer.from(bytes), tail]),
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

afterEach(cleanupTestApps);

describe("GDB routes", () => {
  it("rejects a `.gdb` shell without a valid system catalog before GDAL", async () => {
    const { app } = await makeTestApp();
    const cookie = await loginCookie(app);
    const multipart = multipartZip(await fakeGdbZip());

    const response = await app.inject({
      method: "POST",
      url: "/api/gdb/inspect",
      headers: { cookie, ...multipart.headers },
      payload: multipart.payload,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: "invalid_geodatabase",
    });
  });
});
