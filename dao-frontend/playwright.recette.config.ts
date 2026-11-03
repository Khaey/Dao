import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Recette navigateur sur le DEV partagé, lancée par le workflow
// « DAO DEV recette navigateur » (.github/workflows/dev-recette.yml).
// Les identifiants viennent uniquement des secrets du dépôt ; ils ne sont
// jamais transmis au navigateur, ni écrits dans le rapport ou les captures.
const expectedBaseURL = "https://dao-dev.logiclab.fr";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || expectedBaseURL;
if (baseURL !== expectedBaseURL) {
  throw new Error("La recette DEV refuse une cible autre que dao-dev.logiclab.fr");
}

const root =
  process.env.DAO_RECETTE_OUTPUT_DIR ||
  path.join(process.env.RUNNER_TEMP || ".", "dao-dev-recette");
const browserEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([name]) => !name.startsWith("DAO_RECETTE_") && !name.startsWith("DAO_TEST_"),
  ),
);

export default defineConfig({
  testDir: "./tests/dev-recette",
  globalSetup: "./tests/dev-recette/global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  outputDir: path.join(root, "rapport", "resultats"),
  reporter: [
    ["list"],
    ["html", { outputFolder: path.join(root, "rapport", "html"), open: "never" }],
    ["json", { outputFile: path.join(root, "rapport", "resultats.json") }],
  ],
  use: {
    baseURL,
    locale: "fr-FR",
    timezoneId: "Africa/Tunis",
    launchOptions: { env: browserEnv },
    // Pas de trace ni de vidéo : une trace contient les cookies de session.
    trace: "off",
    video: "off",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"], viewport: { width: 375, height: 812 } },
    },
  ],
});
