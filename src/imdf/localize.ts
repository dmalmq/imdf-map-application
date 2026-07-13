import type { LocaleCode } from "./types";

function primarySubtag(key: string): string {
  const dash = key.indexOf("-");
  return (dash === -1 ? key : key.slice(0, dash)).toLowerCase();
}

/**
 * Resolve a localized value from an IMDF localized-string record.
 *
 * Fallback order:
 * 1. exact requested key
 * 2. case-insensitive BCP 47 key whose primary language subtag matches the
 *    requested locale
 * 3. exact, then primary-subtag prefix match for the manifest language
 * 4. Japanese exact, then prefix
 * 5. English exact, then prefix
 * 6. first remaining locale key in lexical order
 * 7. `null` (callers wanting a stable fallback pass the feature ID to
 *    `localizedLabel`)
 */
export function pickLocalizedValue(
  labels: Record<string, string>,
  locale: LocaleCode,
  manifestLanguage?: string,
): string | null {
  const keys = Object.keys(labels)
    .filter((key) => typeof labels[key] === "string" && labels[key] !== "")
    .sort();
  if (keys.length === 0) {
    return null;
  }

  const exact = keys.find((key) => key === locale);
  if (exact !== undefined) {
    return labels[exact] ?? null;
  }

  const requestedPrimary = locale.toLowerCase();
  const bcp47 = keys.find((key) => primarySubtag(key) === requestedPrimary);
  if (bcp47 !== undefined) {
    return labels[bcp47] ?? null;
  }

  const languageChains: string[] = [];
  if (manifestLanguage) {
    languageChains.push(manifestLanguage);
  }
  languageChains.push("ja", "en");
  for (const language of languageChains) {
    const lower = language.toLowerCase();
    const exactLanguage = keys.find((key) => key.toLowerCase() === lower);
    if (exactLanguage !== undefined) {
      return labels[exactLanguage] ?? null;
    }
    const prefix = keys.find((key) => primarySubtag(key) === primarySubtag(language));
    if (prefix !== undefined) {
      return labels[prefix] ?? null;
    }
  }

  const first = keys[0];
  return first === undefined ? null : (labels[first] ?? null);
}

/** Like `pickLocalizedValue`, but falls back to the stable feature ID. */
export function localizedLabel(
  labels: Record<string, string>,
  locale: LocaleCode,
  featureId: string,
  manifestLanguage?: string,
): string {
  return pickLocalizedValue(labels, locale, manifestLanguage) ?? featureId;
}
