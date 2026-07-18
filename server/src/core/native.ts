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
 * of the discriminant is populated. Treated as untrusted input — see
 * `validateNativeResponse` — since the native addon crosses an FFI
 * boundary and its resolved value is never assumed well-formed.
 */
export interface NativeCompileResponse {
  ok: boolean;
  bundle?: Buffer;
  statsJson?: string;
  warningsJson?: string;
  errorJson?: string;
}

/**
 * Untrusted: the native addon's resolved value is validated from scratch
 * (see `validateNativeResponse`), not assumed to match this shape.
 */
export type NativeCompileFn = (source: Buffer, datasetId: string, version: number) => Promise<unknown>;

const WARNING_CODES: Record<ViewerWarningCode, true> = {
  missing_locale: true,
  unresolved_reference: true,
  missing_level_geometry: true,
  missing_display_point: true,
  unknown_archive_entry: true,
};

const U32_MAX = 0xffff_ffff;

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

function isU32(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= U32_MAX;
}

/** A validated `NativeCompileResponse` success side: every field checked. */
interface ValidatedSuccess {
  ok: true;
  bundle: Buffer;
  statsJson: string;
  warningsJson: string;
}

/** A validated `NativeCompileResponse` failure side: every field checked. */
interface ValidatedFailure {
  ok: false;
  errorJson: string;
}

/**
 * Validates the native addon's resolved value field-by-field before any of
 * it is trusted: the FFI boundary means a bridge bug (wrong napi-rs
 * version, a broken build, a future refactor that drops a field) must
 * surface as a `CoreCompileError("bridge_error", ...)`, never a raw
 * `TypeError` from blindly dereferencing an unexpected shape.
 */
function validateNativeResponse(raw: unknown): ValidatedSuccess | ValidatedFailure {
  if (!isRecord(raw)) {
    throw new CoreCompileError("bridge_error", "native compile response is not an object");
  }
  if (typeof raw.ok !== "boolean") {
    throw new CoreCompileError("bridge_error", "native compile response ok is not a boolean");
  }
  if (raw.ok) {
    if (!Buffer.isBuffer(raw.bundle)) {
      throw new CoreCompileError("bridge_error", "native compile response bundle is not a Buffer");
    }
    if (typeof raw.statsJson !== "string") {
      throw new CoreCompileError("bridge_error", "native compile response statsJson is not a string");
    }
    if (typeof raw.warningsJson !== "string") {
      throw new CoreCompileError("bridge_error", "native compile response warningsJson is not a string");
    }
    return { ok: true, bundle: raw.bundle, statsJson: raw.statsJson, warningsJson: raw.warningsJson };
  }
  if (typeof raw.errorJson !== "string") {
    throw new CoreCompileError("bridge_error", "native compile response errorJson is not a string");
  }
  return { ok: false, errorJson: raw.errorJson };
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
  if (!isRecord(parsed) || !isU32(parsed.levels) || !isU32(parsed.features)) {
    throw new CoreCompileError("bridge_error", "native statsJson has an unexpected shape");
  }
  return { levels: parsed.levels, features: parsed.features };
}

/** `undefined` is a valid absence; any other non-string value is rejected. */
function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new CoreCompileError("bridge_error", `native warningsJson entry has a non-string ${field}`);
  }
  return value;
}

function parseWarning(value: unknown): ViewerWarning {
  if (!isRecord(value) || typeof value.code !== "string" || typeof value.message !== "string") {
    throw new CoreCompileError("bridge_error", "native warningsJson entry has an unexpected shape");
  }
  if (!WARNING_CODES[value.code as ViewerWarningCode]) {
    throw new CoreCompileError("bridge_error", `native warningsJson entry has an unknown code: ${value.code}`);
  }
  const warning: ViewerWarning = { code: value.code as ViewerWarningCode, message: value.message };
  const featureId = parseOptionalString(value.featureId, "featureId");
  if (featureId !== undefined) {
    warning.featureId = featureId;
  }
  const archiveEntry = parseOptionalString(value.archiveEntry, "archiveEntry");
  if (archiveEntry !== undefined) {
    warning.archiveEntry = archiveEntry;
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
  let details: Record<string, unknown> | undefined;
  if (parsed.details !== undefined) {
    if (!isRecord(parsed.details)) {
      throw new CoreCompileError("bridge_error", "native errorJson details is not an object");
    }
    details = parsed.details;
  }
  return new CoreCompileError(parsed.code, parsed.message, details);
}

/**
 * Compile raw IMDF `source` bytes into a `kvb1` bundle via the native
 * `@kiriko/node` addon (off the Node.js event loop; see
 * `napi::bindgen_prelude::AsyncTask` on the Rust side). The native addon's
 * resolved value is treated as untrusted FFI output and validated field by
 * field (see `validateNativeResponse`) before any of it is used. Throws
 * `CoreCompileError` for genuine domain failures (a rejected IMDF archive
 * or bundle-codec error, native `code` `"bridge_error"` — the native addon
 * itself never rejects this promise except for a true bridge/runtime
 * failure, and any such failure (or any other unexpected throw) is also
 * normalized to `CoreCompileError("bridge_error", ...)` here — never a raw
 * `TypeError`/`SyntaxError` escapes this function.
 */
export async function compileVenueBundle(
  source: Buffer,
  metadata: CompileVenueMetadata,
  nativeCompile: NativeCompileFn = compileImdf,
): Promise<{ bundle: Buffer; stats: ImdfStats; warnings: ViewerWarning[] }> {
  try {
    const response = validateNativeResponse(await nativeCompile(source, metadata.datasetId, metadata.version));
    if (response.ok) {
      return {
        bundle: response.bundle,
        stats: parseStats(response.statsJson),
        warnings: parseWarnings(response.warningsJson),
      };
    }
    throw parseError(response.errorJson);
  } catch (error) {
    if (error instanceof CoreCompileError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new CoreCompileError("bridge_error", `native compile bridge failed: ${message}`);
  }
}
