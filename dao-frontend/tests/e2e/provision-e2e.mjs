import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const url = process.env.DAO_SUPABASE_URL;
const secret = process.env.DAO_SUPABASE_SECRET_KEY;
const runId = process.env.GITHUB_RUN_ID || String(Date.now());
const runAttempt = process.env.GITHUB_RUN_ATTEMPT || '1';
const runKey = `${runId}-${runAttempt}`;
const stateFile = process.env.DAO_E2E_STATE_FILE || '/tmp/dao-e2e-state.json';
if (!url || !secret) throw new Error('E2E provisioning configuration is missing');

const headers = {
  apikey: secret,
  Authorization: `Bearer ${secret}`,
  'Content-Type': 'application/json',
};

async function api(path, options = {}) {
  const response = await fetch(url + path, {
    ...options,
    headers: { ...headers, ...(options.headers || {}) },
  });
  const body = await response.text();
  if (!response.ok) {
    const detail = body.replaceAll(secret, '[redacted]').slice(0, 1000);
    throw new Error(`E2E provisioning request failed ${path} (${response.status}): ${detail}`);
  }
  return body ? JSON.parse(body) : null;
}

function password() {
  return `E2e-${randomBytes(18).toString('base64url')}-A9!`;
}

function saveState(state) {
  writeFileSync(stateFile, JSON.stringify(state), 'utf8');
  chmodSync(stateFile, 0o600);
}

const state = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, 'utf8'))
  : { users: [], projects: [], publications: [], contractorProfiles: [] };

async function create(email, role) {
  const pwd = password();
  const user = await api('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password: pwd, email_confirm: true }),
  });

  state.users.push({ id: user.id });
  saveState(state);

  await api('/rest/v1/user_roles', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{ user_id: user.id, role }]),
  });

  process.stdout.write(`::add-mask::${pwd}\n::add-mask::${email}\n`);
  if (process.env.GITHUB_ENV) appendFileSync(
    process.env.GITHUB_ENV,
    `PLAYWRIGHT_${role === 'client' ? 'CLIENT' : 'REVIEWER'}_EMAIL=${email}\nPLAYWRIGHT_${role === 'client' ? 'CLIENT' : 'REVIEWER'}_PASSWORD=${pwd}\n`,
  );
}

async function createArtisan(email) {
  const pwd = password();
  const user = await api('/auth/v1/admin/users', {
    method: 'POST',
    body: JSON.stringify({ email, password: pwd, email_confirm: true }),
  });
  state.users.push({ id: user.id });
  saveState(state);
  await api('/rest/v1/user_roles', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{ user_id: user.id, role: 'contractor' }]),
  });
  const trades = await api('/rest/v1/trades?active=eq.true&select=id&order=code&limit=1');
  if (!trades?.[0]?.id) throw new Error('No active trade available for E2E artisan');
  const profiles = await api('/rest/v1/contractor_profiles', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{
      user_id: user.id,
      business_name: `Artisan E2E ${runKey}`,
      verification_status: 'verified',
      contractor_type: 'artisan',
      public_presentation: 'Profil temporaire pour validation E2E',
      years_experience: 5,
      availability: 'available',
      public_trade_name: `Artisan E2E ${runKey}`,
      public_identity_status: 'approved',
    }]),
  });
  const profile = profiles?.[0];
  if (!profile?.id) throw new Error('Unable to create E2E contractor profile');
  state.contractorProfiles.push({ id: profile.id });
  saveState(state);
  await api('/rest/v1/contractor_trades', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify([{ contractor_id: profile.id, trade_id: trades[0].id }]),
  });
  process.stdout.write(`::add-mask::${pwd}\n::add-mask::${email}\n`);
  if (process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `PLAYWRIGHT_ARTISAN_EMAIL=${email}\nPLAYWRIGHT_ARTISAN_PASSWORD=${pwd}\n`);
}

await create(`dao-e2e-client-${runKey}@logiclab.invalid`, 'client');
await create(`dao-e2e-reviewer-${runKey}@logiclab.invalid`, 'dao_reviewer');
await createArtisan(`dao-e2e-artisan-${runKey}@logiclab.invalid`);
