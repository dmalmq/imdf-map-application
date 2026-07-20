import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, datasetBundleUrl, gdbErrorMessage, publishErrorMessage } from "./api";

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

describe("gallery api client", () => {
  it("builds dataset bundle URLs", () => {
    expect(datasetBundleUrl("tokyo-station")).toBe("/v/default/tokyo-station/bundle");
  });

  it("me() returns null on 401 instead of throwing", async () => {
    mockFetch(401, { error: "unauthorized" });
    expect(await api.me()).toBeNull();
  });

  it("listVenues unwraps the venues array and throws ApiError on failure", async () => {
    mockFetch(200, { venues: [{ id: 1, slug: "a", name: "A", createdAt: "", latest: null }] });
    expect((await api.listVenues())[0]?.slug).toBe("a");

    mockFetch(500, { error: "boom" });
    await expect(api.listVenues()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("publishErrorMessage", () => {
  it("maps known structured importer codes to corrective copy without JSON or details", () => {
    const message = publishErrorMessage(
      JSON.stringify({
        code: "missing_required_file",
        message: "importer: manifest.json is missing",
        details: { entry: "manifest.json" },
      }),
    );
    expect(message).toContain("missing a required IMDF file");
    expect(message).not.toContain("{");
    expect(message).not.toContain("manifest.json");
  });

  it("maps every stable publish code to non-JSON corrective copy", () => {
    const codes = [
      "unsupported_file",
      "archive_too_large",
      "unsafe_archive_path",
      "invalid_archive",
      "missing_required_file",
      "invalid_json",
      "invalid_manifest_version",
      "invalid_feature_collection",
      "duplicate_feature_id",
      "stale_version",
    ];
    for (const code of codes) {
      const message = publishErrorMessage(JSON.stringify({ code, message: "raw importer text" }));
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("{");
      expect(message).not.toContain(code);
      expect(message).not.toContain("raw importer text");
    }
  });

  it("hides unknown structured codes and internal messages behind generic copy", () => {
    for (const raw of [
      JSON.stringify({ code: "internal_error", message: "SQLITE_BUSY: locked" }),
      JSON.stringify({ code: "bridge_error", message: "napi panic: unreachable" }),
      JSON.stringify({ code: "some_future_code", message: "???" }),
    ]) {
      const message = publishErrorMessage(raw);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("{");
      expect(message).not.toContain("SQLITE_BUSY");
      expect(message).not.toContain("panic");
    }
  });

  it("never returns raw JSON for structured payloads of the wrong shape", () => {
    for (const raw of ['{"unexpected":true}', "[1,2,3]", '"quoted"', "42", "null"]) {
      const message = publishErrorMessage(raw);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toContain("{");
      expect(message).not.toContain("[");
      expect(message).not.toContain("unexpected");
    }
  });

  it("passes legacy plain error text through unchanged", () => {
    expect(publishErrorMessage("not a ZIP archive")).toBe("not a ZIP archive");
    expect(publishErrorMessage("timed out")).toBe("timed out");
    expect(publishErrorMessage("unknown error")).toBe("unknown error");
  });
});

describe("gdb api", () => {
  it("publishGdb posts the plan and returns the job envelope", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          jobId: "j1",
          versionId: 7,
          seq: 1,
          excludedLayers: [{ layer: "Bad_Layer", reason: "empty or geometry-less layer" }],
        }),
        { status: 202 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await api.publishGdb(7, "a".repeat(64), {
      venueName: "V", buildings: [], layers: [],
    });
    expect(result).toEqual({
      jobId: "j1",
      versionId: 7,
      seq: 1,
      excludedLayers: [{ layer: "Bad_Layer", reason: "empty or geometry-less layer" }],
    });
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({ venueId: 7, blobHash: "a".repeat(64) });
  });

  it("gdbErrorMessage maps known codes and names the blamed layer", () => {
    expect(gdbErrorMessage({ code: "invalid_geodatabase", message: "x" }, "en")).toContain("File Geodatabase");
    const conv = gdbErrorMessage(
      { code: "gdb_conversion_failed", message: "x", details: { layer: "Station_1_Space", reason: "empty or geometry-less layer" } },
      "en",
    );
    expect(conv).toContain("Station_1_Space");
  });
});
