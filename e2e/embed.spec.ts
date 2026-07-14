import { expect, test, type Page } from "@playwright/test";
import {
  AMENITY_EN,
  closeMenu,
  expectSelectedContent,
  LEVEL_2F_JA,
  LEVEL_B1_EN,
  levelPill,
  markerByLabel,
  menuTrigger,
  minimalImdfZipBuffer,
  OCCUPANT_EN,
  OCCUPANT_ID,
  openMenu,
  searchInput,
  selectedContent,
  VENUE_NAME_JA,
  waitForMapIdle,
  waitForReadyVenue,
} from "./helpers";

const ZIP_ROUTE = "**/venues/minimal-imdf.zip";
const SRC_PARAM = "/venues/minimal-imdf.zip";

async function routeMinimalZip(page: Page): Promise<void> {
  const buffer = await minimalImdfZipBuffer();
  await page.route(ZIP_ROUTE, (route) =>
    route.fulfill({ body: buffer, contentType: "application/zip" }),
  );
}

async function pickFilter(page: Page, label: string): Promise<void> {
  await page.locator(".floating-search__filter-trigger").click();
  await page.locator(".floating-search__filters button", { hasText: label }).click();
}

test.describe("embed deep links", () => {
  test("embed deep link to B1 hides chrome and preselects the level", async ({ page }) => {
    await routeMinimalZip(page);

    await page.goto(`/?src=${SRC_PARAM}&level=b1&embed=1&lang=en`);
    await waitForMapIdle(page);

    await expect(page.locator(".top-bar")).toHaveCount(0);
    await expect(page.locator(".explorer-sidebar")).toHaveCount(0);
    await openMenu(page);
    await expect(levelPill(page, LEVEL_B1_EN)).toHaveAttribute("aria-pressed", "true");
    // Embed omits file controls unless allowOpen=1; hidden input stays.
    await expect(page.locator(".viewer-menu__open")).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(1);
    await closeMenu(page);
  });

  test("non-embed deep link matches short_name case-insensitively", async ({ page }) => {
    await routeMinimalZip(page);

    await page.goto(`/?src=${SRC_PARAM}&level=2f`);
    await waitForReadyVenue(page);

    // Query "2f" matched short_name "2F"; pills show the ja name.
    const panel = await openMenu(page);
    await expect(panel).toContainText(VENUE_NAME_JA);
    await expect(levelPill(page, LEVEL_2F_JA)).toHaveAttribute("aria-pressed", "true");
    // Non-embed keeps file controls in the menu.
    await expect(page.locator(".viewer-menu__open")).toBeVisible();
    await closeMenu(page);
  });

  test("fetch failure surfaces the error and retry re-fetches", async ({ page }) => {
    await page.route(ZIP_ROUTE, (route) => route.fulfill({ status: 404 }));

    await page.goto(`/?src=${SRC_PARAM}&embed=1`);
    await expect(page.locator(".viewer-notice--error")).toBeVisible();

    const buffer = await minimalImdfZipBuffer();
    await page.unroute(ZIP_ROUTE);
    await page.route(ZIP_ROUTE, (route) =>
      route.fulfill({ body: buffer, contentType: "application/zip" }),
    );

    await page.locator(".viewer-notice__retry").click();
    await waitForMapIdle(page);
    await expect(searchInput(page)).toBeVisible();
  });

  test("map-first embed journey covers search, popup, menu, and filters", async ({ page }) => {
    await routeMinimalZip(page);
    await page.goto(`/?src=${SRC_PARAM}&embed=1&lang=en`);
    await waitForReadyVenue(page);

    // 1. No legacy chrome.
    await expect(page.locator(".top-bar")).toHaveCount(0);
    await expect(page.locator(".explorer-sidebar")).toHaveCount(0);

    // 2. Floating search and hamburger visible.
    await expect(searchInput(page)).toBeVisible();
    await expect(menuTrigger(page)).toBeVisible();

    // 3. Combobox keyboard selection.
    await searchInput(page).click();
    await searchInput(page).fill("Station");
    await expect(page.locator(".floating-search__option").first()).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");

    // 4. Visitor popup without diagnostics or warnings.
    await expect(page.locator(".maplibregl-popup")).toBeVisible();
    await expectSelectedContent(page, [OCCUPANT_EN]);
    await expect(selectedContent(page)).not.toContainText(OCCUPANT_ID);
    await expect(selectedContent(page)).not.toContainText("Type");
    await expect(page.getByText("Warnings")).toHaveCount(0);

    // 5. Hamburger shows floor/language/theme but no file controls in embed.
    const panel = await openMenu(page);
    await expect(panel.locator(".level-switcher")).toHaveCount(0);
    await expect(page.locator(".map-stage__levels .level-switcher")).toBeVisible();
    await expect(panel.locator(".viewer-menu__locale")).toBeVisible();
    await expect(panel.locator(".theme-switcher")).toBeVisible();
    await expect(panel.getByRole("button", { name: "Open IMDF ZIP" })).toHaveCount(0);
    await closeMenu(page);

    // 6. Shops filter hides facility markers, keeps the shop (still selected).
    await pickFilter(page, "Shops");
    await expect(markerByLabel(page, AMENITY_EN)).toHaveCount(0);
    await expect(markerByLabel(page, OCCUPANT_EN)).toBeVisible();

    // 7. Facilities filter clears the selected shop popup.
    await pickFilter(page, "Facilities");
    await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
    await expect(markerByLabel(page, OCCUPANT_EN)).toHaveCount(0);
    await expect(markerByLabel(page, AMENITY_EN)).toBeVisible();

    // 8. Gates filter shows the pedestrian gate and no shop markers.
    await pickFilter(page, "Gates");
    await expect(markerByLabel(page, "Central Gate")).toBeVisible();
    await expect(markerByLabel(page, OCCUPANT_EN)).toHaveCount(0);

    // 9. Wheel zoom still works while the pointer is over a compact marker.
    await pickFilter(page, "All");
    const overlay = page.locator(".indoor-marker-overlay");
    const zoomOut = page.locator(".maplibregl-ctrl-zoom-out");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (!(await overlay.evaluate((element) => element.classList.contains("indoor-marker-overlay--expanded")))) {
        break;
      }
      await zoomOut.click();
      await waitForMapIdle(page);
    }
    await expect(overlay).not.toHaveClass(/indoor-marker-overlay--expanded/);
    const marker = markerByLabel(page, "Waiting Room");
    await marker.hover();
    await page.mouse.wheel(0, -4000);
    await expect(overlay).toHaveClass(/indoor-marker-overlay--expanded/);
  });

  test("compact selected place journey uses the bounded bottom sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await routeMinimalZip(page);
    await page.goto(`/?src=${SRC_PARAM}&embed=1&lang=en`);
    await waitForReadyVenue(page);

    // 1. Search sits at the bottom, hamburger stays usable, no horizontal overflow.
    await expect(searchInput(page)).toBeVisible();
    await expect(menuTrigger(page)).toBeVisible();
    const controlBox = await page.locator(".floating-search__control").boundingBox();
    expect(controlBox).not.toBeNull();
    expect(controlBox!.y).toBeGreaterThan(844 / 2);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    // Search text + focused category that still matches the amenity marker.
    // The dropdown opens upward from the bottom-anchored control.
    await searchInput(page).fill("Rest");
    const dropdownBox = await page.locator(".floating-search__dropdown").boundingBox();
    expect(dropdownBox).not.toBeNull();
    expect(dropdownBox!.y + dropdownBox!.height).toBeLessThanOrEqual(controlBox!.y);
    await page.keyboard.press("Escape");
    await pickFilter(page, "Facilities");

    // 2. Selection opens the bottom sheet, not a MapLibre popup.
    await markerByLabel(page, AMENITY_EN).click();
    const sheet = page.locator(".selected-feature-sheet");
    await expect(sheet).toBeVisible();
    await expect(page.locator(".maplibregl-popup")).toHaveCount(0);

    // 3. The sheet is bounded and dismissible.
    const sheetHeight = await sheet.evaluate((element) => element.getBoundingClientRect().height);
    expect(sheetHeight).toBeLessThanOrEqual(481);
    await page.getByRole("button", { name: "Close details" }).click();
    await expect(sheet).toHaveCount(0);

    // 4. Search text and category survive sheet dismissal.
    await expect(searchInput(page)).toHaveValue("Rest");
    await page.locator(".floating-search__filter-trigger").click();
    await expect(
      page.locator(".floating-search__filters button", { hasText: "Facilities" }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");

    // 5. Hamburger restores focus to its trigger on Escape.
    await openMenu(page);
    await page.keyboard.press("Escape");
    await expect(page.locator(".viewer-menu__panel")).toHaveCount(0);
    const focusedClass = await page.evaluate(
      () => document.activeElement?.className ?? "",
    );
    expect(focusedClass).toContain("viewer-menu__trigger");
  });
});
