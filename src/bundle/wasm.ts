/**
 * Kiriko `kvb1` bundle decoder: a thin, typed wrapper over the generated
 * `@kiriko/wasm` package. `initKirikoWasm` performs the module's single
 * required asynchronous initialization (idempotent — safe to call from
 * every call site); `decodeBundle` is synchronous and callable any time
 * after that promise has resolved.
 *
 * Phase Two Task 4: WASM decode adapter (browser side).
 */
import init, { decodeBundle as decodeBundleWasm } from "@kiriko/wasm";
import type { readFile as ReadFileFn } from "node:fs/promises";

export type BoundsTuple = [west: number, south: number, east: number, north: number];

export interface DecodedManifestDto {
  version: string;
  language: string;
  rest: Record<string, unknown>;
}

export interface DecodedLevelDto {
  id: string;
  ordinal: number;
  label: Record<string, string>;
  shortName: Record<string, string>;
}

export interface DecodedFeatureDto {
  id: string;
  featureType: string;
  levelId: string | null;
  geometry: GeoJSON.Geometry | null;
  center: [number, number] | null;
  labels: Record<string, string>;
  altLabels: Record<string, string>;
  category: string | null;
  accessibility: string[];
  restriction: string | null;
  sourceProperties: Record<string, unknown>;
}

export interface DecodedWarningDto {
  code: string;
  message: string;
  featureId: string | null;
  archiveEntry: string | null;
}

export interface DecodedVenueDto {
  venueId: string;
  manifest: DecodedManifestDto;
  levels: DecodedLevelDto[];
  features: DecodedFeatureDto[];
  boundsByLevel: [string, BoundsTuple][];
  warnings: DecodedWarningDto[];
  stats: { levels: number; features: number };
}

/** The four stable `kvb1` bundle-codec error codes (see `kiriko-bundle`). */
export type BundleErrorCode =
  | "invalid_bundle"
  | "unsupported_bundle_version"
  | "bundle_integrity_failed"
  | "bundle_too_large";

export interface DecodeResponseDto {
  ok: boolean;
  venue: DecodedVenueDto | null;
  error: { code: BundleErrorCode; message: string } | null;
}

let initPromise: Promise<void> | null = null;

/**
 * In a real browser, `init()`'s default `fetch(new URL(..., import.meta.url))`
 * resolves against the page origin and works unmodified (see the Vite
 * config's `optimizeDeps.exclude` entry for `@kiriko/wasm`, which keeps
 * that URL intact). Under Vitest/Node there is no HTTP origin to fetch
 * from — Node's `fetch` does not support `file:` URLs — so the module
 * bytes are read from disk and instantiated directly instead.
 */
async function initFromDisk(): Promise<void> {
  // `node:fs/promises` only exists under Node.js and must never enter the
  // browser bundle graph; loading it dynamically (guarded by
  // `isNodeRuntime`) keeps it out of the client build entirely.
  const nodeFsSpecifier = "node:fs/promises";
  const { readFile } = (await import(/* @vite-ignore */ nodeFsSpecifier)) as { readFile: typeof ReadFileFn };
  const wasmUrl = new URL("kiriko_wasm_bg.wasm", import.meta.resolve("@kiriko/wasm/pkg/kiriko_wasm.js"));
  const bytes = await readFile(wasmUrl);
  await init({ module_or_path: bytes });
}

function isNodeRuntime(): boolean {
  return typeof process !== "undefined" && process.versions?.node != null;
}

/**
 * Instantiates the Kiriko WASM decoder module. Idempotent: every caller
 * (including every worker instance, and every test) can call this
 * unconditionally; the underlying WASM module is only instantiated once.
 * The same function works under both a real browser (Vite) and Vitest/Node
 * — see `initFromDisk`.
 */
export async function initKirikoWasm(): Promise<void> {
  initPromise ??= isNodeRuntime() ? initFromDisk() : init().then(() => undefined);
  await initPromise;
}

/**
 * Decodes a `kvb1` bundle. Must only be called after `initKirikoWasm` has
 * resolved. Never throws for domain (bundle-format) failures — inspect
 * `response.ok`/`response.error` instead.
 */
export function decodeBundle(bytes: Uint8Array): DecodeResponseDto {
  return decodeBundleWasm(bytes) as DecodeResponseDto;
}
