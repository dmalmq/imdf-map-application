import type { ThemeId, ViewerTheme } from "./types";

const fontFamily =
  '"Inter Variable", "Noto Sans JP Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", "Noto Sans CJK JP", Meiryo, sans-serif';

/**
 * Kiriko map palette (Figma 📐 Foundation + MapMock/1F): cool stone canvas,
 * soft indigo-tinted units, warm beige service rooms, Ai Indigo selection.
 */
export const themes: Record<ThemeId, ViewerTheme> = {
  kiriko: {
    id: "kiriko",
    label: "Kiriko",
    colors: {
      canvas: "#ededeb",
      panel: "#ffffff",
      text: "#1c1917",
      muted: "#78716c",
      border: "#e7e5e4",
      accent: "#4f46e5",
      accentSoft: "#eef2ff",
      unit: "#e9edf4",
      unitOutline: "#c8ceda",
      walkway: "#f8f9fb",
      restricted: "#d5dae3",
      unitTransit: "#d5dae3",
      unitRestroom: "#f0ebe0",
      unitUnenclosed: "#e3e7ee",
      unitNonPublic: "#e5e2da",
      opening: "#9aa3b2",
      selected: "#4f46e5",
      error: "#dc2626",
      warning: "#d97706",
      focus: "#4f46e5",
    },
    fontFamily,
  },
};

export const kirikoTheme: ViewerTheme = themes.kiriko;
