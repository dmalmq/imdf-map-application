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

/**
 * The only `VenueLoadErrorCode` values a `bundle.worker.ts` failure response
 * may legitimately carry: the four `kvb1` domain codes plus the shared
 * runtime/protocol `worker_failed`. ZIP-only codes (`fetch_failed`,
 * `invalid_archive`, …) can never inhabit this type — see
 * `loadKirikoBundle.test.ts`'s compile-time assertions.
 */
export type BundleWorkerFailureCode = Extract<
  VenueLoadErrorCode,
  | "invalid_bundle"
  | "unsupported_bundle_version"
  | "bundle_integrity_failed"
  | "bundle_too_large"
  | "worker_failed"
>;

export interface BundleDecodeFailure {
  type: "failed";
  error: {
    code: BundleWorkerFailureCode;
    message: string;
    details?: Record<string, unknown>;
  };
}

export type BundleWorkerResponse = BundleDecodeSuccess | BundleDecodeFailure;

/**
 * Shared wire `message` for `worker_failed` bundle-worker failures (WASM
 * init/decode exceptions, worker protocol violations). Deliberately
 * separate from `venueLoadErrorCopy.worker_failed` in `../errors/VenueLoadError`,
 * which is the ZIP-loader-flavored corrective copy shared across every
 * `VenueLoadError` code and must stay unchanged.
 */
export const BUNDLE_WORKER_FAILED_MESSAGE =
  "The venue could not be processed. Try loading the bundle again.";
