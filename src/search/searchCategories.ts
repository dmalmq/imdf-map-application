import type { FeatureType } from "../imdf/types";

export type SearchCategory = "all" | "gates" | "shops" | "facilities";

export interface CategoryFeature {
  featureType: FeatureType;
  category: string | null;
}

const GEOMETRY_ONLY_UNIT_CATEGORIES: ReadonlySet<string> = new Set([
  "walkway",
  "corridor",
  "opentowalkway",
  "ramp",
  "sidewalk",
  "unenclosedarea",
  "opentobelow",
  "structure",
  "platform",
]);

export function isUnitMarkerEligible(feature: CategoryFeature): boolean {
  return (
    feature.featureType === "unit" &&
    feature.category !== null &&
    !GEOMETRY_ONLY_UNIT_CATEGORIES.has(feature.category)
  );
}

export function matchesSearchCategory(
  feature: CategoryFeature,
  category: SearchCategory,
): boolean {
  switch (category) {
    case "all":
      return true;
    case "gates":
      return (
        feature.featureType === "opening" &&
        (feature.category?.startsWith("pedestrian") ?? false)
      );
    case "shops":
      return feature.featureType === "occupant";
    case "facilities":
      return (
        feature.featureType === "amenity" ||
        feature.featureType === "kiosk" ||
        isUnitMarkerEligible(feature)
      );
  }
}
