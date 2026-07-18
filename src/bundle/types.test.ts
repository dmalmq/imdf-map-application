import { describe, it } from "vitest";
import type { BundleDecodeFailure, BundleWorkerFailureCode } from "./types";

/**
 * Compile-time-only proof, checked by `pnpm typecheck` (`tsc --noEmit`),
 * that ZIP-only `VenueLoadErrorCode` values cannot inhabit
 * `BundleWorkerFailureCode` / `BundleDecodeFailure["error"]["code"]`. If
 * `BundleWorkerFailureCode` is ever widened back to the full
 * `VenueLoadErrorCode` union, these `@ts-expect-error` directives stop
 * suppressing a real error and `tsc --noEmit` fails — this is a type
 * assertion, not a runtime assertion, so it adds no meaningful runtime
 * coverage beyond "the module still imports".
 */
describe("BundleWorkerFailureCode (compile-time)", () => {
  it("rejects ZIP-only VenueLoadErrorCode values at the type level", () => {
    // @ts-expect-error "fetch_failed" is a ZIP-only VenueLoadErrorCode, not a BundleWorkerFailureCode.
    const fetchFailedCode: BundleWorkerFailureCode = "fetch_failed";
    // @ts-expect-error "invalid_archive" is a ZIP-only VenueLoadErrorCode, not a BundleWorkerFailureCode.
    const invalidArchiveCode: BundleWorkerFailureCode = "invalid_archive";
    const failure: BundleDecodeFailure = {
      type: "failed",
      // @ts-expect-error BundleDecodeFailure["error"]["code"] cannot be the ZIP-only "unsupported_file".
      error: { code: "unsupported_file", message: "x" },
    };

    void fetchFailedCode;
    void invalidArchiveCode;
    void failure;
  });

  it("accepts every bundle-domain code and the shared worker_failed code", () => {
    const codes: BundleWorkerFailureCode[] = [
      "invalid_bundle",
      "unsupported_bundle_version",
      "bundle_integrity_failed",
      "bundle_too_large",
      "worker_failed",
    ];
    void codes;
  });
});
