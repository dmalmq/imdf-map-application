/**
 * Normalize text for search comparison: Unicode NFKC, lowercased Latin
 * characters, and collapsed whitespace. Source labels are never
 * destructively transliterated; this affects only comparison keys.
 */
export function normalizeSearchText(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}
