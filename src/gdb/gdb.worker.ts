/// <reference lib="webworker" />

import * as gdalModule from "gdal3.js";
import wasmUrl from "gdal3.js/dist/package/gdal3WebAssembly.wasm?url";
import dataUrl from "gdal3.js/dist/package/gdal3WebAssembly.data?url";
import { ArchiveError, archiveErrorCopy } from "../errors/ArchiveError";
import {
  GDB_MAX_GENERATED_BYTES,
  pathJoin,
  pathSegments,
  sanitizeSegment,
  stagedGroupRoot,
  validateGdbSources,
  type GdbSourceGroup,
} from "./gdbSourceValidation";
import type {
  GdbConversionResult,
  GdbConvertedLayer,
  GdbFieldDescriptor,
  GdbGeometryFamily,
  GdbInspection,
  GdbLayerDescriptor,
  GdbLayerKey,
  GdbMappingPlan,
  GdbSourceFile,
  GdbWorkerError,
  GdbWorkerErrorCode,
  GdbWorkerRequest,
  GdbWorkerResponse,
} from "./types";

declare const self: DedicatedWorkerGlobalScope;

// gdal3.js installs its own `onmessage` handler when evaluated in a worker.
// This worker owns a separate protocol, so keep GDAL in-process and prevent its
// proxy shim from intercepting inspect/convert messages.
self.onmessage = null;

/** Minimal Emscripten virtual-filesystem surface used for staging/cleanup. */
interface EmscriptenFS {
  mkdir(path: string): void;
  writeFile(path: string, data: Uint8Array): void;
  analyzePath(path: string): { exists: boolean };
  unlink(path: string): void;
  stat(path: string): { mode: number; size: number };
  isDir(mode: number): boolean;
  readdir(path: string): string[];
  rmdir(path: string): void;
}

/** Minimal GDAL surface consumed by the FileGDB inspect/convert path. */
interface GdalInstance {
  Module: { FS: EmscriptenFS };
  open(path: string, options?: string[], vfs?: string[]): Promise<unknown>;
  ogrinfo(dataset: unknown, args?: string[]): Promise<unknown>;
  ogr2ogr(dataset: unknown, args: string[], outputName: string): Promise<unknown>;
  getFileBytes(output: unknown): Promise<Uint8Array>;
  close(dataset: unknown): Promise<void>;
}

type GdalInitFn = (options: {
  paths: { wasm: string; data: string };
  useWorker: boolean;
  logHandler: () => void;
  errorHandler: () => void;
}) => Promise<unknown>;

type OgrLayer = Record<string, unknown>;

interface InspectedSession {
  importRoot: string;
  databases: Map<string, { dataset: unknown; layers: OgrLayer[]; groupName: string }>;
}

let _gdalPromise: Promise<GdalInstance> | null = null;
let _importSeq = 0;
let _session: InspectedSession | null = null;

// ---------------------------------------------------------------------------
// Untyped GDAL output readers. gdal3.js ships plain JS objects; these narrow
// `unknown` at the boundary instead of asserting fabricated shapes inline.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> {
  // A confirmed object is treated as an index-signature record.
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * Resolve gdal3.js's initializer from an ESM namespace and/or the UMD global.
 * Vite's worker bundling often yields an empty namespace for the UMD build while
 * the side effect still assigns `globalThis.initGdalJs`.
 */
export function resolveGdalInitFunction(
  moduleNamespace: unknown,
  globalInit: unknown = readGlobalGdalInit(),
): GdalInitFn | null {
  return findInitFunction(moduleNamespace) ?? findInitFunction(globalInit);
}

/** Read the UMD side-effect global installed by gdal3.js when present. */
function readGlobalGdalInit(): unknown {
  if (typeof globalThis !== "object" || globalThis === null) return undefined;
  if (!("initGdalJs" in globalThis)) return undefined;
  return Reflect.get(globalThis, "initGdalJs");
}

function findInitFunction(value: unknown, depth = 0): GdalInitFn | null {
  if (typeof value === "function") {
    return value as GdalInitFn;
  }
  if (!value || depth > 4 || typeof value !== "object") {
    return null;
  }
  return findInitFunction(asRecord(value).default, depth + 1);
}

function getGdal(): Promise<GdalInstance> {
  if (!_gdalPromise) {
    _gdalPromise = (async () => {
      const initFn = resolveGdalInitFunction(gdalModule);
      if (!initFn) {
        throw new Error(
          "gdal3.js initializer not found. Expected a function export or globalThis.initGdalJs.",
        );
      }
      const instance = await initFn({
        paths: { wasm: wasmUrl, data: dataUrl },
        useWorker: false,
        logHandler: () => {},
        errorHandler: () => {},
      });
      // gdal3.js exposes no types; the initialized value is a GdalInstance.
      return instance as GdalInstance;
    })();
  }
  return _gdalPromise;
}

// ---------------------------------------------------------------------------
// Path + Emscripten FS helpers (ported from the Cesium FileGDB worker).
// ---------------------------------------------------------------------------

function sanitizeOutputName(value: string): string {
  return (
    sanitizeSegment(value, "layer")
      .replace(/\.+$/g, "")
      .slice(0, 80) || "layer"
  );
}

function fsExists(fs: EmscriptenFS, path: string): boolean {
  try {
    return fs.analyzePath(path).exists;
  } catch {
    return false;
  }
}

function ensureDir(fs: EmscriptenFS, path: string): void {
  let current = "";
  for (const part of pathSegments(path)) {
    current += `/${part}`;
    if (!fsExists(fs, current)) {
      fs.mkdir(current);
    }
  }
}

function ensureParentDir(fs: EmscriptenFS, filePath: string): void {
  const index = filePath.lastIndexOf("/");
  if (index > 0) {
    ensureDir(fs, filePath.slice(0, index));
  }
}

async function writeDescriptorFile(
  fs: EmscriptenFS,
  descriptor: GdbSourceFile,
  targetPath: string,
): Promise<void> {
  ensureParentDir(fs, targetPath);
  const buffer = await descriptor.file.arrayBuffer();
  fs.writeFile(targetPath, new Uint8Array(buffer));
}

function unlinkIfExists(fs: EmscriptenFS, path: string): void {
  try {
    if (fsExists(fs, path)) {
      fs.unlink(path);
    }
  } catch {
    // Best-effort cleanup only.
  }
}

function removeTree(fs: EmscriptenFS, path: string): void {
  if (!fsExists(fs, path)) return;
  let stat: { mode: number };
  try {
    stat = fs.stat(path);
  } catch {
    return;
  }
  if (fs.isDir(stat.mode)) {
    for (const child of fs.readdir(path)) {
      if (child === "." || child === "..") continue;
      removeTree(fs, pathJoin(path, child));
    }
    try {
      fs.rmdir(path);
    } catch {
      // Best-effort cleanup only.
    }
    return;
  }
  unlinkIfExists(fs, path);
}

// ---------------------------------------------------------------------------
// GDAL open + layer helpers.
// ---------------------------------------------------------------------------

function normalizeGdalError(error: unknown): string {
  if (Array.isArray(error)) {
    const message = error
      .map((entry) => asString(asRecord(entry).message) || String(entry))
      .filter(Boolean)
      .join("; ");
    return message || "GDAL returned no error detail.";
  }
  const message = error instanceof Error ? error.message : String(error);
  return message || "GDAL returned no error detail.";
}

async function openDataset(
  gdal: GdalInstance,
  inputPath: string,
  vfs: string[] = [],
): Promise<{ dataset: unknown; warnings: string[] }> {
  let opened: unknown;
  try {
    opened = await gdal.open(inputPath, [], vfs);
  } catch (error) {
    throw new Error(normalizeGdalError(error));
  }
  const record = asRecord(opened);
  const datasets = asArray(record.datasets);
  const warnings = asArray(record.errors)
    .map((entry) => asString(asRecord(entry).message) || String(entry))
    .filter(Boolean);
  const dataset = datasets[0];
  if (dataset === undefined) {
    throw new Error(warnings.length ? warnings.join("; ") : "GDAL returned no datasets.");
  }
  return { dataset, warnings };
}

async function openZipDataset(
  gdal: GdalInstance,
  inputPath: string,
): Promise<{ dataset: unknown; warnings: string[] }> {
  const directWarnings: string[] = [];
  try {
    return await openDataset(gdal, inputPath);
  } catch (directError) {
    directWarnings.push(`Direct open failed: ${normalizeGdalError(directError)}`);
  }
  try {
    const opened = await openDataset(gdal, inputPath, ["vsizip"]);
    return { dataset: opened.dataset, warnings: [...directWarnings, ...opened.warnings] };
  } catch (zipError) {
    throw new Error(
      `GDAL could not open the selected zip as a FileGDB. ${directWarnings.join(
        " ",
      )} /vsizip/ open failed: ${normalizeGdalError(zipError)}`,
    );
  }
}

function classifyGeometry(layer: OgrLayer): GdbGeometryFamily {
  const families = new Set<GdbGeometryFamily>();
  for (const field of asArray(layer.geometryFields)) {
    const type = asString(asRecord(field).type).toLowerCase();
    if (type.includes("point")) families.add("point");
    else if (type.includes("line")) families.add("line");
    else if (type.includes("polygon")) families.add("polygon");
  }
  if (families.size === 0) {
    // Some drivers report a top-level geometry string instead.
    const type = asString(layer.geometry).toLowerCase();
    if (type.includes("point")) families.add("point");
    else if (type.includes("line")) families.add("line");
    else if (type.includes("polygon")) families.add("polygon");
  }
  if (families.size === 0) return "none";
  if (families.size === 1) return [...families][0]!;
  return "mixed";
}

/**
 * True when a GeoJSON feature carries at least one finite coordinate pair.
 * Empty arrays, GeometryCollections with no spatial members, and geometries
 * whose only positions are non-finite count as geometry-less so the convert
 * path can skip them into `skippedGeometryCount` instead of shipping hollow
 * features that later fail bounds synthesis.
 */
export function hasGeometry(feature: unknown): boolean {
  return geometryHasFiniteCoordinates(asRecord(feature).geometry);
}

/** True when `geometry` recursively contains ≥1 finite lon/lat pair. */
function geometryHasFiniteCoordinates(geometry: unknown): boolean {
  const record = asRecord(geometry);
  const type = asString(record.type);
  if (!type) return false;
  if (type === "GeometryCollection") {
    for (const nested of asArray(record.geometries)) {
      if (geometryHasFiniteCoordinates(nested)) return true;
    }
    return false;
  }
  return hasFiniteCoordinatePair(record.coordinates);
}

/**
 * Walk nested GeoJSON coordinate arrays; a leaf position is a finite pair
 * when both lon and lat are finite numbers (Z is ignored).
 */
function hasFiniteCoordinatePair(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (typeof value[0] === "number") {
    const lon = value[0];
    const lat = value[1];
    return typeof lat === "number" && Number.isFinite(lon) && Number.isFinite(lat);
  }
  for (const nested of value) {
    if (hasFiniteCoordinatePair(nested)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Staging.
// ---------------------------------------------------------------------------

async function stageGroup(
  fs: EmscriptenFS,
  importRoot: string,
  mode: "directory" | "archive",
  group: GdbSourceGroup,
): Promise<string> {
  const first = group.files[0];
  const stagedRoot = stagedGroupRoot(importRoot, mode, group);
  if (mode === "archive") {
    if (!first) {
      throw new Error("Archive group has no source file.");
    }
    await writeDescriptorFile(fs, first, stagedRoot);
    return stagedRoot;
  }

  const rootSegmentCount = pathSegments(group.relativePath).length;
  ensureDir(fs, stagedRoot);
  let staged = 0;
  for (const descriptor of group.files) {
    const relSegments = pathSegments(descriptor.relativePath).slice(rootSegmentCount);
    if (relSegments.length === 0) continue;
    const targetPath = pathJoin(
      stagedRoot,
      ...relSegments.map((segment) => sanitizeSegment(segment)),
    );
    await writeDescriptorFile(fs, descriptor, targetPath);
    staged += 1;
  }
  if (staged === 0) {
    throw new Error(`The selected ${group.name} folder contains no files.`);
  }
  return stagedRoot;
}

// ---------------------------------------------------------------------------
// Two-phase request handling.
// ---------------------------------------------------------------------------

function selectionNameFromDescriptors(
  mode: "directory" | "archive",
  files: readonly GdbSourceFile[],
): string {
  if (mode === "directory") {
    const nested = files.find((file) => file.relativePath.includes("/"));
    if (nested) {
      const [firstSegment] = nested.relativePath.split("/");
      return firstSegment || nested.name;
    }
    return files[0]?.name ?? "";
  }
  if (files.length === 1) {
    return files[0]?.name ?? "";
  }
  return `${files.length} GDB archives`;
}

async function closeDatasets(
  gdal: GdalInstance,
  datasets: Iterable<unknown>,
): Promise<void> {
  for (const dataset of datasets) {
    try {
      await gdal.close(dataset);
    } catch {
      // Best-effort close.
    }
  }
}

async function disposeSession(gdal: GdalInstance, fs: EmscriptenFS): Promise<void> {
  if (!_session) return;
  await closeDatasets(
    gdal,
    [..._session.databases.values()].map((db) => db.dataset),
  );
  removeTree(fs, _session.importRoot);
  _session = null;
}

async function handleInspect(
  mode: "directory" | "archive",
  files: readonly GdbSourceFile[],
): Promise<GdbInspection> {
  const validation = await validateGdbSources(mode, files);
  const gdal = await getGdal();
  const fs = gdal.Module.FS;

  // Close all prior datasets and remove their staged tree before replacing.
  await disposeSession(gdal, fs);

  const importRoot = `/input/gdb-import-${++_importSeq}`;
  ensureDir(fs, importRoot);

  const databases: Array<{ id: string; name: string }> = [];
  const layers: GdbLayerDescriptor[] = [];
  const warnings: string[] = [];
  const dbMap = new Map<
    string,
    { dataset: unknown; layers: OgrLayer[]; groupName: string }
  >();
  const openedDatasets: unknown[] = [];

  try {
    for (const group of validation.groups) {
      let opened: { dataset: unknown; warnings: string[] };
      let info: Record<string, unknown>;
      try {
        const stagedPath = await stageGroup(fs, importRoot, mode, group);
        opened =
          mode === "archive"
            ? await openZipDataset(gdal, stagedPath)
            : await openDataset(gdal, stagedPath);
        openedDatasets.push(opened.dataset);
        info = asRecord(await gdal.ogrinfo(opened.dataset, ["-so", "-al"]));
      } catch (error) {
        if (error instanceof ArchiveError) throw error;
        // Normalize staging/open/ogrinfo diagnostics into error.details.
        throw new ArchiveError(
          "invalid_geodatabase",
          archiveErrorCopy.invalid_geodatabase,
          {
            databaseId: group.databaseId,
            database: group.name,
            detail: error instanceof Error ? error.message : String(error),
          },
        );
      }
      warnings.push(...opened.warnings);

      const ogrLayers = asArray(info.layers).map(asRecord);
      dbMap.set(group.databaseId, {
        dataset: opened.dataset,
        layers: ogrLayers,
        groupName: group.name,
      });
      databases.push({ id: group.databaseId, name: group.name });

      for (const layer of ogrLayers) {
        const layerName = asString(layer.name);
        if (!layerName) continue;
        const fields: GdbFieldDescriptor[] = asArray(layer.fields).map((field) => {
          const record = asRecord(field);
          return { name: asString(record.name), type: asString(record.type) };
        });
        layers.push({
          key: { databaseId: group.databaseId, layerName },
          databaseName: group.name,
          featureCount: asNumber(layer.featureCount),
          geometryFamily: classifyGeometry(layer),
          fields,
        });
      }
    }

    if (layers.length === 0) {
      throw new ArchiveError("invalid_geodatabase", archiveErrorCopy.invalid_geodatabase, {
        reason: "no_layers",
      });
    }

    _session = { importRoot, databases: dbMap };
    return {
      sourceName: selectionNameFromDescriptors(mode, files),
      databases,
      layers,
      warnings,
    };
  } catch (error) {
    // Partial inspect failure: close datasets opened this run, drop staged tree.
    await closeDatasets(gdal, openedDatasets);
    removeTree(fs, importRoot);
    throw error;
  }
}

async function exportLayer(
  gdal: GdalInstance,
  fs: EmscriptenFS,
  dataset: unknown,
  key: GdbLayerKey,
  layerIndex: number,
  remainingBytes: number,
): Promise<{ featureCollection: GeoJSON.FeatureCollection; skipped: number; bytes: number }> {
  const outputName = `gdb_${key.databaseId}_${layerIndex}_${sanitizeOutputName(key.layerName)}`;
  const outputPaths = new Set<string>([`/output/${outputName}.geojson`]);
  try {
    const output = await gdal.ogr2ogr(
      dataset,
      [
        "-f",
        "GeoJSON",
        "-t_srs",
        "EPSG:4326",
        "-lco",
        "RFC7946=YES",
        "-nlt",
        "CONVERT_TO_LINEAR",
        "-dim",
        "XY",
        key.layerName,
      ],
      outputName,
    );

    const outputRecord = asRecord(output);
    if (typeof outputRecord.local === "string") {
      outputPaths.add(outputRecord.local);
    }
    for (const entry of asArray(outputRecord.all)) {
      const local = asRecord(entry).local;
      if (typeof local === "string") {
        outputPaths.add(local);
      }
    }

    // Enforce the remaining generated-GeoJSON budget from the Emscripten output
    // stat size BEFORE reading/decoding/parsing, to avoid materializing an
    // over-budget buffer; the cumulative post-read check in handleConvert stays.
    let outputSize = 0;
    try {
      outputSize = fs.stat(`/output/${outputName}.geojson`).size;
    } catch {
      outputSize = 0;
    }
    if (outputSize > remainingBytes) {
      throw new ArchiveError("gdb_too_large", archiveErrorCopy.gdb_too_large, {
        layer: key.layerName,
        database: key.databaseId,
        outputSize,
        remainingBytes,
        limit: GDB_MAX_GENERATED_BYTES,
      });
    }
    const bytes = await gdal.getFileBytes(output);
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    const record = asRecord(parsed);
    if (asString(record.type) !== "FeatureCollection") {
      throw new Error(`Layer "${key.layerName}" did not convert to a FeatureCollection.`);
    }
    const features = asArray(record.features);
    const spatial = features.filter(hasGeometry);
    if (spatial.length === 0) {
      throw new Error(`Layer "${key.layerName}" produced no spatial features.`);
    }
    // GDAL RFC7946 output is trusted GeoJSON; spatial entries are Features.
    const validFeatures = spatial as GeoJSON.Feature[];
    return {
      featureCollection: { type: "FeatureCollection", features: validFeatures },
      skipped: features.length - spatial.length,
      bytes: bytes.length,
    };
  } catch (error) {
    if (error instanceof ArchiveError) {
      throw error;
    }
    throw new ArchiveError("gdb_conversion_failed", archiveErrorCopy.gdb_conversion_failed, {
      layer: key.layerName,
      database: key.databaseId,
      detail: error instanceof Error ? error.message : String(error),
    });
  } finally {
    // Delete this layer's output files immediately; staged inputs stay alive
    // until the worker terminates so mapping retries need no restaging.
    for (const path of outputPaths) {
      unlinkIfExists(fs, path);
    }
  }
}

async function handleConvert(plan: GdbMappingPlan): Promise<GdbConversionResult> {
  const session = _session;
  if (!session) {
    throw new ArchiveError("gdb_conversion_failed", archiveErrorCopy.gdb_conversion_failed, {
      reason: "not_inspected",
    });
  }
  const gdal = await getGdal();
  const fs = gdal.Module.FS;
  const layers: GdbConvertedLayer[] = [];
  const warnings: string[] = [];
  let generatedBytes = 0;

  for (const layerPlan of plan.layers) {
    if (!layerPlan.included) continue;
    const database = session.databases.get(layerPlan.key.databaseId);
    if (!database) {
      throw new ArchiveError("gdb_conversion_failed", archiveErrorCopy.gdb_conversion_failed, {
        reason: "unknown_database",
        key: layerPlan.key,
      });
    }
    const layerIndex = database.layers.findIndex(
      (layer) => asString(layer.name) === layerPlan.key.layerName,
    );
    if (layerIndex === -1) {
      throw new ArchiveError("gdb_conversion_failed", archiveErrorCopy.gdb_conversion_failed, {
        reason: "unknown_layer",
        key: layerPlan.key,
      });
    }

    const result = await exportLayer(
      gdal,
      fs,
      database.dataset,
      layerPlan.key,
      layerIndex,
      GDB_MAX_GENERATED_BYTES - generatedBytes,
    );
    generatedBytes += result.bytes;
    if (generatedBytes > GDB_MAX_GENERATED_BYTES) {
      throw new ArchiveError("gdb_too_large", archiveErrorCopy.gdb_too_large, {
        generatedBytes,
        limit: GDB_MAX_GENERATED_BYTES,
      });
    }
    if (result.skipped > 0) {
      warnings.push(
        `Layer "${layerPlan.key.layerName}" skipped ${result.skipped} feature(s) without geometry.`,
      );
    }
    layers.push({
      key: layerPlan.key,
      featureCollection: result.featureCollection,
      skippedGeometryCount: result.skipped,
    });
  }

  return { layers, warnings };
}

// ---------------------------------------------------------------------------
// Protocol serialization.
// ---------------------------------------------------------------------------

function isGdbErrorCode(code: string): code is GdbWorkerErrorCode {
  return (
    code === "invalid_geodatabase" ||
    code === "gdb_too_large" ||
    code === "gdb_conversion_failed"
  );
}

function serializeWorkerError(
  error: unknown,
  phase: "inspect" | "convert",
): GdbWorkerError {
  const code =
    error instanceof ArchiveError && isGdbErrorCode(error.code)
      ? error.code
      : phase === "convert"
        ? "gdb_conversion_failed"
        : "invalid_geodatabase";
  // All convert-phase typed failures (including the generated cap) are
  // recoverable in the same review session; inspect/staging failures are fatal.
  const recoverable = phase === "convert";
  const base: GdbWorkerError = {
    code,
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    recoverable,
  };
  const details = error instanceof ArchiveError ? error.details : undefined;
  return details !== undefined ? { ...base, details } : base;
}

function isWorkerRequest(value: unknown): value is GdbWorkerRequest {
  if (value === null || typeof value !== "object") return false;
  if (!("id" in value) || typeof value.id !== "number") return false;
  if (!("type" in value)) return false;
  return value.type === "inspect" || value.type === "convert";
}

async function handleMessage(event: MessageEvent<unknown>): Promise<void> {
  const request = event.data;
  if (!isWorkerRequest(request)) return;

  try {
    const result =
      request.type === "inspect"
        ? await handleInspect(request.mode, request.files)
        : await handleConvert(request.plan);
    const response: GdbWorkerResponse = { id: request.id, ok: true, result };
    self.postMessage(response);
  } catch (error) {
    const response: GdbWorkerResponse = {
      id: request.id,
      ok: false,
      error: serializeWorkerError(error, request.type === "convert" ? "convert" : "inspect"),
    };
    self.postMessage(response);
  }
}

// Register the protocol only inside a real worker scope so importing this
// module under vitest/jsdom neither throws nor installs a handler.
declare const WorkerGlobalScope: (new () => unknown) | undefined;
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  self.addEventListener("message", handleMessage);
}
