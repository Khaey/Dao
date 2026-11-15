import { expect, expectNoHorizontalOverflow, test, waitForContent } from "./support";

// Recette DEV sur brouillons temporaires seulement. Chaque proposition est
// abandonnée avant de passer au cas suivant ; aucun chantier n'est créé.
test("Assistant : rénovation ciblée et réparation sans travaux ajoutés par défaut", async ({ as, snap }) => {
  const page = await as("clientA");
  let ownsDraft = false;
  const start = async (nature: string, description: string) => {
    await page.goto("/app/projects/new/assistant");
    await waitForContent(page);
    // Ne jamais abandonner le brouillon déjà présent d'un autre contrôle DEV.
    await expect(page.getByText("Brouillon en cours :")).toHaveCount(0);
    await page.getByRole("button", { name: "Appartement", exact: true }).click();
    await page.getByRole("button", { name: nature, exact: true }).click();
    await page.getByRole("button", { name: "Je ne sais pas" }).click();
    await page.getByLabel("Description libre").fill(description);
    await page.getByRole("button", { name: "Voir la proposition" }).click();
    ownsDraft = true;
    await expect(page.getByText("Lots et ouvrages proposés")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  };
  const abandonOwnDraft = async () => {
    if (!ownsDraft) return;
    const restart = page.getByRole("button", { name: "Recommencer" }).first();
    if (await restart.count()) {
      await restart.click();
      await expect(page.getByRole("heading", { name: "Quel type de lieu ?" })).toBeVisible();
    }
    ownsDraft = false;
  };

  try {
    await start("Rénovation", "Refaire uniquement la salle de bain de mon appartement à Tunis");
    const selected = page.locator('input[type="checkbox"]:checked');
    await expect(page.getByRole("heading", { name: "Ouvrages possibles pour la salle de bain" })).toBeVisible();
    for (const label of ["Dépose ou démolition sélective", "Réseaux alimentation et évacuation", "Équipements sanitaires", "Carrelage et faïence"])
      await expect(page.getByRole("checkbox", { name: new RegExp(label) })).toBeVisible();
    await expect(selected).toHaveCount(0);
    await snap(page, "renovation-ciblee");
    await page.getByRole("checkbox", { name: /Carrelage et faïence/ }).check();
    await expect(page.getByText(/1 lot et 1 ouvrage retenus/)).toBeVisible();
    expect(await selected.count()).toBeLessThanOrEqual(4);
    await abandonOwnDraft();

    await start("Réparation", "Réparer une fuite dans la salle de bain de mon appartement à Tunis");
    await expect(page.getByText(/Quel élément précis faut-il réparer/)).toBeVisible();
    await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(0);
    await snap(page, "reparation-a-preciser");
  } finally {
    await abandonOwnDraft();
  }
});
