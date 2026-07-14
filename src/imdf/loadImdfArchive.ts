import { ArchiveError, type ArchiveErrorCode } from "../errors/ArchiveError";
import type { LoadedVenue } from "./types";
import ImdfWorker from "./imdf.worker?worker&inline";

export type ImdfWorkerRequest = { type: "load"; file: File };

export type ImdfWorkerResponse =
  | { type: "loaded"; venue: LoadedVenue }
  | {
      type: "failed";
      error: {
        code: ArchiveErrorCode;
        message: string;
        details?: Record<string, unknown>;
      };
    };

function isArchiveErrorCode(value: unknown): value is ArchiveErrorCode {
  return (
    value === "unsupported_file" ||
    value === "archive_too_large" ||
    value === "unsafe_archive_path" ||
    value === "invalid_archive" ||
    value === "missing_required_file" ||
    value === "invalid_json" ||
    value === "invalid_manifest_version" ||
    value === "invalid_feature_collection" ||
    value === "duplicate_feature_id" ||
    value === "worker_failed" ||
    value === "fetch_failed"
  );
}

function isWorkerResponse(value: unknown): value is ImdfWorkerResponse {
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
      isArchiveErrorCode(error.code) &&
      "message" in error &&
      typeof error.message === "string"
    );
  }
  return false;
}

function rebuildArchiveError(payload: {
  code: ArchiveErrorCode;
  message: string;
  details?: Record<string, unknown>;
}): ArchiveError {
  if (payload.details !== undefined) {
    return new ArchiveError(payload.code, payload.message, payload.details);
  }
  return new ArchiveError(payload.code, payload.message);
}

function workerFailedError(): ArchiveError {
  return new ArchiveError(
    "worker_failed",
    "The venue could not be processed. Try the archive again.",
  );
}

/**
 * Load and normalize an IMDF ZIP on a dedicated module worker. Creates one
 * worker per call and always terminates it. AbortSignal termination rejects
 * with a DOMException named `AbortError`.
 */
export async function loadImdfArchive(
  file: File,
  signal?: AbortSignal,
): Promise<LoadedVenue> {
  if (signal?.aborted) {
    throw new DOMException("The IMDF load was aborted.", "AbortError");
  }

  const worker = new ImdfWorker();

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
        reject(new DOMException("The IMDF load was aborted.", "AbortError"));
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
      if (data.type === "loaded") {
        settle(() => {
          worker.terminate();
          resolve(data.venue);
        });
        return;
      }
      settle(() => {
        worker.terminate();
        reject(rebuildArchiveError(data.error));
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

    const request: ImdfWorkerRequest = { type: "load", file };
    try {
      worker.postMessage(request);
    } catch {
      settle(() => {
        worker.terminate();
        reject(workerFailedError());
      });
    }
  });
}
