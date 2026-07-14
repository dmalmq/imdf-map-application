import { expect, test, type Page, type Request } from "@playwright/test";
import {
  AMENITY_JA,
  canvasElementIdentity,
  clickBelowMarker,
  closeMenu,
  corruptZipBuffer,
  expectSelectedContent,
  KIOSK_MARKER_EN,
  LEVEL_1F_JA,
  LEVEL_2F_JA,
  LEVEL_B1_EN,
  LEVEL_B1_JA,
  levelPill,
  KIOSK_MARKER_JA,
  mapCanvas,
  mapContainer,
  markerByLabel,
  menuTrigger,
  OCCUPANT_EN,
  OCCUPANT_HOURS,
  OCCUPANT_ID,
  OCCUPANT_JA,
  openMenu,
  searchAndSelect,
  searchInput,
  selectedContent,
  selectLevel,
  switchLocale,
  switchTheme,
  uploadMinimalImdf,
  UNIT_STAIRS_EN,
  uploadZip,
  VENUE_NAME_JA,
  waitForMapIdle,
  waitForReadyVenue,
} from "./helpers";

async function closeSelectedContent(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /Close details|詳細を閉じる/ })
    .first()
    .click();
  await expect(selectedContent(page)).toHaveCount(0);
}

test.describe("IMDF viewer journey", () => {
  test("upload → map-first shell → levels → search → selection → theme → compact → recovery", async ({
    page,
  }) => {
    // Zero post-load network: start counting after the static app load event.
    const networkRequests: string[] = [];
    const onRequest = (request: Request): void => {
      const url = request.url();
      if (url.startsWith("http://") || url.startsWith("https://")) {
        networkRequests.push(url);
      }
    };

    await page.goto("/");
    await page.waitForLoadState("load");
    page.on("request", onRequest);

    await uploadMinimalImdf(page);
    await waitForReadyVenue(page);

    // Map-first shell: the map owns the viewport; no legacy chrome.
    await expect(mapCanvas(page)).toBeVisible();
    await expect(page.locator(".top-bar")).toHaveCount(0);
    await expect(page.locator(".explorer-sidebar")).toHaveCount(0);
    await expect(searchInput(page)).toBeVisible();
    await expect(menuTrigger(page)).toBeVisible();
    await expect(page.getByText("警告")).toHaveCount(0);

    // Venue name and current floor live in the hamburger menu.
    const panel = await openMenu(page);
    await expect(panel).toContainText(VENUE_NAME_JA);
    await expect(panel).toContainText(LEVEL_1F_JA);
    await closeMenu(page);

    // Initial level has amenity + kiosk + occupant markers.
    await expect(markerByLabel(page, AMENITY_JA)).toBeVisible();
    await expect(markerByLabel(page, KIOSK_MARKER_JA)).toBeVisible();
    await expect(markerByLabel(page, OCCUPANT_JA)).toBeVisible();

    // Level switching through the menu.
    await selectLevel(page, LEVEL_B1_JA);
    await expect(page.locator(".indoor-marker")).toHaveCount(4);
    await selectLevel(page, LEVEL_2F_JA);
    await expect(page.locator(".indoor-marker")).toHaveCount(1);
    await selectLevel(page, LEVEL_1F_JA);

    // Japanese search → occupant → visitor popup without diagnostics.
    await searchAndSelect(page, "駅ナカ", OCCUPANT_JA);
    await expectSelectedContent(page, [OCCUPANT_JA, OCCUPANT_HOURS]);
    await expect(selectedContent(page)).not.toContainText(OCCUPANT_ID);
    await expect(selectedContent(page)).not.toContainText("種別");
    await closeSelectedContent(page);

    // English search selects the same feature.
    await switchLocale(page, "en");
    await searchAndSelect(page, "Station Shop", OCCUPANT_EN);
    await expectSelectedContent(page, [OCCUPANT_EN, OCCUPANT_HOURS]);
    await closeSelectedContent(page);

    // Polygonal kiosk click-selection: click slightly below the kiosk marker.
    await expect(markerByLabel(page, KIOSK_MARKER_EN)).toBeVisible();
    await clickBelowMarker(page, KIOSK_MARKER_EN);
    await expectSelectedContent(page, [KIOSK_MARKER_EN]);
    await closeSelectedContent(page);

    // Theme switch updates map without recreating the canvas.
    const canvasIdBefore = await canvasElementIdentity(page);
    expect(canvasIdBefore.length).toBeGreaterThan(0);
    await switchTheme(page, "Customer Blue");
    const canvasIdAfter = await canvasElementIdentity(page);
    expect(canvasIdAfter).toBe(canvasIdBefore);
    await switchTheme(page, "Tokyo Green");

    // Compact layout: floating controls stay usable, selection uses the sheet.
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(searchInput(page)).toBeVisible();
    await expect(menuTrigger(page)).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await searchInput(page).fill("Waiting");
    await page.keyboard.press("Escape");
    await markerByLabel(page, "Waiting Room").click();
    await expect(page.locator(".selected-feature-sheet")).toBeVisible();
    await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
    await closeSelectedContent(page);
    await expect(page.locator(".selected-feature-sheet")).toHaveCount(0);
    await expect(searchInput(page)).toHaveValue("Waiting");
    await searchInput(page).fill("");

    // Restore desktop before replacement-error assertions.
    await page.setViewportSize({ width: 1280, height: 720 });

    // Invalid replacement: corrupt zip keeps the venue + canvas, shows alert.
    await uploadZip(page, corruptZipBuffer(), "corrupt.zip");
    const alert = page.locator('[role="alert"]');
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText("Choose an Apple IMDF .zip archive.");
    await expect(mapCanvas(page)).toBeVisible();
    await expect(mapContainer(page)).toHaveAttribute("data-map-idle", "true");
    const retainedPanel = await openMenu(page);
    await expect(retainedPanel).toContainText("Tokyo Station Test Venue");
    await closeMenu(page);

    // Zero post-load HTTP(S) requests for the whole journey.
    page.off("request", onRequest);
    expect(
      networkRequests,
      `unexpected post-load network requests:\n${networkRequests.join("\n")}`,
    ).toEqual([]);
  });

  test("search-selecting the B1 stairs unit switches level and shows its place card", async ({
    page,
  }) => {
    await page.goto("/");
    await uploadMinimalImdf(page);
    await waitForReadyVenue(page);

    await switchLocale(page, "en");
    await searchAndSelect(page, "B1 Stairs", UNIT_STAIRS_EN);
    await expectSelectedContent(page, [UNIT_STAIRS_EN]);
    await expect(levelPill(page, LEVEL_B1_EN)).toHaveAttribute("aria-pressed", "true");
  });

  test("clicking room pills and transit bubbles selects the feature", async ({
    page,
  }) => {
    await page.goto("/");
    await uploadMinimalImdf(page);
    await waitForReadyVenue(page);
    await switchLocale(page, "en");

    // Room pill on 1F selects the room.
    await markerByLabel(page, "Waiting Room").click();
    await expectSelectedContent(page, ["Waiting Room"]);

    // Stairs icon bubble on B1 selects the stairs unit.
    await selectLevel(page, LEVEL_B1_EN);
    await markerByLabel(page, UNIT_STAIRS_EN).click();
    await expectSelectedContent(page, [UNIT_STAIRS_EN]);

    // Restroom icon bubble selects the restroom unit.
    await markerByLabel(page, "B1 Restroom").click();
    await expectSelectedContent(page, ["B1 Restroom"]);
  });

  test("wheel zoom over a compact marker expands labels and keeps dots selectable", async ({
    page,
  }) => {
    await page.goto("/");
    await uploadMinimalImdf(page);
    await waitForReadyVenue(page);
    await switchLocale(page, "en");

    const overlay = page.locator(".indoor-marker-overlay");
    const marker = markerByLabel(page, "Waiting Room");
    const zoomOut = page.locator(".maplibregl-ctrl-zoom-out");

    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (!(await overlay.evaluate((element) => element.classList.contains("indoor-marker-overlay--expanded")))) {
        break;
      }
      await zoomOut.click();
      await waitForMapIdle(page);
    }

    await expect(overlay).not.toHaveClass(/indoor-marker-overlay--expanded/);
    await expect(marker).toHaveCSS("width", "10px");

    await marker.hover();
    await page.mouse.wheel(0, -4000);
    await expect(overlay).toHaveClass(/indoor-marker-overlay--expanded/);
    await expect(marker).not.toHaveCSS("width", "10px");

    await zoomOut.click();
    await waitForMapIdle(page);
    await expect(overlay).not.toHaveClass(/indoor-marker-overlay--expanded/);
    await expect(marker).toHaveCSS("width", "10px");
    await marker.click();
    await expectSelectedContent(page, ["Waiting Room"]);
    expect(await marker.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(10);
    await expect(overlay).not.toHaveClass(/indoor-marker-overlay--expanded/);
  });
});

test.describe("marker keyboard focus", () => {
  async function readyEnglishViewer(page: Page): Promise<void> {
    await page.goto("/");
    await uploadMinimalImdf(page);
    await waitForMapIdle(page);
    await switchLocale(page, "en");
    await expect(markerByLabel(page, "Waiting Room")).toBeVisible();
  }

  async function tabToWaitingRoom(page: Page): Promise<void> {
    for (let presses = 0; presses < 80; presses += 1) {
      const label = await page.evaluate(
        () => document.activeElement?.getAttribute("aria-label") ?? "",
      );
      if (label === "Waiting Room") {
        return;
      }
      await page.keyboard.press("Tab");
    }
    throw new Error("Tab never reached the Waiting Room marker");
  }

  async function activeMarkerState(
    page: Page,
  ): Promise<{ label: string; selected: boolean }> {
    return page.evaluate(() => {
      const active = document.activeElement;
      return {
        label: active?.getAttribute("aria-label") ?? "",
        selected: active?.classList.contains("indoor-marker--selected") ?? false,
      };
    });
  }

  test("desktop popup keeps keyboard focus through selection and Escape", async ({ page }) => {
    await readyEnglishViewer(page);
    await tabToWaitingRoom(page);

    await page.keyboard.press("Enter");
    await expect(page.locator(".maplibregl-popup")).toBeVisible();
    await expect
      .poll(async () => activeMarkerState(page))
      .toEqual({ label: "Waiting Room", selected: true });

    await page.keyboard.press("Escape");
    await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
    await expect
      .poll(async () => activeMarkerState(page))
      .toEqual({ label: "Waiting Room", selected: false });
  });

  test("compact sheet close returns keyboard focus to the marker", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await readyEnglishViewer(page);
    await tabToWaitingRoom(page);

    await page.keyboard.press("Enter");
    await expect(page.locator(".selected-feature-sheet")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".selected-feature-sheet")).toHaveCount(0);
    await expect
      .poll(async () => activeMarkerState(page))
      .toEqual({ label: "Waiting Room", selected: false });
  });
});
