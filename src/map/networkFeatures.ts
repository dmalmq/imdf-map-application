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
  properties: Record<string, unknown>;
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
  if (typeof parsed !== "object" || parsed === null || !("features" in parsed)) {
    return [];
  }
  const features = parsed.features;
  if (!Array.isArray(features)) {
    return [];
  }
  const out: NetworkFeature[] = [];
  for (const feature of features) {
    if (typeof feature !== "object" || feature === null || !("geometry" in feature)) {
      continue;
    }
    // GeoJSON produced by our own wasm exporter; shape is exporter-guaranteed.
    const geometry = feature.geometry as GeoJSON.Geometry | null | undefined;
    const rawProps = "properties" in feature ? feature.properties : undefined;
    const properties: Record<string, unknown> =
      typeof rawProps === "object" && rawProps !== null ? { ...rawProps } : {};
    const floor = properties.FLOOR;
    if (geometry == null || typeof floor !== "string") {
      continue;
    }
    out.push({ ordinal: floorLabelToOrdinal(floor), geometry, properties });
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

export interface NetworkConnectivity {
  nodes: number;
  edges: number;
  components: number;
  /** Largest component's share of all nodes, 0..1. */
  largestFraction: number;
  /** Distinct floor ordinals spanned by the largest component. */
  floorsInLargest: number;
  /** Nodes with no incident edge. */
  isolated: number;
}

/**
 * Connectivity report over a parsed network: union-find on `net_path`
 * FNODEID/TNODEID, keyed by `net_junction` NODEID. Directed reverse pairs are
 * harmless (they union the same roots). Pure; computed where the graph already
 * lives so no server round-trip is needed.
 */
export function networkConnectivity(net: ParsedNetwork): NetworkConnectivity {
  const index = new Map<number, number>();
  const ordinals: number[] = [];
  for (const j of net.junctions) {
    const id = j.properties.NODEID;
    if (typeof id === "number" && !index.has(id)) {
      index.set(id, ordinals.length);
      ordinals.push(j.ordinal ?? Number.NaN);
    }
  }
  const n = ordinals.length;
  if (n === 0) {
    return { nodes: 0, edges: 0, components: 0, largestFraction: 0, floorsInLargest: 0, isolated: 0 };
  }
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]!]!;
      x = parent[x]!;
    }
    return x;
  };
  const degree = new Array<number>(n).fill(0);
  let edges = 0;
  for (const p of net.paths) {
    const from = p.properties.FNODEID;
    const to = p.properties.TNODEID;
    const f = typeof from === "number" ? index.get(from) : undefined;
    const t = typeof to === "number" ? index.get(to) : undefined;
    if (f === undefined || t === undefined) continue;
    edges += 1;
    degree[f]! += 1;
    degree[t]! += 1;
    const a = find(f);
    const b = find(t);
    if (a !== b) parent[a] = b;
  }
  const sizes = new Map<number, number>();
  for (let i = 0; i < n; i += 1) {
    const r = find(i);
    sizes.set(r, (sizes.get(r) ?? 0) + 1);
  }
  let largestRoot = -1;
  let largest = 0;
  for (const [root, size] of sizes) {
    if (size > largest) {
      largest = size;
      largestRoot = root;
    }
  }
  const floors = new Set<number>();
  for (let i = 0; i < n; i += 1) {
    if (find(i) === largestRoot && Number.isFinite(ordinals[i]!)) floors.add(ordinals[i]!);
  }
  return {
    nodes: n,
    edges,
    components: sizes.size,
    largestFraction: largest / n,
    floorsInLargest: floors.size,
    isolated: degree.filter((d) => d === 0).length,
  };
}
