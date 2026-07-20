/// <reference lib="webworker" />

import { venueLoadErrorCopy } from "../errors/VenueLoadError";
import { BUNDLE_WORKER_FAILED_MESSAGE } from "./types";
import type { BundleDecodeRequest, BundleRouteRequest, BundleWorkerResponse } from "./types";
import { decodeBundle, initKirikoWasm, routeBundle } from "./wasm";

declare const self: DedicatedWorkerGlobalScope;

/**
 * Decodes one transferred bundle `ArrayBuffer` through the sole
 * `@kiriko/wasm` adapter (`initKirikoWasm`/`decodeBundle` in `./wasm`).
 * Never throws: every failure — domain (bundle-format) or runtime (WASM
 * init/decode exception) — resolves to a `{type:"failed"}` response carrying
 * corrective copy, never the raw WASM/Rust message. Domain failures use the
 * per-code corrective copy (`venueLoadErrorCopy`); runtime/protocol
 * failures use the shared bundle-specific `worker_failed` wording
 * (`BUNDLE_WORKER_FAILED_MESSAGE`), not the ZIP loader's copy.
 */
export async function decodeBundleMessage(
  request: BundleDecodeRequest,
): Promise<BundleWorkerResponse> {
  try {
    await initKirikoWasm();
    const response = decodeBundle(new Uint8Array(request.buffer));
    if (response.ok && response.venue !== null) {
      return { type: "loaded", venue: response.venue, hasGraph: response.hasGraph };
    }
    const code = response.error?.code ?? "invalid_bundle";
    return { type: "failed", error: { code, message: venueLoadErrorCopy[code] } };
  } catch {
    return {
      type: "failed",
      error: { code: "worker_failed", message: BUNDLE_WORKER_FAILED_MESSAGE },
    };
  }
}

/**
 * Routes over one transferred bundle `ArrayBuffer` through the same
 * `@kiriko/wasm` adapter (`routeBundle` in `./wasm`). The worker is
 * stateless: the bytes ride every request and are re-decoded inside wasm.
 * Never throws — like `decodeBundleMessage`, every failure (wasm init
 * rejection or a thrown bundle-format `JsError` from `route_bundle`)
 * resolves to the shared `{type:"failed"}` `worker_failed` response. A
 * wasm `null` (no §5 graph, or no connecting path) crosses as
 * `{type:"routed", route:null}`, not as a failure.
 */
export async function routeBundleMessage(
  request: BundleRouteRequest,
): Promise<BundleWorkerResponse> {
  try {
    await initKirikoWasm();
    const route = routeBundle(
      new Uint8Array(request.buffer),
      request.origin,
      request.destination,
    );
    return { type: "routed", route };
  } catch {
    return {
      type: "failed",
      error: { code: "worker_failed", message: BUNDLE_WORKER_FAILED_MESSAGE },
    };
  }
}

// Register the worker message handler only inside a real worker scope.
// Importing this module under vitest/jsdom must not throw or register.
// `WorkerGlobalScope` is defined in every worker scope (including module
// workers) and undefined in window/jsdom.
declare const WorkerGlobalScope: (new () => unknown) | undefined;
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  self.onmessage = (event: MessageEvent<BundleDecodeRequest | BundleRouteRequest>): void => {
    const data = event.data;
    if (data === null || typeof data !== "object" || (data.type !== "decode" && data.type !== "route")) {
      const response: BundleWorkerResponse = {
        type: "failed",
        error: { code: "worker_failed", message: BUNDLE_WORKER_FAILED_MESSAGE },
      };
      self.postMessage(response);
      return;
    }
    const pending =
      data.type === "decode" ? decodeBundleMessage(data) : routeBundleMessage(data);
    void pending.then((response) => {
      self.postMessage(response);
    });
  };
}
