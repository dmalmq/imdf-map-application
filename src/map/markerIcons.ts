import makiInformation from "@mapbox/maki/icons/information.svg?raw";
import temakiAtm from "@rapideditor/temaki/icons/atm.svg?raw";
import temakiVendingMachine from "@rapideditor/temaki/icons/vending_machine.svg?raw";
import jisAccessible from "./icons/jis/accessible.svg?raw";
import jisElevator from "./icons/jis/elevator.svg?raw";
import jisEscalator from "./icons/jis/escalator.svg?raw";
import jisMen from "./icons/jis/men.svg?raw";
import jisStairs from "./icons/jis/stairs.svg?raw";
import jisToilets from "./icons/jis/toilets.svg?raw";
import jisWomen from "./icons/jis/women.svg?raw";

/**
 * Marker bubble icons, three sources by intent:
 * - JIS Z 8210 pictograms (vendored under icons/jis/, traced from the ECOMO
 *   Foundation's official vector pamphlet) for the categories that appear on
 *   physical station signage: conveyances and restrooms.
 * - Maki (Mapbox, CC0) and Temaki (Rapid editor, CC0) for other POI
 *   categories, drawn for legibility at map-marker sizes.
 *
 * JIS files are pre-sanitized (plate removed, figures in currentColor,
 * knockouts in var(--marker-bg)); Maki/Temaki are normalized here.
 */
function normalizeIcon(raw: string): string {
  const start = raw.indexOf("<svg");
  const end = raw.indexOf(">", start);
  const root = raw.slice(start, end);
  const viewBox = /viewBox="([^"]+)"/.exec(root)?.[1] ?? "0 0 15 15";
  const body = raw.slice(end + 1, raw.lastIndexOf("</svg>"));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="14" height="14" fill="currentColor" aria-hidden="true">${body}</svg>`;
}

/** Conveyance unit categories → JIS pictogram. `steps` shares stairs. */
const TRANSIT_ICONS: Record<string, string> = {
  elevator: jisElevator,
  escalator: jisEscalator,
  stairs: jisStairs,
};
TRANSIT_ICONS["steps"] = TRANSIT_ICONS["stairs"]!;

/** Amenity POI categories → Maki/Temaki icon. */
const POI_ICONS: Record<string, string> = {
  information: normalizeIcon(makiInformation),
  atm: normalizeIcon(temakiAtm),
  vendingmachine: normalizeIcon(temakiVendingMachine),
};

const RESTROOM_PREFIX = "restroom";

/** Restroom-family category: unit `restroom*` or amenity `toilet*`. */
export function isRestroomCategory(category: string): boolean {
  return category.startsWith(RESTROOM_PREFIX) || category.startsWith("toilet");
}

/** Icon for a unit/amenity category, or undefined when it gets no bubble. */
export function markerIconFor(category: string): string | undefined {
  const transit = TRANSIT_ICONS[category];
  if (transit !== undefined) {
    return transit;
  }
  const poi = POI_ICONS[category];
  if (poi !== undefined) {
    return poi;
  }
  if (!isRestroomCategory(category)) {
    return undefined;
  }
  if (category.includes("wheelchair")) {
    return jisAccessible;
  }
  // Check "female" before "male" — "female".includes("male") is true.
  if (category.includes("female")) {
    return jisWomen;
  }
  if (category.includes("male")) {
    return jisMen;
  }
  return jisToilets;
}
