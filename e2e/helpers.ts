import { expect, type Locator, type Page } from "@playwright/test";
import { buildMinimalImdfZip } from "../tests/fixtures/buildMinimalImdfZip";

export const MINIMAL_ZIP_NAME = "minimal-imdf.zip";
export const MINIMAL_ZIP_MIME = "application/zip";

export const VENUE_NAME_JA = "東京駅テスト会場";
export const VENUE_NAME_EN = "Tokyo Station Test Venue";

export const LEVEL_1F_JA = "1階";
export const LEVEL_B1_JA = "地下1階";
export const LEVEL_2F_JA = "2階";
export const LEVEL_1F_EN = "1F";
export const LEVEL_B1_EN = "B1";
export const LEVEL_2F_EN = "2F";

export const OCCUPANT_ID = "a1000008-0000-4000-8000-0000000000c1";
export const KIOSK_ID = "f1000001-0000-4000-8000-0000000000f1";
export const KIOSK_MARKER_JA = "案内キオスク";
export const KIOSK_MARKER_EN = "Info Kiosk";
export const OCCUPANT_JA = "駅ナカショップ";
export const OCCUPANT_EN = "Station Shop";
export const OCCUPANT_ALT_JA = "テストストア";
export const OCCUPANT_HOURS = "Mo-Fr 10:00-20:00";
export const AMENITY_JA = "トイレ";
export const AMENITY_EN = "Restroom";
export const UNIT_STAIRS_EN = "B1 Stairs";

export const WARNING_CODES = [
  "missing_display_point",
  "missing_display_point",
  "missing_display_point",
  "unresolved_reference",
  "missing_locale",
] as const;

/** Build the deterministic minimal IMDF ZIP as a Buffer for setInputFiles. */
export async function minimalImdfZipBuffer(): Promise<Buffer> {
  const bytes = await buildMinimalImdfZip();
  return Buffer.from(bytes);
}

/** Non-ZIP bytes that still use a .zip filename so the worker checks magic. */
export function corruptZipBuffer(): Buffer {
  return Buffer.from("not a zip", "utf8");
}

export async function uploadZip(
  page: Page,
  buffer: Buffer,
  fileName = MINIMAL_ZIP_NAME,
): Promise<void> {
  const input = page.locator('input[type="file"][accept*=".zip"]');
  await input.setInputFiles({
    name: fileName,
    mimeType: MINIMAL_ZIP_MIME,
    buffer,
  });
}

export async function uploadMinimalImdf(page: Page): Promise<void> {
  const buffer = await minimalImdfZipBuffer();
  await uploadZip(page, buffer);
}

export function mapContainer(page: Page): Locator {
  return page.locator(".indoor-map");
}

export function mapCanvas(page: Page): Locator {
  return page.locator(".indoor-map canvas").first();
}

export async function waitForMapIdle(page: Page, timeout = 15_000): Promise<void> {
  await expect(mapContainer(page)).toHaveAttribute("data-map-idle", "true", {
    timeout,
  });
}

export async function waitForReadyVenue(page: Page, venueName: string): Promise<void> {
  await expect(page.locator(".top-bar__venue")).toHaveText(venueName, {
    timeout: 15_000,
  });
  await waitForMapIdle(page);
}

export function levelPill(page: Page, label: string): Locator {
  return page.locator(".level-switcher__pill", { hasText: new RegExp(`^${label}$`) });
}

export async function selectLevel(page: Page, label: string): Promise<void> {
  const pill = levelPill(page, label);
  await pill.click();
  await expect(pill).toHaveAttribute("aria-pressed", "true");
  await waitForMapIdle(page);
}

export function markerByLabel(page: Page, label: string): Locator {
  return page.locator(`.indoor-marker[aria-label="${label}"]`);
}

export async function searchAndSelect(
  page: Page,
  query: string,
  resultLabel: string,
): Promise<void> {
  const input = page.locator("#viewer-search-input");
  await input.fill(query);
  const result = page.locator(".explorer-sidebar__result", { hasText: resultLabel });
  await expect(result).toBeVisible({ timeout: 5_000 });
  await result.click();
  await waitForMapIdle(page);
}

export function detailsSection(page: Page): Locator {
  return page.locator(".feature-details");
}

export async function expectDetailsContain(
  page: Page,
  parts: string[],
): Promise<void> {
  const details = detailsSection(page);
  await expect(details).toBeVisible();
  for (const part of parts) {
    await expect(details).toContainText(part);
  }
}

export async function switchLocale(page: Page, locale: "ja" | "en"): Promise<void> {
  const label = locale === "ja" ? "日本語" : "English";
  const button = page.locator(".locale-switcher__btn", { hasText: label });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
}

export async function switchTheme(
  page: Page,
  themeLabel: "Tokyo Green" | "Customer Blue",
): Promise<void> {
  const button = page.locator(".theme-switcher__btn", { hasText: themeLabel });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await waitForMapIdle(page);
}

export async function openWarnings(page: Page): Promise<Locator> {
  const details = page.locator("details.viewer-warnings");
  await expect(details).toBeVisible();
  // Force-open for consistent inspection even if already open.
  await details.evaluate((el: HTMLDetailsElement) => {
    el.open = true;
  });
  return details;
}

export async function expectWarningCodes(
  page: Page,
  expected: readonly string[],
): Promise<void> {
  const warnings = await openWarnings(page);
  const codes = warnings.locator(".viewer-warnings__code");
  await expect(codes).toHaveCount(expected.length);
  const actual = await codes.allTextContents();
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  expect(sortedActual).toEqual(sortedExpected);
}

/** Click slightly below a marker so the hit lands on the polygon under it. */
export async function clickBelowMarker(page: Page, label: string): Promise<void> {
  const marker = markerByLabel(page, label);
  await expect(marker).toBeVisible();
  const box = await marker.boundingBox();
  if (box == null) {
    throw new Error(`Marker "${label}" has no bounding box`);
  }
  // Marker anchor is bottom; polygon sits under the label. Click a few px below
  // the marker box center so queryRenderedFeatures hits the kiosk polygon.
  const x = box.x + box.width / 2;
  const y = box.y + box.height + 8;
  await page.mouse.click(x, y);
  await waitForMapIdle(page);
}

export async function canvasElementIdentity(page: Page): Promise<string> {
  return page.evaluate(() => {
    const canvas = document.querySelector(".indoor-map canvas");
    if (!(canvas instanceof HTMLCanvasElement)) {
      return "";
    }
    // Stamp a stable identity if missing so we can compare across theme switch.
    let id = canvas.dataset.e2eCanvasId;
    if (!id) {
      id = `canvas-${Math.random().toString(36).slice(2)}`;
      canvas.dataset.e2eCanvasId = id;
    }
    return id;
  });
}
