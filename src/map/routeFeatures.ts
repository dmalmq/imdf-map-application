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
 * Projects the directions state into a GeoJSON overlay for one floor. Each
 * route `segment` on `activeOrdinal` becomes one `kind:"segment"` LineString
 * tracing the real corridor polyline; a `kind:"connector"` LineString links
 * each raw click to its projected point on the network, drawn on the
 * projection's floor. Endpoints become `kind:"origin"` / `kind:"destination"`
 * Point features at the raw click, each visible only on its own floor.
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
    for (const segment of route.segments) {
      if (segment.ordinal === activeOrdinal && segment.coordinates.length >= 2) {
        features.push({
          type: "Feature",
          properties: { kind: "segment" },
          geometry: { type: "LineString", coordinates: segment.coordinates },
        });
      }
    }
    // Connectors: raw click → projected point, on the projection's floor.
    const [oLon, oLat, oOrd] = route.originProjected;
    if (origin !== null && oOrd === activeOrdinal) {
      features.push({
        type: "Feature",
        properties: { kind: "connector" },
        geometry: {
          type: "LineString",
          coordinates: [[origin.longitude, origin.latitude], [oLon, oLat]],
        },
      });
    }
    const [dLon, dLat, dOrd] = route.destProjected;
    if (destination !== null && dOrd === activeOrdinal) {
      features.push({
        type: "Feature",
        properties: { kind: "connector" },
        geometry: {
          type: "LineString",
          coordinates: [[destination.longitude, destination.latitude], [dLon, dLat]],
        },
      });
    }
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
