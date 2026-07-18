import { afterEach, describe, expect, it, vi } from "vitest";
import { VenueLoadError } from "../errors/VenueLoadError";

const { createdWorkers, FakeBundleWorker } = vi.hoisted(() => {
  class BaseFakeBundleWorker extends EventTarget {
    postMessage = vi.fn();
    terminate = vi.fn();
  }
  const created: BaseFakeBundleWorker[] = [];
  class TrackedFakeBundleWorker extends BaseFakeBundleWorker {
    constructor() {
      super();
      created.push(this);
    }
  }
  return { createdWorkers: created, FakeBundleWorker: TrackedFakeBundleWorker };
});

vi.mock("./bundle.worker?worker&inline", () => ({ default: FakeBundleWorker }));

const hydrateVenueMock = vi.fn();
vi.mock("./hydrateVenue", () => ({
  hydrateVenue: (...args: unknown[]) => hydrateVenueMock(...args),
}));

import { loadKirikoBundle } from "./loadKirikoBundle";

const SRC = "/v/default/minimal/bundle";

function okResponse(buffer: ArrayBuffer): Response {
  return {
    ok: true,
    status: 200,
    arrayBuffer: vi.fn().mockResolvedValue(buffer),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  hydrateVenueMock.mockReset();
  createdWorkers.length = 0;
});

describe("loadKirikoBundle", () => {
  it("fetches, spawns exactly one worker, and transfers the buffer without cloning", async () => {
    const buffer = new TextEncoder().encode("kvb1-fixture").buffer;
    const fetchMock = vi.fn().mockResolvedValue(okResponse(buffer));
    vi.stubGlobal("fetch", fetchMock);

    const promise = loadKirikoBundle(SRC);
    await vi.waitFor(() => expect(createdWorkers).toHaveLength(1));

    expect(fetchMock).toHaveBeenCalledWith(SRC, { signal: null });

    const worker = createdWorkers[0]!;
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const [message, transfer] = worker.postMessage.mock.calls[0]!;
    expect(message).toEqual({ type: "decode", buffer });
    expect(transfer).toEqual([buffer]);

    const dto = { venueId: "v1" };
    const hydrated = { venue: { id: "v1" } };
    hydrateVenueMock.mockReturnValueOnce(hydrated);
    worker.dispatchEvent(new MessageEvent("message", { data: { type: "loaded", venue: dto } }));

    await expect(promise).resolves.toBe(hydrated);
    expect(hydrateVenueMock).toHaveBeenCalledWith(dto);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("creates a new worker for each call", async () => {
    const buffer1 = new ArrayBuffer(4);
    const buffer2 = new ArrayBuffer(4);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(okResponse(buffer1)).mockResolvedValueOnce(okResponse(buffer2)),
    );

    const first = loadKirikoBundle(SRC);
    await vi.waitFor(() => expect(createdWorkers).toHaveLength(1));
    hydrateVenueMock.mockReturnValueOnce({ n: 1 });
    createdWorkers[0]!.dispatchEvent(
      new MessageEvent("message", { data: { type: "loaded", venue: {} } }),
    );
    await first;

    const second = loadKirikoBundle(SRC);
    await vi.waitFor(() => expect(createdWorkers).toHaveLength(2));
    hydrateVenueMock.mockReturnValueOnce({ n: 2 });
    createdWorkers[1]!.dispatchEvent(
      new MessageEvent("message", { data: { type: "loaded", venue: {} } }),
    );
    await second;

    expect(createdWorkers[0]).not.toBe(createdWorkers[1]);
    expect(createdWorkers[0]!.terminate).toHaveBeenCalledTimes(1);
    expect(createdWorkers[1]!.terminate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["invalid_bundle", "This venue bundle is corrupted and could not be read."],
    [
      "unsupported_bundle_version",
      "This venue bundle was published for a newer viewer. Refresh the page to update.",
    ],
    [
      "bundle_integrity_failed",
      "This venue bundle failed an integrity check and could not be trusted.",
    ],
    ["bundle_too_large", "This venue bundle exceeds the viewer\u2019s size limit."],
  ] as const)(
    "rejects with a reconstructed VenueLoadError and terminates the worker for %s",
    async (code, message) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(new ArrayBuffer(4))));

      const promise = loadKirikoBundle(SRC);
      await vi.waitFor(() => expect(createdWorkers).toHaveLength(1));
      const worker = createdWorkers[0]!;
      worker.dispatchEvent(
        new MessageEvent("message", { data: { type: "failed", error: { code, message } } }),
      );

      const error = await promise.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(VenueLoadError);
      expect((error as VenueLoadError).code).toBe(code);
      expect((error as VenueLoadError).message).toBe(message);
      expect(worker.terminate).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects with a worker_failed VenueLoadError and terminates on a malformed message", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(new ArrayBuffer(4))));

    const promise = loadKirikoBundle(SRC);
    await vi.waitFor(() => expect(createdWorkers).toHaveLength(1));
    const worker = createdWorkers[0]!;
    worker.dispatchEvent(new MessageEvent("message", { data: { totally: "unexpected" } }));

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VenueLoadError);
    expect((error as VenueLoadError).code).toBe("worker_failed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects with a worker_failed VenueLoadError and terminates on a worker error event", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(new ArrayBuffer(4))));

    const promise = loadKirikoBundle(SRC);
    await vi.waitFor(() => expect(createdWorkers).toHaveLength(1));
    const worker = createdWorkers[0]!;
    worker.dispatchEvent(new Event("error"));

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VenueLoadError);
    expect((error as VenueLoadError).code).toBe("worker_failed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects with a fetch_failed VenueLoadError on a non-ok response and never spawns a worker", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404 } as unknown as Response),
    );

    const error = await loadKirikoBundle(SRC).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VenueLoadError);
    expect((error as VenueLoadError).code).toBe("fetch_failed");
    expect((error as VenueLoadError).details).toMatchObject({ status: 404 });
    expect(createdWorkers).toHaveLength(0);
  });

  it("rejects with a fetch_failed VenueLoadError on a network rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await loadKirikoBundle(SRC).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(VenueLoadError);
    expect((error as VenueLoadError).code).toBe("fetch_failed");
    expect(createdWorkers).toHaveLength(0);
  });

  it("rejects with AbortError before starting the fetch when already aborted", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort();

    const error = await loadKirikoBundle(SRC, controller.signal).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(createdWorkers).toHaveLength(0);
  });

  it("rethrows an AbortError raised during the fetch unchanged and never spawns a worker", async () => {
    const abort = new DOMException("Aborted", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));
    const controller = new AbortController();

    const error = await loadKirikoBundle(SRC, controller.signal).catch((e: unknown) => e);
    expect(error).toBe(abort);
    expect(createdWorkers).toHaveLength(0);
  });

  it("aborts during worker decode, terminates the worker, and ignores a stale response afterward", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse(new ArrayBuffer(4))));
    const controller = new AbortController();

    const promise = loadKirikoBundle(SRC, controller.signal);
    await vi.waitFor(() => expect(createdWorkers).toHaveLength(1));
    const worker = createdWorkers[0]!;

    controller.abort();

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DOMException);
    expect((error as DOMException).name).toBe("AbortError");
    expect((error as DOMException).message).toBe("Aborted");
    expect(worker.terminate).toHaveBeenCalledTimes(1);

    // Stale success arriving after the abort must be ignored: no hydration,
    // no unhandled rejection, no double termination.
    worker.dispatchEvent(new MessageEvent("message", { data: { type: "loaded", venue: {} } }));
    expect(hydrateVenueMock).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
});
