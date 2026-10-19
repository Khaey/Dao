import type { Page } from '@playwright/test';
import { test, expect } from './support/fixtures';
import { login } from './support/flow';

// #307 — publication transparency, rendered from synthetic dossiers served by an in-test mock of GET /api/professionals.
// Server publication rules are covered by professional-profile.spec.ts against the real backend; this spec checks
// what each audience is told for every state (pending, approved, refused with reason, withdrawn, error, loading).
const sha = 'a'.repeat(64);
const at = (minute: number) => `2026-10-19T08:${String(minute).padStart(2, '0')}:00.000Z`;
const file = (id: string, extra: Record<string, unknown>) => ({ id, original_name: `${id}.png`, mime_type: 'image/png', revision: 1, content_sha256: sha, public_consent: true, created_at: at(1), ...extra });

function ownerDossier() {
  return {
    profile: { id: 'cp-demo', business_name: 'Atelier Démo', public_trade_name: 'Atelier Démo', verification_status: 'verified', public_identity_status: 'approved', public_presentation: 'Menuiserie de démonstration.' },
    details: { review_status: 'approved', revision: 2 },
    areas: [],
    files: [
      file('logo-actuel', { purpose: 'logo', status: 'approved', created_at: at(5) }),
      file('logo-flou', { purpose: 'logo', status: 'rejected', review_reason: 'Logo illisible', created_at: at(9) }),
    ],
    portfolio: [
      { id: 'p-cuisine', title: 'Cuisine Démo', status: 'published', publication_consent: true, revision: 3, assets: [
        file('cuisine-visible', { status: 'approved' }), file('cuisine-visible-2', { status: 'approved' }),
        file('cuisine-attente', { status: 'ready' }), file('cuisine-refus', { status: 'rejected', review_reason: 'Visage reconnaissable' }),
        file('cuisine-retire', { status: 'withdrawn', public_consent: false }),
      ] },
      { id: 'p-bain', title: 'Salle de bain Démo', status: 'hidden', publication_consent: false, review_reason: 'Adresse lisible sur la photo', revision: 2, assets: [] },
      { id: 'p-terrasse', title: 'Terrasse Démo', status: 'draft', publication_consent: true, revision: 1, assets: [] },
    ],
  };
}

function staffDossier() {
  const dossier = ownerDossier();
  return {
    ...dossier, admin: true,
    details: { review_status: 'pending_review', revision: 2 },
    files: [...dossier.files, file('kbis', { purpose: 'registration', status: 'ready', public_consent: false, mime_type: 'application/pdf', original_name: 'kbis.pdf' })],
    portfolio: [
      { ...dossier.portfolio[0] },
      { id: 'p-terrasse', title: 'Terrasse Démo', status: 'pending_review', publication_consent: true, revision: 1, assets: [file('terrasse-sans-accord', { status: 'ready', public_consent: false })] },
    ],
  };
}

async function serve(page: Page, payload: () => unknown, options: { status?: number; delay?: Promise<void> } = {}) {
  await page.unroute((url) => url.pathname === '/api/professionals');
  await page.route((url) => url.pathname === '/api/professionals', async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Action non autorisée.' }) });
    if (options.delay) await options.delay;
    const status = options.status ?? 200;
    return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { data: payload() } : { error: 'Dossier momentanément indisponible.' }) });
  });
}

const noHorizontalScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);

test('PRO #307 : visibilité client lisible pour le professionnel, le staff et le client', async ({ page, browser, e2eArtisan, e2eAdmin, e2eClient }, info) => {
  test.skip(!e2eArtisan || !e2eAdmin || !e2eClient, 'E2E Supabase credentials are not available');
  const desktop = info.project.name !== 'mobile';
  if (desktop) await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, e2eArtisan!);

  // Loading then error: honest states, never an empty dossier.
  let release!: () => void;
  await serve(page, ownerDossier, { delay: new Promise<void>((resolve) => { release = resolve; }) });
  await page.goto('/app/artisan/profile');
  await expect(page.getByRole('status').filter({ hasText: 'Chargement du dossier professionnel…' })).toBeVisible();
  release();
  await expect(page.getByRole('heading', { name: 'Ce que voient les clients' })).toBeVisible();
  await serve(page, ownerDossier, { status: 503 });
  await page.reload();
  await expect(page.getByRole('alert').filter({ hasText: 'Dossier momentanément indisponible.' })).toBeVisible();

  // Owner overview: what is public today, and the next actions with a keyboard-reachable shortcut.
  await serve(page, ownerDossier);
  await page.reload();
  const overview = page.getByRole('region', { name: 'Ce que voient les clients' });
  await expect(overview.getByText('Publiée', { exact: true })).toBeVisible();
  await expect(overview.getByText('Affiché', { exact: true })).toBeVisible();
  await expect(overview.getByText('1 sur 3 visible', { exact: true })).toBeVisible();
  await expect(overview.getByText('2 sur 4 visibles', { exact: true })).toBeVisible();
  await expect(overview.getByText(/Envoyer un fichier ne le publie pas/)).toBeVisible();
  await expect(overview.getByText(/« Salle de bain Démo » : Modifiez-la puis soumettez-la de nouveau\./)).toBeVisible();
  await page.screenshot({ path: info.outputPath('publication-overview.png'), fullPage: true });

  // Logo: the displayed one and the refused one (with its reason) are told apart.
  await expect(page.getByText(/Pour les clients — visible · Visible par les clients/).first()).toBeVisible();
  await expect(page.getByText(/Refusé par D\.A\.O\./).first()).toBeVisible();
  await expect(page.getByText(/Motif : Logo illisible/)).toBeVisible();

  const open = overview.getByRole('listitem').filter({ hasText: 'Salle de bain Démo' }).getByRole('button', { name: /Ouvrir/ });
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /réalisation/i }).first()).toBeVisible();
  await expect(page.getByText(/Refusée par D\.A\.O\./)).toBeVisible();
  await expect(page.getByText(/Motif : Adresse lisible sur la photo/)).toBeVisible();
  await expect(page.getByText(/Motif : Visage reconnaissable/)).toBeVisible();
  await expect(page.getByText(/Retiré par vous/)).toBeVisible();
  await expect(page.getByText(/En contrôle par D\.A\.O\./).first()).toBeVisible();
  await expect(page.getByText(/Brouillon non soumis/)).toBeVisible();
  await noHorizontalScroll(page);
  if (!desktop) { await page.setViewportSize({ width: 375, height: 812 }); await noHorizontalScroll(page); }

  // Staff: a scannable to-do, distinct media/fiche controls, and the client effect of each decision.
  const staffContext = await browser.newContext({ viewport: desktop ? { width: 1440, height: 900 } : { width: 390, height: 844 } });
  const staff = await staffContext.newPage();
  await login(staff, e2eAdmin!);
  await serve(staff, staffDossier);
  await staff.goto('/app/dao/professionals/cp-demo/dossier');
  await expect(staff.getByRole('heading', { name: 'À examiner' })).toBeVisible();
  for (const label of ['Fiche client à publier ou à corriger', 'Pièce à examiner : kbis.pdf', 'Réalisation à décider : Terrasse Démo', 'Média à décider : cuisine-attente.png (Cuisine Démo)'])
    await expect(staff.getByRole('button', { name: label })).toBeVisible();
  await expect(staff.getByRole('heading', { name: 'Contrôle de la fiche' })).toBeVisible();
  await expect(staff.getByRole('heading', { name: 'Contrôle des médias — logo' })).toBeVisible();
  await expect(staff.getByRole('heading', { name: 'Pièces de vérification — privées' })).toBeVisible();
  await expect(staff.getByText(/Visibilité Client :/)).toBeVisible();
  await expect(staff.getByText('Pièce privée — jamais publiée')).toBeVisible();
  await expect(staff.getByText(/Côté client — non visible · Sans autorisation de publication/)).toBeVisible();
  await expect(staff.getByRole('button', { name: 'Approuver terrasse-sans-accord.png', exact: true })).toBeDisabled();
  await staff.getByRole('button', { name: 'Réalisation à décider : Terrasse Démo' }).click();
  await expect(staff.locator('#realisation-p-terrasse')).toBeInViewport();
  await expect(staff.getByRole('button', { name: 'Refuser Terrasse Démo', exact: true })).toBeDisabled();
  await expect(staff.getByText(/Pour refuser, indiquez d’abord un motif/).first()).toBeVisible();
  await noHorizontalScroll(staff);
  await staff.screenshot({ path: info.outputPath('publication-staff.png'), fullPage: true });
  await staffContext.close();

  // Client: published project without public media gets an elegant empty state, never an internal status.
  const clientContext = await browser.newContext({ viewport: desktop ? { width: 1440, height: 900 } : { width: 375, height: 812 } });
  const client = await clientContext.newPage();
  await login(client, e2eClient!);
  await serve(client, () => ({ id: 'cp-demo', name: 'Atelier Démo', verification_status: 'verified', presentation: 'Menuiserie de démonstration.', trades: [], areas: [], portfolio: [{ id: 'p-cuisine', title: 'Cuisine Démo', assets: [] }] }));
  await client.goto('/app/professionals/cp-demo');
  await expect(client.getByRole('heading', { name: 'Cuisine Démo' })).toBeVisible();
  await expect(client.getByText('Pas encore de photo publiée pour cette réalisation.')).toBeVisible();
  for (const internal of [/En revue/, /Brouillon/, /Refusé/, /En contrôle/, /Masqué/]) await expect(client.getByText(internal)).toHaveCount(0);
  await noHorizontalScroll(client);
  await clientContext.close();
});
