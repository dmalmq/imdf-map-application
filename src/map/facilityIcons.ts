/**
 * Staged point-facility marker icons. The GDB `image` field references
 * `/marker/<name>.png`; we bundle the available subset under `icons/marker/`
 * and resolve by basename. Facilities whose icon is not in the staged set
 * (named stores by numeric symbol_id, building overlays) fall back to a
 * generic pin.
 */
const modules = import.meta.glob("./icons/marker/*.png", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

/** Basename (without extension) → bundled asset URL. */
export const MARKER_ICON_URLS: Record<string, string> = {};
for (const [path, url] of Object.entries(modules)) {
  const base = path.split("/").pop()?.replace(/\.png$/, "");
  if (base !== undefined && base.length > 0) {
    MARKER_ICON_URLS[base] = url;
  }
}

/** MapLibre image id used when a facility's icon has no staged asset. */
export const FACILITY_PIN_IMAGE = "kiriko-facility-pin";

/**
 * Resolve a facility's `image` basename to a registered MapLibre image id:
 * the icon name when a staged asset exists, otherwise the generic pin.
 */
export function facilityIconImage(icon: string): string {
  return icon !== "" && Object.prototype.hasOwnProperty.call(MARKER_ICON_URLS, icon)
    ? icon
    : FACILITY_PIN_IMAGE;
}
