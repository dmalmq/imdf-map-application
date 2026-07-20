/**
 * Server-side gdal3.js wrapper: one lazily-initialized instance per process.
 *
 * gdal3.js ships an Emscripten build of GDAL whose Node entry point is
 * `gdal3.js/node` (`initGdalJs`). Its runtime assets (`.wasm` + `.data`) live
 * under `gdal3.js/dist/package/`; the initializer needs the relative path to
 * that directory so it can resolve them from CWD. We resolve the absolute
 * directory at module load and pass it relative to `process.cwd()`.
 */
import { createRequire } from "node:module";
import { dirname, relative } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Resolve the gdal3.js dist package directory. `require.resolve` follows
 * pnpm's symlinks to the real `.pnpm/gdal3.js@<ver>/...` location, so the
 * WASM/data assets always come from the actually-installed package.
 */
function resolveGdalDistPackage(): string {
  const entry = require.resolve("gdal3.js/node");
  // entry: .../gdal3.js/dist/node/index.js → resolve the wasm sibling under
  // dist/package, then return that directory.
  const wasm = require.resolve("gdal3.js/dist/package/gdal3WebAssembly.wasm", {
    paths: [dirname(entry)],
  });
  return dirname(wasm);
}

/** Minimal GDAL surface consumed by the inspect/convert paths. */
export interface GdalInstance {
  open(path: string, options?: string[], vfs?: string[]): Promise<GdalOpenResult>;
  ogrinfo(dataset: unknown, args?: string[]): Promise<GdalOgrInfoResult>;
  ogr2ogr(dataset: unknown, args: string[], outputName: string): Promise<GdalOutputPath>;
  getFileBytes(output: unknown): Promise<Uint8Array>;
  close(dataset: unknown): Promise<void>;
  drivers: { vector: Record<string, unknown> };
}

export interface GdalOpenResult {
  datasets: unknown[];
  errors?: unknown[];
}

export interface GdalOgrInfoResult {
  layers?: GdalOgrLayer[];
}

export interface GdalOgrLayer {
  name?: string;
  featureCount?: number;
  geometryFields?: Array<{ type?: string }>;
  geometry?: string;
  fields?: Array<{ name?: string; type?: string }>;
}

export interface GdalOutputPath {
  local?: string;
  all?: Array<{ local?: string }>;
}

type GdalInitFn = (options: {
  path?: string;
  useWorker?: boolean;
  logHandler?: () => void;
  errorHandler?: (message: string) => void;
}) => Promise<GdalInstance>;

let cachedPromise: Promise<GdalInstance> | null = null;
let operationTail: Promise<void> = Promise.resolve();

/**
 * Serialize access to the shared Emscripten GDAL runtime. Its virtual
 * filesystem and fixed `/output` namespace are process-global, so overlapping
 * inspect/convert requests can otherwise close each other's datasets or
 * overwrite output files.
 */
export function serializeGdalOperation<T>(operation: () => Promise<T>): Promise<T> {
  const result = operationTail.then(operation);
  operationTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Returns the shared gdal3.js instance, initializing it on first use. The
 * WASM runtime is heavy (~50 MiB) and not needed until the first GDB request,
 * so lazy init keeps plain IMDF-only deployments off the critical path.
 */
export function getGdal(): Promise<GdalInstance> {
  if (cachedPromise) return cachedPromise;
  cachedPromise = (async () => {
    const loaded = require("gdal3.js/node");
    const init: GdalInitFn | undefined =
      typeof loaded === "function" ? (loaded as GdalInitFn) : loaded?.default;
    if (typeof init !== "function") {
      throw new Error("gdal3.js initializer not found in `gdal3.js/node`.");
    }
    const distPkg = resolveGdalDistPackage();
    return init({
      path: relative(process.cwd(), distPkg),
      useWorker: false,
      logHandler: () => {
        /* gdal3.js verbose logs are intentionally dropped. */
      },
      errorHandler: () => {
        /* Errors surface through the returned result envelope or thrown promise. */
      },
    });
  })();
  return cachedPromise;
}

/** Escape hatch for tests: drop the cached instance so the next call re-inits. */
export function resetGdalCacheForTests(): void {
  cachedPromise = null;
}
