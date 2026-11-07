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
  // Statut « soumis » : badge toujours visible ; l'encadré d'attente n'apparaît que si le Client ne peut pas valider (réglage).
  await expect(detail.getByText("En attente de validation technique").first()).toBeVisible();
  if (policy === "default") await expect(detail.getByRole("status").filter({ hasText: "En attente de validation technique" })).toBeVisible();
  // Jamais d'auto-validation : la révision reste en attente ; sans le réglage, aucun bouton de validation.
  if (policy === "default") await expect(detail.getByRole("button", { name: /Valider la révision/ })).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText(/\bTND\b/);
  await snap(page, "metres-assistant-en-attente");
  await expectNoHorizontalOverflow(page);
});

// Décision du propriétaire (07/11/2026) : après attribution, les métrés prévisionnels sont figés ; les quantités
// réalisées passent par les situations de travaux. Le chantier manuel de recette a tous ses lots attribués.
// La validation par un gestionnaire affecté reste couverte par la CI (pile jetable) : aucun chantier DEV en
// préparation n'a de gestionnaire affecté, et la recette ne modifie pas les affectations réelles.
test("Métrés : chantier attribué, métrés prévisionnels figés et historique conservé", async ({ as, snap }) => {
  for (const role of ["clientA", "clientB"] as const) {
    const page = await as(role);
    await page.goto(`/app/projects/${MANUAL_PROJECT}/metres`);
    await waitForContent(page);
    await expect(page.getByTestId("takeoffs-frozen-notice")).toContainText("Lots attribués");
    await expect(page.getByTestId("takeoffs-frozen-notice").getByRole("link", { name: /situations de travaux/ })).toHaveAttribute("href", `/app/native-execution/${MANUAL_PROJECT}`);
    await expect(page.getByRole("button", { name: /^Nouveau métré/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Ajouter des ouvrages" })).toHaveCount(0);
    const history = page.getByTestId("takeoffs-unlinked");
    if (await history.count()) {
      await expect(history).toContainText("conservé tel quel, en historique");
      await history.getByRole("button").first().click();
      await expect(page.getByTestId("takeoff-frozen")).toBeVisible();
      for (const name of [/Valider la révision/, "Soumettre pour validation", /Corriger les dimensions|Compléter les dimensions/]) {
        await expect(page.getByTestId("takeoff-detail").getByRole("button", { name })).toHaveCount(0);
      }
    }
    await expect(page.locator("main")).not.toContainText(/\bTND\b/);
    await snap(page, `metres-attribue-fige-${role}`);
    await expectNoHorizontalOverflow(page);
  }
});

// Métrés d'exécution (décision du 07/11/2026) : section du suivi du chantier. Le chantier attribué de recette
// date d'avant les ouvrages par lot (aucune occurrence) : la section l'explique sans rien proposer de créer.
test("Suivi du chantier : section Métrés d’exécution, sans création hors ouvrage attribué", async ({ as, snap }) => {
  const page = await as("clientA");
  await page.goto(`/app/native-execution/${MANUAL_PROJECT}?section=metres`);
  await waitForContent(page);
  await expect(page.getByRole("button", { name: "Métrés d’exécution" })).toHaveAttribute("aria-current", "true");
  await expect(page.getByText("Métrés d’exécution, à partir des dimensions relevées sur le chantier.")).toBeVisible();
  await expect(page.getByText(/Aucun lot attribué avec des ouvrages/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Nouveau métré/ })).toHaveCount(0);
  await expect(page.getByTestId("takeoff-budget")).toHaveCount(0);
  await snap(page, "suivi-metres-execution");
  await expectNoHorizontalOverflow(page);
});

test("Métrés : accès refusé à un Artisan et à un gestionnaire non affecté", async ({ as, snap }) => {
  for (const role of ["artisanA", "clientB"] as const) {
    const page = await as(role);
    await page.goto(`/app/projects/${ASSISTANT_PROJECT}/metres`);
    await expect(page.getByText("Accès réservé")).toBeVisible();
    await snap(page, `metres-refus-${role}`);
  }
});
