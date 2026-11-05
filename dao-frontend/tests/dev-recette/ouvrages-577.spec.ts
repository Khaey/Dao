import { expect, expectNoHorizontalOverflow, test, waitForContent } from "./support";

// #577 — Recette DEV : deux entrées de création, assistant guidé (sans créer de chantier : le brouillon
// est abandonné), ouvrages transcrits et persistés sur un chantier existant créé avec l'assistant,
// accès refusé à un Artisan. Aucune suppression, aucun prix, aucune donnée réelle modifiée.
const ASSISTANT_PROJECT = "0f9fd432-a6c2-4fa4-a54a-3b92af3f4fb6";

test("Création : deux entrées explicites et questions guidées une à la fois", async ({ as, snap }) => {
  const page = await as("clientA");
  await page.goto("/app/projects/new");
  await waitForContent(page);
  await expect(page.getByTestId("entry-manual")).toContainText("Créer manuellement");
  await expect(page.getByTestId("entry-assistant")).toContainText("Avec l’assistant");
  await expectNoHorizontalOverflow(page);
  await snap(page, "creation-deux-entrees");

  await page.getByTestId("entry-assistant").click();
  await waitForContent(page);
  const resume = page.getByRole("button", { name: "Recommencer" });
  if (await resume.count()) { await resume.first().click(); }
  await expect(page.getByRole("heading", { name: "Quel type de lieu ?" })).toBeVisible();
  await page.getByRole("button", { name: "Appartement" }).click();
  await expect(page.getByRole("heading", { name: "Quelle nature de travaux ?" })).toBeVisible();
  await page.getByRole("button", { name: "Rénovation" }).click();
  await page.getByRole("button", { name: "Je ne sais pas" }).click();
  await expect(page.getByText("Vos réponses :")).toContainText("Appartement");
  await page.getByLabel("Description libre").fill("RECETTE (test, ne pas traiter) : refaire la salle de bain et la cuisine");
  await expectNoHorizontalOverflow(page);
  await snap(page, "assistant-guide-description");
  await page.getByRole("button", { name: "Voir la proposition" }).click();
  await expect(page.getByText("Lots et ouvrages proposés")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await snap(page, "assistant-guide-proposition");
  // Brouillon abandonné : aucun chantier créé sur DEV par la recette.
  await page.getByRole("button", { name: "Recommencer" }).first().click();
  await expect(page.getByRole("heading", { name: "Quel type de lieu ?" })).toBeVisible();
});

test("Ouvrages : transcrits depuis l'assistant, regroupés par lot et persistés", async ({ as, snap }) => {
  const page = await as("clientA");
  await page.goto(`/app/projects/${ASSISTANT_PROJECT}?tab=lots`);
  await waitForContent(page);
  await expect(page.getByTestId("lot-works").first()).toBeVisible();
  const count = await page.getByTestId("work-item").count();
  expect(count, "ouvrages repris depuis l'assistant").toBeGreaterThan(0);
  await expect(page.getByText("retenu avec l’assistant").first()).toBeVisible();
  await page.reload();
  await waitForContent(page);
  await expect(page.getByTestId("work-item")).toHaveCount(count);
  await expectNoHorizontalOverflow(page);
  await snap(page, "ouvrages-par-lot");

  await page.goto(`/app/projects/${ASSISTANT_PROJECT}/metres`);
  await waitForContent(page);
  await expect(page.getByTestId("takeoff-lot").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await snap(page, "metres-par-lot");
});

test("Ouvrages : un Artisan n'y a pas accès", async ({ as, snap }) => {
  const page = await as("artisanA");
  await page.goto(`/app/projects/${ASSISTANT_PROJECT}/metres`);
  await expect(page.getByText("Accès réservé")).toBeVisible();
  await snap(page, "ouvrages-refus-artisan");
});
