import fs from "node:fs";
import path from "node:path";

// Comptes de test DEV. Chaque rôle lit DAO_RECETTE_<CLE>_EMAIL et
// DAO_RECETTE_<CLE>_PASSWORD, ou à défaut le mot de passe commun
// DAO_RECETTE_PASSWORD. Aucune valeur n'est codée en dur.
export const ROLES = {
  admin: { key: "ADMIN", label: "Admin" },
  clientA: { key: "CLIENT_A", label: "Client A" },
  clientB: { key: "CLIENT_B", label: "Client B (Gestionnaire)" },
  artisanA: { key: "ARTISAN_A", label: "Artisan A" },
  artisanB: { key: "ARTISAN_B", label: "Artisan B" },
} as const;

export type Role = keyof typeof ROLES;

export function outputRoot() {
  return (
    process.env.DAO_RECETTE_OUTPUT_DIR ||
    path.join(process.env.RUNNER_TEMP || ".", "dao-dev-recette")
  );
}

// Les sessions sont hors du dossier publié en artefact.
export function stateDir() {
  return path.join(outputRoot(), "sessions-non-publiees");
}

export function statePath(role: Role) {
  return path.join(stateDir(), `${role}.json`);
}

export function credentials(role: Role) {
  const { key } = ROLES[role];
  const email = process.env[`DAO_RECETTE_${key}_EMAIL`]?.trim();
  const password =
    process.env[`DAO_RECETTE_${key}_PASSWORD`] || process.env.DAO_RECETTE_PASSWORD;
  return email && password ? { email, password } : null;
}

export function hasSession(role: Role) {
  return fs.existsSync(statePath(role));
}
