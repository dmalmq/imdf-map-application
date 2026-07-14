import { expect, test, type Request } from "@playwright/test";
import {
  AMENITY_JA,
  canvasElementIdentity,
  clickBelowMarker,
  corruptZipBuffer,
  expectDetailsContain,
  expectWarningCodes,
  KIOSK_ID,
  KIOSK_MARKER_JA,
  LEVEL_1F_JA,
  LEVEL_2F_JA,
  LEVEL_B1_JA,
  LEVEL_B1_EN,
  levelPill,
  mapCanvas,
  mapContainer,
  markerByLabel,
  OCCUPANT_ALT_JA,
  OCCUPANT_EN,
  OCCUPANT_HOURS,
  OCCUPANT_ID,
  OCCUPANT_JA,
  searchAndSelect,
  selectLevel,
  switchLocale,
  switchTheme,
  uploadMinimalImdf,
  UNIT_STAIRS_EN,
  uploadZip,
  VENUE_NAME_JA,
  waitForMapIdle,
  waitForReadyVenue,
  WARNING_CODES,
} from "./helpers";

test.describe("IMDF viewer journey", () => {
  test("upload → map → level → search → selection → details → theme → compact → recovery", async ({
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

    // Upload synthetic IMDF ZIP.
    await uploadMinimalImdf(page);
    await waitForReadyVenue(page, VENUE_NAME_JA);

    // Map canvas + idle + top-bar venue/level.
    await expect(mapCanvas(page)).toBeVisible();
    await expect(mapContainer(page)).toHaveAttribute("data-map-idle", "true");
    await expect(page.locator(".top-bar__venue")).toHaveText(VENUE_NAME_JA);
    await expect(page.locator(".top-bar__level")).toHaveText(LEVEL_1F_JA);

    // Initial level has amenity + kiosk + occupant markers.
    await expect(markerByLabel(page, AMENITY_JA)).toBeVisible();
    await expect(markerByLabel(page, KIOSK_MARKER_JA)).toBeVisible();
    await expect(markerByLabel(page, OCCUPANT_JA)).toBeVisible();
    await expect(levelPill(page, LEVEL_1F_JA)).toHaveAttribute("aria-pressed", "true");

    // Switch to B1 then 2F; assert pressed state + idle + markers when present.
    await selectLevel(page, LEVEL_B1_JA);
    await expect(page.locator(".top-bar__level")).toHaveText(LEVEL_B1_JA);
    // B1: stairs + restroom bubbles, machine-room + staff-room pills.
    await expect(mapContainer(page)).toHaveAttribute("data-map-idle", "true");
    await expect(page.locator(".indoor-marker")).toHaveCount(4);

    await selectLevel(page, LEVEL_2F_JA);
    await expect(page.locator(".top-bar__level")).toHaveText(LEVEL_2F_JA);
    await expect(mapContainer(page)).toHaveAttribute("data-map-idle", "true");
    await expect(page.locator(".indoor-marker")).toHaveCount(1);

    // Return to 1F for search/selection.
    await selectLevel(page, LEVEL_1F_JA);
    await expect(page.locator(".top-bar__level")).toHaveText(LEVEL_1F_JA);

    // Japanese search → select occupant → details.
    await searchAndSelect(page, "駅ナカ", OCCUPANT_JA);
    await expectDetailsContain(page, [
      OCCUPANT_JA,
      OCCUPANT_ALT_JA,
      OCCUPANT_HOURS,
      OCCUPANT_ID,
      "occupant",
    ]);
    await expect(page.locator(".feature-details")).toContainText("別名");
    await expect(page.locator(".feature-details")).toContainText("営業時間");

    // English search: switch locale → search "Station Shop" → same feature.
    await switchLocale(page, "en");
    await searchAndSelect(page, "Station Shop", OCCUPANT_EN);
    await expectDetailsContain(page, [OCCUPANT_EN, "Test Store", OCCUPANT_ID, OCCUPANT_HOURS]);
    await expect(page.locator(".feature-details")).toContainText("Also known as");
    await expect(page.locator(".feature-details")).toContainText("Hours");

    // Back to Japanese for remaining assertions with known labels.
    await switchLocale(page, "ja");
    await waitForMapIdle(page);

    // Polygonal kiosk click-selection: click slightly below the kiosk marker.
    // Ensure 1F is selected and markers are present.
    await selectLevel(page, LEVEL_1F_JA);
    await expect(markerByLabel(page, KIOSK_MARKER_JA)).toBeVisible();
    await clickBelowMarker(page, KIOSK_MARKER_JA);
    await expectDetailsContain(page, ["kiosk", KIOSK_ID, KIOSK_MARKER_JA]);

    // Theme switch updates map without recreating the canvas.
    const canvasIdBefore = await canvasElementIdentity(page);
    expect(canvasIdBefore.length).toBeGreaterThan(0);
    await switchTheme(page, "Customer Blue");
    await expect(page.locator(".theme-switcher__btn", { hasText: "Customer Blue" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const canvasIdAfter = await canvasElementIdentity(page);
    expect(canvasIdAfter).toBe(canvasIdBefore);
    // Switch back so later steps keep the default theme look.
    await switchTheme(page, "Tokyo Green");

    // Warnings: exactly 5 entries with the known codes.
    await expectWarningCodes(page, WARNING_CODES);

    // Compact layout at 390×844 (while still ready so level switches work).
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".app")).toHaveClass(/app--compact/);
    // Top bar: product name + open button only (no venue/level/locale/theme in header).
    await expect(page.locator(".top-bar__product")).toBeVisible();
    await expect(page.locator(".top-bar__open")).toBeVisible();
    await expect(page.locator(".top-bar .top-bar__venue")).toHaveCount(0);
    await expect(page.locator(".top-bar .locale-switcher")).toHaveCount(0);
    await expect(page.locator(".top-bar .theme-switcher")).toHaveCount(0);
    // Venue/level + locale/theme live in the sheet compact header.
    await expect(page.locator(".explorer-sidebar__compact-row--meta .top-bar__venue")).toHaveText(
      VENUE_NAME_JA,
    );
    await expect(page.locator(".explorer-sidebar__compact-row--controls .locale-switcher")).toBeVisible();
    await expect(page.locator(".explorer-sidebar__compact-row--controls .theme-switcher")).toBeVisible();
    // Level pills remain visible and clickable.
    await expect(levelPill(page, LEVEL_1F_JA)).toBeVisible();
    await selectLevel(page, LEVEL_B1_JA);
    await expect(levelPill(page, LEVEL_B1_JA)).toHaveAttribute("aria-pressed", "true");

    // Restore desktop for replacement-error assertions that use the top bar.
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.locator(".app")).not.toHaveClass(/app--compact/);

    // Invalid replacement: corrupt zip keeps the venue + canvas, shows alert.
    await uploadZip(page, corruptZipBuffer(), "corrupt.zip");
    const alert = page.locator('[role="alert"]');
    await expect(alert).toBeVisible({ timeout: 10_000 });
    await expect(alert).toContainText("Choose an Apple IMDF .zip archive.");
    await expect(page.locator(".top-bar__venue")).toHaveText(VENUE_NAME_JA);
    await expect(mapCanvas(page)).toBeVisible();
    await expect(mapContainer(page)).toHaveAttribute("data-map-idle", "true");

    // Zero post-load HTTP(S) requests for the whole journey.
    page.off("request", onRequest);
    expect(
      networkRequests,
      `unexpected post-load network requests:\n${networkRequests.join("\n")}`,
    ).toEqual([]);
  });

  test("search-selecting the B1 stairs unit switches level and shows details", async ({
    page,
  }) => {
    await page.goto("/");
    await uploadMinimalImdf(page);
    await waitForReadyVenue(page, VENUE_NAME_JA);

    await switchLocale(page, "en");
    await searchAndSelect(page, "B1 Stairs", UNIT_STAIRS_EN);
    await expectDetailsContain(page, [UNIT_STAIRS_EN]);
    await expect(levelPill(page, LEVEL_B1_EN)).toHaveAttribute("aria-pressed", "true");
  });

  test("clicking room pills and transit bubbles selects the feature", async ({
    page,
  }) => {
    await page.goto("/");
    await uploadMinimalImdf(page);
    await waitForReadyVenue(page, VENUE_NAME_JA);
    await switchLocale(page, "en");

    // Room pill on 1F selects the room.
    await markerByLabel(page, "Waiting Room").click();
    await expectDetailsContain(page, ["Waiting Room", "room"]);
    // Stairs icon bubble on B1 selects the stairs unit.
    await selectLevel(page, LEVEL_B1_EN);
    await markerByLabel(page, UNIT_STAIRS_EN).click();
    await expectDetailsContain(page, [UNIT_STAIRS_EN, "stairs"]);

    // Restroom icon bubble selects the restroom unit.
    await markerByLabel(page, "B1 Restroom").click();
    await expectDetailsContain(page, ["B1 Restroom", "restroom.female"]);
  });
  test("wheel zoom over a compact marker expands labels and keeps dots selectable", async ({
    page,
  }) => {
    await page.goto("/");
    await uploadMinimalImdf(page);
    await waitForReadyVenue(page, VENUE_NAME_JA);
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
    await expectDetailsContain(page, ["Waiting Room"]);
    expect(await marker.evaluate((element) => element.getBoundingClientRect().width)).toBeGreaterThan(10);
    await expect(overlay).not.toHaveClass(/indoor-marker-overlay--expanded/);
  });

});

test.describe("marker keyboard focus", () => {
  async function readyEnglishViewer(page: import("@playwright/test").Page): Promise<void> {
    await page.goto("/");
    await uploadMinimalImdf(page);
    await waitForMapIdle(page);
    await page.getByRole("button", { name: "メニュー" }).click();
    await page.getByRole("button", { name: "English" }).click();
    await page.keyboard.press("Escape");
    await expect(markerByLabel(page, "Waiting Room")).toBeVisible();
  }

  async function tabToWaitingRoom(page: import("@playwright/test").Page): Promise<void> {
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
    page: import("@playwright/test").Page,
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
