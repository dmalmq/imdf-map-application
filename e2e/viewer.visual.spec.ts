import { expect, test, type Page } from "@playwright/test";
import {
  minimalImdfZipBuffer,
  OCCUPANT_EN,
  OCCUPANT_JA,
  searchAndSelect,
  switchLocale,
  uploadMinimalImdf,
  VENUE_NAME_EN,
  VENUE_NAME_JA,
  waitForMapIdle,
  waitForReadyVenue,
} from "./helpers";

async function settleForScreenshot(page: Page): Promise<void> {
  // Font gate: absence must FAIL the suite, never auto-update baselines.
  // Noto Sans JP ships unicode-range subsets, so load + check must name CJK
  // sample glyphs; a bare check() only tests the (never-loaded) space subset.
  const fontsOk = await page.evaluate(async () => {
    await document.fonts.load('16px "Noto Sans JP Variable"', "駅ナカショップ東京会場");
    await document.fonts.load('16px "Inter Variable"', "Kiriko");
    await document.fonts.ready;
    return (
      document.fonts.check('16px "Noto Sans JP Variable"', "駅") &&
      document.fonts.check('16px "Inter Variable"', "K")
    );
  });
  expect(fontsOk).toBe(true);

  await waitForMapIdle(page);

  // Two animation frames after idle.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
  );

  // Disable CSS animations/transitions for deterministic pixels.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addStyleTag({
    content:
      "*, *::before, *::after { animation: none !important; transition: none !important; }",
  });
}

test.describe("viewer visual baselines", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "visual baselines are Chromium-only");

  test("desktop-kiriko-ja", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("load");
    await uploadMinimalImdf(page);
    await waitForReadyVenue(page, VENUE_NAME_JA);
    await searchAndSelect(page, "駅ナカ", OCCUPANT_JA);
    await settleForScreenshot(page);
    await expect(page).toHaveScreenshot("desktop-kiriko-ja.png", {
      animations: "disabled",
      fullPage: false,
    });
  });

  test("desktop-kiriko-en", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("load");
    await uploadMinimalImdf(page);
    await waitForReadyVenue(page, VENUE_NAME_JA);
    await switchLocale(page, "en");
    await waitForReadyVenue(page, VENUE_NAME_EN);
    await searchAndSelect(page, "Station Shop", OCCUPANT_EN);
    await settleForScreenshot(page);
    await expect(page).toHaveScreenshot("desktop-kiriko-en.png", {
      animations: "disabled",
      fullPage: false,
    });
  });

  test("compact-kiriko-ja", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForLoadState("load");
    await uploadMinimalImdf(page);
    await waitForReadyVenue(page, VENUE_NAME_JA);
    await expect(page.locator(".app")).toHaveClass(/app--compact/);
    await searchAndSelect(page, "駅ナカ", OCCUPANT_JA);
    await settleForScreenshot(page);
    await expect(page).toHaveScreenshot("compact-kiriko-ja.png", {
      animations: "disabled",
      fullPage: false,
    });
  });

  test("embed-kiriko-en", async ({ page }) => {
    const buffer = await minimalImdfZipBuffer();
    await page.route("**/venues/minimal-imdf.zip", (route) =>
      route.fulfill({ body: buffer, contentType: "application/zip" }),
    );
    await page.setViewportSize({ width: 960, height: 600 });
    await page.goto("/?src=/venues/minimal-imdf.zip&embed=1&lang=en");
    await page.waitForLoadState("load");
    await settleForScreenshot(page);
    await expect(page).toHaveScreenshot("embed-kiriko-en.png", {
      animations: "disabled",
      fullPage: false,
    });
  });
});
