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
  await rest(c, `/rest/v1/projects?id=eq.${SYNTHETIC_PROJECT}&status=eq.archived`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'draft' }) });
  // DB-side admission of the fixed synthetic pair (the previous cleanup revoked it; a revoked mapping refuses every sync step).
  const mapping = await rest(c, '/rest/v1/rpc/oce_request_mapping', { method: 'POST', body: JSON.stringify({ p_project_id: SYNTHETIC_PROJECT, p_request_id: SYNTHETIC_LOT }) });
  R.mapping_admitted = mapping.status < 300 && typeof mapping.body === 'string'
    && (await rest(c, '/rest/v1/rpc/oce_set_admission', { method: 'POST', body: JSON.stringify({ p_mapping_id: mapping.body, p_admitted: true }) })).status < 300;
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
  R.summary_status = sum.status; R.summary_duration_days = sb?.data?.total_duration_days ?? null;
  R.summary_critical_count = Number.isInteger(sb?.data?.critical_count) ? sb.data.critical_count : null;
  // Replay with identical content: nothing new is written.
  R.replay_saved = (await put('2026-11-02', '2026-12-18')).status === 200;
  const replay = await waitState(owner, 'synced'); R.sync_replay = replay.state;
  R.replay_revision_unchanged = replay.data?.revision === first.data?.revision;
  // Changed plan: pending again, then synced with a new revision and a different duration.
  R.change_saved = (await put('2026-11-02', '2026-12-31')).status === 200;
  const changed = await waitState(owner, 'synced'); R.sync_changed = changed.state;
  R.changed_revision_incremented = changed.data?.revision === (first.data?.revision ?? -1) + 1;
  const sum2 = await (await app(owner, `/api/oce/planning-summary?${q}`)).json().catch(() => ({}));
  R.changed_duration_differs = sum2?.data?.total_duration_days !== undefined && sum2.data.total_duration_days !== R.summary_duration_days;
  return R;
}

// DB-side revocation + archival of the synthetic pair. The gateway-side revocation is the separate fixed root verb.
async function cleanup() {
  const c = cfg(); const R = {};
  // Revoke the mapping through the service RPCs (the closed tables are not readable directly), THEN archive.
  const mapping = await rest(c, '/rest/v1/rpc/oce_request_mapping', { method: 'POST', body: JSON.stringify({ p_project_id: SYNTHETIC_PROJECT, p_request_id: SYNTHETIC_LOT }) });
  R.mapping_revoked = mapping.status < 300 && typeof mapping.body === 'string'
    && (await rest(c, '/rest/v1/rpc/oce_set_admission', { method: 'POST', body: JSON.stringify({ p_mapping_id: mapping.body, p_admitted: false }) })).status < 300;
  R.project_archived = (await rest(c, `/rest/v1/projects?id=eq.${SYNTHETIC_PROJECT}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'archived' }) })).status < 300;
  return R;
}

// ---- #325 tranche B : recette du planning GLOBAL (>=3 lots, >=2 dependances inter-lots) ----
// Memes regles : DEV protege, jeu fictif a identifiants fixes, TEST client/artisan seulement. Le contexte de planning du projet reutilise
// le couple admis de la passerelle (le lot de recette), sans toucher aux scripts d'exploitation.
const id = n => `5eed0301-0000-4000-8000-0000000000${n}`;
const LOT2 = id('a3'), LOT3 = id('a4');
const pg = (c, path, opt) => rest(c, path, opt);
const ign = { Prefer: 'resolution=ignore-duplicates,return=minimal' };

async function provisionGlobal(c) {
  const users = await (await svc(c, '/auth/v1/admin/users?per_page=200')).json();
  const contractorUser = (users.users || []).find(u => (u.email || '').toLowerCase() === CONTRACTOR) || fail('TEST contractor not found');
  const profile = ((await pg(c, `/rest/v1/contractor_profiles?select=id&user_id=eq.${contractorUser.id}`)).body || [])[0] || fail('TEST contractor profile missing');
  const trade = ((await pg(c, '/rest/v1/trades?select=id&order=code&limit=1')).body || [])[0] || fail('reference data missing: trades');
  const ins = async (table, row, conflict) => { const r = await pg(c, `/rest/v1/${table}${conflict ? `?on_conflict=${conflict}` : ''}`, { method: 'POST', headers: ign, body: JSON.stringify(row) }); if (r.status >= 300) fail(`synthetic insert failed: ${table} (${r.status})`); };
  const lots = [[SYNTHETIC_LOT, 'Gros oeuvre'], [LOT2, 'Electricite'], [LOT3, 'Finitions']];
  for (const [lot, name] of lots) {
    await ins('project_requests', { id: lot, project_id: SYNTHETIC_PROJECT });
    await ins('project_request_versions', { project_id: SYNTHETIC_PROJECT, request_id: lot, version_no: 1, title: `[SYNTHETIQUE] ${name}`, scope: 'Lot fictif de recette', trade_id: trade.id }, 'request_id,version_no');
  }
  const versions = {};
  for (const [lot] of lots) versions[lot] = ((await pg(c, `/rest/v1/project_request_versions?select=id&request_id=eq.${lot}&version_no=eq.1`)).body || [])[0]?.id || fail('request version missing');
  // Offre fictive de l'artisan TEST sur les 3 lots (une seule version soumise ; contenu immuable une fois soumise).
  const bidVersion = id('b2');
  const exists = ((await pg(c, `/rest/v1/bid_versions?select=id&id=eq.${bidVersion}`)).body || []).length === 1;
  if (!exists) {
    await ins('bids', { id: id('b1'), project_id: SYNTHETIC_PROJECT, contractor_id: profile.id });
    await ins('bid_versions', { id: bidVersion, bid_id: id('b1'), project_id: SYNTHETIC_PROJECT, contractor_id: profile.id, version_no: 1, expires_at: '2099-01-01T00:00:00Z' });
    const items = [[id('b3'), SYNTHETIC_LOT], [id('b4'), LOT2], [id('b5'), LOT3]];
    for (const [item, lot] of items) await ins('bid_items', { id: item, bid_version_id: bidVersion, project_id: SYNTHETIC_PROJECT, request_version_id: versions[lot], request_id: lot, contractor_id: profile.id, price_millimes: 1000000, duration_days: 30, inclusions: 'fictif' });
    const sub = (n, item, lot, pos, key, title, start, end) => ins('bid_sub_lots', { id: id(n), bid_version_id: bidVersion, bid_item_id: item, project_id: SYNTHETIC_PROJECT, request_id: lot, contractor_id: profile.id, node_key: id(key), position: pos, title, start_date: start, end_date: end });
    await sub('d1', id('b3'), SYNTHETIC_LOT, 1, 'e1', 'Fondations', '2026-11-02', '2026-11-20');
    await sub('d2', id('b3'), SYNTHETIC_LOT, 2, 'e2', 'Dalle', '2026-11-21', '2026-12-15');
    await sub('d3', id('b3'), SYNTHETIC_LOT, 3, 'e3', 'Cloture (parallele)', '2026-11-02', '2026-11-10');
    await sub('d4', id('b4'), LOT2, 1, 'e4', 'Tirage de cables', '2026-12-16', '2027-01-20');
    const link = (n, pk, pr, sk, sr) => ins('bid_sub_lot_links', { id: id(n), bid_version_id: bidVersion, project_id: SYNTHETIC_PROJECT, contractor_id: profile.id, pred_kind: pk, pred_ref: pr, succ_kind: sk, succ_ref: sr });
    await link('f1', 'proposal', id('e1'), 'proposal', id('e2'));      // intra-lot : Fondations -> Dalle
    await link('f2', 'proposal', id('e2'), 'proposal', id('e4'));      // inter-lot 1 : Dalle (lot 1) -> Tirage de cables (lot 2)
    await link('f3', 'proposal', id('e4'), 'lot', LOT3);              // inter-lot 2 : Tirage de cables (lot 2) -> lot 3
    await link('f4', 'lot', LOT3, 'proposal', id('e1'));              // ferme une boucle : doit etre refuse a la confirmation
    const sub2 = await pg(c, `/rest/v1/bid_versions?id=eq.${bidVersion}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'submitted', submitted_at: new Date().toISOString() }) });
    if (sub2.status >= 300) fail('synthetic bid submission failed');
  }
  // Attribution PAR LOT (un award, trois lignes).
  await ins('awards', { id: id('c1'), project_id: SYNTHETIC_PROJECT, contractor_id: profile.id });
  for (const [n, item, lot] of [['c2', id('b3'), SYNTHETIC_LOT], ['c3', id('b4'), LOT2], ['c4', id('b5'), LOT3]])
    await ins('award_items', { id: id(n), award_id: id('c1'), project_id: SYNTHETIC_PROJECT, request_id: lot, bid_item_id: item, agreed_millimes: 1000000, contractor_id: profile.id });
}

async function runGlobal() {
  const c = cfg(); const R = {};
  await rest(c, `/rest/v1/projects?id=eq.${SYNTHETIC_PROJECT}&status=eq.archived`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'draft' }) });
  await provisionGlobal(c);
  // Le contexte du projet prend l'identifiant du lot de recette (seul couple admis par la passerelle).
  const ctx = await rest(c, '/rest/v1/rpc/oce_plan_context_bind', { method: 'POST', body: JSON.stringify({ p_project_id: SYNTHETIC_PROJECT, p_context_id: SYNTHETIC_LOT }) });
  R.context_bound = ctx.status < 300 && ctx.body === true;
  const mapping = await rest(c, '/rest/v1/rpc/oce_request_mapping', { method: 'POST', body: JSON.stringify({ p_project_id: SYNTHETIC_PROJECT, p_request_id: SYNTHETIC_LOT }) });
  R.mapping_admitted = mapping.status < 300 && typeof mapping.body === 'string'
    && (await rest(c, '/rest/v1/rpc/oce_set_admission', { method: 'POST', body: JSON.stringify({ p_mapping_id: mapping.body, p_admitted: true }) })).status < 300;
  const owner = await signIn(c, CLIENT, env('DAO_TEST_CLIENT_PASSWORD'));
  const other = await signIn(c, CONTRACTOR, env('DAO_TEST_CONTRACTOR_PASSWORD'));
  const plan = async (token = owner) => { const r = await app(token, `/api/oce/project-plan?project_id=${SYNTHETIC_PROJECT}`); return { status: r.status, data: (await r.json().catch(() => ({}))).data }; };
  const decide = async (link, decision) => { const r = await app(owner, '/api/oce/project-plan', { method: 'POST', body: JSON.stringify({ project_id: SYNTHETIC_PROJECT, link_id: link, decision }) }); return { status: r.status, code: (await r.json().catch(() => ({}))).code }; };
  const putLot3 = end => app(owner, '/api/oce/lot-plan', { method: 'PUT', body: JSON.stringify({ project_id: SYNTHETIC_PROJECT, lot_id: LOT3, planned_start: '2027-01-21', planned_end: end, ready: true }) });
  const settle = async (after) => {
    for (let i = 0; i < 30; i++) { const p = await plan(); const s = p.data?.sync; if (p.data && p.data.revision >= after && (s?.state === 'synced' || s?.state === 'failed')) return p.data; await sleep(3000); }
    return (await plan()).data;
  };

  R.unauthenticated_refused = (await app(null, `/api/oce/project-plan?project_id=${SYNTHETIC_PROJECT}`)).status === 401;
  R.artisan_read_refused = (await plan(other)).status === 403;
  R.artisan_decision_refused = (await app(other, '/api/oce/project-plan', { method: 'POST', body: JSON.stringify({ project_id: SYNTHETIC_PROJECT, link_id: id('f1'), decision: 'confirmed' }) })).status === 403;

  const g0 = (await plan()).data || {};
  R.lots = g0.lots?.length ?? 0; R.lots_awarded = (g0.lots || []).filter(l => l.awarded).length;
  R.links_proposed = g0.links?.length ?? 0;
  // Etat initial determine : plan du lot 3, chaine confirmee, liaison fermant la boucle refusee.
  R.lot3_plan_saved = (await putLot3('2027-02-28')).status === 200;
  const d1 = await decide(id('f1'), 'confirmed'), d2 = await decide(id('f2'), 'confirmed'), d3 = await decide(id('f3'), 'confirmed');
  R.links_confirmed = d1.status === 200 && d2.status === 200 && d3.status === 200;
  const cycle = await decide(id('f4'), 'confirmed');
  R.cycle_rejected = cycle.status === 422 && cycle.code === 'DEPENDENCY_CYCLE';
  const rev0 = (await plan()).data?.revision ?? 0;
  const base = await settle(rev0); const bs = base?.sync || {};
  R.sync_global = bs.state; R.global_duration_days = bs.duration_days ?? null; R.critical_count = bs.critical_codes?.length ?? 0;
  R.effective_links = (base?.links || []).filter(l => l.state === 'effective').length;
  const nodeTitle = new Map((base?.nodes || []).map(n => [`SL-${n.id.replace(/-/g, '')}`, n.title]));
  const critTitles = (bs.critical_codes || []).map(k => nodeTitle.get(k) || (k.startsWith('LA-') ? 'lot' : '?'));
  R.critical_titles = critTitles.sort().join('|');
  R.critical_has_chain = ['Fondations', 'Dalle', 'Tirage de cables'].every(t => critTitles.includes(t));
  R.parallel_task_not_critical = !critTitles.includes('Cloture (parallele)');
  // Changement de duree (fin du lot 3) : recalcul.
  await putLot3('2027-03-31');
  const longer = await settle((base?.revision ?? 0) + 1);
  R.duration_change_recomputed = longer?.sync?.state === 'synced' && (longer.sync.duration_days ?? 0) > (bs.duration_days ?? 0);
  R.duration_after_change = longer?.sync?.duration_days ?? null;
  // Un lien effectif est definitif : la passerelle OCE n'a aucune operation de retrait de dependance.
  const retire = await decide(id('f2'), 'rejected');
  R.confirmed_link_final_refused = retire.status === 422 && retire.code === 'LINK_CONFIRMED_FINAL';
  await putLot3('2027-02-28');
  return R;
}

const op = process.argv[2]; const ops = { probe, provision, run, cleanup, 'run-global': runGlobal };
if (!ops[op]) { console.error('usage: oce-dev-recette.mjs probe|provision|run|run-global|cleanup'); process.exit(2); }
let report; let ok = true;
try { report = await ops[op](); } catch (e) { ok = false; report = { error: String(e.message || e).replace(/[^\w .:()/-]/g, '').slice(0, 120) }; }
finally { if (op === 'run' || op === 'run-global') { try {
      const cleaned = await cleanup(); const c = cfg();
      const owner = await signIn(c, CLIENT, env('DAO_TEST_CLIENT_PASSWORD'));
      cleaned.summary_refused_after_revocation = (await app(owner, `/api/oce/planning-summary?${q}`)).status === 403;
      report = { ...(report || {}), cleanup: cleaned };
    } catch { /* reported by absence */ } } }
// A recette only passes when every expected outcome is true; a missing or false outcome fails it (never vacuous).
const EXPECT_RUN = ['mapping_admitted', 'unauthenticated_refused', 'unauthorized_plan_read_refused', 'unauthorized_plan_write_refused', 'unauthorized_summary_refused',
  'plan_saved_ready', 'replay_saved', 'replay_revision_unchanged', 'change_saved', 'changed_revision_incremented', 'changed_duration_differs'];
const EXPECT_GLOBAL = ['context_bound', 'mapping_admitted', 'unauthenticated_refused', 'artisan_read_refused', 'artisan_decision_refused', 'lot3_plan_saved', 'links_confirmed', 'cycle_rejected',
  'critical_has_chain', 'parallel_task_not_critical', 'duration_change_recomputed', 'confirmed_link_final_refused'];
if (op === 'run-global' && ok) {
  const r = report || {};
  ok = EXPECT_GLOBAL.every(k => r[k] === true) && r.lots >= 3 && r.lots_awarded >= 3 && r.effective_links >= 3 && r.sync_global === 'synced'
    && Number.isInteger(r.global_duration_days) && r.global_duration_days > 0 && r.critical_count >= 3
    && r.cleanup?.mapping_revoked === true && r.cleanup?.project_archived === true;
}
if (op === 'run' && ok) {
  const r = report || {};
  ok = EXPECT_RUN.every(k => r[k] === true) && r.sync_first === 'synced' && r.sync_replay === 'synced' && r.sync_changed === 'synced'
    && r.summary_status === 200 && Number.isInteger(r.summary_duration_days) && r.summary_duration_days > 0
    && r.cleanup?.mapping_revoked === true && r.cleanup?.project_archived === true && r.cleanup?.summary_refused_after_revocation === true;
}
console.log(JSON.stringify({ oce_recette: op, ok, ...report }, null, 1));
if (!ok) process.exit(1);
