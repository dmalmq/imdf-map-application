import { afterEach, describe, expect, it, vi } from "vitest";
import { venueLoadErrorCopy } from "../errors/VenueLoadError";
import { BUNDLE_WORKER_FAILED_MESSAGE } from "./types";

const initKirikoWasmMock = vi.fn();
const decodeBundleMock = vi.fn();
vi.mock("./wasm", () => ({
  initKirikoWasm: (...args: unknown[]) => initKirikoWasmMock(...args),
  decodeBundle: (...args: unknown[]) => decodeBundleMock(...args),
}));

import { decodeBundleMessage } from "./bundle.worker";

function request(buffer: ArrayBuffer = new Uint8Array([1, 2, 3]).buffer as ArrayBuffer): {
  type: "decode";
  buffer: ArrayBuffer;
} {
  return { type: "decode", buffer };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("decodeBundleMessage", () => {
  it("awaits initKirikoWasm before calling decodeBundle (catches a dropped `await`)", async () => {
    let resolveInit!: () => void;
    initKirikoWasmMock.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveInit = resolve;
      }),
    );
    decodeBundleMock.mockReturnValue({ ok: true, venue: { id: "v" }, error: null });

    const promise = decodeBundleMessage(request());
    await Promise.resolve();
    await Promise.resolve();
    expect(decodeBundleMock).not.toHaveBeenCalled();

    resolveInit();
    const response = await promise;
    expect(decodeBundleMock).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ type: "loaded", venue: { id: "v" } });
  });

  it("maps a successful decode to a loaded response carrying the decoded venue", async () => {
    initKirikoWasmMock.mockResolvedValue(undefined);
    const venue = { id: "v1", features: [] };
    decodeBundleMock.mockReturnValue({ ok: true, venue, error: null });

    const response = await decodeBundleMessage(request());
    expect(response).toEqual({ type: "loaded", venue });
  });

  it.each([
    "invalid_bundle",
    "unsupported_bundle_version",
    "bundle_integrity_failed",
    "bundle_too_large",
  ] as const)(
    "maps a structured %s domain failure to its corrective copy, discarding the raw WASM message",
    async (code) => {
      initKirikoWasmMock.mockResolvedValue(undefined);
      decodeBundleMock.mockReturnValue({
        ok: false,
        venue: null,
        error: { code, message: "raw rust panic text" },
      });

      const response = await decodeBundleMessage(request());
      expect(response).toEqual({ type: "failed", error: { code, message: venueLoadErrorCopy[code] } });
      expect(response.type === "failed" && response.error.message).not.toBe("raw rust panic text");
    },
  );

  it("falls back to worker_failed with the shared bundle wording when initKirikoWasm rejects", async () => {
    initKirikoWasmMock.mockRejectedValue(new Error("wasm module fetch failed"));

    const response = await decodeBundleMessage(request());
    expect(response).toEqual({
      type: "failed",
      error: { code: "worker_failed", message: BUNDLE_WORKER_FAILED_MESSAGE },
    });
    expect(decodeBundleMock).not.toHaveBeenCalled();
  });

  it("falls back to worker_failed with the shared bundle wording when decodeBundle throws synchronously", async () => {
    initKirikoWasmMock.mockResolvedValue(undefined);
    decodeBundleMock.mockImplementation(() => {
      throw new Error("unexpected wasm panic");
    });

    const response = await decodeBundleMessage(request());
    expect(response).toEqual({
      type: "failed",
      error: { code: "worker_failed", message: BUNDLE_WORKER_FAILED_MESSAGE },
    });
  });

  it("uses the shared bundle-specific worker_failed wording, not the ZIP loader's global copy", () => {
    expect(BUNDLE_WORKER_FAILED_MESSAGE).not.toBe(venueLoadErrorCopy.worker_failed);
  });
});
