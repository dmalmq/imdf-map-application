import type { RouteEndpoint, RouteResultDto } from "../bundle/wasm";

/**
 * Directions overlay input: the two picked endpoints plus the worker's
 * computed route, any of which may be absent mid-flow.
 */
export interface RouteFeaturesInput {
  origin: RouteEndpoint | null;
  destination: RouteEndpoint | null;
  route: RouteResultDto | null;
}

/**
 * Projects the directions state into a GeoJSON overlay for one floor.
 * Route nodes are grouped into maximal runs of consecutive nodes on
 * `activeOrdinal`; each run of two or more becomes one `kind:"segment"`
 * LineString, so floor transitions never draw cross-floor chords and only
 * the active floor's segments render. Endpoints become `kind:"origin"` /
 * `kind:"destination"` Point features, each visible only on its own floor.
 */
export function buildRouteFeatures(
  input: RouteFeaturesInput | null,
  activeOrdinal: number,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  if (input === null) {
    return { type: "FeatureCollection", features };
  }

  const { origin, destination, route } = input;

  if (route !== null) {
    let run: [number, number][] = [];
    const flush = (): void => {
      if (run.length >= 2) {
        features.push({
          type: "Feature",
          properties: { kind: "segment" },
          geometry: { type: "LineString", coordinates: run },
        });
      }
      run = [];
    };
    for (const node of route.nodes) {
      if (node.ordinal === activeOrdinal) {
        run.push([node.lon, node.lat]);
      } else {
        flush();
      }
    }
    flush();
  }

  if (origin !== null && origin.ordinal === activeOrdinal) {
    features.push({
      type: "Feature",
      properties: { kind: "origin" },
      geometry: { type: "Point", coordinates: [origin.longitude, origin.latitude] },
    });
  }
  if (destination !== null && destination.ordinal === activeOrdinal) {
    features.push({
      type: "Feature",
      properties: { kind: "destination" },
      geometry: { type: "Point", coordinates: [destination.longitude, destination.latitude] },
    });
  }

  return { type: "FeatureCollection", features };
}
