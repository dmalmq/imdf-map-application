/**
 * Per-feature fill colors for unit (`_Space`) features, keyed by the source
 * `color2` attribute the JR East venue GDB carries (a Japanese color *name*,
 * not a hex). Hex values are copied verbatim from the Cesium project
 * (`src/main.js` / `src/viewer.js` COLOR2_LOOKUP); `道白` is added as white.
 */
export const COLOR2_LOOKUP: Record<string, string> = {
  "橙": "#FFC090",
  "トイレ": "#E5E6E6",
  "薄紅": "#FFECE6",
  "緑": "#DDF5D9",
  "濃空": "#C2E5F2",
  "濃鼠": "#C8C9CA",
  "白": "#FFFFFF",
  "薄空": "#C0E0EA",
  "薄鼠": "#A0A1A2",
  "黄": "#F5F5C0",
  "濃紅": "#F2CFC2",
  "ラチ外白": "#FFFFFF",
  "進入制限あり": "#E5E6E6",
  "道白": "#FFFFFF",
};

/** Fallback fill for a present-but-unmapped color2 value (matches Cesium). */
export const COLOR2_DEFAULT = "#808080";

/** Cell values that are themselves colors: #RGB or #RRGGBB. Verbatim from Cesium layerColorConfig.js. */
export const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/**
 * Resolve a unit's fill from its raw `color2` value: the mapped hex for a
 * named color, a literal #RGB/#RRGGBB value returned as-is, the default gray
 * for any other present-but-unmapped string, or null when absent/blank so the
 * caller keeps the category theme color.
 */
export function color2Fill(value: unknown): string | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  const mapped = COLOR2_LOOKUP[value];
  if (mapped !== undefined) {
    return mapped;
  }
  if (HEX_COLOR_RE.test(value)) {
    return value;
  }
  return COLOR2_DEFAULT;
}
