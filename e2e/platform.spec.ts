import { expect, request, test } from "@playwright/test";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeVenue } from "../src/imdf/normalizeVenue";
import { writeVenueSnapshot } from "../src/imdf/venueSnapshot";
import type { FeatureType, ImdfManifest, ParsedImdfArchive } from "../src/imdf/types";
import {
  LEVEL_B1_JA,
  levelPill,
  minimalImdfZipBuffer,
  openMenu,
  VENUE_NAME_JA,
} from "./helpers";

const BASE = "http://127.0.0.1:4174";
const RUN_ID = `${Date.now()}`;
const SNAPSHOT_ID = `e2e-snap-${RUN_ID}`;

test.use({ baseURL: BASE });

const FIXTURE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "tests",
  "fixtures",
  "minimal-imdf",
);

async function buildSnapshotBuffer(): Promise<Buffer> {
  const manifest = JSON.parse(
    await readFile(path.join(FIXTURE_DIR, "manifest.json"), "utf8"),
  ) as ImdfManifest;
  const collections: ParsedImdfArchive["collections"] = {};
  for (const name of await readdir(FIXTURE_DIR)) {
    if (!name.endsWith(".geojson")) {
      continue;
    }
    collections[name.replace(/\.geojson$/, "") as FeatureType] = JSON.parse(
      await readFile(path.join(FIXTURE_DIR, name), "utf8"),
    ) as GeoJSON.FeatureCollection;
  }
  const venue = normalizeVenue({ manifest, collections });
  const blob = await writeVenueSnapshot(venue, "e2e-fixture.gdb");
  return Buffer.from(await blob.arrayBuffer());
}

async function adminApi() {
  const api = await request.newContext({ baseURL: BASE });
  const login = await api.post("/api/login", {
    data: { username: "admin", password: "e2e-admin-pw" },
  });
  expect(login.ok()).toBeTruthy();
  return api;
}

test.describe("platform", () => {
  test.beforeAll(async () => {
    const api = await adminApi();
    const put = await api.put(
      `/api/datasets/${SNAPSHOT_ID}?name=${encodeURIComponent("E2E スナップショット")}&kind=venue-snapshot&levelCount=3&featureCount=20&sourceName=e2e-fixture.gdb`,
      {
        data: await buildSnapshotBuffer(),
        headers: { "content-type": "application/zip" },
      },
    );
    expect(put.ok()).toBeTruthy();
    await api.dispose();
  });

  test("snapshot datasets load through the bundle path", async ({ page }) => {
    await page.goto(`/?dataset=${SNAPSHOT_ID}`);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    const panel = await openMenu(page);
    await expect(panel).toContainText(VENUE_NAME_JA);
  });

  test("full journey: admin UI-publish -> gallery -> colleague view -> pinned comment -> embed", async ({ page }) => {
    const PUBLISHED_ID = `e2e-imdf-${RUN_ID}`;
    const PUBLISHED_NAME = `E2E 公開テスト ${RUN_ID}`;

    await page.goto("/");
    await expect(page.getByRole("button", { name: "公開", exact: true })).toHaveCount(0);

    const zip = await minimalImdfZipBuffer();
    await page
      .locator('input[type="file"][accept*="zip"]')
      .first()
      .setInputFiles({ name: "minimal-imdf.zip", mimeType: "application/zip", buffer: zip });
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect(page.getByRole("button", { name: "公開", exact: true })).toHaveCount(0);

    await openMenu(page);
    await page.getByRole("button", { name: "サインイン" }).click();
    await page.getByLabel("ユーザー名").fill("admin");
    await page.getByLabel("パスワード").fill("e2e-admin-pw");
    await page.getByRole("button", { name: "送信" }).click();
    await expect(page.getByLabel("ユーザー名")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "公開", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "公開", exact: true }).click();
    const dialog = page.locator("dialog.publish-dialog");
    await dialog.getByLabel("表示名").fill(PUBLISHED_NAME);
    await dialog.getByLabel("データセットID").fill(PUBLISHED_ID);
    await dialog.getByRole("button", { name: "公開", exact: true }).click();
    await expect(dialog.getByLabel("表示URL")).toHaveValue(new RegExp(`dataset=${PUBLISHED_ID}`));
    await dialog.getByRole("button", { name: "閉じる" }).click();

    await openMenu(page);
    await page.getByRole("button", { name: "サインアウト" }).click();
    await page.goto("/");
    const card = page.getByRole("button", { name: new RegExp(PUBLISHED_NAME) });
    await expect(card).toBeVisible();
    await card.click();

    await expect(page).toHaveURL(new RegExp(`dataset=${PUBLISHED_ID}`));
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    const colleagueMenu = await openMenu(page);
    await expect(colleagueMenu).toContainText(VENUE_NAME_JA);

    await page.getByRole("button", { name: "サインイン" }).click();
    await page.getByLabel("ユーザー名").fill("alice");
    await page.getByLabel("パスワード").fill("e2e-alice-pw");
    await page.getByRole("button", { name: "送信" }).click();
    await expect(page.getByLabel("ユーザー名")).toHaveCount(0);

    await levelPill(page, LEVEL_B1_JA).click();
    await page.getByRole("button", { name: "コメント", exact: true }).click();
    await page.getByRole("button", { name: "地図にピンを打つ" }).click();
    const canvas = page.locator(".maplibregl-canvas");
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const comments = page.locator(".comments-panel");
    await comments.getByLabel("コメント", { exact: true }).fill("ここを確認してください");
    await comments.getByRole("button", { name: "投稿" }).click();
    await expect(comments.getByText("ここを確認してください")).toBeVisible();

    await page.reload();
    await page.getByRole("button", { name: "コメント", exact: true }).click();
    await expect(page.getByText("ここを確認してください")).toBeVisible();

    await page.goto(`/?dataset=${PUBLISHED_ID}&embed=1&level=b1`);
    await expect(page.locator(".maplibregl-canvas")).toBeVisible();
    await expect(levelPill(page, LEVEL_B1_JA)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "サインイン" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "コメント", exact: true })).toHaveCount(0);
  });
});
