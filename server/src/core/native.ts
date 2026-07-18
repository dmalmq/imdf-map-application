import { compileImdf } from "@kiriko/node";

/** Bundle statistics, API-compatible with the existing `stats_json` shape. */
export interface ImdfStats {
  levels: number;
  features: number;
}

export type ViewerWarningCode =
  | "missing_locale"
  | "unresolved_reference"
  | "missing_level_geometry"
  | "missing_display_point"
  | "unknown_archive_entry";

export interface ViewerWarning {
  code: ViewerWarningCode;
  message: string;
  featureId?: string;
  archiveEntry?: string;
}

export interface CompileVenueMetadata {
  datasetId: string;
  version: number;
}

/**
 * `@kiriko/node`'s raw bridge contract. Mirrors the generated
 * `NativeCompileResponse` napi-rs type: a flat, always-defined `ok`
 * discriminant with the remaining fields optional depending on which side
 * of the discriminant is populated.
 */
export interface NativeCompileResponse {
  ok: boolean;
  bundle?: Buffer;
  statsJson?: string;
  warningsJson?: string;
  errorJson?: string;
}

export type NativeCompileFn = (
  source: Buffer,
  datasetId: string,
  version: number,
) => Promise<NativeCompileResponse>;

const WARNING_CODES: Record<ViewerWarningCode, true> = {
  missing_locale: true,
  unresolved_reference: true,
  missing_level_geometry: true,
  missing_display_point: true,
  unknown_archive_entry: true,
};

/**
 * A venue compile failure. `code` is either a stable `kiriko-model`
 * importer code or a stable `kiriko-bundle` codec code (both documented in
 * the Phase Two bundle format contract), or `"bridge_error"` when the
 * native addon's response itself was malformed.
 */
export class CoreCompileError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CoreCompileError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(json: string, field: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new CoreCompileError("bridge_error", `native ${field} is not valid JSON`);
  }
}

function parseStats(json: string): ImdfStats {
  const parsed = parseJson(json, "statsJson");
  if (!isRecord(parsed) || typeof parsed.levels !== "number" || typeof parsed.features !== "number") {
    throw new CoreCompileError("bridge_error", "native statsJson has an unexpected shape");
  }
  return { levels: parsed.levels, features: parsed.features };
}

function parseWarning(value: unknown): ViewerWarning {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.message !== "string") {
    throw new CoreCompileError("bridge_error", "native warningsJson entry has an unexpected shape");
  }
  if (!WARNING_CODES[value.code as ViewerWarningCode]) {
    throw new CoreCompileError("bridge_error", `native warningsJson entry has an unknown code: ${value.code}`);
  }
  const warning: ViewerWarning = { code: value.code as ViewerWarningCode, message: value.message };
  if (typeof value.featureId === "string") {
    warning.featureId = value.featureId;
  }
  if (typeof value.archiveEntry === "string") {
    warning.archiveEntry = value.archiveEntry;
  }
  return warning;
}

function parseWarnings(json: string): ViewerWarning[] {
  const parsed = parseJson(json, "warningsJson");
  if (!Array.isArray(parsed)) {
    throw new CoreCompileError("bridge_error", "native warningsJson is not an array");
  }
  return parsed.map(parseWarning);
}

function parseError(json: string): CoreCompileError {
  const parsed = parseJson(json, "errorJson");
  if (!isRecord(parsed) || typeof parsed.code !== "string" || typeof parsed.message !== "string") {
    throw new CoreCompileError("bridge_error", "native errorJson has an unexpected shape");
  }
  const details = isRecord(parsed.details) ? parsed.details : undefined;
  return new CoreCompileError(parsed.code, parsed.message, details);
}

/**
 * Compile raw IMDF `source` bytes into a `kvb1` bundle via the native
 * `@kiriko/node` addon (off the Node.js event loop; see
 * `napi::bindgen_prelude::AsyncTask` on the Rust side). Validates every
 * field of the discriminated native response before returning or throwing;
 * throws `CoreCompileError` both for genuine domain failures (a rejected
 * IMDF archive or bundle-codec error) and for a malformed bridge payload
 * (code `"bridge_error"`) — the native addon itself never rejects this
 * promise except for a true bridge/runtime failure.
 */
export async function compileVenueBundle(
  source: Buffer,
  metadata: CompileVenueMetadata,
  nativeCompile: NativeCompileFn = compileImdf,
): Promise<{ bundle: Buffer; stats: ImdfStats; warnings: ViewerWarning[] }> {
  const response = await nativeCompile(source, metadata.datasetId, metadata.version);

  if (response.ok) {
    if (!response.bundle || !response.statsJson || !response.warningsJson) {
      throw new CoreCompileError("bridge_error", "native compile response is missing required success fields");
    }
    return {
      bundle: response.bundle,
      stats: parseStats(response.statsJson),
      warnings: parseWarnings(response.warningsJson),
    };
  }

  if (!response.errorJson) {
    throw new CoreCompileError("bridge_error", "native compile response is missing errorJson");
  }
  throw parseError(response.errorJson);
}
