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
  // IMDF input is the non-multiple accept=".zip,application/zip" control.
  // GDB archives also accept .zip (with multiple + .gdb.zip), so never use a
  // broad [accept*=".zip"] selector here.
  const input = page.locator('input[type="file"][accept=".zip,application/zip"]:not([multiple])');
  await input.setInputFiles({
    name: fileName,
    mimeType: MINIMAL_ZIP_MIME,
    buffer,
  });
}

/** Upload one or more GDB archive files through the dedicated multi-file picker. */
export async function uploadGdbArchives(
  page: Page,
  files: Array<{ buffer: Buffer; fileName: string; mimeType?: string }>,
): Promise<void> {
  const input = page.locator('input[type="file"][multiple][accept*=".gdb.zip"]');
  await input.setInputFiles(
    files.map(({ buffer, fileName, mimeType = MINIMAL_ZIP_MIME }) => ({
      name: fileName,
      mimeType,
      buffer,
    })),
  );
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

export async function waitForReadyVenue(page: Page): Promise<void> {
  await expect(page.locator(".floating-search__control input")).toBeVisible({
    timeout: 15_000,
  });
  await waitForMapIdle(page);
}

export function menuTrigger(page: Page): Locator {
  return page.locator(".viewer-menu__trigger");
}

export function menuPanel(page: Page): Locator {
  return page.locator(".viewer-menu__panel");
}

export async function openMenu(page: Page): Promise<Locator> {
  const panel = menuPanel(page);
  if (!(await panel.isVisible())) {
    await menuTrigger(page).click();
    await expect(panel).toBeVisible();
  }
  return panel;
}

export async function closeMenu(page: Page): Promise<void> {
  if (await menuPanel(page).isVisible()) {
    await page.keyboard.press("Escape");
    await expect(menuPanel(page)).toHaveCount(0);
  }
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

export function searchInput(page: Page): Locator {
  return page.locator('.floating-search__control input[type="search"]');
}

export async function searchAndSelect(
  page: Page,
  query: string,
  resultLabel: string,
): Promise<void> {
  const input = searchInput(page);
  await input.fill(query);
  const result = page.locator(".floating-search__option", { hasText: resultLabel });
  await expect(result.first()).toBeVisible({ timeout: 5_000 });
  await result.first().click();
  await waitForMapIdle(page);
}

/** Selected-place content host: desktop MapLibre popup or compact sheet. */
export function selectedContent(page: Page): Locator {
  return page.locator(".selected-feature");
}

export async function expectSelectedContent(
  page: Page,
  parts: string[],
): Promise<void> {
  const content = selectedContent(page);
  await expect(content).toBeVisible();
  for (const part of parts) {
    await expect(content).toContainText(part);
  }
}

export async function switchLocale(page: Page, locale: "ja" | "en"): Promise<void> {
  const label = locale === "ja" ? "日本語" : "English";
  const panel = await openMenu(page);
  const button = panel.locator(".viewer-menu__locale button", { hasText: label });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await closeMenu(page);
}

export async function switchTheme(
  page: Page,
  themeLabel: "Tokyo Green" | "Customer Blue",
): Promise<void> {
  const panel = await openMenu(page);
  const button = panel.locator(".theme-switcher__btn", { hasText: themeLabel });
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await closeMenu(page);
  await waitForMapIdle(page);
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
