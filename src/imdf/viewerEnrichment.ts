import type {
  ViewerEnrichmentEntry,
  ViewerEnrichmentImage,
  ViewerWarning,
} from "./types";

const MAX_FEATURES = 5_000;
const MAX_ID_LENGTH = 128;
const MAX_LOCALES = 16;
const MAX_LOCALE_LENGTH = 35;
const MAX_DESCRIPTION_LENGTH = 2_000;
const MAX_ALT_LENGTH = 300;
const MAX_HOURS_LENGTH = 512;
const MAX_PHONE_LENGTH = 64;
const MAX_URL_LENGTH = 2_048;
const PHONE_RE = /^[+0-9().\- ]+$/;

export interface ViewerEnrichmentParseResult {
  entries: Record<string, ViewerEnrichmentEntry>;
  warnings: ViewerWarning[];
}

function invalidEnrichmentWarning(message: string): ViewerWarning {
  return {
    code: "invalid_viewer_enrichment",
    message,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseLocalizedMap(
  value: unknown,
  maxValueLength: number,
): Record<string, string> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const localeKeys = Object.keys(value);
  if (localeKeys.length === 0 || localeKeys.length > MAX_LOCALES) {
    return undefined;
  }

  const result: Record<string, string> = {};
  for (const locale of localeKeys) {
    if (locale.length === 0 || locale.length > MAX_LOCALE_LENGTH) {
      return undefined;
    }
    const text = value[locale];
    if (typeof text !== "string" || text.length === 0 || text.length > maxValueLength) {
      return undefined;
    }
    result[locale] = text;
  }
  return result;
}

function isHttpsUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function isViewerRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) {
    return false;
  }
  if (!value.startsWith("/")) {
    return false;
  }
  // Reject protocol-relative URLs ("//host/path") and any scheme-looking form.
  if (value.startsWith("//") || value.includes("://") || value.includes("\\")) {
    return false;
  }
  return true;
}

function parsePhone(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length === 0 || value.length > MAX_PHONE_LENGTH) {
    return undefined;
  }
  if (!PHONE_RE.test(value)) {
    return undefined;
  }
  return value;
}

function parseHours(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value.length === 0 || value.length > MAX_HOURS_LENGTH) {
    return undefined;
  }
  return value;
}

function parseWebsite(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return isHttpsUrl(value) ? value : undefined;
}

function parseImage(value: unknown): ViewerEnrichmentImage | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const src = value["src"];
  if (typeof src !== "string") {
    return undefined;
  }
  const validSrc =
    isViewerRelativePath(src) || isHttpsUrl(src) ? src : undefined;
  if (validSrc === undefined) {
    return undefined;
  }
  const alt = parseLocalizedMap(value["alt"], MAX_ALT_LENGTH);
  if (alt === undefined) {
    return undefined;
  }
  return { src: validSrc, alt };
}

function parseImages(value: unknown): [] | [ViewerEnrichmentImage] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  if (value.length === 0) {
    return [];
  }
  if (value.length !== 1) {
    // Version 1 permits zero or one image; two or more drop the field entirely.
    return undefined;
  }
  const image = parseImage(value[0]);
  if (image === undefined) {
    return undefined;
  }
  return [image];
}

function parseEntry(value: unknown): ViewerEnrichmentEntry | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const entry: ViewerEnrichmentEntry = {};

  const description = parseLocalizedMap(value["description"], MAX_DESCRIPTION_LENGTH);
  if (description !== undefined) {
    entry.description = description;
  }

  const hours = parseHours(value["hours"]);
  if (hours !== undefined) {
    entry.hours = hours;
  }

  const phone = parsePhone(value["phone"]);
  if (phone !== undefined) {
    entry.phone = phone;
  }

  const website = parseWebsite(value["website"]);
  if (website !== undefined) {
    entry.website = website;
  }

  if ("images" in value) {
    const images = parseImages(value["images"]);
    if (images !== undefined) {
      entry.images = images;
    }
  }

  return entry;
}

/**
 * Pure, bounded parser for optional `viewer-enrichment.json` content.
 * Malformed / unsupported top-level values yield no entries and one warning.
 * Invalid feature keys or non-object feature values drop that entry only.
 * Invalid optional fields and images drop only those fields.
 */
export function parseViewerEnrichment(value: unknown): ViewerEnrichmentParseResult {
  if (!isPlainObject(value)) {
    return {
      entries: {},
      warnings: [invalidEnrichmentWarning("Viewer enrichment must be a JSON object.")],
    };
  }

  const version = value["version"];
  if (version !== "1.0") {
    return {
      entries: {},
      warnings: [
        invalidEnrichmentWarning(
          typeof version === "string"
            ? `Unsupported viewer enrichment version ${version}.`
            : "Viewer enrichment version must be the string \"1.0\".",
        ),
      ],
    };
  }

  const features = value["features"];
  if (!isPlainObject(features)) {
    return {
      entries: {},
      warnings: [
        invalidEnrichmentWarning("Viewer enrichment features must be an object."),
      ],
    };
  }

  const featureKeys = Object.keys(features);
  if (featureKeys.length > MAX_FEATURES) {
    return {
      entries: {},
      warnings: [
        invalidEnrichmentWarning(
          `Viewer enrichment exceeds the maximum of ${MAX_FEATURES} features.`,
        ),
      ],
    };
  }

  const entries: Record<string, ViewerEnrichmentEntry> = {};
  for (const featureId of featureKeys) {
    if (featureId.length === 0 || featureId.length > MAX_ID_LENGTH) {
      continue;
    }
    const entry = parseEntry(features[featureId]);
    if (entry === undefined) {
      continue;
    }
    // Keep empty objects so a feature key with only invalid optionals still
    // does not invent content; callers only care about present fields.
    entries[featureId] = entry;
  }

  return { entries, warnings: [] };
}
