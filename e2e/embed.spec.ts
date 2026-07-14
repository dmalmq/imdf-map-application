import { expect, test } from "@playwright/test";
import {
  LEVEL_2F_JA,
  LEVEL_B1_EN,
  levelPill,
  minimalImdfZipBuffer,
  VENUE_NAME_JA,
  waitForMapIdle,
  waitForReadyVenue,
} from "./helpers";

const ZIP_ROUTE = "**/venues/minimal-imdf.zip";
const SRC_PARAM = "/venues/minimal-imdf.zip";

test.describe("embed deep links", () => {
  test("embed deep link to B1 hides chrome and preselects the level", async ({ page }) => {
    const buffer = await minimalImdfZipBuffer();
    await page.route(ZIP_ROUTE, (route) =>
      route.fulfill({ body: buffer, contentType: "application/zip" }),
    );

    await page.goto(`/?src=${SRC_PARAM}&level=b1&embed=1&lang=en`);
    await waitForMapIdle(page);

    await expect(page.locator(".top-bar")).toHaveCount(0);
    await expect(page.locator(".explorer-sidebar")).toHaveCount(0);
    await expect(levelPill(page, LEVEL_B1_EN)).toHaveAttribute("aria-pressed", "true");
    // Hidden file input stays for pipeline uniformity, but no open button.
    await expect(page.locator('input[type="file"]')).toHaveCount(1);
    await expect(page.locator(".top-bar__open")).toHaveCount(0);
  });

  test("non-embed deep link matches short_name case-insensitively", async ({ page }) => {
    const buffer = await minimalImdfZipBuffer();
    await page.route(ZIP_ROUTE, (route) =>
      route.fulfill({ body: buffer, contentType: "application/zip" }),
    );

    await page.goto(`/?src=${SRC_PARAM}&level=2f`);
    await waitForReadyVenue(page, VENUE_NAME_JA);

    // Query "2f" matched short_name "2F"; pills show the ja name.
    await expect(levelPill(page, LEVEL_2F_JA)).toHaveAttribute("aria-pressed", "true");
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
    await expect(page.locator(".level-switcher__pill").first()).toBeVisible();
  });
});
