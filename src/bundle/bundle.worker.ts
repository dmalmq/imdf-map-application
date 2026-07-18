/// <reference lib="webworker" />

import { venueLoadErrorCopy } from "../errors/VenueLoadError";
import type { BundleDecodeRequest, BundleWorkerResponse } from "./types";
import { decodeBundle, initKirikoWasm } from "./wasm";

declare const self: DedicatedWorkerGlobalScope;

/**
 * Decodes one transferred bundle `ArrayBuffer` through the sole
 * `@kiriko/wasm` adapter (`initKirikoWasm`/`decodeBundle` in `./wasm`).
 * Never throws: every failure — domain (bundle-format) or runtime (WASM
 * init/decode exception) — resolves to a `{type:"failed"}` response carrying
 * corrective copy, never the raw WASM/Rust message.
 */
export async function decodeBundleMessage(
  request: BundleDecodeRequest,
): Promise<BundleWorkerResponse> {
  try {
    await initKirikoWasm();
    const response = decodeBundle(new Uint8Array(request.buffer));
    if (response.ok && response.venue !== null) {
      return { type: "loaded", venue: response.venue };
    }
    const code = response.error?.code ?? "invalid_bundle";
    return { type: "failed", error: { code, message: venueLoadErrorCopy[code] } };
  } catch {
    return {
      type: "failed",
      error: { code: "worker_failed", message: venueLoadErrorCopy.worker_failed },
    };
  }
}

// Register the worker message handler only inside a real worker scope.
// Importing this module under vitest/jsdom must not throw or register.
// `WorkerGlobalScope` is defined in every worker scope (including module
// workers) and undefined in window/jsdom.
declare const WorkerGlobalScope: (new () => unknown) | undefined;
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  self.onmessage = (event: MessageEvent<BundleDecodeRequest>): void => {
    const data = event.data;
    if (data === null || typeof data !== "object" || data.type !== "decode") {
      const response: BundleWorkerResponse = {
        type: "failed",
        error: { code: "worker_failed", message: venueLoadErrorCopy.worker_failed },
      };
      self.postMessage(response);
      return;
    }
    void decodeBundleMessage(data).then((response) => {
      self.postMessage(response);
    });
  };
}
