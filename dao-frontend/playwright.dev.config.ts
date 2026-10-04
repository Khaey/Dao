import { defineConfig, devices } from "@playwright/test";

const expectedBaseURL = "https://dao-dev.logiclab.fr";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || expectedBaseURL;
const browserEnv = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith("DAO_TEST_")),
);

if (baseURL !== expectedBaseURL) {
  throw new Error("DEV real-email Playwright config refused a non-DEV target");
}

export default defineConfig({
  testDir: "./tests/dev-email",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  reporter: "line",
  outputDir: process.env.RUNNER_TEMP
    ? `${process.env.RUNNER_TEMP}/dao-dev-real-email-playwright`
    : "./.dev-real-email-playwright-results",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    launchOptions: { env: browserEnv },
    trace: "off",
    screenshot: "off",
    video: "off",
    storageState: undefined,
  },
});
