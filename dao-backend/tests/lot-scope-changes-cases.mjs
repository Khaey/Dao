// #587 — Modification de périmètre validée après attribution : proposition, validation par l'autre partie,
// nouvelle version append-only du lot attribué, occurrences mesurables en métrés d'exécution.
// PGlite : JWT simulé par claim SQL (aucune Auth Supabase réelle ici ; la CI réelle couvre l'API).
import { randomUUID } from 'node:crypto';

export async function lotScopeChangesCases(db, test, { U, as }) {
  const eq = (a, b, label = '') => { if (a !== b) throw Error(`${label}Expected ${JSON.stringify(b)}, received ${JSON.stringify(a)}`); };
  const ok = (value, label) => { if (!value) throw Error(label); };
  const rejects = async (fn, code) => { try { await fn(); } catch (e) { if (code) eq(e.code, code, `[${e.message}] `); return e; } throw Error('Unexpected success'); };
  const one = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const snapshot = projectId => one('select public.lot_scope_changes_snapshot_v1($1)', [projectId]);
  const command = (action, input, key = `sc-${randomUUID()}`) => one('select public.lot_scope_change_command_v1($1,$2::jsonb,$3)', [action, JSON.stringify(input), key]);
  const exec = (action, input, key = `ex-${randomUUID()}`) => one('select public.btp_execution_takeoff_command_v1($1,$2::jsonb,$3)', [action, JSON.stringify(input), key]);
  const measurable = (await db.query(`select w.id,w.code,w.unit_code,m.input_schema from public.btp_measurement_templates m
    join public.btp_works w on w.id=m.work_id and w.catalog_version_id=m.catalog_version_id
    join public.btp_catalog_versions v on v.id=m.catalog_version_id and v.status='published'
    where m.active and w.active order by w.code limit 1`)).rows[0];
  const unitOf = name => name.endsWith('_m3') ? 'm3' : name.endsWith('_m2') ? 'm2' : name.endsWith('_m') ? 'm' : 'unit';
  const inputs = value => Object.fromEntries((measurable.input_schema.required ?? []).map(name => [name, { value, unit: unitOf(name), source: { kind: 'manual', reference: 'Relevé test #587' }, original: { value, unit: unitOf(name) } }]));
  // Lot attribué au titulaire proA sur un chantier du Client A.
  const award = (await db.query(`select ai.id, ai.project_id, ai.request_id from public.award_items ai
    join public.awards a on a.id=ai.award_id and a.status<>'cancelled' join public.contractor_profiles cp on cp.id=ai.contractor_id
    join public.projects p on p.id=ai.project_id where ai.active and cp.user_id=$1 and p.client_id=$2 order by ai.created_at limit 1`, [U.proA, U.clientA])).rows[0];
  const lotOf = (snap, id = award.id) => snap.lots.find(l => l.awardItemId === id);

  let change, baseline;
  await test('scope change: parties only; competitor, other Client and anonymous see nothing', async () => {
    ok(award, 'fixture: active award of proA on a Client A project');
    baseline = (await db.query(`select ai.agreed_millimes::text a, (select count(*) from public.contract_amendments)::int n,
      (select count(*) from public.contract_versions)::int v from public.award_items ai where ai.id=$1`, [award.id])).rows[0];
    const client = await as('clientA', () => snapshot(award.project_id));
    eq(lotOf(client).viewerRole, 'client'); eq(lotOf(client).canPropose, true); eq(lotOf(client).currentVersion.versionNo, 1);
    const pro = await as('proA', () => snapshot(award.project_id));
    eq(lotOf(pro).viewerRole, 'contractor');
    ok(pro.lots.every(l => l.viewerRole === 'contractor'), 'Artisan sees only his own awarded lots');
    await as('proB', async () => { const s = await snapshot(award.project_id).catch(e => e); ok(s.code === '42501' || !lotOf(s), 'competitor must not read the lot'); });
    await as('clientB', () => rejects(() => snapshot(award.project_id), '42501'));
    await as('clientB', () => rejects(() => command('propose', { awardItemId: award.id, reason: 'Contournement', items: [{ label: 'Ouvrage forgé' }] }), '42501'));
    await as('proB', () => rejects(() => command('propose', { awardItemId: award.id, reason: 'Contournement', items: [{ label: 'Ouvrage forgé' }] }), '42501'));
    await as('admin', async () => { const s = await snapshot(award.project_id); eq(lotOf(s).viewerRole, 'observer'); eq(lotOf(s).canPropose, false);
      await rejects(() => command('propose', { awardItemId: award.id, reason: 'Admin hors partie', items: [{ label: 'Ouvrage admin' }] }), '42501'); });
    await as('clientA', () => rejects(() => db.query('select * from public.lot_scope_changes'), '42501'));
    await as('clientA', () => rejects(() => db.query('select * from public.lot_scope_versions'), '42501'));
    await db.exec('set role anon');
    try { await rejects(() => snapshot(award.project_id), '42501'); } finally { await db.exec('reset role'); }
  });

  await test('scope change: strict proposal, one pending per lot, no price field, idempotent replay', () => as('proA', async () => {
    await rejects(() => command('propose', { awardItemId: award.id, reason: 'x', items: [{ label: 'Pergola' }] }), '22023');
    await rejects(() => command('propose', { awardItemId: award.id, reason: 'Ajout demandé', items: [] }), '22023');
    await rejects(() => command('propose', { awardItemId: award.id, reason: 'Ajout demandé', items: [{ label: 'Pergola', priceMillimes: 1000 }] }), '22023');
    await rejects(() => command('propose', { awardItemId: award.id, reason: 'Ajout demandé', amountMillimes: 1000, items: [{ label: 'Pergola' }] }), '22023');
    await rejects(() => command('propose', { awardItemId: award.id, reason: 'Ajout demandé', items: [{ workId: measurable.id, label: 'Forgé' }] }), '22023');
    await rejects(() => command('propose', { awardItemId: award.id, reason: 'Ajout demandé', items: [{ workId: randomUUID() }] }), '22023');
    await rejects(() => command('propose', { awardItemId: award.id, reason: 'Ajout demandé', items: [{ label: 'Pergola', subLotId: randomUUID() }] }), '22023');
    const key = 'sc-replay-587-0001';
    const input = { awardItemId: award.id, reason: 'Le Client demande une terrasse supplémentaire', items: [{ workId: measurable.id }, { label: 'Pergola bois sur mesure' }] };
    const first = await command('propose', input, key);
    const again = await command('propose', input, key);
    eq(first.changeId, again.changeId);
    change = lotOf(first).changes.find(c => c.id === first.changeId);
    eq(change.state, 'pending'); eq(change.proposerRole, 'contractor'); eq(change.priceEffect, 'none'); eq(change.items.length, 2);
    eq(change.items[0].label.length > 0, true); eq(change.items[1].custom, true);
    eq(change.canDecide, false); eq(change.canWithdraw, true); eq(lotOf(first).canPropose, false);
    const second = await rejects(() => command('propose', { awardItemId: award.id, reason: 'Deuxième demande', items: [{ label: 'Autre ouvrage' }] }), '23514');
    eq(second.hint, 'scope_change_pending');
  }));

  await test('scope change: the proposer cannot accept his own proposal; other party decides', async () => {
    const own = await as('proA', () => rejects(() => command('accept', { changeId: change.id }), '42501'));
    eq(own.hint, 'scope_change_other_party');
    await as('proB', () => rejects(() => command('accept', { changeId: change.id }), '42501'));
    await as('admin', () => rejects(() => command('accept', { changeId: change.id }), '42501'));
    eq(lotOf(await as('clientA', () => snapshot(award.project_id))).changes.find(c => c.id === change.id).canDecide, true);
    await as('clientA', () => rejects(() => command('reject', { changeId: change.id, reason: 'x' }), '22023'));
  });

  let itemIds;
  await test('scope change: acceptance creates version 2 and measurable occurrences; v1 stays immutable', async () => {
    const before = (await db.query('select count(*)::int c from public.project_work_items where request_id=$1', [award.request_id])).rows[0].c;
    const accepted = await as('clientA', () => command('accept', { changeId: change.id }));
    const lot = lotOf(accepted);
    const c = lot.changes.find(x => x.id === change.id);
    eq(c.state, 'accepted'); eq(c.decidedRole, 'client'); eq(c.resultVersionNo, 2);
    eq(lot.currentVersion.versionNo, 2); eq(lot.versions.map(v => v.versionNo).join(','), '1,2');
    eq(lot.versions[1].worksCount, lot.versions[0].worksCount + 2);
    eq(lot.canPropose, true);
    const rows = (await db.query("select id, origin, scope_change_id, work_id, label from public.project_work_items where scope_change_id=$1 order by ordinal", [change.id])).rows;
    eq(rows.length, 2); ok(rows.every(r => r.origin === 'scope_change'), 'origin scope_change');
    eq((await db.query('select count(*)::int c from public.project_work_items where request_id=$1', [award.request_id])).rows[0].c, before + 2);
    itemIds = rows.map(r => r.id);
    // Les occurrences apparaissent dans la liste commune (métrés d'exécution) avec leur modification d'origine.
    const items = await as('clientA', () => one('select public.project_work_items_snapshot_v1($1)', [award.project_id]));
    const shown = items.lots.find(l => l.requestId === award.request_id).items.filter(i => i.scopeChangeId === change.id);
    eq(shown.length, 2); eq(shown.find(i => i.workId === measurable.id).measurable, true);
    // Historique append-only.
    await db.exec('reset role');
    await rejects(() => db.query('update public.lot_scope_versions set works=$2 where award_item_id=$1', [award.id, '[]']), '23514');
    await rejects(() => db.query('delete from public.lot_scope_change_events where scope_change_id=$1', [change.id]), '23514');
    await rejects(() => db.query("update public.lot_scope_changes set reason='réécrit' where id=$1", [change.id]), '23514');
    await rejects(() => db.query("update public.lot_scope_changes set state='rejected' where id=$1", [change.id]), '23514');
    await rejects(() => db.query('update public.project_work_items set scope_change_id=null where id=$1', [itemIds[0]]), '23514');
    await as('clientA', () => rejects(() => command('accept', { changeId: change.id }), '23514'));
    // Le Client ne peut pas retirer l'occurrence : lot attribué, liste verrouillée.
    const item = items.lots.find(l => l.requestId === award.request_id).items.find(i => i.id === itemIds[0]);
    await as('clientA', () => rejects(() => one("select public.project_work_item_command_v1('remove',$1::jsonb,$2)", [JSON.stringify({ itemId: item.id, expectedRevision: item.revision }), `wi-${randomUUID()}`]), '23514'));
  });

  await test('scope change: accepted catalogue work is measurable in execution takeoffs only', () => as('clientA', async () => {
    const item = itemIds[0];
    const t = await exec('calculate', { projectId: award.project_id, workId: measurable.id, workItemId: item, scopeKey: 'avenant-1', label: 'Terrasse ajoutée', canonicalInputs: inputs('3') });
    eq(t.kind, 'execution'); eq(t.workItemId, item);
    await rejects(() => one("select public.btp_takeoff_command_v1('calculate',$1::jsonb,$2)", [JSON.stringify({ projectId: award.project_id, workId: measurable.id, workItemId: item, scopeKey: 'prev-avenant', label: 'Prévisionnel', canonicalInputs: {} }), `tk-${randomUUID()}`]), '23514');
  }));

  await test('scope change: rejection and withdrawal keep the version unchanged and are traced', async () => {
    const proposed = await as('clientA', () => command('propose', { awardItemId: award.id, reason: 'Ajouter un garde-corps', items: [{ label: 'Garde-corps métallique' }] }));
    const rejected = await as('proA', () => command('reject', { changeId: proposed.changeId, reason: 'Hors de mes compétences' }));
    const r = lotOf(rejected).changes.find(c => c.id === proposed.changeId);
    eq(r.state, 'rejected'); eq(r.decisionReason, 'Hors de mes compétences'); eq(lotOf(rejected).currentVersion.versionNo, 2);
    const again = await as('proA', () => command('propose', { awardItemId: award.id, reason: 'Proposition retirée ensuite', items: [{ label: 'Ouvrage retiré' }] }));
    await as('clientA', () => rejects(() => command('withdraw', { changeId: again.changeId }), '42501'));
    const withdrawn = await as('proA', () => command('withdraw', { changeId: again.changeId }));
    eq(lotOf(withdrawn).changes.find(c => c.id === again.changeId).state, 'withdrawn');
    eq(lotOf(withdrawn).currentVersion.versionNo, 2);
    eq((await db.query('select count(*)::int c from public.project_work_items where scope_change_id in ($1,$2)', [proposed.changeId, again.changeId])).rows[0].c, 0);
    const events = (await db.query('select event_type from public.lot_scope_change_events where scope_change_id in ($1,$2) order by created_at, id', [proposed.changeId, again.changeId])).rows.map(e => e.event_type);
    eq(events.join(','), 'proposed,rejected,proposed,withdrawn');
  });

  await test('scope change: no effect on award amount, award state or contract', async () => {
    const now = (await db.query(`select ai.agreed_millimes::text a, ai.active, (select count(*) from public.contract_amendments)::int n,
      (select count(*) from public.contract_versions)::int v from public.award_items ai where ai.id=$1`, [award.id])).rows[0];
    eq(now.active, true); eq(now.a, baseline.a); eq(now.n, baseline.n); eq(now.v, baseline.v);
  });
}
