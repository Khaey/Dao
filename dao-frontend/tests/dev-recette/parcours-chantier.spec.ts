import { expect, expectNoHorizontalOverflow, test, waitForContent } from "./support";

// #568 — Parcours chantier cohérent multi-rôles, en LECTURE SEULE sur des fixtures DEV existantes :
// - « RECETTE 03/11 — Rénovation appartement Sousse » : publié, 2 lots sur 2 attribués, Client A
//   propriétaire, Client B Gestionnaire affecté ;
// - « renovation maison » (Client A) : publié, 3 lots actifs dont 1 attribué (2 lots publiés).
// Aucun clic d'action, aucune écriture : seules des pages sont ouvertes et capturées.
const AWARDED = { project: "a5aed924-00b0-4a5c-b976-314bea21a514", publication: "bcfe4e45-ae90-491c-b5fd-02504036d280" };
const PARTIAL = { project: "96888ef1-fa4e-4f66-bfb3-8a8154699eae" };

test("Admin : dossier publié et attribué sans « Prêt à publier » ni publication à préparer", async ({ as, snap }) => {
  const page = await as("admin");
  await page.goto(`/app/dao/projects/${AWARDED.project}`);
  await waitForContent(page);
  await expect(page.getByTestId("journey-next-step")).toContainText("Tous les lots sont attribués");
  await expect(page.getByText("Tous les lots attribués", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Préparer une publication", exact: true })).toHaveCount(0);
  await snap(page, "admin-dossier-attribue");
  await expectNoHorizontalOverflow(page);

  await page.goto("/app/dao/projects?status=published");
  await waitForContent(page);
  await expect(page.getByLabel("État du chantier")).toHaveValue("published");
  const card = page.getByRole("link").filter({ hasText: "RECETTE 03/11 — Rénovation appartement Sousse" });
  await expect(card.getByText("Tous les lots attribués", { exact: true })).toBeVisible();
  await snap(page, "admin-chantiers-publies");
  await expectNoHorizontalOverflow(page);
});

test("Gestionnaire affecté : même situation et même prochaine action", async ({ as, snap }) => {
  const page = await as("clientB");
  await page.goto(`/app/dao/projects/${AWARDED.project}`);
  await waitForContent(page);
  await expect(page.getByTestId("journey-next-step")).toContainText("Tous les lots sont attribués");
  await expect(page.getByRole("link", { name: "Préparer une publication", exact: true })).toHaveCount(0);
  await snap(page, "gestionnaire-dossier-attribue");
});

test("Client : fiche et « Mes chantiers » donnent le même état réel par lot", async ({ as, snap }) => {
  const page = await as("clientA");
  await page.goto(`/app/projects/${AWARDED.project}`);
  await waitForContent(page);
  await expect(page.getByTestId("journey-next-step")).toContainText("Convenez des conditions avec les Artisans retenus");
  await expect(page.getByText("Tous les lots attribués", { exact: true }).first()).toBeVisible();
  await snap(page, "client-fiche-attribuee");

  await page.goto(`/app/projects/${PARTIAL.project}`);
  await waitForContent(page);
  await expect(page.getByTestId("journey-next-step")).toContainText(/lots? restants?|lot sans Artisan/);
  await expect(page.getByText("1 lot sur 3 attribué", { exact: true }).first()).toBeVisible();
  await snap(page, "client-fiche-partielle");

  await page.goto("/app/projects");
  await waitForContent(page);
  await expect(page.getByTestId(`project-row-${AWARDED.project}`)).toContainText("Tous les lots attribués");
  await expect(page.getByTestId(`project-row-${PARTIAL.project}`)).toContainText("1 lot sur 3 attribué");
  await snap(page, "client-mes-chantiers");
  await expectNoHorizontalOverflow(page);
});

test("Artisans : un DAO entièrement attribué n'est plus dans « DAO disponibles »", async ({ as, snap }) => {
  for (const role of ["artisanA", "artisanB"] as const) {
    const page = await as(role);
    await page.goto("/app/artisan");
    await waitForContent(page);
    await expect(page.locator(`a[href="/app/artisan/publications/${AWARDED.publication}"]`)).toHaveCount(0);
    await snap(page, `${role}-dao-disponibles`);
  }
});
