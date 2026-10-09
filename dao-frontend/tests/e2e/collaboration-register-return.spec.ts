import { randomUUID } from 'node:crypto';
import { test, expect } from './support/fixtures';
import { login } from './support/flow';
import { adminRows, createCollaborative, signOut } from './support/collaboration';
import { recordE2EValue } from './support/state';

for (const accountType of ['client', 'contractor'] as const) {
  test(`Invitation et inscription ${accountType} : identité préremplie, rôle imposé et retour au chantier`, async ({ page, e2eClient, e2eArtisan }, info) => {
    test.skip(!e2eClient || !e2eArtisan, 'Disposable E2E credentials are not available');
    const suffix = randomUUID();
    const invitedEmail = `dao-invite-${accountType}-${suffix}@logiclab.invalid`;
    await login(page, accountType === 'client' ? e2eArtisan! : e2eClient!);
    const project = await createCollaborative(page, info, accountType === 'client', invitedEmail);
    await signOut(page);
    await page.goto(project.link);
    await page.getByRole('link', { name: 'Créer un compte', exact: true }).click();

    const create = page.getByRole('button', { name: 'Créer mon compte' });
    const name = page.getByPlaceholder('Nom complet');
    const email = page.getByPlaceholder('Email', { exact: true });
    await expect(page.getByLabel('Type de compte défini par l’invitation')).toContainText(accountType === 'client' ? 'Client' : 'Artisan / Entreprise');
    await expect(page.getByRole('radio')).toHaveCount(0);
    await expect(name).toHaveValue(project.recipientName);
    await expect(email).toHaveValue(invitedEmail);
    await expect(email).toHaveAttribute('readonly', '');
    await expect(page.getByPlaceholder('Téléphone tunisien (optionnel)')).toHaveCount(0);
    await expect(page.getByPlaceholder('Nom de l’activité / entreprise')).toHaveCount(0);
    await expect(create).toBeDisabled();

    const finalName = `${project.recipientName} modifié`;
    await name.fill(finalName);
    await page.getByPlaceholder('Mot de passe', { exact: true }).fill(`D!ao-${randomUUID()}-A9`);
    await expect(create).toBeEnabled();

    const initialized = page.waitForResponse(response => response.url().endsWith('/api/profile') && response.request().method() === 'POST');
    await create.click();
    await expect(page).toHaveURL(/\/invite\/[a-f0-9]{64}$/);
    const profile = await (await initialized).json();
    const userId = profile.data?.user_id;
    expect(Boolean(userId)).toBeTruthy();
    recordE2EValue(info, 'users', userId);
    expect((await adminRows('user_roles', `user_id=eq.${userId}&select=role`)).map(row => row.role)).toEqual([accountType]);
    if (accountType === 'contractor') {
      const contractors = await adminRows('contractor_profiles', `user_id=eq.${userId}&select=id,business_name,verification_status`);
      expect(contractors).toHaveLength(1);
      expect(contractors[0].verification_status).toBe('pending');
      expect(contractors[0].business_name).toBe(finalName);
      recordE2EValue(info, 'contractorProfiles', contractors[0].id);
    }
    await page.getByRole('button', { name: 'Confirmer et rejoindre le chantier' }).click();
    await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { name: project.title })).toBeVisible();
  });
}

test('Auth : une URL externe ne peut pas remplacer le retour d’invitation', async ({ page, e2eClient }) => {
  test.skip(!e2eClient, 'Disposable E2E credentials are not available');
  await page.goto('/auth/login?returnTo=https%3A%2F%2Fexample.invalid');
  await page.getByPlaceholder('Votre email').fill(e2eClient!.email);
  await page.getByPlaceholder('Mot de passe').fill(e2eClient!.password);
  await page.getByRole('button', { name: 'Se connecter', exact: true }).click();
  await expect(page).toHaveURL(/\/app$/);
});
