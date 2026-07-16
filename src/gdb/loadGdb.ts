import { ArchiveError, archiveErrorCopy } from "../errors/ArchiveError";
import GdbWorker from "./gdb.worker?worker";
import type {
  GdbConversionResult,
  GdbConvertedLayer,
  GdbGeometryFamily,
  GdbInspection,
  GdbMappingPlan,
  GdbSourceFile,
  GdbWorkerError,
  GdbWorkerErrorCode,
  GdbWorkerRequest,
  GdbWorkerResponse,
} from "./types";

/**
 * Stateful GDB import session. One worker per session inspects the selection
 * once, then converts only the layers the review UI selected. All requests are
 * serialized through a single queue so inspect/convert never overlap, and the
 * worker holds the staged datasets alive between calls.
 * {@link GdbImportSession.dispose} terminates the worker and rejects in-flight
 * calls; an actual worker/protocol fault is terminal and rejects with
 * `worker_failed`.
 */
export interface GdbImportSession {
  inspect(): Promise<GdbInspection>;
  convert(plan: GdbMappingPlan): Promise<GdbConversionResult>;
  dispose(): void;
}

interface PendingCall {
  kind: "inspect" | "convert";
  resolve: (result: GdbInspection | GdbConversionResult) => void;
  reject: (error: unknown) => void;
}

function isGdbWorkerErrorCode(value: unknown): value is GdbWorkerErrorCode {
  return (
    value === "invalid_geodatabase" ||
    value === "gdb_too_large" ||
    value === "gdb_conversion_failed"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

/** Complete GdbWorkerError envelope: code, name, message, recoverable, and an
 * optional plain-object `details`. */
function isWorkerErrorPayload(value: unknown): value is GdbWorkerError {
  if (!isRecord(value)) return false;
  if (!isGdbWorkerErrorCode(value.code)) return false;
  if (typeof value.name !== "string") return false;
  if (typeof value.message !== "string") return false;
  if (typeof value.recoverable !== "boolean") return false;
  if ("details" in value && value.details !== undefined) {
    if (!isRecord(value.details) || Array.isArray(value.details)) return false;
  }
  return true;
}

/** A well-formed response envelope; success result shape is checked per-kind. */
function isResponseEnvelope(value: unknown): value is GdbWorkerResponse {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "number") return false;
  if (typeof value.ok !== "boolean") return false;
  if (value.ok) {
    return "result" in value;
  }
  return isWorkerErrorPayload(value.error);
}

const GEOMETRY_FAMILIES: ReadonlySet<string> = new Set([
  "point",
  "line",
  "polygon",
  "mixed",
  "none",
]);

function isGeometryFamily(value: unknown): value is GdbGeometryFamily {
  return typeof value === "string" && GEOMETRY_FAMILIES.has(value);
}

function isFieldDescriptor(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.type === "string"
  );
}

function isLayerKey(value: unknown): value is { databaseId: string; layerName: string } {
  return (
    isRecord(value) &&
    typeof value.databaseId === "string" &&
    typeof value.layerName === "string"
  );
}

function isDatabaseEntry(value: unknown): value is { id: string; name: string } {
  return isRecord(value) && typeof value.id === "string" && typeof value.name === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isLayerDescriptor(
  value: unknown,
  databaseIds: ReadonlySet<string>,
): boolean {
  if (!isRecord(value)) return false;
  if (!isLayerKey(value.key)) return false;
  if (!databaseIds.has(value.key.databaseId)) return false;
  if (typeof value.databaseName !== "string") return false;
  if (!isFiniteNumber(value.featureCount)) return false;
  if (!isGeometryFamily(value.geometryFamily)) return false;
  if (!Array.isArray(value.fields)) return false;
  return value.fields.every(isFieldDescriptor);
}

/** Deep inspection shape: rejects shallow successes such as empty database
 * objects, non-string warnings, invalid geometry families, or layers whose
 * key.databaseId is not present in the databases list. */
function isInspectionResult(value: unknown): value is GdbInspection {
  if (!isRecord(value)) return false;
  if (typeof value.sourceName !== "string") return false;
  if (!Array.isArray(value.databases)) return false;
  if (!Array.isArray(value.layers)) return false;
  if (!Array.isArray(value.warnings)) return false;
  if (!value.warnings.every((warning) => typeof warning === "string")) return false;
  if (!value.databases.every(isDatabaseEntry)) return false;
  const databaseIds = new Set(value.databases.map((database) => database.id));
  return value.layers.every((layer) => isLayerDescriptor(layer, databaseIds));
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isConvertedLayer(value: unknown): value is GdbConvertedLayer {
  if (!isRecord(value)) return false;
  if (!isRecord(value.key)) return false;
  if (typeof value.key.databaseId !== "string") return false;
  if (typeof value.key.layerName !== "string") return false;
  if (!isNonNegativeInteger(value.skippedGeometryCount)) return false;
  if (!isRecord(value.featureCollection)) return false;
  if (value.featureCollection.type !== "FeatureCollection") return false;
  return Array.isArray(value.featureCollection.features);
}

/** Deep conversion-only shape: rejects an inspection payload delivered to a
 * pending convert — both by its layer descriptors lacking a FeatureCollection
 * and by explicitly refusing inspection-only keys (so an empty inspection,
 * whose `layers.every` is vacuously true, is still rejected). */
function isConversionResult(value: unknown): value is GdbConversionResult {
  if (!isRecord(value)) return false;
  if ("sourceName" in value || "databases" in value) return false;
  if (!Array.isArray(value.warnings)) return false;
  if (!value.warnings.every((warning) => typeof warning === "string")) return false;
  if (!Array.isArray(value.layers)) return false;
  return value.layers.every(isConvertedLayer);
}

/** Correlate a typed failure with the pending call's phase: inspect accepts
 * only fatal invalid_geodatabase|gdb_too_large; convert accepts only
 * recoverable responses (mapped to gdb_conversion_failed). */
function errorMatchesKind(
  error: GdbWorkerError,
  kind: "inspect" | "convert",
): boolean {
  if (kind === "convert") {
    return error.recoverable === true;
  }
  return (
    error.recoverable === false &&
    (error.code === "invalid_geodatabase" || error.code === "gdb_too_large")
  );
}

/**
 * Selection display name for the pre-inspection status line and the initial
 * venue name: the common folder segment for a directory pick, the single
 * archive filename, or a count template for multiple archives.
 */
export function gdbSelectionName(files: readonly File[]): string {
  const folderFile = files.find((file) => file.webkitRelativePath);
  if (folderFile) {
    const [firstSegment] = folderFile.webkitRelativePath.split("/");
    return firstSegment || folderFile.name;
  }
  if (files.length === 1) {
    return files[0]?.name ?? "";
  }
  return `${files.length} GDB archives`;
}

function abortError(): DOMException {
  return new DOMException("The GDB import session was disposed.", "AbortError");
}

function workerFailedError(): ArchiveError {
  return new ArchiveError("worker_failed", archiveErrorCopy.worker_failed);
}

/**
 * Map a typed worker failure to an ArchiveError with fixed corrective copy and
 * diagnostic details. Every recoverable (convert-phase) failure collapses to
 * `gdb_conversion_failed`; fatal inspect/staging failures keep their typed code.
 */
function mapErrorResponse(error: GdbWorkerError): ArchiveError {
  const code = error.recoverable ? "gdb_conversion_failed" : error.code;
  const details: Record<string, unknown> = {
    ...(error.details ?? {}),
    workerCode: error.code,
    workerMessage: error.message,
  };
  return new ArchiveError(code, archiveErrorCopy[code], details);
}

export function createGdbImportSession(
  mode: "directory" | "archive",
  files: readonly File[],
): GdbImportSession {
  const descriptors: GdbSourceFile[] = files.map((file) => ({
    file,
    name: file.name,
    relativePath: file.webkitRelativePath || file.name,
  }));

  const worker = new GdbWorker();
  const pending = new Map<number, PendingCall>();
  let nextId = 1;
  let disposed = false;
  let terminalError: ArchiveError | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  const detach = (): void => {
    worker.removeEventListener("message", onMessage);
    worker.removeEventListener("error", onFault);
    worker.removeEventListener("messageerror", onFault);
  };

  const rejectAll = (error: unknown): void => {
    for (const call of pending.values()) {
      call.reject(error);
    }
    pending.clear();
  };

  const teardown = (error: unknown): void => {
    detach();
    worker.terminate();
    rejectAll(error);
  };

  // A protocol/worker fault (real error event, malformed message, unknown or
  // duplicate id, mis-shaped success result) is terminal: mark disposed, detach,
  // terminate, and reject every pending and future call with worker_failed.
  const failTerminal = (): void => {
    if (disposed) return;
    disposed = true;
    terminalError = workerFailedError();
    teardown(terminalError);
  };

  const onFault = (): void => failTerminal();

  const onMessage = (event: MessageEvent<unknown>): void => {
    const data = event.data;
    if (!isResponseEnvelope(data)) {
      failTerminal();
      return;
    }
    const call = pending.get(data.id);
    if (!call) {
      // Unknown or duplicate id — the worker violated the protocol.
      failTerminal();
      return;
    }
    if (data.ok) {
      const matches =
        call.kind === "inspect"
          ? isInspectionResult(data.result)
          : isConversionResult(data.result);
      if (!matches) {
        failTerminal();
        return;
      }
      pending.delete(data.id);
      call.resolve(data.result);
      return;
    }
    // A phase/code mismatch (e.g. a recoverable error on inspect, a fatal error
    // on convert, or a wrong code) is a protocol violation → terminal.
    if (!errorMatchesKind(data.error, call.kind)) {
      failTerminal();
      return;
    }
    // A correlated typed failure rejects only this call; the session stays
    // usable so the review UI can remap and retry a recoverable conversion.
    pending.delete(data.id);
    call.reject(mapErrorResponse(data.error));
  };

  worker.addEventListener("message", onMessage);
  worker.addEventListener("error", onFault);
  worker.addEventListener("messageerror", onFault);

  const send = <T extends GdbInspection | GdbConversionResult>(
    kind: "inspect" | "convert",
    makeRequest: (id: number) => GdbWorkerRequest,
  ): Promise<T> => {
    const run = (): Promise<T> => {
      if (terminalError) {
        return Promise.reject(terminalError);
      }
      if (disposed) {
        return Promise.reject(abortError());
      }
      const id = nextId++;
      // The configured ES2022 lib does not declare Promise.withResolvers, so the
      // executor form is required to capture resolve/reject for the pending map.
      return new Promise<T>((resolve, reject) => {
        pending.set(id, {
          kind,
          resolve: (result) => {
            // Each id is answered with the response type its request implies.
            const typed = result as T;
            resolve(typed);
          },
          reject,
        });
        try {
          worker.postMessage(makeRequest(id));
        } catch {
          pending.delete(id);
          reject(workerFailedError());
        }
      });
    };
    // Serialize every request through one queue so inspect/convert never run
    // concurrently in the worker; `run` starts only after the prior settles.
    const result = queue.then(run, run);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  return {
    inspect: () =>
      send<GdbInspection>("inspect", (id) => ({
        id,
        type: "inspect",
        mode,
        files: descriptors,
      })),
    convert: (plan) =>
      send<GdbConversionResult>("convert", (id) => ({ id, type: "convert", plan })),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      teardown(abortError());
    },
  };
}
