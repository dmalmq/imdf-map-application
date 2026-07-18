import { expect, test } from "@playwright/test";
import { minimalImdfZipBuffer, signIn, VENUE_NAME_JA, waitForReadyVenue } from "./helpers";

test.describe("gallery journey", () => {
  test("sign in → upload → card → open in viewer", async ({ page }) => {
    await page.goto("/");

    // Anonymous visit shows the sign-in card.
    await expect(page.locator(".signin-card")).toBeVisible();
    await signIn(page);

    // Upload the fixture through the modal.
    await page.getByRole("button", { name: /Open local data|ローカルデータを開く/ }).click();
    const buffer = await minimalImdfZipBuffer();
    await page
      .locator('.upload-modal input[type="file"]')
      .setInputFiles({ name: "tokyo-test.zip", mimeType: "application/zip", buffer });
    await expect(page.getByLabel(/Dataset name|データセット名/)).toHaveValue("tokyo-test");
    await page.getByRole("button", { name: /Publish|公開/ }).click();

    // Published → open in the viewer via the modal link.
    const open = page.getByRole("link", { name: /^Open$|^開く$/ });
    await expect(open).toBeVisible({ timeout: 20_000 });
    await open.click();
    await waitForReadyVenue(page, VENUE_NAME_JA);
    const datasetSlug = new URL(page.url()).searchParams.get("dataset");
    expect(datasetSlug).toMatch(/^tokyo-test/);

    // Back to the gallery: the card shows stats from the publish pipeline.
    await page.goto("/");
    // Filter by the exact slug element so concurrent chromium+firefox runs don't collide.
    const card = page.locator(".dataset-card").filter({
      has: page.locator(".dataset-card__slug", { hasText: datasetSlug! }),
    });
    await expect(card).toBeVisible();
    await expect(card.locator(".dataset-card__meta")).toContainText("3");
  });
});
