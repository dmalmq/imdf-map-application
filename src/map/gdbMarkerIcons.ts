import type { Map as MapLibreMap } from "maplibre-gl";

/**
 * Local POI marker assets copied from the Cesium app. Icons are the only
 * accepted image source: an `image` value is mapped to one of these local
 * filenames and never fetched from an arbitrary/external URL.
 */
export const GDB_MARKER_ICON_FILES: readonly string[] = [
  "baby.png",
  "bansen_01.png",
  "bansen_02.png",
  "bansen_03.png",
  "bansen_04.png",
  "bansen_05.png",
  "bansen_06.png",
  "bansen_07.png",
  "bansen_08.png",
  "bansen_09.png",
  "bansen_10.png",
  "bansen_11.png",
  "bus.png",
  "children.png",
  "elevator.png",
  "elevator_down.png",
  "elevator_up.png",
  "escalator.png",
  "exchange.png",
  "female.png",
  "info.png",
  "livecamera.png",
  "locker.png",
  "male.png",
  "multipurpose.png",
  "mv.png",
  "prayer.png",
  "slope.png",
  "smoking.png",
  "stairs_down.png",
  "stairs_up.png",
  "taxi.png",
  "ticket.png",
  "unisex.png",
];

const ICON_ID_PREFIX = "gdb-icon:";
const ICON_BASE_PATH = "/icons/marker/";
/** All source assets are normalized to the Cesium app's 32 px footprint. */
const ICON_SIZE = 32;

/**
 * Icon id for a source `image` value, or null for the DOM/circle fallback.
 * Takes only the final normalized (`/` or `\`) path segment, lowercased, so an
 * external URL resolves to at most a local allowlisted basename — never a fetch.
 */
export function gdbMarkerIconId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const segments = value.trim().split(/[/\\]/);
  const filename = segments[segments.length - 1]!.toLowerCase();
  if (filename === "" || !GDB_MARKER_ICON_FILES.includes(filename)) {
    return null;
  }
  return `${ICON_ID_PREFIX}${filename}`;
}

/** Draw a source image into a 32x32 canvas; null when 2d context is unavailable. */
function rasterizeTo32(image: HTMLImageElement | ImageBitmap): ImageData | null {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  if (ctx == null) {
    return null;
  }
  ctx.drawImage(image, 0, 0, ICON_SIZE, ICON_SIZE);
  return ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
}

async function registerOne(
  map: MapLibreMap,
  filename: string,
  signal: AbortSignal | undefined,
): Promise<void> {
  const iconId = `${ICON_ID_PREFIX}${filename}`;
  try {
    // Skip the fetch/decode entirely when aborted or already registered.
    if (signal?.aborted || map.hasImage(iconId)) {
      return;
    }
    const result = await map.loadImage(`${ICON_BASE_PATH}${filename}`);
    // Abort/existence re-checked after the async boundary so a torn-down map is
    // never mutated and a concurrent registration never double-adds.
    if (signal?.aborted || map.hasImage(iconId)) {
      return;
    }
    const data = rasterizeTo32(result.data);
    if (data == null || signal?.aborted || map.hasImage(iconId)) {
      return;
    }
    map.addImage(iconId, data);
  } catch {
    // A single missing/undecodable asset is skipped without failing startup.
  }
}

/**
 * Load and register every allowlisted marker as a 32x32 image. Safe to abort:
 * once `signal` aborts, no further image is added to the (possibly removed) map.
 */
export async function registerGdbMarkerIcons(
  map: MapLibreMap,
  signal?: AbortSignal,
): Promise<void> {
  await Promise.all(
    GDB_MARKER_ICON_FILES.map((filename) => registerOne(map, filename, signal)),
  );
}
