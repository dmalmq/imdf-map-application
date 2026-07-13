import type { ThemeId, ViewerTheme } from "./types";

const fontFamily =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", "Noto Sans CJK JP", Meiryo, sans-serif';

export const themes: Record<ThemeId, ViewerTheme> = {
  "tokyo-green": {
    id: "tokyo-green",
    label: "Tokyo Green",
    colors: {
      canvas: "#e8ece8",
      panel: "#fafbf9",
      text: "#1d2a23",
      muted: "#53635a",
      border: "#c8d0cb",
      accent: "#17452f",
      accentSoft: "#dce9e1",
      unit: "#f6f8f5",
      unitOutline: "#a9b7ae",
      walkway: "#e3efe7",
      restricted: "#dfe3e0",
      opening: "#9b5a20",
      selected: "#146b44",
      error: "#a52828",
      warning: "#7a4f00",
      focus: "#005fcc",
    },
    fontFamily,
  },
  "customer-blue": {
    id: "customer-blue",
    label: "Customer Blue",
    colors: {
      canvas: "#e8edf3",
      panel: "#fbfcfe",
      text: "#172333",
      muted: "#526173",
      border: "#c7d0dc",
      accent: "#184d80",
      accentSoft: "#dce9f6",
      unit: "#f5f8fc",
      unitOutline: "#a9b8ca",
      walkway: "#e2edf8",
      restricted: "#e1e4e8",
      opening: "#9a612b",
      selected: "#0d5f9e",
      error: "#a12626",
      warning: "#795000",
      focus: "#005fcc",
    },
    fontFamily,
  },
};
