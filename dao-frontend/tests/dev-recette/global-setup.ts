import fs from "node:fs";
import { chromium, type FullConfig } from "@playwright/test";
import { credentials, ROLES, stateDir, statePath, type Role } from "./roles";

// Connecte chaque rôle configuré une seule fois et garde la session dans un
// dossier non publié. Le mot de passe n'apparaît que dans ce processus :
// ni dans le rapport HTML, ni dans les étapes des tests, ni dans les logs.
export default async function globalSetup(config: FullConfig) {
  if (process.env.DAO_DEV_RECETTE !== "1") {
    throw new Error("Recette DEV refusée : DAO_DEV_RECETTE=1 est requis (workflow dev-recette.yml)");
  }
  const baseURL = config.projects[0]?.use.baseURL;
  if (baseURL !== "https://dao-dev.logiclab.fr") {
    throw new Error("Recette DEV refusée : cible inattendue");
  }
  fs.rmSync(stateDir(), { recursive: true, force: true });
  fs.mkdirSync(stateDir(), { recursive: true });

  const browser = await chromium.launch();
  const report: string[] = [];
  try {
    for (const role of Object.keys(ROLES) as Role[]) {
      const label = ROLES[role].label;
      const creds = credentials(role);
      if (!creds) {
        report.push(`${label} : non configuré (secret DAO_RECETTE_${ROLES[role].key}_EMAIL ou mot de passe absent)`);
        continue;
      }
      const context = await browser.newContext({ baseURL, locale: "fr-FR" });
      const page = await context.newPage();
      try {
        await page.goto("/auth/login");
        await page.getByPlaceholder("Votre email").fill(creds.email);
        await page.getByPlaceholder("Mot de passe").fill(creds.password);
        await page.getByPlaceholder("Mot de passe").press("Enter");
        await page.waitForURL(/\/app(?:[/?#]|$)/, { timeout: 30_000 });
        await context.storageState({ path: statePath(role) });
        report.push(`${label} : connecté`);
      } catch {
        // Message volontairement générique : aucune donnée de connexion.
        report.push(`${label} : ÉCHEC de connexion (identifiants à vérifier)`);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  console.log(`Connexions de recette :\n- ${report.join("\n- ")}`);
}
