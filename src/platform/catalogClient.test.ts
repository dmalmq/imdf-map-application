import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  PlatformError,
  datasetBlobUrl,
  datasetViewUrl,
  fetchCatalog,
  fetchMe,
  login,
  postComment,
  probeCatalog,
  publishDataset,
  slugifyDatasetId,
} from "./catalogClient";

function mockFetch(response: Partial<Response> & { json?: () => Promise<unknown> }): Mock {
  const impl = vi.fn().mockResolvedValue({ ok: true, status: 200, ...response });
  vi.stubGlobal("fetch", impl);
  return impl;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("catalogClient", () => {
  it("unwraps the datasets envelope", async () => {
    const entry = { id: "tokyo", name: "Tokyo", kind: "venue-snapshot", levelCount: 1, featureCount: 2, sourceName: "t.gdb", updatedAt: "2026-01-01T00:00:00.000Z" };
    mockFetch({ json: () => Promise.resolve({ datasets: [entry] }) });
    expect(await fetchCatalog()).toEqual([entry]);
  });

  it("throws PlatformError with the server code and message", async () => {
    mockFetch({ ok: false, status: 403, json: () => Promise.resolve({ code: "forbidden", message: "Publishing requires an admin account." }) });
    const error = await fetchCatalog().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PlatformError);
    expect((error as PlatformError).status).toBe(403);
    expect((error as PlatformError).code).toBe("forbidden");
    expect((error as PlatformError).message).toBe("Publishing requires an admin account.");
  });

  it("probeCatalog returns null on failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network down")));
    expect(await probeCatalog(50)).toBeNull();
  });

  it("publishDataset PUTs the blob with URL-encoded metadata", async () => {
    const impl = mockFetch({ json: () => Promise.resolve({ dataset: { id: "shinjuku" } }) });
    const blob = new Blob(["zip"]);
    await publishDataset(
      { id: "shinjuku", name: "新宿駅", kind: "venue-snapshot", levelCount: 3, featureCount: 9, sourceName: "S.gdb" },
      blob,
    );
    const [url, init] = impl.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/datasets/shinjuku?");
    expect(url).toContain(`name=${encodeURIComponent("新宿駅")}`);
    expect(url).toContain("kind=venue-snapshot");
    expect(url).toContain("levelCount=3");
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(blob);
  });

  it("postComment posts JSON and unwraps the comment envelope", async () => {
    const impl = mockFetch({ json: () => Promise.resolve({ comment: { id: "c1", author: "alice", text: "hi", createdAt: "now" } }) });
    const posted = await postComment("tokyo", { text: "hi", lngLat: [139.7, 35.6] });
    expect(posted.id).toBe("c1");
    const [url, init] = impl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/datasets/tokyo/comments");
    expect(JSON.parse(init.body as string)).toEqual({ text: "hi", lngLat: [139.7, 35.6] });
  });

  it("fetchMe maps 401 to null", async () => {
    mockFetch({ ok: false, status: 401, json: () => Promise.resolve({ code: "unauthenticated", message: "x" }) });
    expect(await fetchMe()).toBeNull();
  });

  it("passes an AbortSignal through login", async () => {
    const impl = mockFetch({
      json: () => Promise.resolve({ account: { username: "admin", role: "admin" } }),
    });
    const controller = new AbortController();
    await login("admin", "pw", controller.signal);
    const [, init] = impl.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("builds blob and view URLs and slugs", () => {
    expect(datasetBlobUrl("tokyo-station")).toBe("/datasets/tokyo-station.zip");
    expect(datasetViewUrl("tokyo-station")).toContain("/?dataset=tokyo-station");
    expect(datasetViewUrl("tokyo-station", true)).toContain("embed=1");
    expect(slugifyDatasetId("JR Tokyo Station 2026")).toBe("jr-tokyo-station-2026");
    expect(slugifyDatasetId("東京駅")).toBe("dataset");
    expect(slugifyDatasetId("--Weird__Name--")).toBe("weird-name");
  });
});
