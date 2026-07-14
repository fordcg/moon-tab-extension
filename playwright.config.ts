import { defineConfig } from "@playwright/test";
import { resolveBrowserExecutablePath } from "./tests/e2e/fixtures/browserExecutable";

const browserExecutablePath = resolveBrowserExecutablePath();
const skipWebServer = process.env.PLAYWRIGHT_SKIP_WEBSERVER === "1";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  ...(skipWebServer
    ? {}
    : {
        webServer: {
          command: "node scripts/playwright-static-server.mjs",
          url: baseURL,
          reuseExistingServer: false,
          timeout: 120_000,
        },
      }),
  use: {
    baseURL,
    ...(browserExecutablePath ? { launchOptions: { executablePath: browserExecutablePath } } : {}),
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "web-preview",
      testMatch: /(?:extension-smoke|workflow-tasks)\.spec\.ts/,
    },
    {
      name: "chrome-extension",
      testMatch: /extension-runtime\.spec\.ts/,
    },
  ],
});
