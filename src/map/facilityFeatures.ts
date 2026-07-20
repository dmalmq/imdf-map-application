import type { FacilityDto } from "../bundle/wasm";
import { facilityIconImage } from "./facilityIcons";

/**
 * Projects point facilities into a GeoJSON symbol source for one floor. Only
 * facilities on `activeOrdinal` are emitted, so switching levels swaps the
 * visible markers. Each feature carries its resolved MapLibre `icon` image id
 * (staged icon or pin fallback), display `name`, whether it has a routing
 * `anchor`, and its index into the source `facilities` array so a tap can
 * recover the full record (including the anchor) without re-parsing geometry.
 */
export function buildFacilityFeatures(
  facilities: readonly FacilityDto[],
  activeOrdinal: number,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  facilities.forEach((facility, index) => {
    if (facility.ordinal !== activeOrdinal) {
      return;
    }
    features.push({
      type: "Feature",
      properties: {
        kind: "facility",
        index,
        name: facility.name,
        icon: facilityIconImage(facility.icon),
        hasAnchor: facility.anchor !== null,
      },
      geometry: { type: "Point", coordinates: [facility.lon, facility.lat] },
    });
  });
  return { type: "FeatureCollection", features };
}
