import { expect, test, type Page } from "@playwright/test";
import {
  LEVEL_1F_JA,
  closeMenu,
  levelPill,
  OCCUPANT_EN,
  OCCUPANT_JA,
  openMenu,
  searchAndSelect,
  switchLocale,
  switchTheme,
  uploadMinimalImdf,
  waitForMapIdle,
  waitForReadyVenue,
} from "./helpers";

async function settleForScreenshot(page: Page): Promise<void> {
  // Font gate: absence must FAIL the suite, never auto-update baselines.
  const hasNoto = await page.evaluate(() =>
    document.fonts.check('16px "Noto Sans CJK JP"'),
  );
  expect(hasNoto).toBe(true);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });

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

/** Compact layout keeps floating controls; readiness matches desktop. */
async function waitForCompactReady(page: Page): Promise<void> {
  await waitForReadyVenue(page);
}

test.describe("viewer visual baselines", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "visual baselines are Chromium-only");

  test("desktop-tokyo-ja", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("load");
    await uploadMinimalImdf(page);
    await waitForReadyVenue(page);
    await searchAndSelect(page, "駅ナカ", OCCUPANT_JA);
    await settleForScreenshot(page);
    await expect(page).toHaveScreenshot("desktop-tokyo-ja.png", {
      animations: "disabled",
      fullPage: false,
    });
  });

  test("desktop-blue-en", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await page.waitForLoadState("load");
    await uploadMinimalImdf(page);
    await waitForReadyVenue(page);
    await switchLocale(page, "en");
    await waitForReadyVenue(page);
    await switchTheme(page, "Customer Blue");
    await searchAndSelect(page, "Station Shop", OCCUPANT_EN);
    await settleForScreenshot(page);
    await expect(page).toHaveScreenshot("desktop-blue-en.png", {
      animations: "disabled",
      fullPage: false,
    });
  });

  test("compact-tokyo-ja", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForLoadState("load");
    await uploadMinimalImdf(page);
    await waitForCompactReady(page);
    await expect(page.locator(".app")).toHaveClass(/app--compact/);
    await searchAndSelect(page, "駅ナカ", OCCUPANT_JA);
    await settleForScreenshot(page);
    await expect(page).toHaveScreenshot("compact-tokyo-ja.png", {
      animations: "disabled",
      fullPage: false,
    });
  });

  test("compact-blue-en", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    await page.waitForLoadState("load");
    await uploadMinimalImdf(page);
    await waitForCompactReady(page);
    const panel = await openMenu(page);
    await expect(levelPill(page, LEVEL_1F_JA)).toBeVisible();
    await expect(panel).toBeVisible();
    await closeMenu(page);
    await switchLocale(page, "en");
    await waitForCompactReady(page);
    await switchTheme(page, "Customer Blue");
    await searchAndSelect(page, "Station Shop", OCCUPANT_EN);
    await settleForScreenshot(page);
    await expect(page).toHaveScreenshot("compact-blue-en.png", {
      animations: "disabled",
      fullPage: false,
    });
  });
});
