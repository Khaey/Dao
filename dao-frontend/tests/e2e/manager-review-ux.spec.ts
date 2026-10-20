import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { createProjectWithMainLot, login } from './support/flow';

// #338 — Gestionnaire journey: actionable dashboard, assignment-aware queue, guarded decisions, filter continuity.
// Real Supabase flow; permissions remain server-side (claim_review / manages_project).
const noHorizontalScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test('Gestionnaire #338 : file actionnable, prise en charge, lecture seule et retour filtré', async ({ page, browser, e2eClient, e2eReviewer, e2eOtherReviewer, e2eAdmin }, info) => {
  test.skip(!e2eClient || !e2eReviewer || !e2eOtherReviewer || !e2eAdmin, 'E2E Supabase credentials are not available');
  test.setTimeout(240_000);
  const viewport = info.project.name === 'mobile' ? { width: 375, height: 812 } : { width: 1440, height: 900 };
  await login(page, e2eClient!);
  const project = await createProjectWithMainLot(page, info, 'manager-ux', 'Pose et essais du réseau électrique.', 'Lot électricité gestionnaire');
  await page.goto(`/app/projects/${project.projectId}/review`);
  await page.getByRole('button', { name: 'Soumettre pour revue DAO', exact: true }).click();
  await expect(page).toHaveURL(`/app/projects/${project.projectId}`);

  const rc = await browser.newContext({ viewport }), reviewer = await rc.newPage();
  await login(reviewer, e2eReviewer!);
  await reviewer.goto('/app/dao');
  await expect(reviewer.getByRole('heading', { name: 'Votre file de revue' })).toBeVisible();
  await noHorizontalScroll(reviewer);
  await reviewer.getByRole('link', { name: /^À prendre en charge/ }).click();
  await expect(reviewer).toHaveURL(/\/app\/dao\/review\?vue=todo$/);
  await expect(reviewer.getByRole('radio', { name: 'À prendre en charge' })).toBeChecked();
  const heading = reviewer.getByRole('heading', { name: project.title, exact: true });
  const card = heading.locator('xpath=../../..');
  await expect(card.getByText('Nouveau dossier', { exact: true })).toBeVisible();
  await expect(card.getByText(project.lotScope, { exact: true })).toBeVisible();

  // Network failure: explicit error in the card, nothing presented as recorded.
  await reviewer.route('**/api/dao/review/decision', (route) => route.abort());
  await card.getByRole('button', { name: 'Passer en revue DAO' }).click();
  await expect(card.getByRole('alert')).toContainText('Décision non enregistrée');
  await reviewer.unroute('**/api/dao/review/decision');

  // A double click sends a single decision.
  let decisions = 0;
  reviewer.on('request', (request) => { if (request.url().includes('/api/dao/review/decision')) decisions += 1; });
  await card.getByRole('button', { name: 'Passer en revue DAO' }).dblclick();
  await expect(reviewer.getByRole('status')).toContainText('passe en revue DAO');
  expect(decisions).toBe(1);
  await expect(heading).toHaveCount(0);

  // Keyboard: the filter is a radio group; « Mes revues » now holds the dossier.
  await reviewer.getByRole('radio', { name: 'À prendre en charge' }).focus();
  await reviewer.keyboard.press('ArrowRight');
  await expect(reviewer.getByRole('radio', { name: 'Mes revues' })).toBeChecked();
  await expect(reviewer).toHaveURL(/\?vue=mine$/);
  await expect(card.getByText('Revue DAO', { exact: true })).toBeVisible();
  await expect(card.getByText('Vous', { exact: true })).toBeVisible();

  // Detail: progressive sections, guarded refusal, then « retour » to the same filtered queue.
  await reviewer.getByRole('link', { name: project.title, exact: true }).click();
  await expect(reviewer.getByText('Vous pouvez gérer ce dossier.', { exact: true })).toBeVisible();
  for (const name of ['Résumé du dossier', 'Lots et sous-lots examinés', 'Décision']) await expect(reviewer.getByRole('heading', { name: new RegExp(name) })).toBeVisible();
  await expect(reviewer.getByRole('button', { name: 'Refuser', exact: true })).toBeDisabled();
  await reviewer.getByLabel('Commentaire de revue').fill('Précisez la puissance du tableau électrique.');
  await reviewer.getByRole('button', { name: 'Refuser', exact: true }).click();
  await expect(reviewer.getByRole('group', { name: 'Confirmer la demande de corrections' })).toContainText('Précisez la puissance du tableau électrique.');
  await reviewer.getByRole('button', { name: 'Annuler', exact: true }).click();
  await expect(reviewer.getByRole('button', { name: 'Approuver', exact: true })).toBeEnabled();
  await noHorizontalScroll(reviewer);
  await reviewer.getByRole('navigation', { name: 'Fil d’Ariane' }).getByRole('link', { name: 'Revues', exact: true }).click();
  await expect(reviewer).toHaveURL(/\/app\/dao\/review\?vue=mine$/);
  await expect(reviewer.getByRole('radio', { name: 'Mes revues' })).toBeChecked();

  // Another reviewer: read-only everywhere, never a decision control.
  const oc = await browser.newContext({ viewport }), other = await oc.newPage();
  await login(other, e2eOtherReviewer!);
  await other.goto('/app/dao/review?vue=others');
  const otherCard = other.getByRole('heading', { name: project.title, exact: true }).locator('xpath=../../..');
  await expect(otherCard.getByText(/^Lecture seule :/)).toBeVisible();
  await expect(otherCard.getByLabel('Commentaire de revue')).toHaveCount(0);
  await expect(otherCard.getByRole('button')).toHaveCount(0);
  await otherCard.getByRole('link', { name: 'Consulter le dossier' }).click();
  await expect(other.getByText(/^Lecture seule : ce dossier est affecté à/)).toBeVisible();
  await expect(other.getByLabel('Commentaire de revue')).toHaveCount(0);
  await expect(other.getByRole('button', { name: 'Prendre en charge' })).toHaveCount(0);
  await expect(other.getByRole('heading', { name: /Décision/ })).toHaveCount(0);
  await noHorizontalScroll(other);
  await oc.close();

  // Admin: can act on another reviewer's dossier and is told so; admin-only navigation stays admin-only.
  const ac = await browser.newContext({ viewport }), admin = await ac.newPage();
  await login(admin, e2eAdmin!);
  await admin.goto('/app/dao/review');
  const adminCard = admin.getByRole('heading', { name: project.title, exact: true }).locator('xpath=../../..');
  await expect(adminCard.getByText(/vous intervenez en tant qu’administrateur/)).toBeVisible();
  await expect(adminCard.getByLabel('Commentaire de revue')).toBeVisible();
  await ac.close();

  // Chantiers: filters live in the URL and survive the round trip through a dossier.
  await reviewer.goto('/app/dao/projects');
  await reviewer.getByLabel('État du chantier').selectOption('dao_review');
  await reviewer.getByLabel('Mes revues').check();
  await reviewer.getByLabel('Rechercher un chantier').fill(project.title);
  await expect(reviewer).toHaveURL(/status=dao_review/);
  await expect(reviewer).toHaveURL(/mine=true/);
  await expect(reviewer).toHaveURL(/q=/);
  await reviewer.getByRole('link').filter({ has: reviewer.getByRole('heading', { name: project.title, exact: true }) }).click();
  await reviewer.getByRole('navigation', { name: 'Fil d’Ariane' }).getByRole('link', { name: 'Chantiers', exact: true }).click();
  await expect(reviewer.getByLabel('État du chantier')).toHaveValue('dao_review');
  await expect(reviewer.getByLabel('Mes revues')).toBeChecked();
  await expect(reviewer.getByLabel('Rechercher un chantier')).toHaveValue(project.title);
  await expect(reviewer.getByRole('heading', { name: project.title, exact: true })).toBeVisible();
  await noHorizontalScroll(reviewer);

  // Close the loop: confirmed correction request from the detail page.
  await reviewer.goto(`/app/dao/projects/${project.projectId}`);
  await reviewer.getByLabel('Commentaire de revue').fill('Précisez la puissance du tableau électrique.');
  await reviewer.getByRole('button', { name: 'Refuser', exact: true }).click();
  await reviewer.getByRole('button', { name: 'Confirmer la demande de corrections' }).click();
  await expect(reviewer.getByRole('status')).toContainText('Corrections demandées au client.');
  await expect(reviewer.getByLabel('Commentaire de revue')).toHaveCount(0);
  await rc.close();
});
