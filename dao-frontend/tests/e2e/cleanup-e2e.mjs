import { existsSync, lstatSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';

const url = process.env.DAO_SUPABASE_URL;
const secret = process.env.DAO_SUPABASE_SECRET_KEY;
const stateDir = process.env.DAO_E2E_STATE_DIR || '/tmp/dao-e2e-state';
const reservedEmail = /^dao-e2e-(?:client|reviewer|artisan)-[a-z0-9-]+@logiclab\.invalid$/i;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const headers = secret ? {
  apikey: secret,
  Authorization: `Bearer ${secret}`,
  'Content-Type': 'application/json',
} : {};
const currentRunId = Number(process.env.GITHUB_RUN_ID);
const currentRunAttempt = Number(process.env.GITHUB_RUN_ATTEMPT || 1);

function isInCleanupWindow(email) {
  if (!reservedEmail.test(email)) return false;
  const match = email.match(/^dao-e2e-(?:client|reviewer|artisan)-(\d+)-(\d+)(?:-|@)/i);
  if (!match || !Number.isSafeInteger(currentRunId) || !Number.isSafeInteger(currentRunAttempt)) return false;
  const runId = Number(match[1]);
  const attempt = Number(match[2]);
  return runId < currentRunId || (runId === currentRunId && attempt <= currentRunAttempt);
}

function isLegacyProjectTitle(title) {
  if (/^DAO E2E (?:DEV|archive) /i.test(title)) return true;
  const match = title.match(/^DAO E2E \S+ (\d+)-(\d+)-/i);
  if (!match || !Number.isSafeInteger(currentRunId) || !Number.isSafeInteger(currentRunAttempt)) return false;
  const runId = Number(match[1]);
  const attempt = Number(match[2]);
  return runId < currentRunId || (runId === currentRunId && attempt <= currentRunAttempt);
}

function dedupe(values) {
  return [...new Set(values)];
}

function stateIds(values = []) {
  const ids = [];
  for (const value of values) {
    const id = typeof value === 'string' ? value : value?.id;
    if (id == null) continue;
    if (typeof id !== 'string' || !uuidPattern.test(id)) throw new Error('E2E state contains a malformed ID');
    ids.push(id);
  }
  return dedupe(ids);
}

function loadWorkerState() {
  if (!existsSync(stateDir)) {
    return {
      files: [],
      temporaryFiles: [],
      state: { users: [], projects: [], publications: [], contractorProfiles: [] },
    };
  }
  const entries = readdirSync(stateDir, { withFileTypes: true });
  const files = entries
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => path.join(stateDir, entry.name));
  const temporaryFiles = entries
    .filter(entry => entry.isFile() && /^[a-f0-9]{24}\.json\.[a-f0-9-]+\.tmp$/i.test(entry.name))
    .map(entry => path.join(stateDir, entry.name));
  if (entries.length !== files.length + temporaryFiles.length) throw new Error('E2E state directory contains an unexpected entry');
  const state = { users: [], projects: [], publications: [], contractorProfiles: [] };
  for (const file of files) {
    if (!lstatSync(file).isFile()) throw new Error('E2E state entries must be regular files');
    const workerState = JSON.parse(readFileSync(file, 'utf8'));
    if (!workerState || typeof workerState !== 'object' || Array.isArray(workerState)) throw new Error('E2E worker state must be a JSON object');
    for (const collection of Object.keys(state)) {
      const entries = workerState[collection] ?? [];
      if (!Array.isArray(entries)) throw new Error(`E2E state collection ${collection} is malformed`);
      state[collection].push(...entries);
    }
  }
  return { files, temporaryFiles, state };
}

function queryIn(column, ids) {
  return `${column}=in.(${ids.join(',')})`;
}

async function awaitIndependent(requests) {
  const results = await Promise.allSettled(requests);
  const failures = results.filter(result => result.status === 'rejected');
  if (failures.length) {
    const detail = failures[0].reason instanceof Error ? failures[0].reason.message : 'unknown cleanup error';
    throw new Error(`${failures.length} independent E2E cleanup request(s) failed: ${detail}`);
  }
}

async function api(endpoint, options = {}) {
  let response;
  try {
    response = await fetch(`${url}${endpoint}`, {
      ...options,
      headers: { ...headers, ...(options.headers || {}) },
    });
  } catch (error) {
    throw new Error(`E2E cleanup network request failed (${options.method || 'GET'} ${endpoint.split('?')[0]}): ${error.message}`);
  }
  const body = await response.text();
  if (!response.ok) {
    const detail = body.replaceAll(secret, '[redacted]').slice(0, 800);
    throw new Error(`E2E cleanup request failed (${options.method || 'GET'} ${endpoint.split('?')[0]}, ${response.status}): ${detail}`);
  }
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    throw new Error(`E2E cleanup received an invalid response (${options.method || 'GET'} ${endpoint.split('?')[0]})`);
  }
}

async function rows(table, filters, select = 'id') {
  if (!filters.length) return [];
  const params = new URLSearchParams();
  for (const filter of filters) {
    const separator = filter.indexOf('=');
    if (separator <= 0) throw new Error(`E2E cleanup received a malformed filter for ${table}`);
    params.append(filter.slice(0, separator), filter.slice(separator + 1));
  }
  params.set('select', select);
  const query = params.toString();
  const data = await api(`/rest/v1/${table}?${query}`);
  if (!Array.isArray(data)) throw new Error(`E2E cleanup expected a row list from ${table}`);
  return data;
}

async function removeRows(table, column, ids) {
  if (!ids.length) return;
  await api(`/rest/v1/${table}?${queryIn(column, ids)}`, {
    method: 'DELETE',
    headers: { Prefer: 'return=representation' },
  });
}

async function removeStorageObject(objectPath) {
  if (!objectPath) return;
  const encodedPath = objectPath.split('/').map(encodeURIComponent).join('/');
  let response;
  try {
    response = await fetch(`${url}/storage/v1/object/dao-private/${encodedPath}`, {
      method: 'DELETE',
      headers,
    });
  } catch (error) {
    throw new Error(`E2E cleanup could not remove a Storage object: ${error.message}`);
  }
  if (response.status === 404) return;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`E2E cleanup could not remove a Storage object (${response.status}): ${body.replaceAll(secret, '[redacted]').slice(0, 800)}`);
  }
}

async function listReservedUsers() {
  const found = [];
  const pageSize = 100;
  for (let page = 1; page <= 1000; page += 1) {
    const response = await api(`/auth/v1/admin/users?page=${page}&per_page=${pageSize}`);
    const users = Array.isArray(response?.users) ? response.users : null;
    if (!users) throw new Error('E2E cleanup could not read Supabase Auth users');
    found.push(...users.filter(user => typeof user.email === 'string' && isInCleanupWindow(user.email)));
    if (users.length < pageSize) return found;
  }
  throw new Error('E2E cleanup reached the Auth user pagination limit');
}

async function deleteAuthUserIfPresent(id) {
  let response;
  try {
    response = await fetch(`${url}/auth/v1/admin/users/${id}`, { headers });
  } catch (error) {
    throw new Error(`E2E cleanup could not inspect a Supabase Auth user: ${error.message}`);
  }
  if (response.status === 404) return;
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`E2E cleanup could not inspect a Supabase Auth user (${response.status}): ${body.replaceAll(secret, '[redacted]').slice(0, 800)}`);
  }
  await deleteListedAuthUser(id);
}

async function deleteListedAuthUser(id) {
  let response;
  try {
    response = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers });
  } catch (error) {
    throw new Error(`E2E cleanup could not delete a Supabase Auth user: ${error.message}`);
  }
  if (response.status === 404) return;
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`E2E cleanup could not delete a Supabase Auth user (${response.status}): ${body.replaceAll(secret, '[redacted]').slice(0, 800)}`);
  }
}

async function assertNoRows(table, column, ids) {
  if (!ids.length) return;
  const remaining = await rows(table, [queryIn(column, ids)]);
  if (remaining.length) throw new Error(`E2E cleanup verification found ${remaining.length} remaining row(s) in ${table}.${column}`);
}

const { files, temporaryFiles, state } = loadWorkerState();
const isMainCleanup = process.env.GITHUB_REF === 'refs/heads/main'
  && ['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME || '');

if (!url || !secret) {
  if (files.length || temporaryFiles.length || isMainCleanup) throw new Error('E2E cleanup requires DAO_SUPABASE_URL and DAO_SUPABASE_SECRET_KEY');
  process.stdout.write('E2E cleanup skipped: no run state and no Supabase configuration.\n');
  process.exit(0);
}

const trackedUsers = stateIds(state.users);
const trackedProjects = stateIds(state.projects);
const trackedPublications = stateIds(state.publications);
const trackedContractorProfiles = stateIds(state.contractorProfiles);
const reservedUsers = isMainCleanup ? await listReservedUsers() : [];
const userIds = dedupe([...trackedUsers, ...stateIds(reservedUsers)]);

const [ownedProjects, profilesForUsers, legacyProjectVersions] = await Promise.all([
  rows('projects', userIds.length ? [queryIn('client_id', userIds)] : []),
  rows('contractor_profiles', userIds.length ? [queryIn('user_id', userIds)] : []),
  rows('project_versions', isMainCleanup ? ['title=ilike.DAO E2E %'] : [], 'project_id,title'),
]);
const legacyProjectIds = legacyProjectVersions
  .filter(row => typeof row.title === 'string' && isLegacyProjectTitle(row.title))
  .map(row => row.project_id);
const projectIds = dedupe([...trackedProjects, ...stateIds(ownedProjects), ...stateIds(legacyProjectIds.map(id => ({ id })))]);
const contractorProfileIds = dedupe([...trackedContractorProfiles, ...stateIds(profilesForUsers)]);

const [publicationRows, projectBids, profileBids, documentRows, versions, aiRuns,
  awardsByProject, awardsByProfile, contracts, conversationsByProject,
  conversationsByProfile, portfolioProjects] = await Promise.all([
  rows('publications', projectIds.length ? [queryIn('project_id', projectIds)] : []),
  rows('bids', projectIds.length ? [queryIn('project_id', projectIds)] : []),
  rows('bids', contractorProfileIds.length ? [queryIn('contractor_id', contractorProfileIds)] : []),
  Promise.all([
    rows('documents', projectIds.length ? [queryIn('project_id', projectIds)] : [], 'id,object_path'),
    rows('documents', userIds.length ? [queryIn('owner_id', userIds)] : [], 'id,object_path'),
  ]).then(groups => groups.flat()),
  rows('project_versions', projectIds.length ? [queryIn('project_id', projectIds)] : []),
  rows('ai_runs', projectIds.length ? [queryIn('project_id', projectIds)] : []),
  rows('awards', projectIds.length ? [queryIn('project_id', projectIds)] : []),
  rows('awards', contractorProfileIds.length ? [queryIn('contractor_id', contractorProfileIds)] : []),
  rows('contracts', projectIds.length ? [queryIn('project_id', projectIds)] : []),
  rows('conversations', projectIds.length ? [queryIn('project_id', projectIds)] : []),
  rows('conversations', contractorProfileIds.length ? [queryIn('contractor_id', contractorProfileIds)] : []),
  rows('portfolio_projects', contractorProfileIds.length ? [queryIn('contractor_id', contractorProfileIds)] : []),
]);

const publicationIds = dedupe([...trackedPublications, ...stateIds(publicationRows)]);
const bidIds = dedupe([...stateIds(projectBids), ...stateIds(profileBids)]);
const uniqueDocumentRows = [...new Map(documentRows.map(row => [row.id, row])).values()];
const documentIds = stateIds(uniqueDocumentRows);
const projectVersionIds = stateIds(versions);
const aiRunIds = stateIds(aiRuns);
const awardIds = dedupe([...stateIds(awardsByProject), ...stateIds(awardsByProfile)]);
const contractIds = stateIds(contracts);
const conversationIds = dedupe([...stateIds(conversationsByProject), ...stateIds(conversationsByProfile)]);
const portfolioProjectIds = stateIds(portfolioProjects);
const [awardItemsByProject, awardItemsByAward] = await Promise.all([
  rows('award_items', projectIds.length ? [queryIn('project_id', projectIds)] : []),
  rows('award_items', awardIds.length ? [queryIn('award_id', awardIds)] : []),
]);
const awardItemIds = dedupe([...stateIds(awardItemsByProject), ...stateIds(awardItemsByAward)]);

const [bidVersions, portfolioAssets] = await Promise.all([
  rows('bid_versions', bidIds.length ? [queryIn('bid_id', bidIds)] : []),
  rows('portfolio_assets', portfolioProjectIds.length ? [queryIn('portfolio_project_id', portfolioProjectIds)] : [], 'id,object_path'),
]);
const bidVersionIds = stateIds(bidVersions);
const [bidDocumentsByVersion, bidDocumentsByProject, bidDocumentsByProfile] = await Promise.all([
  rows('bid_documents', bidVersionIds.length ? [queryIn('bid_version_id', bidVersionIds)] : [], 'id,object_path,bid_version_id'),
  rows('bid_documents', projectIds.length ? [queryIn('project_id', projectIds)] : [], 'id,object_path,bid_version_id'),
  rows('bid_documents', contractorProfileIds.length ? [queryIn('contractor_id', contractorProfileIds)] : [], 'id,object_path,bid_version_id'),
]);
const bidDocuments = [...new Map([...bidDocumentsByVersion, ...bidDocumentsByProject, ...bidDocumentsByProfile].map(row => [row.id, row])).values()];
const bidDocumentIds = stateIds(bidDocuments);

const objectPaths = dedupe([
  ...uniqueDocumentRows.map(row => row.object_path),
  ...bidDocuments.map(row => row.object_path),
  ...portfolioAssets.map(row => row.object_path),
].filter(Boolean));
await awaitIndependent(objectPaths.map(removeStorageObject));

// Remove leaves first. Calls in a wave touch independent tables; repeated
// filters on one table stay sequential so the same row is never deleted twice.
await removeRows('award_items', 'id', awardItemIds);
await removeRows('bid_group_items', 'bid_version_id', bidVersionIds);
await awaitIndependent([
  removeRows('publication_requests', 'publication_id', publicationIds),
  removeRows('publication_recipients', 'publication_id', publicationIds),
  removeRows('bid_documents', 'id', bidDocumentIds),
  removeRows('bid_items', 'bid_version_id', bidVersionIds),
  removeRows('bid_groups', 'bid_version_id', bidVersionIds),
  removeRows('contract_versions', 'contract_id', contractIds),
  removeRows('conversation_participants', 'conversation_id', conversationIds),
  removeRows('messages', 'conversation_id', conversationIds),
  removeRows('portfolio_assets', 'portfolio_project_id', portfolioProjectIds),
  removeRows('project_reviews', 'project_version_id', projectVersionIds),
  removeRows('document_grants', 'document_id', documentIds),
  removeRows('contract_parties', 'contract_id', contractIds),
  removeRows('notifications', 'user_id', userIds),
  removeRows('audit_events', 'actor_id', userIds),
  removeRows('command_receipts', 'actor_id', userIds),
]);

await awaitIndependent([
  removeRows('project_reviews', 'actor_id', userIds),
  removeRows('document_grants', 'user_id', userIds),
  removeRows('contract_parties', 'user_id', userIds),
  removeRows('conversation_participants', 'user_id', userIds),
  removeRows('messages', 'author_id', userIds),
]);

await awaitIndependent([
  removeRows('publications', 'id', publicationIds),
  removeRows('contracts', 'id', contractIds),
  removeRows('conversations', 'id', conversationIds),
  removeRows('documents', 'id', documentIds),
  removeRows('ai_proposals', 'run_id', aiRunIds),
  removeRows('portfolio_projects', 'id', portfolioProjectIds),
  removeRows('project_private_details', 'project_id', projectIds),
]);
await removeRows('awards', 'id', awardIds);

await removeRows('bid_versions', 'id', bidVersionIds);
await removeRows('bids', 'id', bidIds);

await removeRows('ai_runs', 'id', aiRunIds);

await removeRows('project_version_requests', 'project_id', projectIds);
await removeRows('project_request_versions', 'project_id', projectIds);
await removeRows('project_requests', 'project_id', projectIds);
await awaitIndependent([
  removeRows('project_versions', 'id', projectVersionIds),
  removeRows('contractor_trades', 'contractor_id', contractorProfileIds),
  removeRows('contractor_service_areas', 'contractor_id', contractorProfileIds),
]);

await awaitIndependent([
  removeRows('projects', 'id', projectIds),
  removeRows('contractor_profiles', 'id', contractorProfileIds),
  removeRows('profiles', 'user_id', userIds),
  removeRows('profile_contacts', 'user_id', userIds),
  removeRows('user_roles', 'user_id', userIds),
]);

const listedAuthUserIds = new Set(stateIds(reservedUsers));
await awaitIndependent(userIds.map(id => listedAuthUserIds.has(id)
  ? deleteListedAuthUser(id)
  : deleteAuthUserIfPresent(id)));

await awaitIndependent([
  assertNoRows('projects', 'id', projectIds),
  assertNoRows('projects', 'client_id', userIds),
  assertNoRows('project_private_details', 'project_id', projectIds),
  assertNoRows('project_versions', 'id', projectVersionIds),
  assertNoRows('project_requests', 'project_id', projectIds),
  assertNoRows('project_request_versions', 'project_id', projectIds),
  assertNoRows('project_version_requests', 'project_id', projectIds),
  assertNoRows('project_reviews', 'project_version_id', projectVersionIds),
  assertNoRows('publications', 'id', publicationIds),
  assertNoRows('publication_requests', 'publication_id', publicationIds),
  assertNoRows('publication_recipients', 'publication_id', publicationIds),
  assertNoRows('bids', 'id', bidIds),
  assertNoRows('bid_versions', 'id', bidVersionIds),
  assertNoRows('bid_documents', 'id', bidDocumentIds),
  assertNoRows('bid_group_items', 'bid_version_id', bidVersionIds),
  assertNoRows('bid_items', 'bid_version_id', bidVersionIds),
  assertNoRows('bid_groups', 'bid_version_id', bidVersionIds),
  assertNoRows('documents', 'id', documentIds),
  assertNoRows('document_grants', 'document_id', documentIds),
  assertNoRows('document_grants', 'user_id', userIds),
  assertNoRows('ai_runs', 'id', aiRunIds),
  assertNoRows('ai_proposals', 'run_id', aiRunIds),
  assertNoRows('awards', 'project_id', projectIds),
  assertNoRows('award_items', 'project_id', projectIds),
  assertNoRows('award_items', 'id', awardItemIds),
  assertNoRows('awards', 'contractor_id', contractorProfileIds),
  assertNoRows('award_items', 'award_id', awardIds),
  assertNoRows('contracts', 'project_id', projectIds),
  assertNoRows('contract_versions', 'contract_id', contractIds),
  assertNoRows('contract_parties', 'contract_id', contractIds),
  assertNoRows('contract_parties', 'user_id', userIds),
  assertNoRows('conversations', 'id', conversationIds),
  assertNoRows('conversation_participants', 'conversation_id', conversationIds),
  assertNoRows('conversation_participants', 'user_id', userIds),
  assertNoRows('messages', 'conversation_id', conversationIds),
  assertNoRows('messages', 'author_id', userIds),
  assertNoRows('portfolio_projects', 'id', portfolioProjectIds),
  assertNoRows('portfolio_assets', 'portfolio_project_id', portfolioProjectIds),
  assertNoRows('contractor_profiles', 'id', contractorProfileIds),
  assertNoRows('contractor_profiles', 'user_id', userIds),
  assertNoRows('contractor_trades', 'contractor_id', contractorProfileIds),
  assertNoRows('contractor_service_areas', 'contractor_id', contractorProfileIds),
  assertNoRows('profiles', 'user_id', userIds),
  assertNoRows('profile_contacts', 'user_id', userIds),
  assertNoRows('user_roles', 'user_id', userIds),
  assertNoRows('notifications', 'user_id', userIds),
  assertNoRows('audit_events', 'actor_id', userIds),
  assertNoRows('command_receipts', 'actor_id', userIds),
]);

const remainingReservedUsers = await listReservedUsers();
if (remainingReservedUsers.length) throw new Error(`E2E cleanup verification found ${remainingReservedUsers.length} reserved test user(s) remaining in Supabase Auth`);

for (const file of [...files, ...temporaryFiles]) unlinkSync(file);
if (existsSync(stateDir) && readdirSync(stateDir).length === 0) rmdirSync(stateDir);
process.stdout.write(`E2E cleanup verified: ${projectIds.length} project(s), ${contractorProfileIds.length} contractor profile(s), ${userIds.length} user(s).\n`);
