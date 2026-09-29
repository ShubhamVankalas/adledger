import { defineConfig, devices } from "@playwright/test";

// End-to-end smoke test against a production build with a fresh embedded database.
// Run: pnpm build && pnpm e2e   (SCREENSHOTS=1 also refreshes docs/screenshots)
const PORT = Number(process.env.E2E_PORT ?? 3200);

export default defineConfig({
  testDir: "e2e",
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    colorScheme: "light",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", testIgnore: /(a11y|mobile)\.spec\.ts/, use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Runs after the smoke journey (which creates the account) and reuses its database.
    { name: "a11y", testMatch: /a11y\.spec\.ts/, dependencies: ["chromium"], use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    // Phone layout; runs after the desktop journey, which creates the demo workspace.
    { name: "mobile", testMatch: /mobile\.spec\.ts/, dependencies: ["chromium"], use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: `http://localhost:${PORT}/api/v1/health`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { PORT: String(PORT), DATA_DIR: ".data/e2e", DATABASE_URL: "", CONNECTOR_MODE: "mock", DISABLE_SCHEDULER: "true", DISABLE_TOUR: "true" },
  },
});
