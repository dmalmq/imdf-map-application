import { defineConfig, devices } from "@playwright/test";

const VISUAL_SPEC = "**/viewer.visual.spec.ts";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  // Plan-literal baseline names (desktop-tokyo-ja.png, …) on the fixed
  // Chromium/Linux runner; the visual project below is the only snapshot user.
  snapshotPathTemplate: "{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}{ext}",
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] }, testIgnore: VISUAL_SPEC },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, testIgnore: VISUAL_SPEC },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, testIgnore: VISUAL_SPEC },
    {
      // Visual baselines run on deterministic software rasterization
      // (SwiftShader) so GPU/driver variance cannot jitter pixels.
      // Performance specs stay on the plain chromium project: SwiftShader
      // timings would not represent the acceptance runner.
      name: "chromium-visual",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
            // Deterministic text rasterization: marker labels otherwise flip
            // between LCD and grayscale antialiasing across runs.
            "--disable-lcd-text",
            "--font-render-hinting=none",
            "--force-color-profile=srgb",
            // Markers use 3D transforms and become composited layers; GPU
            // (SwiftShader-GL) tile rasterization of their text is not
            // run-deterministic. Software compositing is.
            "--disable-gpu-compositing",
          ],
        },
      },
      testMatch: VISUAL_SPEC,
    },
  ],
  webServer: [
    {
      command: "corepack pnpm build && corepack pnpm exec vite preview --host 127.0.0.1 --port 4173",
      url: "http://127.0.0.1:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command:
        "corepack pnpm build:server && node server/dist/main.js add-user admin --role admin --password e2e-admin-pw --data e2e/.platform-data && node server/dist/main.js add-user alice --role user --password e2e-alice-pw --data e2e/.platform-data && node server/dist/main.js --port 4174 --data e2e/.platform-data --app dist",
      url: "http://127.0.0.1:4174/api/catalog",
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
