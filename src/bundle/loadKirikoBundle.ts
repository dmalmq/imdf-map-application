import { VenueLoadError } from "../errors/VenueLoadError";
import type { LoadedVenue } from "../imdf/types";
import { hydrateVenue } from "./hydrateVenue";
import { BUNDLE_WORKER_FAILED_MESSAGE } from "./types";
import type { BundleDecodeRequest, BundleWorkerFailureCode, BundleWorkerResponse } from "./types";
import BundleWorker from "./bundle.worker?worker&inline";

/**
 * The only codes a bundle-worker `{type:"failed"}` response may legitimately
 * carry: the four `kvb1` domain codes plus the shared runtime/protocol
 * `worker_failed`. ZIP-only codes (`fetch_failed`, `invalid_archive`, …)
 * never originate from `bundle.worker.ts` and are rejected as malformed.
 */
const BUNDLE_WORKER_FAILURE_CODES: Record<string, true> = {
  invalid_bundle: true,
  unsupported_bundle_version: true,
  bundle_integrity_failed: true,
  bundle_too_large: true,
  worker_failed: true,
};

function isBundleWorkerFailureCode(value: unknown): value is BundleWorkerFailureCode {
  return typeof value === "string" && BUNDLE_WORKER_FAILURE_CODES[value] === true;
}

/**
 * `details`, when present, must be a plain object: not `null`, not an
 * array, and not a `Map`/`Set`/`Date`/class instance (only a literal
 * `{...}` or `Object.create(null)` prototype is accepted).
 */
function isValidErrorDetails(value: unknown): boolean {
  if (value === undefined) {
    return true;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype: object | null = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isWorkerResponse(value: unknown): value is BundleWorkerResponse {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (!("type" in value)) {
    return false;
  }
  if (value.type === "loaded") {
    return "venue" in value && value.venue !== null && typeof value.venue === "object";
  }
  if (value.type === "failed") {
    if (!("error" in value) || value.error === null || typeof value.error !== "object") {
      return false;
    }
    const error = value.error;
    return (
      "code" in error &&
      isBundleWorkerFailureCode(error.code) &&
      "message" in error &&
      typeof error.message === "string" &&
      (!("details" in error) || isValidErrorDetails(error.details))
    );
  }
  return false;
}

function rebuildVenueLoadError(payload: {
  code: BundleWorkerFailureCode;
  message: string;
  details?: Record<string, unknown>;
}): VenueLoadError {
  if (payload.details !== undefined) {
    return new VenueLoadError(payload.code, payload.message, payload.details);
  }
  return new VenueLoadError(payload.code, payload.message);
}

function workerFailedError(): VenueLoadError {
  return new VenueLoadError("worker_failed", BUNDLE_WORKER_FAILED_MESSAGE);
}

/**
 * Fetches and decodes a Kiriko `.kvb` bundle on a dedicated module worker.
 * Creates one worker per call, transfers the fetched buffer to it (never
 * cloned), and always terminates it on every terminal path. `AbortSignal`
 * termination — before the fetch starts, mid-fetch, or mid-decode — rejects
 * with `DOMException("Aborted", "AbortError")`. Responses arriving after an
 * abort (or after any other terminal path) are ignored.
 */
export async function loadKirikoBundle(src: string, signal?: AbortSignal): Promise<LoadedVenue> {
  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  let response: Response;
  try {
    response = await fetch(src, { signal: signal ?? null });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new VenueLoadError("fetch_failed", "Could not download the Kiriko bundle.", { src });
  }
  if (!response.ok) {
    throw new VenueLoadError("fetch_failed", "Could not download the Kiriko bundle.", {
      src,
      status: response.status,
    });
  }

  let buffer: ArrayBuffer;
  try {
    buffer = await response.arrayBuffer();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw error;
    }
    throw new VenueLoadError("fetch_failed", "Could not download the Kiriko bundle.", { src });
  }

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const worker = new BundleWorker();

  return new Promise<LoadedVenue>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
      worker.removeEventListener("messageerror", onMessageError);
      signal?.removeEventListener("abort", onAbort);
    };

    const settle = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      fn();
    };

    const onAbort = (): void => {
      settle(() => {
        worker.terminate();
        reject(new DOMException("Aborted", "AbortError"));
      });
    };

    const onMessage = (event: MessageEvent<unknown>): void => {
      const data = event.data;
      if (!isWorkerResponse(data)) {
        settle(() => {
          worker.terminate();
          reject(workerFailedError());
        });
        return;
      }
      if (data.type === "failed") {
        settle(() => {
          worker.terminate();
          reject(rebuildVenueLoadError(data.error));
        });
        return;
      }
      let venue: LoadedVenue;
      try {
        venue = hydrateVenue(data.venue);
      } catch (error) {
        settle(() => {
          worker.terminate();
          reject(error instanceof VenueLoadError ? error : workerFailedError());
        });
        return;
      }
      settle(() => {
        worker.terminate();
        resolve(venue);
      });
    };

    const onError = (): void => {
      settle(() => {
        worker.terminate();
        reject(workerFailedError());
      });
    };

    const onMessageError = (): void => {
      settle(() => {
        worker.terminate();
        reject(workerFailedError());
      });
    };

    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.addEventListener("messageerror", onMessageError);
    signal?.addEventListener("abort", onAbort, { once: true });

    const request: BundleDecodeRequest = { type: "decode", buffer };
    try {
      worker.postMessage(request, [buffer]);
    } catch {
      settle(() => {
        worker.terminate();
        reject(workerFailedError());
      });
    }
  });
}
