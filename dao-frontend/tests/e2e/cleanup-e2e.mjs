import { existsSync, readFileSync, unlinkSync } from 'node:fs';

const url = process.env.DAO_SUPABASE_URL;
const secret = process.env.DAO_SUPABASE_SECRET_KEY;
const stateFile = process.env.DAO_E2E_STATE_FILE || '/tmp/dao-e2e-state.json';
if (!url || !secret || !existsSync(stateFile)) process.exit(0);

const headers = { apikey: secret, Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' };
async function api(path, options = {}) {
  try { return await fetch(url + path, { ...options, headers: { ...headers, ...(options.headers || {}) } }); } catch { return null; }
}
async function rows(table, query) {
  const response = await api('/rest/v1/' + table + '?' + query);
  if (!response?.ok) return [];
  try { return await response.json(); } catch { return []; }
}
async function removeRows(table, query) {
  await api('/rest/v1/' + table + '?' + query, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
}
function inQuery(column, values) {
  return values.length ? column + '=in.(' + values.join(',') + ')' : null;
}
function ids(data, key = 'id') { return [...new Set((data || []).map(item => item[key]).filter(Boolean))]; }

const state = JSON.parse(readFileSync(stateFile, 'utf8'));
const projectIds = [...new Set((state.projects || []).map(item => typeof item === 'string' ? item : item.id))];
const publicationIds = [...new Set((state.publications || []).map(item => typeof item === 'string' ? item : item.id))];
const contractorProfileIds = [...new Set((state.contractorProfiles || []).map(item => typeof item === 'string' ? item : item.id))];

for (const publicationId of publicationIds) {
  for (const table of ['publication_requests', 'publication_recipients']) await removeRows(table, 'publication_id=eq.' + publicationId);
  await removeRows('publications', 'id=eq.' + publicationId);
}

// Bids reference projects, so remove this run's offer graph before projects.
for (const profileId of contractorProfileIds) {
  const bids = await rows('bids', 'contractor_id=eq.' + profileId + '&select=id');
  const bidIds = ids(bids);
  const bidVersions = bidIds.length ? await rows('bid_versions', inQuery('bid_id', bidIds) + '&select=id') : [];
  const bidVersionIds = ids(bidVersions);
  if (bidVersionIds.length) {
    await removeRows('bid_documents', inQuery('bid_version_id', bidVersionIds));
    await removeRows('bid_group_items', inQuery('bid_version_id', bidVersionIds));
    await removeRows('bid_groups', inQuery('bid_version_id', bidVersionIds));
    await removeRows('bid_items', inQuery('bid_version_id', bidVersionIds));
    await removeRows('bid_versions', inQuery('id', bidVersionIds));
  }
  if (bidIds.length) await removeRows('bids', inQuery('id', bidIds));
}

for (const projectId of projectIds) {
  const documents = await rows('documents', 'project_id=eq.' + projectId + '&select=id,object_path');
  for (const document of documents) {
    if (document.object_path) await api('/storage/v1/object/dao-private/' + document.object_path.split('/').map(encodeURIComponent).join('/'), { method: 'DELETE' });
  }
  const documentIds = ids(documents);
  const runs = await rows('ai_runs', 'project_id=eq.' + projectId + '&select=id');
  const runIds = ids(runs);
  const versions = await rows('project_versions', 'project_id=eq.' + projectId + '&select=id');
  const versionIds = ids(versions);
  for (const filter of [inQuery('document_id', documentIds), inQuery('run_id', runIds), inQuery('project_version_id', versionIds)]) {
    if (filter) {
      const table = filter.startsWith('document_id') ? 'document_grants' : filter.startsWith('run_id') ? 'ai_proposals' : 'project_reviews';
      await removeRows(table, filter);
    }
  }
  if (documentIds.length) await removeRows('documents', inQuery('id', documentIds));
  if (runIds.length) await removeRows('ai_runs', inQuery('id', runIds));
  for (const table of ['project_version_requests', 'project_request_versions', 'project_requests', 'project_versions']) await removeRows(table, 'project_id=eq.' + projectId);
  await removeRows('projects', 'id=eq.' + projectId);
}

for (const publicationId of publicationIds) {
  for (const table of ['publication_requests', 'publication_recipients']) await removeRows(table, 'publication_id=eq.' + publicationId);
  await removeRows('publications', 'id=eq.' + publicationId);
}

for (const profileId of contractorProfileIds) {
  const bids = await rows('bids', 'contractor_id=eq.' + profileId + '&select=id');
  const bidIds = ids(bids);
  const bidVersions = bidIds.length ? await rows('bid_versions', inQuery('bid_id', bidIds) + '&select=id') : [];
  const bidVersionIds = ids(bidVersions);
  if (bidVersionIds.length) {
    const bidDocuments = await rows('bid_documents', inQuery('bid_version_id', bidVersionIds) + '&select=object_path');
    for (const document of bidDocuments) if (document.object_path) await api('/storage/v1/object/dao-private/' + document.object_path.split('/').map(encodeURIComponent).join('/'), { method: 'DELETE' });
    await removeRows('bid_documents', inQuery('bid_version_id', bidVersionIds));
    await removeRows('bid_group_items', inQuery('bid_version_id', bidVersionIds));
    await removeRows('bid_groups', inQuery('bid_version_id', bidVersionIds));
    await removeRows('bid_items', inQuery('bid_version_id', bidVersionIds));
    await removeRows('bid_versions', inQuery('id', bidVersionIds));
  }
  if (bidIds.length) await removeRows('bids', inQuery('id', bidIds));
  await removeRows('contractor_trades', 'contractor_id=eq.' + profileId);
  await removeRows('contractor_service_areas', 'contractor_id=eq.' + profileId);
  await removeRows('contractor_profiles', 'id=eq.' + profileId);
}

for (const user of state.users || []) {
  const id = typeof user === 'string' ? user : user.id;
  await removeRows('profile_contacts', 'user_id=eq.' + id);
  await removeRows('profiles', 'user_id=eq.' + id);
  await removeRows('user_roles', 'user_id=eq.' + id);
  await api('/auth/v1/admin/users/' + id, { method: 'DELETE' });
}
try { unlinkSync(stateFile); } catch {}
