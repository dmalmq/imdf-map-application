import type { BlobStore } from "../blobs/store";
import {
  CoreInspectError,
  inspectVenueBundle,
  type BundleAnchorIndex,
} from "../core/native";

const DEFAULT_MAX_ENTRIES = 8;

/**
 * Small process-local LRU for immutable bundle anchor indexes. Resolved values
 * and in-flight work are deliberately separate: only successful, hash-matched
 * inspection results consume the bounded cache.
 */
export class AnchorIndexCache {
  private readonly resolved = new Map<string, BundleAnchorIndex>();
  private readonly inFlight = new Map<string, Promise<BundleAnchorIndex>>();
  private generation = 0;

  constructor(
    private readonly blobs: BlobStore,
    private readonly inspect: typeof inspectVenueBundle = inspectVenueBundle,
    private readonly maxEntries = DEFAULT_MAX_ENTRIES,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError("AnchorIndexCache maxEntries must be a positive integer");
    }
  }

  get(bundleHash: string): Promise<BundleAnchorIndex> {
    const cached = this.resolved.get(bundleHash);
    if (cached !== undefined) {
      this.resolved.delete(bundleHash);
      this.resolved.set(bundleHash, cached);
      return Promise.resolve(cached);
    }

    const pending = this.inFlight.get(bundleHash);
    if (pending !== undefined) {
      return pending;
    }

    const generation = this.generation;
    let load!: Promise<BundleAnchorIndex>;
    load = Promise.resolve()
      .then(() => this.blobs.readAsync(bundleHash))
      .then((bytes) => this.inspect(bytes, bundleHash))
      .then((index) => {
        if (index.bundleHash !== bundleHash) {
          throw new CoreInspectError(
            "bundle_hash_mismatch",
            `inspected bundle hash ${index.bundleHash} does not match ${bundleHash}`,
          );
        }
        if (this.generation === generation && this.inFlight.get(bundleHash) === load) {
          this.resolved.set(bundleHash, index);
          while (this.resolved.size > this.maxEntries) {
            const leastRecent = this.resolved.keys().next().value as string;
            this.resolved.delete(leastRecent);
          }
        }
        return index;
      })
      .finally(() => {
        if (this.inFlight.get(bundleHash) === load) {
          this.inFlight.delete(bundleHash);
        }
      });
    this.inFlight.set(bundleHash, load);
    return load;
  }

  clear(): void {
    this.generation += 1;
    this.resolved.clear();
    this.inFlight.clear();
  }
}
