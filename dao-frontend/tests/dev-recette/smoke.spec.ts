import { expect, expectNoHorizontalOverflow, test } from "./support";
import { ROLES, type Role } from "./roles";

// Recette de base, en lecture seule : aucune écriture sur le DEV partagé.
// Les fils ajoutent leurs scénarios dans des fichiers *.spec.ts de ce dossier.

for (const role of Object.keys(ROLES) as Role[]) {
  test(`${ROLES[role].label} : tableau de bord`, async ({ as, snap }) => {
    const page = await as(role);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/app(?:[/?#]|$)/);
    await expect(page.getByText("Chargement du DAO…")).toHaveCount(0);
    await expect(page.locator("main")).toBeVisible();
    await snap(page, `${role}-tableau-de-bord`);
    await expectNoHorizontalOverflow(page);
  });
}

test("Admin : Utilisateurs & rôles accessible", async ({ as, snap }) => {
  const page = await as("admin");
  await page.goto("/app/dao/users");
  await expect(page.getByLabel("Rechercher utilisateurs & rôles")).toBeVisible();
  await expect(page.getByText("Administration réservée")).toHaveCount(0);
  await snap(page, "admin-utilisateurs-roles");
});

// Gestionnaire : staff sans droit Admin. Artisan : hors back-office.
const refusals = {
  clientB: "Administration réservée",
  artisanA: "Accès réservé au back-office",
} as const;

for (const role of ["clientB", "artisanA"] as const) {
  test(`${ROLES[role].label} : administration refusée`, async ({ as, snap }) => {
    const page = await as(role);
    await page.goto("/app/dao/users");
    await expect(
      page.getByRole("alert").filter({ hasText: refusals[role] }),
    ).toBeVisible();
    await snap(page, `${role}-administration-refusee`);
  });
}

test("Anonyme : API protégées en 401 et page chantier vers la connexion", async ({ page, request }) => {
  for (const url of ["/api/contracts/agreements", "/api/projects/execution"]) {
    const response = await request.get(url);
    expect(response.status(), url).toBe(401);
  }
  await page.goto("/app");
  await expect(page).toHaveURL(/\/auth\/login/);
});
