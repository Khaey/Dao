import { randomBytes } from 'node:crypto';
import { test as base, expect } from '@playwright/test';
import type { WorkerInfo } from '@playwright/test';
import { recordE2EValue } from './state';

export interface E2EUser {
  id: string;
  email: string;
  password: string;
}

type Role = 'client' | 'dao_reviewer' | 'contractor';
type WorkerFixtures = {
  e2eClient: E2EUser | null;
  e2eReviewer: E2EUser | null;
  e2eArtisan: E2EUser | null;
};

function config() {
  return {
    url: process.env.DAO_SUPABASE_URL,
    secret: process.env.DAO_SUPABASE_SECRET_KEY,
  };
}

async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { url, secret } = config();
  if (!url || !secret) throw new Error('E2E Supabase provisioning configuration is missing');
  const response = await fetch(url + path, {
    ...options,
    headers: {
      apikey: secret,
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) {
    const detail = body.replaceAll(secret, '[redacted]').slice(0, 1000);
    throw new Error(`E2E provisioning request failed ${options.method || 'GET'} ${path} (${response.status}): ${detail}`);
  }
  return (body ? JSON.parse(body) : null) as T;
}

function emailRole(role: Role) {
  if (role === 'dao_reviewer') return 'reviewer';
  if (role === 'contractor') return 'artisan';
  return 'client';
}

async function createUser(worker: WorkerInfo, role: Role): Promise<E2EUser | null> {
  const { url, secret } = config();
  if (!url || !secret) return null;

  const run = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
  const attempt = process.env.GITHUB_RUN_ATTEMPT || '1';
  const workerKey = `${run}-${attempt}-${worker.project.name}-${worker.workerIndex}-${randomBytes(4).toString('hex')}`;
  const email = `dao-e2e-${emailRole(role)}-${workerKey}@logiclab.invalid`;
  const password = `E2e-${randomBytes(18).toString('base64url')}-A9!`;
  const user = await api<{ id: string }>('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  recordE2EValue(worker, 'users', user.id);

  await api('/rest/v1/user_roles', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{ user_id: user.id, role }]),
  });

  if (role === 'contractor') {
    const trades = await api<Array<{ id: string }>>('/rest/v1/trades?active=eq.true&select=id&order=code&limit=1');
    const tradeId = trades[0]?.id;
    if (!tradeId) throw new Error('No active trade available for E2E artisan');

    const profiles = await api<Array<{ id: string }>>('/rest/v1/contractor_profiles', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{
        user_id: user.id,
        business_name: `Artisan E2E ${workerKey}`,
        verification_status: 'verified',
        contractor_type: 'artisan',
        public_presentation: 'Profil temporaire pour validation E2E',
        years_experience: 5,
        availability: 'available',
        public_trade_name: `Artisan E2E ${workerKey}`,
        public_identity_status: 'approved',
      }]),
    });
    const profile = profiles[0];
    if (!profile?.id) throw new Error('Unable to create E2E contractor profile');
    recordE2EValue(worker, 'contractorProfiles', profile.id);
    await api('/rest/v1/contractor_trades', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([{ contractor_id: profile.id, trade_id: tradeId }]),
    });
  }

  return { id: user.id, email, password };
}

export const test = base.extend<{}, WorkerFixtures>({
  e2eClient: [async ({}, use, worker) => use(await createUser(worker, 'client')), { scope: 'worker' }],
  e2eReviewer: [async ({}, use, worker) => use(await createUser(worker, 'dao_reviewer')), { scope: 'worker' }],
  e2eArtisan: [async ({}, use, worker) => use(await createUser(worker, 'contractor')), { scope: 'worker' }],
});

export { expect };
