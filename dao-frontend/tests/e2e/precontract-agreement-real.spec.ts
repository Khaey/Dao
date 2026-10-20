import { test, expect } from './support/fixtures';
import { createProjectWithMainLot, login } from './support/flow';
import { actorCommand, adminRows } from './support/collaboration';
import { recordE2EValue } from './support/state';

// Bounded actions: a stuck step fails with its own locator instead of a bare test timeout.
test.use({ actionTimeout: 20_000, navigationTimeout: 30_000 });

// #346 B1 against the REAL backend delivered in #345/#348, through the actual product journey
// (publish → bid → award), with no manual membership insertion.
test('Accord avant contrat #346 réel : Client propose sur le vrai award, concurrent refusé', async ({ page, browser, e2eClient, e2eReviewer, e2eArtisan, e2eSecondArtisan }, info) => {
  test.skip(!e2eClient || !e2eReviewer || !e2eArtisan || !e2eSecondArtisan, 'E2E Supabase credentials are not available');
  test.setTimeout(240_000);
  const lotTitle = `Lot accord réel ${info.project.name}`;
  await login(page, e2eClient!);
  const project = await createProjectWithMainLot(page, info, 'precontract-real', 'Pose de menuiseries intérieures.', lotTitle);
  await page.goto(`/app/projects/${project.projectId}/review`);
  await page.getByRole('button', { name: 'Soumettre pour revue DAO' }).click();

  const rc = await browser.newContext(), reviewer = await rc.newPage();
  await login(reviewer, e2eReviewer!); await reviewer.goto('/app/dao/review');
  const card = reviewer.getByRole('heading', { name: project.title, exact: true }).locator('xpath=../../..');
  await card.getByRole('button', { name: 'Passer en revue DAO' }).click();
  await expect(card.getByText('Revue DAO', { exact: true })).toBeVisible();
  await card.getByRole('button', { name: 'Approuver' }).click();
  await expect(reviewer.getByRole('heading', { name: project.title, exact: true })).toHaveCount(0);
  await reviewer.goto(`/app/dao/publications/new?project_id=${project.projectId}`);
  await expect(reviewer.getByRole('button', { name: 'Publier le DAO' })).toBeEnabled();
  await reviewer.getByRole('button', { name: 'Publier le DAO' }).click();
  await expect(reviewer).toHaveURL(/\/app\/publications\/[^/]+/);
  const publicationId = reviewer.url().split('/').pop()!;
  recordE2EValue(info, 'publications', publicationId); await rc.close();

  const ac = await browser.newContext(), artisan = await ac.newPage();
  await login(artisan, e2eArtisan!); await artisan.goto(`/app/artisan/publications/${publicationId}`);
  const line = artisan.locator('div.rounded-xl').filter({ has: artisan.getByRole('heading', { name: lotTitle, exact: true }) }).filter({ has: artisan.getByLabel('Prix proposé (TND)') });
  await line.getByLabel('Prix proposé (TND)').fill('1500');
  await line.getByLabel('Délai (jours)').fill('12');
  await line.getByLabel('Proposition technique / inclusions').fill('Fourniture et pose');
  await artisan.getByRole('button', { name: 'Soumettre l’offre' }).click();
  await expect(artisan.getByRole('heading', { name: 'Offre envoyée' })).toBeVisible();

  await page.goto(`/app/publications/${publicationId}`);
  const comparison = page.getByRole('heading', { name: 'Comparer et attribuer les offres' }).locator('..');
  const lot = comparison.getByRole('heading', { name: lotTitle, exact: true }).locator('xpath=../..');
  await lot.getByRole('button', { name: 'Attribuer cette offre' }).click();
  await lot.getByRole('button', { name: 'Confirmer l’attribution' }).click();
  await expect(comparison.getByText('Lot attribué', { exact: true })).toBeVisible();
  const [award] = await adminRows('award_items', `project_id=eq.${project.projectId}&active=eq.true&select=award_id`);
  expect(award?.award_id).toBeTruthy();

  // Client: the entry appears on the awarded lot once the real service answers, and leads to the exact award.
  await lot.getByRole('link', { name: 'Conditions et calendrier' }).click();
  await expect(page).toHaveURL(`/app/awards/${award.award_id}/conditions`);
  await expect(page.getByRole('heading', { name: 'Conditions et calendrier' })).toBeVisible();
  await expect(page.getByText(lotTitle, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Proposer des conditions' }).click();
  await page.getByLabel('Date de début souhaitée').fill('2026-11-16');
  await page.getByLabel('Durée des travaux (jours)').fill('12');
  await page.getByLabel('Modalité de paiement de référence').selectOption('lot_end');
  await page.getByRole('button', { name: 'Relire avant envoi' }).click();
  await page.getByRole('button', { name: 'Envoyer à l’Artisan' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Proposition envoyée à l’Artisan' })).toBeVisible();
  await expect(page.getByText('Confirmez votre accord sur votre proposition', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Accepter la version 1' }).click();
  await page.getByRole('button', { name: 'Confirmer mon accord' }).click();
  await expect(page.getByText('En attente de l’accord de l’Artisan', { exact: true })).toBeVisible();
  // Server truth: one version, one Client acceptance, nothing signed and the award untouched.
  const [agreement] = await adminRows('precontract_agreements', `award_id=eq.${award.award_id}&select=id,status`);
  expect(agreement.status).toBe('negotiating');
  expect(await adminRows('precontract_agreement_acceptances', `agreement_id=eq.${agreement.id}&select=party_role`)).toEqual([{ party_role: 'client' }]);
  expect(await adminRows('contracts', `project_id=eq.${project.projectId}&select=id`)).toHaveLength(0);

  // Competitor: refused, conditions never shown.
  const cc = await browser.newContext(), competitor = await cc.newPage();
  await login(competitor, e2eSecondArtisan!);
  const forged = await actorCommand(competitor, e2eSecondArtisan!, '/api/contracts/agreements', { action: 'accept', agreement_id: agreement.id, version_id: (await adminRows('precontract_agreement_versions', `agreement_id=eq.${agreement.id}&select=id`))[0].id, idempotency_key: crypto.randomUUID() });
  expect(forged.status()).toBe(403);
  await competitor.goto(`/app/awards/${award.award_id}/conditions`);
  await expect(competitor.getByRole('alert').filter({ hasText: 'Seuls le Client et l’Artisan attributaire' })).toBeVisible();
  await expect(competitor.getByText('Pose de menuiseries intérieures.')).toHaveCount(0);
  await cc.close();

  // Awarded Artisan: access depends on the server rule under discussion in #345 (accepted project membership,
  // which a marketplace award does not create). Record what the server actually does; never work around it.
  await artisan.goto(`/app/awards/${award.award_id}/conditions`);
  const granted = artisan.getByText('Vous êtes l’Artisan attributaire', { exact: false });
  const refused = artisan.getByRole('alert').filter({ hasText: 'Seuls le Client et l’Artisan attributaire' });
  await expect(granted.or(refused)).toBeVisible();
  const outcome = await granted.isVisible() ? 'granted' : 'refused';
  info.annotations.push({ type: 'precontract-awarded-artisan', description: outcome === 'granted' ? 'Accès accordé à l’Artisan attributaire' : 'Accès refusé à l’Artisan attributaire sans appartenance au chantier — décision attendue dans #345' });
  if (outcome === 'granted') {
    await expect(artisan.getByText('Client vous propose la version 1', { exact: true })).toBeVisible();
    await artisan.getByRole('button', { name: 'Accepter la version 1' }).click();
    await artisan.getByRole('button', { name: 'Confirmer mon accord' }).click();
    await expect(artisan.getByRole('heading', { name: 'Le Client et l’Artisan ont accepté la version 1' })).toBeVisible();
    expect((await adminRows('precontract_agreements', `id=eq.${agreement.id}&select=status`))[0].status).toBe('agreed');
  }
  await ac.close();
});
