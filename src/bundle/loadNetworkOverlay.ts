import { exportNetwork, initKirikoWasm } from "./wasm";
import { parseNetworkOverlay, type ParsedNetwork } from "../map/networkFeatures";

/**
 * Fetch a published `.kvb` bundle's bytes and extract its §5 routing network
 * as floor-tagged features for review rendering. Runs the wasm exporter on the
 * main thread on demand (the directions worker only routes; this is only
 * invoked when the user opens the network-review overlay). Throws when the
 * fetch fails or the bundle carries no graph.
 */
export async function loadNetworkOverlay(
  bundleUrl: string,
  signal?: AbortSignal,
): Promise<ParsedNetwork> {
  const response = await fetch(bundleUrl, {
    credentials: "same-origin",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw new Error(`bundle fetch failed: ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  await initKirikoWasm();
  return parseNetworkOverlay(exportNetwork(bytes));
}
