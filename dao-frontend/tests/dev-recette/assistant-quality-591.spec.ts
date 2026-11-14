import { expect, expectNoHorizontalOverflow, test, waitForContent } from "./support";

// Recette DEV sur brouillons temporaires seulement. Chaque proposition est
// abandonnée avant de passer au cas suivant ; aucun chantier n'est créé.
test("Assistant : rénovation ciblée et réparation sans travaux ajoutés par défaut", async ({ as, snap }) => {
  const page = await as("clientA");
  const start = async (nature: string, description: string) => {
    await page.goto("/app/projects/new/assistant");
    await waitForContent(page);
    if (await page.getByRole("button", { name: "Recommencer" }).count())
      await page.getByRole("button", { name: "Recommencer" }).first().click();
    await page.getByRole("button", { name: "Appartement", exact: true }).click();
    await page.getByRole("button", { name: nature, exact: true }).click();
    await page.getByRole("button", { name: "Je ne sais pas" }).click();
    await page.getByLabel("Description libre").fill(description);
    await page.getByRole("button", { name: "Voir la proposition" }).click();
    await expect(page.getByText("Lots et ouvrages proposés")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  };

  await start("Rénovation", "Refaire uniquement la salle de bain de mon appartement à Tunis");
  const selected = page.locator('input[type="checkbox"]:checked');
  // Un lot, son sous-lot et l'ouvrage explicite ; aucun lot de toiture,
  // d'isolation ou d'électricité n'est retenu à cause du seul type de projet.
  expect(await selected.count()).toBeGreaterThan(0);
  expect(await selected.count()).toBeLessThanOrEqual(4);
  await snap(page, "renovation-ciblee");
  await page.getByRole("button", { name: "Recommencer" }).first().click();

  await start("Réparation", "Réparer une fuite dans la salle de bain de mon appartement à Tunis");
  await expect(page.getByText(/Quel élément précis faut-il réparer/)).toBeVisible();
  await expect(page.locator('input[type="checkbox"]:checked')).toHaveCount(0);
  await snap(page, "reparation-a-preciser");
  await page.getByRole("button", { name: "Recommencer" }).first().click();
});
