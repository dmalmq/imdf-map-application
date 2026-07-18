/**
 * Message protocol for the Kiriko bundle decode worker (`bundle.worker.ts`).
 * The decoded venue DTO itself is Task 4's `@kiriko/wasm` contract (see
 * `./wasm`); this module defines only the request/response envelope shared
 * by the worker and its caller, `loadKirikoBundle.ts`.
 */
import type { VenueLoadErrorCode } from "../errors/VenueLoadError";
import type { DecodedVenueDto } from "./wasm";

/** `buffer` is always transferred (not cloned) to the worker. */
export interface BundleDecodeRequest {
  type: "decode";
  buffer: ArrayBuffer;
}

export interface BundleDecodeSuccess {
  type: "loaded";
  venue: DecodedVenueDto;
}

export interface BundleDecodeFailure {
  type: "failed";
  error: {
    code: VenueLoadErrorCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type BundleWorkerResponse = BundleDecodeSuccess | BundleDecodeFailure;
