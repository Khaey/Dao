import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { createProjectWorkItemsHandler } from '../../src/server/projectWorkItemsHandler.js';

// #577 — ouvrages du chantier avec de vrais JWT Supabase sur la pile jetable :
// saisie manuelle Lot → Sous-lot facultatif → Ouvrage, persistance, droits négatifs,
// métré rattaché à l'occurrence, estimation par lot réel et instantané publié sans données privées.
test('project work items: real JWT, RLS, persistence, takeoff link, estimate and publication snapshot', async () => {
  const url = process.env.DAO_SUPABASE_URL!, key = process.env.DAO_SUPABASE_PUBLISHABLE_KEY!, secret = process.env.DAO_SUPABASE_SECRET_KEY!;
  assert.equal(url, 'http://127.0.0.1:54321', 'Only disposable Supabase is authorized'); assert.ok(key); assert.ok(secret);
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, secret, opts); const anon = createClient(url, key, opts);
  const password = 'Wi577!' + randomUUID(); const users: Record<string, { id: string; db: any }> = {};
  for (const [name, role] of Object.entries({ owner: 'client', stranger: 'client', pro: 'contractor', manager: 'dao_reviewer' })) {
    const email = `wi577-${name}-${randomUUID()}@example.invalid`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ifError(created.error);
    const id = created.data.user!.id;
    assert.ifError((await admin.from('profiles').insert({ user_id: id, display_name: 'Synth ' + name })).error);
    assert.ifError((await admin.from('user_roles').insert({ user_id: id, role })).error);
    const db = createClient(url, key, opts); assert.ifError((await db.auth.signInWithPassword({ email, password })).error);
    users[name] = { id, db };
  }
  const rpc = async (who: string, name: string, args: Record<string, unknown>) => users[who].db.rpc(name, args);
  const gov = (await admin.from('governorates').select('id').limit(1).single()); assert.ifError(gov.error);
  const trade = (await admin.from('trades').select('id').eq('code', 'general_contractor').single()); assert.ifError(trade.error);
  const catalog = (await admin.from('btp_catalog_versions').select('id').eq('country_code', 'TN').eq('status', 'published').single()); assert.ifError(catalog.error);
  const templ = (await admin.from('btp_measurement_templates').select('work_id,input_schema').eq('catalog_version_id', catalog.data.id).eq('active', true).limit(1).single()); assert.ifError(templ.error);
  const workId = templ.data.work_id as string;
  const otherWork = (await admin.from('btp_works').select('id').eq('catalog_version_id', catalog.data.id).eq('active', true).neq('id', workId).limit(1).single()); assert.ifError(otherWork.error);

  // Parcours manuel du Client propriétaire, uniquement par RPC JWT.
  const project = await rpc('owner', 'create_project_draft', { p_project_type: 'renovation', p_surface_m2: null, p_desired_start_date: null, p_indicative_budget_millimes: null, p_governorate_id: gov.data.id });
  assert.ifError(project.error); const projectId = project.data.id as string;
  const lotA = await rpc('owner', 'add_project_request', { p_project_id: projectId, p_trade_id: trade.data.id, p_title: 'Lot sans sous-lot', p_scope: 'Ouvrage direct', p_budget_millimes: null }); assert.ifError(lotA.error);
  const lotB = await rpc('owner', 'add_project_request', { p_project_id: projectId, p_trade_id: trade.data.id, p_title: 'Lot avec sous-lot', p_scope: 'Sous-lot manuel', p_budget_millimes: null }); assert.ifError(lotB.error);
  const before = await rpc('owner', 'native_request_sub_lots_v1', { p_request_id: lotB.data.id }); assert.ifError(before.error);
  const subs = await rpc('owner', 'replace_client_request_sub_lots_v1', { p_request_id: lotB.data.id, p_expected_request_version_id: before.data.requestVersionId, p_items: [{ title: 'Salle de bain', scope: 'Créé à la main' }] });
  assert.ifError(subs.error); const subLotId = subs.data.items[0].id as string;

  const api = (who: string) => createProjectWorkItemsHandler(users[who].db, async () => ({ id: users[who].id }));
  const post = async (who: string, body: any) => { const r = await api(who)(new Request('https://dao.test/api/projects/work-items', { method: 'POST', headers: { authorization: 'Bearer real' }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
  const read = async (who: string) => { const r = await api(who)(new Request(`https://dao.test/api/projects/work-items?project_id=${projectId}`, { headers: { authorization: 'Bearer real' } })); return { status: r.status, body: await r.json() }; };

  const added = await post('owner', { action: 'add', idempotencyKey: 'wi577-real-add-1', requestId: lotB.data.id, items: [{ subLotId, workId }, { subLotId, workId: otherWork.data.id }] });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  const direct = await post('owner', { action: 'add', idempotencyKey: 'wi577-real-add-2', requestId: lotA.data.id, items: [{ workId }] });
  assert.equal(direct.status, 200, JSON.stringify(direct.body));
  const replay = await post('owner', { action: 'add', idempotencyKey: 'wi577-real-add-2', requestId: lotA.data.id, items: [{ workId }] });
  assert.deepEqual(replay.body.data.createdIds, direct.body.data.createdIds);

  // Rechargement : mêmes occurrences, mêmes rattachements.
  const reload = await read('owner'); assert.equal(reload.status, 200);
  const lotsById = Object.fromEntries(reload.body.data.lots.map((l: any) => [l.requestId, l]));
  assert.equal(lotsById[lotB.data.id].items.length, 2); assert.equal(lotsById[lotA.data.id].items.length, 1);
  assert.ok(lotsById[lotB.data.id].items.every((i: any) => i.subLotId === subLotId));
  assert.equal(lotsById[lotA.data.id].items[0].subLotId, null);
  const itemA = lotsById[lotA.data.id].items[0]; const itemB = lotsById[lotB.data.id].items.find((i: any) => i.workId === workId);
  assert.notEqual(itemA.id, itemB.id);

  // Permissions négatives : autre Client, Artisan, anonyme, écriture directe.
  assert.equal((await read('stranger')).status, 403);
  assert.equal((await read('pro')).status, 403);
  assert.equal((await post('stranger', { action: 'remove', idempotencyKey: 'wi577-real-x-1', itemId: itemA.id, expectedRevision: 1 })).status, 403);
  assert.equal((await post('pro', { action: 'add', idempotencyKey: 'wi577-real-x-2', requestId: lotA.data.id, items: [{ workId }] })).status, 403);
  assert.ok((await anon.rpc('project_work_items_snapshot_v1', { p_project_id: projectId })).error);
  assert.ok((await users.owner.db.from('project_work_items').select('id')).error, 'no direct table access');
  assert.ok((await users.owner.db.from('project_work_items').update({ label: 'forgé' }).eq('id', itemA.id)).error);

  // Métré rattaché à l'occurrence (même ouvrage dans deux lots : deux métrés distincts).
  const takeoff = (who: string, input: any, idem: string) => rpc(who, 'btp_takeoff_command_v1', { p_action: 'calculate', p_input: input, p_idempotency_key: idem });
  const noItem = await takeoff('owner', { projectId, workId, scopeKey: 'default', label: 'Sans occurrence', canonicalInputs: {} }, 'wi577-real-tk-0');
  assert.equal(noItem.error?.code, '22023');
  const tkA = await takeoff('owner', { projectId, workId, workItemId: itemA.id, scopeKey: 'default', label: 'Lot A', canonicalInputs: {} }, 'wi577-real-tk-1'); assert.ifError(tkA.error);
  const tkB = await takeoff('owner', { projectId, workId, workItemId: itemB.id, scopeKey: 'default', label: 'Lot B', canonicalInputs: {} }, 'wi577-real-tk-2'); assert.ifError(tkB.error);
  assert.equal(tkA.data.workItemId, itemA.id); assert.equal(tkB.data.workItemId, itemB.id);
  assert.equal((await rpc('pro', 'btp_takeoff_snapshot_v1', { p_project_id: projectId })).error?.code, '42501');
  const proRows = await users.pro.db.from('btp_takeoffs').select('id').eq('project_id', projectId); assert.ifError(proRows.error); assert.equal(proRows.data.length, 0);

  // Estimation : une ligne par occurrence, regroupée sous les lots réels, sans prix inventé.
  const preview = await rpc('owner', 'btp_estimate_command_v1', { p_action: 'preview', p_input: { projectId, mode: 'reference' }, p_idempotency_key: null });
  assert.ifError(preview.error);
  const lines = preview.data.result.lines.filter((l: any) => l.workId === workId);
  assert.equal(lines.length, 2); assert.ok(lines.every((l: any) => l.quantity === null));
  assert.deepEqual(new Set(preview.data.result.byLot.map((g: any) => g.lotId)), new Set([lotA.data.id, lotB.data.id]));

  // Publication : instantané commercial sans dimensions ; le lot publié est figé.
  const latest = lotsById[lotB.data.id].requestVersionId;
  const pv = await admin.from('project_versions').select('id').eq('project_id', projectId).order('version_no', { ascending: false }).limit(1).single(); assert.ifError(pv.error);
  const pub = await admin.from('publications').insert({ project_id: projectId, project_version_id: pv.data.id, visibility: 'public', safe_title: 'Test 577', safe_description: 'test', governorate_id: gov.data.id, project_type: 'renovation' }).select('id').single(); assert.ifError(pub.error);
  const pr = await admin.from('publication_requests').insert({ publication_id: pub.data.id, request_version_id: latest, trade_id: trade.data.id, safe_title: 'Lot avec sous-lot', safe_scope: 'test' }).select('works_scope').single();
  assert.ifError(pr.error);
  assert.equal(pr.data.works_scope.length, 2);
  for (const w of pr.data.works_scope) assert.deepEqual(Object.keys(w).sort(), ['custom', 'id', 'label', 'subLotId', 'toConfirm', 'unitCode', 'workCode']);
  const locked = await post('owner', { action: 'add', idempotencyKey: 'wi577-real-add-3', requestId: lotB.data.id, items: [{ workId: otherWork.data.id }] });
  assert.equal(locked.status, 409); assert.equal(locked.body.code, 'LOCKED');
});
