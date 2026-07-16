export type ThemeId = "tokyo-green" | "customer-blue";

export interface ViewerTheme {
  id: ThemeId;
  label: string;
  colors: {
    canvas: string;
    panel: string;
    text: string;
    muted: string;
    border: string;
    accent: string;
    accentSoft: string;
    unit: string;
    unitOutline: string;
    walkway: string;
    restricted: string;
    unitTransit: string;
    unitRestroom: string;
    unitUnenclosed: string;
    unitNonPublic: string;
    unitParking: string;
    unitPlatform: string;
    opening: string;
    selected: string;
    error: string;
    warning: string;
    focus: string;
  };
  fontFamily: string;
}
