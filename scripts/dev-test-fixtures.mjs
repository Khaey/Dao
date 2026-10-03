#!/usr/bin/env node

const EXPECTED = Object.freeze({
  client: 'ahmedhattab.pro+dao-client@gmail.com',
  contractor: 'ahmedhattab.pro+dao-contractor@gmail.com',
});

function fail(message) { throw new Error(message); }

function env(name) {
  const value = process.env[name];
  if (!value) fail(`Missing protected fixture configuration: ${name}`);
  return value;
}

function targetGuard() {
  if (process.env.DAO_FIXTURE_TARGET !== 'dev') fail('Fixture operation refused: DAO_FIXTURE_TARGET must be dev');
  const url = env('DAO_SUPABASE_URL').replace(/\/$/, '');
  if (!/^https:\/\//i.test(url) || /127\.0\.0\.1|localhost/i.test(url)) {
    fail('Fixture operation refused: target is not the protected DEV Supabase project');
  }
  return url;
}

function protectedConfig({ passwords = false } = {}) {
  const config = {
    url: targetGuard(),
    publishable: env('DAO_SUPABASE_PUBLISHABLE_KEY'),
    secret: env('DAO_SUPABASE_SECRET_KEY'),
    clientEmail: env('DAO_TEST_CLIENT_EMAIL').trim().toLowerCase(),
    contractorEmail: env('DAO_TEST_CONTRACTOR_EMAIL').trim().toLowerCase(),
  };
  if (config.clientEmail !== EXPECTED.client || config.contractorEmail !== EXPECTED.contractor) {
    fail('Fixture operation refused: TEST aliases do not match the approved DEV mailbox aliases');
  }
  if (passwords) {
    config.clientPassword = env('DAO_TEST_CLIENT_PASSWORD');
    config.contractorPassword = env('DAO_TEST_CONTRACTOR_PASSWORD');
  }
  return config;
}

function headers(config, mode = 'service') {
  const token = mode === 'service' ? config.secret : config.publishable;
  return { apikey: token, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

async function request(config, path, options = {}, mode = 'service') {
  const response = await fetch(`${config.url}${path}`, {
    ...options,
    headers: { ...headers(config, mode), ...(options.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try { body = JSON.parse(text); } catch { body = null; }
  }
  if (!response.ok) fail(`Protected DEV fixture request failed: ${options.method || 'GET'} ${path} (${response.status})`);
  return body;
}

function jsonBody(body) { return { body: JSON.stringify(body) }; }

async function listAuthUsers(config) {
  const body = await request(config, '/auth/v1/admin/users?page=1&per_page=1000');
  if (!body || !Array.isArray(body.users)) fail('Protected DEV Auth response was not a user list');
  return body.users;
}

function singleByEmail(users, email) {
  const matches = users.filter(user => String(user.email || '').toLowerCase() === email);
  if (matches.length > 1) fail('Protected DEV Auth contains duplicate TEST email identities');
  return matches[0] || null;
}

async function ensureAuthUser(config, email, password) {
  const existing = singleByEmail(await listAuthUsers(config), email);
  if (existing?.id) {
    await request(config, `/auth/v1/admin/users/${encodeURIComponent(existing.id)}`, {
      method: 'PUT', ...jsonBody({ email, password, email_confirm: true }),
    });
    return { id: existing.id, created: false };
  }
  const created = await request(config, '/auth/v1/admin/users', {
    method: 'POST', ...jsonBody({ email, password, email_confirm: true }),
  });
  const user = created?.user || created;
  if (!user?.id) fail('Protected DEV Auth did not return the TEST user id');
  return { id: user.id, created: true };
}

async function rows(config, table, query) {
  const result = await request(config, `/rest/v1/${table}?${query}`);
  if (!Array.isArray(result)) fail(`Protected DEV fixture response for ${table} was not a list`);
  return result;
}

async function ensureRole(config, userId, expectedRole) {
  const existing = await rows(config, 'user_roles', `user_id=eq.${encodeURIComponent(userId)}&select=role`);
  if (existing.some(row => row.role !== expectedRole)) fail(`TEST user has an unexpected role; refusing to alter it (${expectedRole})`);
  if (!existing.some(row => row.role === expectedRole)) {
    await request(config, '/rest/v1/user_roles', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      ...jsonBody([{ user_id: userId, role: expectedRole }]),
    });
  }
}

async function ensureProfile(config, userId, email, displayName) {
  const profiles = await rows(config, 'profiles', `user_id=eq.${encodeURIComponent(userId)}&select=user_id`);
  if (!profiles.length) {
    await request(config, '/rest/v1/profiles', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      ...jsonBody([{ user_id: userId, display_name: displayName }]),
    });
  }
  const contacts = await rows(config, 'profile_contacts', `user_id=eq.${encodeURIComponent(userId)}&select=user_id`);
  if (!contacts.length) {
    await request(config, '/rest/v1/profile_contacts', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      ...jsonBody([{ user_id: userId, contact_email: email }]),
    });
  }
}

async function ensureContractorProfile(config, userId) {
  const profiles = await rows(config, 'contractor_profiles', `user_id=eq.${encodeURIComponent(userId)}&select=id`);
  if (!profiles.length) {
    await request(config, '/rest/v1/contractor_profiles', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      ...jsonBody([{
        user_id: userId, business_name: 'TEST DEV Contractor', verification_status: 'pending',
        public_presentation: 'Profil réservé aux validations DEV.', public_identity_status: 'draft',
      }]),
    });
    return;
  }
  if (profiles.length !== 1) fail('TEST contractor has duplicate contractor profiles');
  await request(config, `/rest/v1/contractor_profiles?user_id=eq.${encodeURIComponent(userId)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    ...jsonBody({ verification_status: 'pending', public_identity_status: 'draft' }),
  });
}

async function resolveUsers(config) {
  const users = await listAuthUsers(config);
  const client = singleByEmail(users, config.clientEmail);
  const contractor = singleByEmail(users, config.contractorEmail);
  if (!client?.id || !contractor?.id) fail('Permanent TEST Auth accounts are not provisioned');
  return { client: client.id, contractor: contractor.id };
}

async function provision() {
  const config = protectedConfig({ passwords: true });
  const client = await ensureAuthUser(config, config.clientEmail, config.clientPassword);
  const contractor = await ensureAuthUser(config, config.contractorEmail, config.contractorPassword);
  await ensureRole(config, client.id, 'client');
  await ensureRole(config, contractor.id, 'contractor');
  await ensureProfile(config, client.id, config.clientEmail, 'TEST DEV Client');
  await ensureProfile(config, contractor.id, config.contractorEmail, 'TEST DEV Contractor');
  await ensureContractorProfile(config, contractor.id);
  console.log(`FIXTURE_PROVISION client=PASS contractor=PASS client_id=${client.id} contractor_id=${contractor.id}`);
}

async function signIn(config, email, password, expectedId) {
  const session = await request(config, '/auth/v1/token?grant_type=password', {
    method: 'POST', ...jsonBody({ email, password }),
  }, 'publishable');
  if (!session?.access_token) fail('TEST login did not return an access token');
  const response = await fetch(`${config.url}/auth/v1/user`, {
    headers: { apikey: config.publishable, Authorization: `Bearer ${session.access_token}` },
  });
  if (!response.ok) fail('TEST login session could not be verified');
  const user = await response.json();
  if (user?.id !== expectedId || String(user.email || '').toLowerCase() !== email) fail('TEST login returned an unexpected Auth identity');
}

async function verify() {
  const config = protectedConfig({ passwords: true });
  const ids = await resolveUsers(config);
  await signIn(config, config.clientEmail, config.clientPassword, ids.client);
  await signIn(config, config.contractorEmail, config.contractorPassword, ids.contractor);
  const roleRows = await rows(config, 'user_roles', `user_id=in.(${encodeURIComponent(ids.client)},${encodeURIComponent(ids.contractor)})&select=user_id,role`);
  if (!roleRows.some(row => row.user_id === ids.client && row.role === 'client')) fail('TEST client role is missing');
  if (!roleRows.some(row => row.user_id === ids.contractor && row.role === 'contractor')) fail('TEST contractor role is missing');
  const contractor = await rows(config, 'contractor_profiles', `user_id=eq.${encodeURIComponent(ids.contractor)}&select=verification_status,public_identity_status`);
  if (contractor.length !== 1 || contractor[0].verification_status !== 'pending' || contractor[0].public_identity_status !== 'draft') fail('TEST contractor is not in pending/draft state');
  console.log('FIXTURE_VERIFY login_client=PASS login_contractor=PASS contractor_pending=PASS');
}

async function reset() {
  const config = protectedConfig();
  const ids = await resolveUsers(config);
  const projects = new Map();
  for (const userId of [ids.client, ids.contractor]) {
    const owned = await rows(config, 'projects', `or=(client_id.eq.${encodeURIComponent(userId)},initiator_id.eq.${encodeURIComponent(userId)})&select=id,status`);
    for (const project of owned) projects.set(project.id, project);
  }
  let archived = 0;
  let revoked = 0;
  for (const project of projects.values()) {
    if (project.status !== 'archived') {
      await request(config, `/rest/v1/projects?id=eq.${encodeURIComponent(project.id)}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' }, ...jsonBody({ status: 'archived' }),
      });
      archived += 1;
    }
    const invitations = await rows(config, 'project_invitations', `project_id=eq.${encodeURIComponent(project.id)}&status=eq.pending&select=id,created_by`);
    for (const invitation of invitations) {
      if (![ids.client, ids.contractor].includes(invitation.created_by)) continue;
      await request(config, `/rest/v1/project_invitations?id=eq.${encodeURIComponent(invitation.id)}&status=eq.pending`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        ...jsonBody({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_by: invitation.created_by }),
      });
      revoked += 1;
    }
  }
  console.log(`FIXTURE_RESET owned_projects=${projects.size} archived_projects=${archived} revoked_invitations=${revoked} immutable_history=preserved`);
}

const operation = process.argv[2];
if (!['provision', 'verify', 'reset'].includes(operation)) {
  console.error('Usage: node scripts/dev-test-fixtures.mjs <provision|verify|reset>');
  process.exit(2);
}

try {
  if (operation === 'provision') await provision();
  if (operation === 'verify') await verify();
  if (operation === 'reset') await reset();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Protected DEV fixture operation failed');
  process.exit(1);
}

export { EXPECTED };
