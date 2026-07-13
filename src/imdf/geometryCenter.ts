/**
 * Center of a GeoJSON geometry: a Point returns its own position; any other
 * geometry returns the center of the longitude/latitude bounding box of every
 * finite coordinate pair, walking nested coordinate arrays and
 * GeometryCollections recursively. Null, empty, or entirely non-finite
 * geometry returns `null`.
 */
export function geometryCenter(geometry: GeoJSON.Geometry): [number, number] | null {
  if (geometry.type === "Point") {
    const [lon, lat] = geometry.coordinates;
    return typeof lon === "number" &&
      typeof lat === "number" &&
      Number.isFinite(lon) &&
      Number.isFinite(lat)
      ? [lon, lat]
      : null;
  }

  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  let found = false;

  const visitPositions = (value: unknown): void => {
    if (!Array.isArray(value)) {
      return;
    }
    if (typeof value[0] === "number") {
      const lon = value[0];
      const lat = value[1];
      if (
        typeof lat === "number" &&
        Number.isFinite(lon) &&
        Number.isFinite(lat)
      ) {
        west = Math.min(west, lon);
        south = Math.min(south, lat);
        east = Math.max(east, lon);
        north = Math.max(north, lat);
        found = true;
      }
      return;
    }
    for (const nested of value) {
      visitPositions(nested);
    }
  };

  const visitGeometry = (candidate: GeoJSON.Geometry): void => {
    if (candidate.type === "GeometryCollection") {
      for (const nested of candidate.geometries ?? []) {
        visitGeometry(nested);
      }
      return;
    }
    visitPositions(candidate.coordinates);
  };

  visitGeometry(geometry);

  return found ? [(west + east) / 2, (south + north) / 2] : null;
}
