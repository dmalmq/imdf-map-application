import type { NetworkGeoJsonDto } from "../bundle/wasm";

/**
 * Parse an exported network `FLOOR` label back to a level ordinal — the
 * inverse of the Rust `ordinal_to_floor_label` (`F1 → 0`, `F{n} → n-1`,
 * `B{n} → -n`), with `M{n} → n` tolerated for hand-authored data. Returns
 * `null` for anything unrecognized so the feature is simply not shown.
 */
export function floorLabelToOrdinal(label: string): number | null {
  const match = /^([A-Za-z]+)(\d+)$/.exec(label.trim());
  if (match === null) {
    return null;
  }
  const prefix = match[1]!.toUpperCase();
  const n = Number.parseInt(match[2]!, 10);
  if (!Number.isFinite(n)) {
    return null;
  }
  if (prefix === "F") {
    return n - 1;
  }
  if (prefix === "M") {
    return n;
  }
  // `B` or a building-prefixed basement (`KB`, `SB`, …) → negative ordinal.
  if (prefix === "B" || prefix.endsWith("B")) {
    return -n;
  }
  return null;
}

interface NetworkFeature {
  ordinal: number | null;
  geometry: GeoJSON.Geometry;
}

/** Parsed, floor-tagged network ready for per-floor overlay rendering. */
export interface ParsedNetwork {
  junctions: NetworkFeature[];
  paths: NetworkFeature[];
}

function parseCollection(text: string): NetworkFeature[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const features = (parsed as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    return [];
  }
  const out: NetworkFeature[] = [];
  for (const feature of features) {
    const geometry = (feature as { geometry?: GeoJSON.Geometry }).geometry;
    const floor = (feature as { properties?: { FLOOR?: unknown } }).properties?.FLOOR;
    if (geometry == null || typeof floor !== "string") {
      continue;
    }
    out.push({ ordinal: floorLabelToOrdinal(floor), geometry });
  }
  return out;
}

/** Parse the wasm `exportNetwork` DTO into floor-tagged features. */
export function parseNetworkOverlay(dto: NetworkGeoJsonDto): ParsedNetwork {
  return {
    junctions: parseCollection(dto.junctions),
    paths: parseCollection(dto.paths),
  };
}

/**
 * Project the parsed network onto one floor: every `net_path` on
 * `activeOrdinal` becomes a `kind:"path"` LineString and every `net_junction`
 * a `kind:"junction"` Point. Mirrors `buildRouteFeatures`' per-floor overlay
 * contract so the map renders only the active level's network.
 */
export function buildNetworkFeatures(
  network: ParsedNetwork | null,
  activeOrdinal: number,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (network === null) {
    return { type: "FeatureCollection", features };
  }
  for (const path of network.paths) {
    if (path.ordinal === activeOrdinal) {
      features.push({ type: "Feature", properties: { kind: "path" }, geometry: path.geometry });
    }
  }
  for (const junction of network.junctions) {
    if (junction.ordinal === activeOrdinal) {
      features.push({ type: "Feature", properties: { kind: "junction" }, geometry: junction.geometry });
    }
  }
  return { type: "FeatureCollection", features };
}
