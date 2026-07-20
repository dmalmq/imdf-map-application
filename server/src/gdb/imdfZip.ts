/**
 * IMDF zip serializer: writes a {@link ParsedImdfArchive} into a flat IMDF
 * 1.0.0 archive (manifest.json + per-collection .geojson files) ready for the
 * Rust importer. The importer requires `manifest.json`, `venue.geojson`, and
 * `address.geojson` to be present; address is always emitted (empty when no
 * addresses were synthesized), matching the importer's empty-FeatureCollection
 * acceptance.
 */
import { ZipWriter, TextReader, Uint8ArrayWriter } from "@zip.js/zip.js";
import type { FeatureType, ParsedImdfArchive } from "./mapping";

const FEATURE_FILENAMES: Record<FeatureType, string> = {
  address: "address.geojson",
  amenity: "amenity.geojson",
  anchor: "anchor.geojson",
  building: "building.geojson",
  detail: "detail.geojson",
  fixture: "fixture.geojson",
  footprint: "footprint.geojson",
  geofence: "geofence.geojson",
  kiosk: "kiosk.geojson",
  level: "level.geojson",
  occupant: "occupant.geojson",
  opening: "opening.geojson",
  relationship: "relationship.geojson",
  section: "section.geojson",
  unit: "unit.geojson",
  venue: "venue.geojson",
};

/**
 * Serialize the archive into IMDF ZIP bytes. Manifest and every collection are
 * written as deterministic JSON. The importer canonicalizes property/keys, so
 * we leave JSON output order alone and just emit the manifest plus every
 * present collection under its IMDF filename.
 */
export async function writeImdfZip(archive: ParsedImdfArchive): Promise<Uint8Array> {
  const output = new Uint8ArrayWriter();
  const writer = new ZipWriter(output, { level: 6 });

  await writer.add("manifest.json", new TextReader(JSON.stringify(archive.manifest)));

  for (const [type, collection] of Object.entries(archive.collections) as Array<
    [FeatureType, GeoJSON.FeatureCollection]
  >) {
    const filename = FEATURE_FILENAMES[type];
    if (filename === undefined) continue;
    await writer.add(filename, new TextReader(JSON.stringify(collection)));
  }
  if (archive.collections.address === undefined) {
    await writer.add(
      "address.geojson",
      new TextReader(JSON.stringify({ type: "FeatureCollection", features: [] })),
    );
  }

  return writer.close();
}
