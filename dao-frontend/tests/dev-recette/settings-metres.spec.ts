import { expect, expectNoHorizontalOverflow, test } from "./support";

// #556 §5.1 / #564 — réglage « Validation des métrés par le Client », en lecture seule :
// l'Admin le trouve dans Paramètres → Plateforme D.A.O. → Fonctions → « Métrés et estimation ».
test("Admin : réglage de validation des métrés visible dans les Paramètres", async ({ as, snap }) => {
  const page = await as("admin");
  await page.goto("/app/dao/settings");
  await page.getByRole("button", { name: "Fonctions", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Métrés et estimation" })).toBeVisible();
  const label = page.getByText("Validation des métrés par le Client", { exact: true });
  await expect(label).toBeVisible();
  await expect(page.getByText(/seul le gestionnaire affecté au chantier ou un Admin valide un métré/)).toBeVisible();
  await label.scrollIntoViewIfNeeded();
  await snap(page, "admin-parametres-validation-metres");
  await expectNoHorizontalOverflow(page);
});
