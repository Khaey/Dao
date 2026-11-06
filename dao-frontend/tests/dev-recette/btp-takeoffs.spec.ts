import { expect, expectNoHorizontalOverflow, test, waitForContent } from "./support";

// #560 — Recette DEV du parcours métrés. Écrit uniquement des métrés fictifs nommés
// « RECETTE jj/mm — … (test, ne pas traiter) » ; aucune suppression, aucun prix, pas de PROD.
// Chantiers de recette existants sur DEV (Client A) :
//  - créé avec l'assistant (#543), sans gestionnaire affecté ;
//  - créé manuellement « RECETTE 03/11 — Rénovation appartement Sousse », gestionnaire = Client B.
const ASSISTANT_PROJECT = "0f9fd432-a6c2-4fa4-a54a-3b92af3f4fb6";
const MANUAL_PROJECT = "a5aed924-00b0-4a5c-b976-314bea21a514";
const day = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "Africa/Tunis" });

async function createTakeoff(page: import("@playwright/test").Page, projectId: string, work: string, name: string, dims: Array<[string, string, string]>) {
  // #577 : un métré part d'un ouvrage du lot. Ouvrage déjà présent (assistant, reprise ou recette
  // précédente) : « Nouveau métré » ; sinon, ajout dans le premier lot modifiable puis « Dimensions ».
  const known = page.getByRole("button", { name: `Nouveau métré : ${work}`, exact: true }).first();
  if (await known.count()) await known.click();
  else {
    await page.goto(`/app/projects/${projectId}?tab=lots`);
    await waitForContent(page);
    await page.getByRole("button", { name: /Ajouter des ouvrages au lot/ }).first().click();
    const picker = page.getByTestId("work-picker");
    await picker.getByLabel("Rechercher un ouvrage").fill(work);
    await picker.getByRole("checkbox", { name: new RegExp(work) }).first().check();
    await picker.getByRole("button", { name: /Ajouter 1 ouvrage/ }).click();
    await page.getByRole("link", { name: `Renseigner les dimensions : ${work}` }).first().click();
    await waitForContent(page);
    const existing = page.getByRole("button", { name: `Nouveau métré : ${work}`, exact: true }).first();
    if (!(await page.getByTestId("takeoff-editor").count())) await existing.click();
  }
  const editor = page.getByTestId("takeoff-editor");
  await editor.getByLabel("Nom du métré").fill(name);
  for (const [field, value, unit] of dims) {
    await editor.getByLabel(`${field} — valeur`, { exact: true }).fill(value);
    await editor.getByLabel(`${field} — unité`, { exact: true }).selectOption(unit);
    await editor.getByLabel(`${field} — provenance`, { exact: true }).selectOption("document");
    await editor.getByLabel(`${field} — référence`, { exact: true }).fill("Plan fictif de recette");
  }
  await editor.getByRole("button", { name: "Calculer et enregistrer" }).click();
  return page.getByTestId("takeoff-detail");
}

// Réglage Settings takeoffs.client_validation (#564) : selon la valeur active sur DEV, le Client
// peut valider lui-même. La recette constate la politique affichée au lieu de la supposer.
const CLIENT_SETTING = "Les paramètres D.A.O. vous autorisent à valider vous-même";
async function validationPolicy(page: import("@playwright/test").Page, defaultText: string) {
  const policy = page.getByTestId("validation-policy");
  await expect(policy).toContainText(new RegExp(`${defaultText}|${CLIENT_SETTING}`));
  return (await policy.textContent())?.includes(CLIENT_SETTING) ? "client_setting" : "default";
}

test("Métrés : chantier assistant sans gestionnaire, soumission sans auto-validation", async ({ as, snap }, info) => {
  const page = await as("clientA");
  await page.goto(`/app/projects/${ASSISTANT_PROJECT}`);
  await waitForContent(page);
  await page.getByRole("link", { name: "Saisir les métrés" }).click();
  await waitForContent(page);
  const policy = await validationPolicy(page, "Aucun gestionnaire n’est affecté");
  await expect(page.getByText("retenu avec l’assistant").first()).toBeVisible();
  const detail = await createTakeoff(page, ASSISTANT_PROJECT, "Carrelage et faïence", `RECETTE ${day} — Sol ${info.project.name} (test, ne pas traiter)`, [["Surface", "1250000", "cm2"]]);
  await expect(detail.getByTestId("takeoff-result")).toHaveText(/^125(,0+)? m²$/);
  await detail.getByRole("button", { name: "Soumettre pour validation" }).click();
  await expect(detail.getByRole("status").filter({ hasText: "En attente de validation technique" })).toBeVisible();
  // Jamais d'auto-validation : la révision reste en attente ; sans le réglage, aucun bouton de validation.
  if (policy === "default") await expect(detail.getByRole("button", { name: /Valider la révision/ })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/\bTND\b/);
  await snap(page, "metres-assistant-en-attente");
  await expectNoHorizontalOverflow(page);
});

test("Métrés : gestionnaire affecté valide, budget indisponible honnête", async ({ as, snap }, info) => {
  const client = await as("clientA");
  await client.goto(`/app/projects/${MANUAL_PROJECT}/metres`);
  await waitForContent(client);
  await validationPolicy(client, "gestionnaire D.A.O. est affecté");
  const name = `RECETTE ${day} — Terrasse ${info.project.name} (test, ne pas traiter)`;
  const detail = await createTakeoff(client, MANUAL_PROJECT, "Terrasse extérieure", name, [["Longueur", "1000", "cm"], ["Largeur", "6", "m"]]);
  await expect(detail.getByTestId("takeoff-result")).toHaveText(/^60(,0+)? m²$/);
  await detail.getByRole("button", { name: "Soumettre pour validation" }).click();
  await expect(detail.getByText("En attente de validation technique").first()).toBeVisible();

  const manager = await as("clientB");
  await manager.goto(`/app/projects/${MANUAL_PROJECT}/metres`);
  await waitForContent(manager);
  await expect(manager.getByTestId("validation-policy")).toContainText("gestionnaire affecté");
  await manager.getByRole("button", { name: new RegExp(name.replace(/[()]/g, "\\$&")) }).click();
  await manager.getByLabel("Note").fill("Recette : dimensions contrôlées");
  await manager.getByRole("button", { name: /Valider la révision/ }).click();
  await expect(manager.getByTestId("takeoff-detail").getByText("Validé", { exact: true }).first()).toBeVisible();
  await snap(manager, "metres-gestionnaire-valide");

  await client.reload();
  await waitForContent(client);
  await client.getByRole("button", { name: new RegExp(name.replace(/[()]/g, "\\$&")) }).click();
  await expect(client.getByTestId("takeoff-detail").getByText(/Révision validée de référence/)).toBeVisible();
  const budget = client.getByTestId("takeoff-budget");
  await expect(budget).toContainText("métré validé");
  await expect(budget).toContainText("Aucun tarif sourcé et vérifié");
  await expect(client.locator("main")).not.toContainText(/\bTND\b/);
  await snap(client, "metres-valide-budget-indisponible");
});

test("Métrés : accès refusé à un Artisan et à un gestionnaire non affecté", async ({ as, snap }) => {
  for (const role of ["artisanA", "clientB"] as const) {
    const page = await as(role);
    await page.goto(`/app/projects/${ASSISTANT_PROJECT}/metres`);
    await expect(page.getByText("Accès réservé")).toBeVisible();
    await snap(page, `metres-refus-${role}`);
  }
});
