import type { Page } from "@playwright/test";
import { expect, expectNoHorizontalOverflow, test, waitForContent } from "./support";

// #587 — Recette DEV de la modification de périmètre validée (décision du propriétaire, 07/11/2026).
// Chantier de recette « RECETTE 03/11 » du Client A, lots attribués avant les ouvrages par lot.
// Écrit uniquement un ouvrage fictif « RECETTE jj/mm — … (test, ne pas traiter) » ; aucun prix, aucune suppression.
const MANUAL_PROJECT = "a5aed924-00b0-4a5c-b976-314bea21a514";
const day = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "Africa/Tunis" });

const LABEL_RE = /RECETTE \d{2}\/\d{2} — Ouvrage ajouté après attribution \(test, ne pas traiter\)/;

// La carte s'affiche dès le chargement : attendre la fin de « Chargement… » avant de compter les lots.
async function loadedScope(page: Page) {
  const section = page.getByTestId("scope-changes");
  await section.waitFor();
  await expect(section.getByText("Chargement…", { exact: true })).toHaveCount(0, { timeout: 20_000 });
  return section;
}

test("Périmètre : le Client propose, l’Artisan titulaire accepte, l’ouvrage devient mesurable", async ({ as, snap }) => {
  let label = `RECETTE ${day} — Ouvrage ajouté après attribution (test, ne pas traiter)`;
  const client = await as("clientA");
  await client.goto(`/app/native-execution/${MANUAL_PROJECT}?section=perimetre`);
  await waitForContent(client);
  const section = await loadedScope(client);
  await expect(section.getByTestId("scope-no-price")).toContainText("ne change ni le prix attribué, ni le contrat");
  const fresh = section.getByTestId("scope-lot").filter({ has: client.getByRole("button", { name: "Proposer un nouvel ouvrage" }) });
  let lotName: string | null;
  if (await fresh.count()) {
    lotName = await fresh.first().getAttribute("aria-label");
    // Le bouton disparaît à l'ouverture du formulaire : le lot est ensuite repéré par son nom, pas par le bouton.
    const lot = section.getByRole("region", { name: lotName!, exact: true });
    await lot.getByRole("button", { name: "Proposer un nouvel ouvrage" }).click();
    const form = lot.getByTestId("scope-propose");
    await form.getByLabel("Rechercher un ouvrage").fill("Carrelage");
    await form.getByRole("checkbox").first().check();
    await form.getByLabel("Ouvrage hors référentiel").fill(label);
    await form.getByRole("button", { name: "Ajouter", exact: true }).click();
    await form.getByLabel(/Motif de la modification/).fill("Recette #587 : ajout demandé par le Client (test, ne pas traiter)");
    await form.getByRole("button", { name: /Envoyer la proposition/ }).click();
  } else {
    // Reprise d'une recette interrompue : une proposition de recette du Client attend déjà l'Artisan.
    const resumed = section.getByTestId("scope-lot").filter({ has: client.getByTestId("scope-pending").filter({ hasText: LABEL_RE }) }).first();
    await expect(resumed, "aucun lot de recette disponible pour une proposition").toBeVisible();
    lotName = await resumed.getAttribute("aria-label");
    label = (await resumed.getByTestId("scope-pending").innerText()).match(LABEL_RE)![0];
  }
  const lot = section.getByRole("region", { name: lotName!, exact: true });
  const pending = lot.getByTestId("scope-pending");
  await expect(pending).toContainText("en attente de l’Artisan");
  await expect(pending.getByRole("button", { name: "Accepter" })).toHaveCount(0);
  await expect(client.locator("main")).not.toContainText(/\bTND\b/);
  await snap(client, "perimetre-proposition-client");
  await expectNoHorizontalOverflow(client);

  // L'Artisan titulaire de ce lot accepte ; l'autre Artisan ne voit pas ce lot.
  let accepted = false;
  for (const role of ["artisanA", "artisanB"] as const) {
    const page = await as(role);
    await page.goto(`/app/native-execution/${MANUAL_PROJECT}?section=perimetre`);
    await waitForContent(page);
    await loadedScope(page);
    const region = page.getByRole("region", { name: lotName!, exact: true });
    if (!(await region.count())) continue;
    await region.getByTestId("scope-pending").getByRole("button", { name: "Accepter" }).click();
    await expect(page.getByTestId("scope-message")).toContainText("Modification acceptée");
    await expect(region.getByTestId("scope-pending")).toHaveCount(0);
    await snap(page, `perimetre-acceptation-${role}`);
    await expectNoHorizontalOverflow(page);
    accepted = true;
    break;
  }
  expect(accepted, "un Artisan de recette doit être titulaire du lot").toBe(true);

  await client.goto(`/app/native-execution/${MANUAL_PROJECT}?section=metres`);
  await waitForContent(client);
  await expect(client.getByText(label).first()).toBeVisible();
  await expect(client.getByRole("button", { name: /^Nouveau métré/ }).first()).toBeVisible();
  await snap(client, "perimetre-metres-execution");
});
