import { test, expect, type Page } from "@playwright/test";
import { login } from "../e2e/support/flow";
import { createCollaborative, signOut } from "../e2e/support/collaboration";
import type { E2EUser } from "../e2e/support/fixtures";

const expectedBaseURL = "https://dao-dev.logiclab.fr";
const expectedClientEmail = "ahmedhattab.pro+dao-client@gmail.com";
const expectedContractorEmail = "ahmedhattab.pro+dao-contractor@gmail.com";

function protectedValue(name: string) {
  const value = process.env[name];
  if (!value)
    throw new Error(`Missing protected DEV test configuration: ${name}`);
  return value;
}

if (process.env.CI !== "true" || process.env.DAO_DEV_REAL_TEST !== "1") {
  throw new Error(
    "DEV real-email test is CI-only and requires its protected workflow",
  );
}
if ((process.env.PLAYWRIGHT_BASE_URL || "") !== expectedBaseURL) {
  throw new Error("DEV real-email test refused a non-DEV target");
}

function user(
  emailName: string,
  passwordName: string,
  expectedEmail: string,
): E2EUser {
  const email = protectedValue(emailName).trim().toLowerCase();
  if (email !== expectedEmail)
    throw new Error(
      "Protected DEV test alias does not match the approved fixture",
    );
  return { id: "", email, password: protectedValue(passwordName) };
}

const client = user(
  "DAO_TEST_CLIENT_EMAIL",
  "DAO_TEST_CLIENT_PASSWORD",
  expectedClientEmail,
);
const contractor = user(
  "DAO_TEST_CONTRACTOR_EMAIL",
  "DAO_TEST_CONTRACTOR_PASSWORD",
  expectedContractorEmail,
);

// Keep credentials in the Playwright worker only; browser child processes and
// any accidental environment dump must not inherit the protected values.
for (const name of [
  "DAO_TEST_CLIENT_EMAIL",
  "DAO_TEST_CLIENT_PASSWORD",
  "DAO_TEST_CONTRACTOR_EMAIL",
  "DAO_TEST_CONTRACTOR_PASSWORD",
]) {
  delete process.env[name];
}

async function acceptInvitation(
  page: Page,
  link: string,
  contractor: E2EUser,
  title: string,
) {
  try {
    await page.goto(link, { waitUntil: "domcontentloaded" });
  } catch {
    throw new Error("DEV invitation navigation failed");
  }
  await page.getByRole("link", { name: "Se connecter", exact: true }).click();
  await page.getByPlaceholder("Votre email").fill(contractor.email);
  await page.getByPlaceholder("Mot de passe").fill(contractor.password);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await page
    .getByRole("button", {
      name: "Confirmer et rejoindre le chantier",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("heading", { name: title, exact: true }),
  ).toBeVisible();
}

test.afterEach(async ({ context, page }) => {
  await context.clearCookies();
  if (!page.isClosed()) {
    await page
      .evaluate(() => {
        localStorage.clear();
        sessionStorage.clear();
      })
      .catch(() => undefined);
  }
});

test("DEV réel : client envoie une invitation et contractor la confirme", async ({
  page,
}, info) => {
  let projectId = "unknown";

  try {
    await test.step("authentifier le client TEST", () => login(page, client));
    const project =
      await test.step("préparer un chantier et une invitation", () =>
        createCollaborative(page, info, false, contractor.email, true));
    projectId = project.projectId;

    const invitationLink = await page
      .getByLabel("Lien d’invitation")
      .inputValue();
    await test.step("envoyer le vrai email Resend", async () => {
      await page
        .getByRole("button", { name: "Envoyer par e-mail", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Invitation envoyée ✓", exact: true }),
      ).toBeDisabled();
      await expect(
        page.getByRole("status").filter({ hasText: "Invitation envoyée à" }),
      ).toBeVisible();
    });
    console.log(`DEV_EMAIL_E2E send=PASS project_id=${projectId}`);

    await test.step("basculer vers le contractor TEST", () => signOut(page));
    await test.step("ouvrir et accepter l’invitation", () =>
      acceptInvitation(page, invitationLink, contractor, project.title));
    console.log(`DEV_EMAIL_E2E accept=PASS project_id=${projectId}`);
  } catch {
    throw new Error(`DEV_EMAIL_E2E_FAILED project_id=${projectId}`);
  }
});
