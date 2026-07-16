import { localizedLabel, pickLocalizedValue } from "../imdf/localize";
import type {
  LoadedVenue,
  LocaleCode,
  ViewerEnrichmentEntry,
  ViewerEnrichmentImage,
  ViewerFeature,
} from "../imdf/types";

const PHONE_RE = /^[+0-9().\- ]+$/;

export interface SourceAttribute {
  field: string;
  value: string;
}

function formatAttributeValue(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function resolveSourceAttributes(
  feature: ViewerFeature,
): { attributes: SourceAttribute[]; provenance: string } | null {
  const layer = feature.sourceProperties["__gdb_layer"];
  if (typeof layer !== "string") return null;
  const database = feature.sourceProperties["__gdb_database"];
  const attributes = Object.entries(feature.sourceProperties)
    .filter(([key]) => !key.startsWith("__gdb_"))
    .map(([field, value]) => ({ field, value: formatAttributeValue(value) }));
  return {
    attributes,
    provenance: typeof database === "string" ? `${layer} (${database})` : layer,
  };
}

export interface ResolvedFeatureContent {
  name: string;
  description: string | null;
  category: string | null;
  floor: string | null;
  hours: string | null;
  accessibility: string[];
  phone: string | null;
  website: string | null;
  image: { src: string; alt: string } | null;
  /** Original GDB columns in original field order; null for IMDF features. */
  sourceAttributes: SourceAttribute[] | null;
  /** Layer/database provenance for GDB features; null otherwise. */
  provenance: string | null;
}

function coreString(feature: ViewerFeature, key: string): string | null {
  const value = feature.sourceProperties[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function validPhone(value: string | null): string | null {
  return value !== null && value.length <= 64 && PHONE_RE.test(value) ? value : null;
}

function validWebsite(value: string | null): string | null {
  if (value === null || value.length > 2_048) return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

function selectedThenAnchor(
  selected: ViewerEnrichmentEntry | undefined,
  anchor: ViewerEnrichmentEntry | undefined,
  key: "hours" | "phone" | "website",
): string | null {
  if (selected !== undefined && Object.hasOwn(selected, key)) return selected[key] ?? null;
  if (anchor !== undefined && Object.hasOwn(anchor, key)) return anchor[key] ?? null;
  return null;
}

function resolveImage(
  selected: ViewerEnrichmentEntry | undefined,
  anchor: ViewerEnrichmentEntry | undefined,
  locale: LocaleCode,
  manifestLanguage: string,
): ResolvedFeatureContent["image"] {
  let images: ViewerEnrichmentEntry["images"];
  if (selected !== undefined && Object.hasOwn(selected, "images")) images = selected.images;
  else if (anchor !== undefined && Object.hasOwn(anchor, "images")) images = anchor.images;
  const image: ViewerEnrichmentImage | undefined = images?.[0];
  if (image === undefined) return null;
  return {
    src: image.src,
    alt: pickLocalizedValue(image.alt, locale, manifestLanguage) ?? "",
  };
}

export function resolveSelectedFeatureContent(
  venue: LoadedVenue,
  feature: ViewerFeature,
  locale: LocaleCode,
): ResolvedFeatureContent {
  const selected = venue.enrichmentByFeatureId.get(feature.id);
  const anchorId = feature.sourceProperties["anchor_id"];
  const anchor =
    typeof anchorId === "string" && anchorId !== feature.id
      ? venue.enrichmentByFeatureId.get(anchorId)
      : undefined;
  const source = resolveSourceAttributes(feature);

  const descriptions = {
    ...(anchor?.description ?? {}),
    ...(selected?.description ?? {}),
  };
  const level =
    feature.levelId === null
      ? undefined
      : venue.levels.find((candidate) => candidate.id === feature.levelId);

  const enrichedHours = selectedThenAnchor(selected, anchor, "hours");
  const enrichedPhone = selectedThenAnchor(selected, anchor, "phone");
  const enrichedWebsite = selectedThenAnchor(selected, anchor, "website");

  return {
    name: localizedLabel(feature.labels, locale, feature.id, venue.manifest.language),
    description: pickLocalizedValue(descriptions, locale, venue.manifest.language),
    category: feature.category,
    floor:
      level === undefined
        ? null
        : localizedLabel(level.label, locale, level.id, venue.manifest.language),
    hours: enrichedHours ?? coreString(feature, "hours"),
    accessibility: feature.accessibility,
    phone: enrichedPhone ?? validPhone(coreString(feature, "phone")),
    website: enrichedWebsite ?? validWebsite(coreString(feature, "website")),
    image: resolveImage(selected, anchor, locale, venue.manifest.language),
    sourceAttributes: source?.attributes ?? null,
    provenance: source?.provenance ?? null,
  };
}
