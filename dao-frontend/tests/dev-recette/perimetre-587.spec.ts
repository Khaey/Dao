import { expect, expectNoHorizontalOverflow, test, waitForContent } from "./support";

// #587 — Recette DEV de la modification de périmètre validée (décision du propriétaire, 07/11/2026).
// Chantier de recette « RECETTE 03/11 » du Client A, lots attribués avant les ouvrages par lot.
// Écrit uniquement un ouvrage fictif « RECETTE jj/mm — … (test, ne pas traiter) » ; aucun prix, aucune suppression.
const MANUAL_PROJECT = "a5aed924-00b0-4a5c-b976-314bea21a514";
const day = new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", timeZone: "Africa/Tunis" });

test("Périmètre : le Client propose, l’Artisan titulaire accepte, l’ouvrage devient mesurable", async ({ as, snap }) => {
  const label = `RECETTE ${day} — Ouvrage ajouté après attribution (test, ne pas traiter)`;
  const client = await as("clientA");
  await client.goto(`/app/native-execution/${MANUAL_PROJECT}?section=perimetre`);
  await waitForContent(client);
  const section = client.getByTestId("scope-changes");
  await expect(section.getByTestId("scope-no-price")).toContainText("ne change ni le prix attribué, ni le contrat");
  const candidate = section.getByTestId("scope-lot").filter({ has: client.getByRole("button", { name: "Proposer un nouvel ouvrage" }) }).first();
  await expect(candidate).toBeVisible();
  const lotName = await candidate.getAttribute("aria-label");
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
    const region = page.getByRole("region", { name: lotName!, exact: true });
    await page.getByTestId("scope-changes").waitFor();
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
