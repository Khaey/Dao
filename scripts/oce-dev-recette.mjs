#!/usr/bin/env node
// OCE V1 DEV recette (#58 / #301). Protected DEV only. One FIXED synthetic project + lot (ids below), TEST client only.
// Secrets come from the GitHub environment `dev`; nothing secret is ever printed. Output is a closed report of booleans/counters.
export const SYNTHETIC_PROJECT = '5eed0301-0000-4000-8000-0000000000a1';
export const SYNTHETIC_LOT = '5eed0301-0000-4000-8000-0000000000a2';
const TITLE = '[SYNTHETIQUE OCE #301] Lot de recette';
const CLIENT = 'ahmedhattab.pro+dao-client@gmail.com';
const CONTRACTOR = 'ahmedhattab.pro+dao-contractor@gmail.com';
const BASE = 'https://dao-dev.logiclab.fr';

const fail = m => { throw new Error(m); };
const env = n => process.env[n] || fail(`Missing protected configuration: ${n}`);
const cfg = () => {
  const url = env('DAO_SUPABASE_URL').replace(/\/$/, '');
  if (process.env.DAO_FIXTURE_TARGET !== 'dev' || !/^https:\/\//i.test(url) || /127\.0\.0\.1|localhost/i.test(url)) fail('Refused: protected DEV target required');
  if (env('DAO_TEST_CLIENT_EMAIL').trim().toLowerCase() !== CLIENT || env('DAO_TEST_CONTRACTOR_EMAIL').trim().toLowerCase() !== CONTRACTOR) fail('Refused: TEST aliases mismatch');
  return { url, pub: env('DAO_SUPABASE_PUBLISHABLE_KEY'), secret: env('DAO_SUPABASE_SECRET_KEY') };
};
const svc = (c, path, opt = {}) => fetch(`${c.url}${path}`, { ...opt, headers: { apikey: c.secret, Authorization: `Bearer ${c.secret}`, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
async function rest(c, path, opt = {}) { const r = await svc(c, path, opt); const t = await r.text(); let b = null; try { b = t ? JSON.parse(t) : null; } catch { /* closed */ } return { status: r.status, body: b }; }
async function signIn(c, email, password) {
  const r = await fetch(`${c.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: c.pub, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const b = await r.json().catch(() => ({})); if (!r.ok || !b.access_token) fail('TEST sign-in failed'); return b.access_token;
}
const app = (token, path, init = {}) => fetch(`${BASE}${path}`, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } });
const q = `project_id=${SYNTHETIC_PROJECT}&lot_id=${SYNTHETIC_LOT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function probe() {
  const c = cfg(); const report = {};
  for (const t of ['oce_sync_mappings', 'oce_sync_journal', 'oce_lot_plans']) report[`table_${t}`] = (await rest(c, `/rest/v1/${t}?select=id&limit=1`)).status === 200;
  const a = { p_project_id: SYNTHETIC_PROJECT, p_request_id: SYNTHETIC_LOT };
  for (const f of ['oce_summary_access', 'oce_lot_plan_for_sync', 'oce_resync_access']) report[`rpc_${f}`] = (await rest(c, `/rest/v1/rpc/${f}`, { method: 'POST', body: JSON.stringify(a) })).status !== 404;
  report.rpc_oce_request_mapping = (await rest(c, '/rest/v1/rpc/oce_object_changed', { method: 'POST', body: JSON.stringify({ p_mapping_id: '00000000-0000-4000-8000-000000000000', p_kind: 'wbs', p_code: 'X', p_code2: null, p_hash: 'a'.repeat(64) }) })).status !== 404;
  report.synthetic_project_present = ((await rest(c, `/rest/v1/projects?select=id,status&id=eq.${SYNTHETIC_PROJECT}`)).body || []).length === 1;
  return report;
}

async function provision() {
  const c = cfg();
  const users = await (await svc(c, '/auth/v1/admin/users?per_page=200')).json();
  const client = (users.users || []).find(u => (u.email || '').toLowerCase() === CLIENT) || fail('TEST client not found');
  const one = async (path) => { const r = await rest(c, path); return (r.body || [])[0] || fail(`reference data missing: ${path.split('?')[0]}`); };
  const gov = await one('/rest/v1/governorates?select=id&order=code&limit=1');
  const trade = await one('/rest/v1/trades?select=id&order=code&limit=1');
  const ins = async (table, row) => { const r = await rest(c, `/rest/v1/${table}`, { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(row) }); if (r.status >= 300) fail(`synthetic insert failed: ${table} (${r.status})`); };
  await ins('projects', { id: SYNTHETIC_PROJECT, client_id: client.id, initiator_id: client.id, project_origin: 'client_existing_team' });
  await ins('project_versions', { project_id: SYNTHETIC_PROJECT, version_no: 1, title: TITLE, description: 'Projet 100 % fictif de recette OCE (#301).', governorate_id: gov.id, status: 'approved' });
  await ins('project_requests', { id: SYNTHETIC_LOT, project_id: SYNTHETIC_PROJECT });
  await ins('project_request_versions', { project_id: SYNTHETIC_PROJECT, request_id: SYNTHETIC_LOT, version_no: 1, title: TITLE, scope: 'Lot fictif de recette', trade_id: trade.id });
  return { synthetic_project_present: ((await rest(c, `/rest/v1/projects?select=id&id=eq.${SYNTHETIC_PROJECT}`)).body || []).length === 1 };
}

async function journalCount(c) { const r = await svc(c, '/rest/v1/oce_sync_journal?select=id', { headers: { Prefer: 'count=exact', Range: '0-0' } }); return Number((r.headers.get('content-range') || '').split('/')[1] || -1); }

async function waitState(token, wanted) {
  for (let i = 0; i < 30; i++) {
    const r = await app(token, `/api/oce/lot-plan?${q}`); const b = await r.json().catch(() => ({}));
    const s = b?.data?.sync?.state; if (s === wanted || s === 'failed') return { state: s, data: b?.data };
    await sleep(3000);
  }
  return { state: 'timeout' };
}

async function run() {
  const c = cfg(); const R = {};
  const owner = await signIn(c, CLIENT, env('DAO_TEST_CLIENT_PASSWORD'));
  const other = await signIn(c, CONTRACTOR, env('DAO_TEST_CONTRACTOR_PASSWORD'));
  const put = (start, end, ready = true) => app(owner, '/api/oce/lot-plan', { method: 'PUT', body: JSON.stringify({ project_id: SYNTHETIC_PROJECT, lot_id: SYNTHETIC_LOT, planned_start: start, planned_end: end, ready }) });
  // Refusals first: unauthenticated and non-authorized actors never reach the plan or the summary.
  R.unauthenticated_refused = (await app(null, `/api/oce/lot-plan?${q}`)).status === 401;
  R.unauthorized_plan_read_refused = (await app(other, `/api/oce/lot-plan?${q}`)).status === 403;
  R.unauthorized_plan_write_refused = (await app(other, '/api/oce/lot-plan', { method: 'PUT', body: JSON.stringify({ project_id: SYNTHETIC_PROJECT, lot_id: SYNTHETIC_LOT, planned_start: '2026-11-02', planned_end: '2026-12-18', ready: true }) })).status === 403;
  R.unauthorized_summary_refused = (await app(other, `/api/oce/planning-summary?${q}`)).status === 403;
  // Explicit dates, plan ready, automatic synchronisation.
  R.plan_saved_ready = (await put('2026-11-02', '2026-12-18')).status === 200;
  const first = await waitState(owner, 'synced'); R.sync_first = first.state;
  const sum = await app(owner, `/api/oce/planning-summary?${q}`); const sb = await sum.json().catch(() => ({}));
  R.summary_status = sum.status; R.summary_duration_days = sb?.data?.project_duration_days ?? null;
  R.summary_critical_count = Array.isArray(sb?.data?.critical_activity_codes) ? sb.data.critical_activity_codes.length : null;
  // Replay with identical content: nothing new is written.
  const before = await journalCount(c);
  R.replay_saved = (await put('2026-11-02', '2026-12-18')).status === 200;
  const replay = await waitState(owner, 'synced'); R.sync_replay = replay.state;
  R.replay_journal_unchanged = (await journalCount(c)) === before;
  R.replay_revision_unchanged = replay.data?.revision === first.data?.revision;
  // Changed plan: pending again, then synced with a new revision and a different duration.
  R.change_saved = (await put('2026-11-02', '2026-12-31')).status === 200;
  const changed = await waitState(owner, 'synced'); R.sync_changed = changed.state;
  R.changed_revision_incremented = changed.data?.revision === (first.data?.revision ?? -1) + 1;
  const sum2 = await (await app(owner, `/api/oce/planning-summary?${q}`)).json().catch(() => ({}));
  R.changed_duration_differs = sum2?.data?.project_duration_days !== undefined && sum2.data.project_duration_days !== R.summary_duration_days;
  return R;
}

// DB-side revocation + archival of the synthetic pair. The gateway-side revocation is the separate fixed root verb.
async function cleanup() {
  const c = cfg(); const R = {};
  const m = (await rest(c, `/rest/v1/oce_sync_mappings?select=id&project_id=eq.${SYNTHETIC_PROJECT}&request_id=eq.${SYNTHETIC_LOT}`)).body || [];
  if (m[0]) R.mapping_revoked = (await rest(c, '/rest/v1/rpc/oce_set_admission', { method: 'POST', body: JSON.stringify({ p_mapping_id: m[0].id, p_admitted: false }) })).status < 300;
  R.project_archived = (await rest(c, `/rest/v1/projects?id=eq.${SYNTHETIC_PROJECT}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'archived' }) })).status < 300;
  return R;
}

const op = process.argv[2]; const ops = { probe, provision, run, cleanup };
if (!ops[op]) { console.error('usage: oce-dev-recette.mjs probe|provision|run|cleanup'); process.exit(2); }
let report; let ok = true;
try { report = await ops[op](); } catch (e) { ok = false; report = { error: String(e.message || e).replace(/[^\w .:()/-]/g, '').slice(0, 120) }; }
finally { if (op === 'run') { try {
      const cleaned = await cleanup(); const c = cfg();
      const owner = await signIn(c, CLIENT, env('DAO_TEST_CLIENT_PASSWORD'));
      cleaned.summary_refused_after_revocation = (await app(owner, `/api/oce/planning-summary?${q}`)).status === 403;
      report = { ...(report || {}), cleanup: cleaned };
    } catch { /* reported by absence */ } } }
console.log(JSON.stringify({ oce_recette: op, ok, ...report }, null, 1));
if (!ok) process.exit(1);
