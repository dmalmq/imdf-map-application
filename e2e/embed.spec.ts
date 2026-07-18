import { expect, test } from "@playwright/test";
import {
  collectIssueRequests,
  floorButton,
  LEVEL_2F_SHORT,
  LEVEL_B1_SHORT,
  minimalImdfZipBuffer,
  VENUE_NAME_JA,
  waitForMapIdle,
  waitForReadyVenue,
} from "./helpers";

const ZIP_ROUTE = "**/venues/minimal-imdf.zip";
const SRC_PARAM = "/venues/minimal-imdf.zip";

test.describe("embed deep links", () => {
  test("embed src deep link uses the ZIP path, hides chrome, and preselects the level", async ({
    page,
  }) => {
    const issueRequests = collectIssueRequests(page);
    const sourceRequests: string[] = [];
    const datasetRequests: string[] = [];
    page.on("request", (request) => {
      const pathname = new URL(request.url()).pathname;
      if (pathname === SRC_PARAM) {
        sourceRequests.push(pathname);
      }
      if (/^\/v\/default\/[^/]+\/(?:bundle|archive)$/.test(pathname)) {
        datasetRequests.push(pathname);
      }
    });
    const buffer = await minimalImdfZipBuffer();
    await page.route(ZIP_ROUTE, (route) =>
      route.fulfill({ body: buffer, contentType: "application/zip" }),
    );

    await page.goto(`/?src=${SRC_PARAM}&level=b1&embed=1&lang=en`);
    await waitForMapIdle(page);

    await expect(page.locator(".context-bar")).toHaveCount(0);
    await expect(page.locator(".icon-rail")).toHaveCount(0);
    await expect(page.locator(".floating-panel")).toHaveCount(0);
    await expect(page.locator(".top-actions")).toHaveCount(0);
    await expect(floorButton(page, LEVEL_B1_SHORT)).toHaveAttribute("aria-pressed", "true");
    // The Kiriko badge links back to the full viewer.
    const badge = page.locator(".kiriko-badge");
    await expect(badge).toBeVisible();
    const href = await badge.getAttribute("href");
    expect(href).toContain(SRC_PARAM.replace(/\//g, "%2F"));
    expect(href).not.toContain("embed=");
    // Hidden file input stays for pipeline uniformity, but no open button.
    await expect(page.locator('input[type="file"]')).toHaveCount(1);
    expect(sourceRequests).toEqual([SRC_PARAM]);
    expect(datasetRequests).toEqual([]);
    expect(issueRequests.requests).toEqual([]);
    issueRequests.dispose();
  });

  test("non-embed deep link matches short_name case-insensitively", async ({ page }) => {
    const issueRequests = collectIssueRequests(page);
    const buffer = await minimalImdfZipBuffer();
    await page.route(ZIP_ROUTE, (route) =>
      route.fulfill({ body: buffer, contentType: "application/zip" }),
    );

    await page.goto(`/?src=${SRC_PARAM}&level=2f`);
    await waitForReadyVenue(page, VENUE_NAME_JA);

    // Query "2f" matched short_name "2F".
    await expect(floorButton(page, LEVEL_2F_SHORT)).toHaveAttribute("aria-pressed", "true");
    expect(issueRequests.requests).toEqual([]);
    issueRequests.dispose();
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
    await expect(page.locator(".floor-stack__btn").first()).toBeVisible();
  });
});
