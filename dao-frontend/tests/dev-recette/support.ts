import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";
import { hasSession, outputRoot, ROLES, statePath, type Role } from "./roles";

type RecetteFixtures = {
  /** Ouvre une page connectée sous le rôle demandé (contexte isolé). */
  as: (role: Role) => Promise<Page>;
  /** Capture pleine page, jointe au rapport et copiée dans captures/. */
  snap: (page: Page, name: string) => Promise<void>;
};

export const test = base.extend<RecetteFixtures>({
  as: async ({ browser }, use, testInfo) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    const u = testInfo.project.use;
    await use(async (role: Role) => {
      if (!hasSession(role)) {
        throw new Error(
          `${ROLES[role].label} indisponible : secret DAO_RECETTE_${ROLES[role].key}_EMAIL manquant ou connexion échouée (voir l'étape de connexion)`,
        );
      }
      const context = await browser.newContext({
        baseURL: u.baseURL,
        viewport: u.viewport,
        userAgent: u.userAgent,
        deviceScaleFactor: u.deviceScaleFactor,
        isMobile: u.isMobile,
        hasTouch: u.hasTouch,
        locale: u.locale,
        timezoneId: u.timezoneId,
        storageState: statePath(role),
      });
      contexts.push(context);
      return context.newPage();
    });
    for (const context of contexts) await context.close();
  },
  snap: async ({}, use, testInfo) => {
    await use(async (page: Page, name: string) => {
      const safe = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
      const dir = path.join(outputRoot(), "rapport", "captures");
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, `${testInfo.project.name}-${safe}.png`);
      // Pas de capture d'un écran encore en chargement (squelettes aria-busy).
      await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
      await page.screenshot({ path: file, fullPage: true });
      await testInfo.attach(name, { path: file, contentType: "image/png" });
    });
  },
});

export { expect };

/** Attend que l'écran soit chargé : titre visible et plus de zone aria-busy. */
export async function waitForContent(page: Page) {
  await expect(page.locator("main h1").first()).toBeVisible();
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
}

/** Vérifie qu'aucun débordement horizontal n'apparaît (contrôle mobile). */
export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "débordement horizontal en px").toBeLessThanOrEqual(1);
}
