/**
 * Per-feature fill colors for unit (_Space) features, keyed by the source
 * `color2` attribute. Hex values are copied verbatim from the Cesium project
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

/**
 * Resolve a unit's fill from its raw `color2` value: the mapped hex, the
 * default gray for a present-but-unmapped string, or null when absent/blank so
 * the caller keeps the theme color.
 */
export function color2Fill(value: unknown): string | null {
  if (typeof value !== "string" || value === "") {
    return null;
  }
  return COLOR2_LOOKUP[value] ?? COLOR2_DEFAULT;
}
