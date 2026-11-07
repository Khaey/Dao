// #577 — Ouvrages du chantier : occurrences persistantes Lot → Sous-lot facultatif → Ouvrage,
// métrés rattachés, estimation par lot réel, instantané commercial publié, reprise idempotente.
// PGlite : JWT simulé par claim SQL (aucune Auth Supabase réelle ici ; la CI réelle couvre l'API).
import { randomUUID } from 'node:crypto';

export async function projectWorkItemsCases(db, test, { U, gov, as }) {
  const eq = (a, b, label = '') => { if (a !== b) throw Error(`${label}Expected ${JSON.stringify(b)}, received ${JSON.stringify(a)}`); };
  const ok = (value, label) => { if (!value) throw Error(label); };
  const rejects = async (fn, code) => { try { await fn(); } catch (e) { if (code) eq(e.code, code, `[${e.message}] `); return e; } throw Error('Unexpected success'); };
  const one = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const snapshot = projectId => one('select public.project_work_items_snapshot_v1($1)', [projectId]);
  const command = (action, input, key = `wi-${randomUUID()}`) => one('select public.project_work_item_command_v1($1,$2::jsonb,$3)', [action, JSON.stringify(input), key]);
  const takeoff = (action, input, key = `tk-${randomUUID()}`) => one('select public.btp_takeoff_command_v1($1,$2::jsonb,$3)', [action, JSON.stringify(input), key]);
  const estimate = input => one("select public.btp_estimate_command_v1('preview',$1::jsonb,null)", [JSON.stringify(input)]);
  const work = async code => (await db.query("select w.id,w.unit_code,w.catalog_version_id from public.btp_works w join public.btp_catalog_versions v on v.id=w.catalog_version_id and v.status='published' where w.code=$1", [code])).rows[0];
  const trade = await one("select id from public.trades where code='general_contractor'");
  // Ouvrage calculable du référentiel publié : modèle de métré actif.
  const measurable = (await db.query(`select w.id,w.code,w.unit_code,m.input_schema from public.btp_measurement_templates m
    join public.btp_works w on w.id=m.work_id and w.catalog_version_id=m.catalog_version_id
    join public.btp_catalog_versions v on v.id=m.catalog_version_id and v.status='published'
    where m.active and w.active order by w.code limit 1`)).rows[0];
  const other = (await db.query("select w.id,w.code from public.btp_works w join public.btp_catalog_versions v on v.id=w.catalog_version_id and v.status='published' where w.active and w.id<>$1 order by w.code limit 1", [measurable.id])).rows[0];
  const unitOf = name => name.endsWith('_m3') ? 'm3' : name.endsWith('_m2') ? 'm2' : name.endsWith('_m') ? 'm' : 'unit';
  const inputs = value => Object.fromEntries((measurable.input_schema.required ?? []).map(name => [name, { value, unit: unitOf(name), source: { kind: 'manual', reference: 'Relevé test #577' }, original: { value, unit: unitOf(name) } }]));

  let project, lotA, lotB, subB, items;
  await test('work items: manual Client lot, optional sub-lot and works persist with stable ids', () => as('clientA', async () => {
    project = await one("select (public.create_project_draft('renovation',null,null,null,$1)).id", [gov]);
    lotA = await one('select (public.add_project_request($1,$2,$3,$4,null::bigint)).id', [project, trade, 'Gros œuvre', 'Lot sans sous-lot']);
    lotB = await one('select (public.add_project_request($1,$2,$3,$4,null::bigint)).id', [project, trade, 'Revêtements', 'Lot avec sous-lot']);
    const before = await one('select public.native_request_sub_lots_v1($1)', [lotB]);
    const subs = await one('select public.replace_client_request_sub_lots_v1($1,$2,$3::jsonb)', [lotB, before.requestVersionId, JSON.stringify([{ title: 'Salle de bain', scope: 'Sous-lot manuel' }])]);
    subB = subs.items[0].id;
    // Aucune dimension ni quantité : une sélection n'est ni un métré ni un devis.
    await command('add', { requestId: lotB, items: [{ subLotId: subB, workId: measurable.id }, { subLotId: subB, workId: other.id }] });
    await command('add', { requestId: lotA, items: [{ workId: measurable.id }, { label: 'Pergola sur mesure', confirmation: 'to_confirm' }] });
    const first = await snapshot(project);
    const second = await snapshot(project); // « rechargement »
    eq(JSON.stringify(first), JSON.stringify(second));
    const a = first.lots.find(l => l.requestId === lotA); const b = first.lots.find(l => l.requestId === lotB);
    eq(a.items.length, 2); eq(b.items.length, 2);
    eq(b.items.every(i => i.subLotId === subB && i.subLotCurrent), true);
    eq(a.items[0].subLotId, null); eq(a.items[0].workId, measurable.id); eq(a.items[0].measurable, true);
    eq(a.items[1].custom, true); eq(a.items[1].workId, null); eq(a.items[1].measurable, false); eq(a.items[1].confirmation, 'to_confirm');
    // Même ouvrage dans deux parties du chantier : deux occurrences distinctes.
    const sameWork = [...a.items, ...b.items].filter(i => i.workId === measurable.id);
    eq(sameWork.length, 2); ok(sameWork[0].id !== sameWork[1].id, 'occurrences must differ');
    items = { aWork: a.items[0], aCustom: a.items[1], bWork: b.items.find(i => i.workId === measurable.id), bOther: b.items.find(i => i.workId === other.id) };
    eq((await db.query('select count(*)::int c from public.btp_takeoffs where project_id=$1', [project])).rows[0].c, 0);
  }));

  await test('work items: idempotent replay, strict validation and catalogue labels', () => as('clientA', async () => {
    const key = 'wi-replay-577-0001';
    const once = await command('add', { requestId: lotA, items: [{ workId: other.id }] }, key);
    const twice = await command('add', { requestId: lotA, items: [{ workId: other.id }] }, key);
    eq(JSON.stringify(once.createdIds), JSON.stringify(twice.createdIds));
    eq((await snapshot(project)).lots.find(l => l.requestId === lotA).items.length, 3);
    await rejects(() => command('add', { requestId: lotA, items: [{ workId: measurable.id }] }, key), '22023');
    await rejects(() => command('add', { requestId: lotA, items: [{ workId: randomUUID() }] }), '22023');
    await rejects(() => command('add', { requestId: lotA, items: [{ workId: measurable.id, label: 'Libellé forgé' }] }), '22023');
    await rejects(() => command('add', { requestId: lotA, items: [{ label: 'x' }] }), '22023');
    await rejects(() => command('add', { requestId: lotA, items: [{ subLotId: subB, workId: measurable.id }] }), '22023'); // sous-lot d'un autre lot
    await rejects(() => command('add', { requestId: lotA, items: [{ quantity: '12' }] }), '22023');
    const extra = (await snapshot(project)).lots.find(l => l.requestId === lotA).items.find(i => i.workId === other.id);
    const removed = await command('remove', { itemId: extra.id, expectedRevision: extra.revision });
    eq(removed.removedCount, 1);
  }));

  await test('work items: other Clients, Artisans and anonymous are refused; no direct table access', async () => {
    await as('clientB', () => rejects(() => snapshot(project), '42501'));
    await as('clientB', () => rejects(() => command('add', { requestId: lotA, items: [{ workId: other.id }] }), '42501'));
    await as('proA', () => rejects(() => snapshot(project), '42501'));
    await as('proA', () => rejects(() => command('remove', { itemId: items.aWork.id, expectedRevision: 1 }), '42501'));
    await as('clientA', () => rejects(() => db.query('select * from public.project_work_items'), '42501'));
    await as('clientA', () => rejects(() => db.query("update public.project_work_items set label='forgé'"), '42501'));
    await as('clientA', () => rejects(() => db.query('select * from public.project_work_item_events'), '42501'));
    await as('clientA', () => rejects(() => db.query("select dao_private.link_legacy_takeoffs_v1(null)"), '42501'));
    await db.exec('set role anon');
    try { await rejects(() => snapshot(project), '42501'); } finally { await db.exec('reset role'); }
    // Gestionnaire non affecté (Admin = gestion plateforme) : lecture autorisée, édition réservée au propriétaire.
    await as('admin', async () => { eq((await snapshot(project)).canEdit, false); await rejects(() => command('add', { requestId: lotA, items: [{ workId: other.id }] }), '42501'); });
  });

  await test('work items: update moves to the lot, revision guard and append-only history', () => as('clientA', async () => {
    const moved = await command('update', { itemId: items.bOther.id, expectedRevision: 1, subLotId: null, confirmation: 'to_confirm' });
    const item = moved.lots.find(l => l.requestId === lotB).items.find(i => i.id === items.bOther.id);
    eq(item.subLotId, null); eq(item.confirmation, 'to_confirm'); eq(item.revision, 2);
    await rejects(() => command('update', { itemId: items.bOther.id, expectedRevision: 1, confirmation: 'selected' }), '40001');
    await rejects(() => command('update', { itemId: items.bOther.id, expectedRevision: 2, label: 'Renommer un ouvrage canonique' }), '22023');
    const history = await one('select public.project_work_item_history_v1($1)', [items.bOther.id]);
    eq(history.events.map(e => e.type).join(','), 'created,updated');
    ok(history.events[0].requestVersionId, 'event must record the lot version');
    await db.exec('reset role');
    await rejects(() => db.query('delete from public.project_work_item_events where work_item_id=$1', [items.bOther.id]), '23514');
    await rejects(() => db.query('delete from public.project_work_items where id=$1', [items.bOther.id]), '23514');
    await rejects(() => db.query('update public.project_work_items set work_id=null where id=$1', [items.bOther.id]), '23514');
  }));

  let tk;
  await test('takeoffs: a new takeoff points to its occurrence; same work in two places stays separate', () => as('clientA', async () => {
    await rejects(() => takeoff('calculate', { projectId: project, workId: measurable.id, scopeKey: 'default', label: 'Sans occurrence', canonicalInputs: {} }), '22023');
    await rejects(() => takeoff('calculate', { projectId: project, workId: measurable.id, workItemId: items.bOther.id, scopeKey: 'default', label: 'Mauvais ouvrage', canonicalInputs: {} }), '22023');
    tk = await takeoff('calculate', { projectId: project, workId: measurable.id, workItemId: items.aWork.id, scopeKey: 'default', label: 'Lot A', canonicalInputs: inputs('2') });
    const tkB = await takeoff('calculate', { projectId: project, workId: measurable.id, workItemId: items.bWork.id, scopeKey: 'default', label: 'Lot B', canonicalInputs: {} });
    eq(tk.workItemId, items.aWork.id); eq(tkB.workItemId, items.bWork.id);
    // Deux métrés indépendants sur la même occurrence (mur nord / mur sud).
    const north = await takeoff('calculate', { projectId: project, workId: measurable.id, workItemId: items.aWork.id, scopeKey: 'mur-nord', label: 'Mur nord', canonicalInputs: {} });
    eq(north.workItemId, items.aWork.id);
    await rejects(() => takeoff('calculate', { projectId: project, workId: measurable.id, workItemId: items.aWork.id, scopeKey: 'default', label: 'Doublon', canonicalInputs: {} }), '23505');
    // Ouvrage doté de métrés : retrait refusé (aucun métré orphelin).
    const fresh = (await snapshot(project)).lots.find(l => l.requestId === lotA).items.find(i => i.id === items.aWork.id);
    eq(fresh.takeoffs, 2);
    await rejects(() => command('remove', { itemId: items.aWork.id, expectedRevision: fresh.revision }), '23514');
    // Un recalcul garde l'occurrence ; deux révisions ne comptent qu'une fois.
    tk = await takeoff('calculate', { projectId: project, workId: measurable.id, workItemId: items.aWork.id, takeoffId: tk.id, expectedRevision: 1, scopeKey: 'default', label: 'Lot A', canonicalInputs: inputs('3') });
    eq(tk.currentRevision, 2); eq(tk.workItemId, items.aWork.id);
    tk = await takeoff('submit', { takeoffId: tk.id, expectedRevision: 2 });
  }));

  await test('takeoffs are private: Artisan and other Client read nothing', async () => {
    await as('admin', async () => { tk = await takeoff('validate', { takeoffId: tk.id, expectedRevision: 2 }); eq(tk.validatedRevision, 2); });
    await as('proA', () => rejects(() => db.query('select public.btp_takeoff_snapshot_v1($1)', [project]), '42501'));
    await as('proA', async () => eq((await db.query('select count(*)::int c from public.btp_takeoffs where project_id=$1', [project])).rows[0].c, 0));
    await as('clientB', async () => eq((await db.query('select count(*)::int c from public.btp_takeoff_revisions r join public.btp_takeoffs t on t.id=r.takeoff_id where t.project_id=$1', [project])).rows[0].c, 0));
  });

  await test('estimate: one line per occurrence, grouped by real lot and sub-lot, nothing invented', () => as('clientA', async () => {
    const r = (await estimate({ projectId: project, mode: 'reference' })).result;
    const same = r.lines.filter(l => l.workId === measurable.id);
    eq(same.length, 2, 'two occurrences of the same work: ');
    const lineA = same.find(l => l.workItemId === items.aWork.id); const lineB = same.find(l => l.workItemId === items.bWork.id);
    eq(lineA.quantitySource.kind, 'takeoff'); eq(lineA.quantitySource.revision, 2); ok(lineA.quantity, 'validated quantity expected');
    eq(lineB.quantity, null); ok(lineB.missing.includes('quantity_missing'), 'occurrence without validated takeoff has no quantity');
    eq(lineA.requestId, lotA); eq(lineB.requestId, lotB); eq(lineB.projectSubLotId, subB); eq(lineB.projectSubLotTitle, 'Salle de bain');
    const custom = r.lines.find(l => l.workItemId === items.aCustom.id);
    eq(custom.status, 'missing'); ok(custom.missing.includes('custom_work_without_catalog_reference'), 'custom work never priced');
    eq(r.totals.htMinMinor, null); // aucun tarif réel vérifié : aucun total inventé
    const groups = r.byLot.map(g => g.lotId);
    eq(groups[0], lotA); eq(groups[1], lotB);
    const gB = r.byLot.find(g => g.lotId === lotB);
    eq(gB.lotLabel, 'Revêtements');
    ok(gB.subLots.some(s => s.subLotId === subB && s.title === 'Salle de bain'), 'sub-lot subtotal');
    ok(gB.subLots.some(s => s.subLotId === null && s.title === 'Directement dans le lot'), 'direct-in-lot subtotal');
    eq(r.lines.filter(l => l.workItemId === items.aWork.id).length, 1, 'validated takeoff replaces the empty occurrence line: ');
  }));

  await test('estimate: an unlinked legacy takeoff with the same work/scope never hides nor doubles an occurrence', async () => {
    // Métré validé sur l'occurrence B (même périmètre « default » que celui de A), puis détaché pour simuler un ancien métré.
    let tkB = (await as('clientA', () => one('select public.btp_takeoff_snapshot_v1($1)', [project]))).items.find(t => t.workItemId === items.bWork.id && t.scopeKey === 'default');
    tkB = await as('clientA', () => takeoff('calculate', { projectId: project, workId: measurable.id, takeoffId: tkB.id, expectedRevision: tkB.currentRevision, scopeKey: 'default', label: 'Lot B', canonicalInputs: inputs('5') }));
    tkB = await as('clientA', () => takeoff('submit', { takeoffId: tkB.id, expectedRevision: tkB.currentRevision }));
    tkB = await as('admin', () => takeoff('validate', { takeoffId: tkB.id, expectedRevision: tkB.currentRevision }));
    await db.query('update public.btp_takeoffs set project_work_item_id=null where id=$1', [tkB.id]);
    try {
      const r = (await as('clientA', () => estimate({ projectId: project, mode: 'reference' }))).result;
      const same = r.lines.filter(l => l.workId === measurable.id);
      eq(same.filter(l => l.quantity).length, 1, 'only the linked takeoff of A carries a quantity: ');
      eq(same.find(l => l.workItemId === items.aWork.id).quantitySource.kind, 'takeoff');
      eq(same.find(l => l.workItemId === items.bWork.id).quantity, null);
      eq(same.some(l => l.unlinked), false, 'legacy takeoff waits for assignment: ');
      // Une ligne explicite ouvrage/périmètre ne masque plus le métré rattaché de A.
      const withExplicit = (await as('clientA', () => estimate({ projectId: project, mode: 'reference', lines: [{ workId: measurable.id, scopeKey: 'default', source: { kind: 'none' } }] }))).result;
      eq(withExplicit.lines.filter(l => l.workItemId === items.aWork.id && l.quantity).length, 1);
    } finally {
      await db.query('update public.btp_takeoffs set project_work_item_id=$2 where id=$1', [tkB.id, items.bWork.id]);
    }
  });

  await test('publication: immutable commercial snapshot with works, no private data, then locked', async () => {
    const rv = (await snapshot_as('clientA', project)).lots.find(l => l.requestId === lotB).requestVersionId;
    const pv = await one('select id from public.project_versions where project_id=$1 order by version_no desc limit 1', [project]);
    const pub = await one("insert into public.publications(project_id,project_version_id,visibility,safe_title,safe_description,governorate_id,project_type) values($1,$2,'public','Rénovation','test',$3,'renovation') returning id", [project, pv, gov]);
    const pr = await one("insert into public.publication_requests(publication_id,request_version_id,trade_id,safe_title,safe_scope) values($1,$2,$3,'Revêtements','Lot avec sous-lot') returning works_scope", [pub, rv, trade]);
    eq(pr.length, 2);
    const allowed = ['custom', 'id', 'label', 'subLotId', 'toConfirm', 'unitCode', 'workCode'];
    eq(pr.every(w => JSON.stringify(Object.keys(w).sort()) === JSON.stringify(allowed)), true, 'no private keys: ');
    eq(JSON.stringify(pr).includes('canonicalInputs') || JSON.stringify(pr).includes('quantity'), false);
    await as('clientA', async () => {
      const lot = (await snapshot(project)).lots.find(l => l.requestId === lotB);
      eq(lot.lockReason, 'published');
      await rejects(() => command('add', { requestId: lotB, items: [{ workId: other.id }] }), '23514');
      await rejects(() => command('update', { itemId: items.bOther.id, expectedRevision: 2, confirmation: 'selected' }), '23514');
    });
    await rejects(() => db.query("update public.publication_requests set works_scope='[]'::jsonb where publication_id=$1", [pub]), '23514');
  });

  await test('assistant: creation transcribes works once; replay and backfill never duplicate', () => as('clientA', async () => {
    const proposal = { decisions: [], items: [
      { id: 'fx:lot_tiling', code: 'lot_tiling', kind: 'lot', parentId: null, label: 'Revêtements', tradeCode: 'general_contractor', unit: null, relevance: 'usual', selected: true, origin: 'usual', tentative: false },
      { id: 'fx:sub_floor', code: 'sub_floor', kind: 'sub_lot', parentId: 'fx:lot_tiling', label: 'Sols', unit: null, relevance: 'usual', selected: true, origin: 'usual', tentative: false },
      { id: measurable.id, code: measurable.code, kind: 'work', parentId: 'fx:sub_floor', label: 'Ouvrage du référentiel', unit: measurable.unit_code, relevance: 'usual', selected: true, origin: 'usual', tentative: false },
      { id: 'fx:work_custom', code: 'work_custom', kind: 'work', parentId: 'fx:sub_floor', label: 'Ouvrage hors référentiel', unit: null, relevance: 'verify', selected: true, origin: 'usual', tentative: false },
    ] };
    const draft = await one('select public.save_project_assistant_draft_v1(null,null,$1,$2,$3::jsonb)', ['analyze', 'cmd', JSON.stringify({ projectType: 'renovation', description: 'Appartement à rénover', title: 'Appartement #577', governorateId: gov, proposal, referential: { provider: 'fixture', catalogVersion: 'fixture-577' }, engineMode: 'rules' })]);
    const created = await one('select public.create_project_from_assistant_draft_v1($1,$2)', [draft.id, 'creation-577-0001']);
    const again = await one('select public.create_project_from_assistant_draft_v1($1,$2)', [draft.id, 'creation-577-0002']);
    eq(again.projectId, created.projectId);
    const snap = await snapshot(created.projectId);
    const all = snap.lots.flatMap(l => l.items);
    eq(all.length, 2); eq(all.every(i => i.origin === 'assistant' && i.subLotId && i.subLotCurrent), true);
    eq(all.find(i => i.workId === measurable.id).custom, false);
    const custom = all.find(i => i.custom); eq(custom.label, 'Ouvrage hors référentiel'); eq(custom.confirmation, 'to_confirm');
    await db.exec('reset role');
    eq((await one('select dao_private.import_assistant_work_items_v1(null)')).imported, 0);
    eq((await one('select count(*)::int from public.project_work_items where project_id=$1', [created.projectId])), 2);
    eq((await one("select count(*)::int from dao_private.project_work_item_migration_log where kind='assistant_work_not_in_catalog' and project_id=$1", [created.projectId])), 1);
  }));

  await test('legacy takeoffs: linked only when one occurrence matches, otherwise left to assign', async () => {
    const template = (await db.query("select m.id,m.catalog_version_id from public.btp_measurement_templates m join public.btp_catalog_versions v on v.id=m.catalog_version_id and v.status='published' where m.work_id=$1 and m.active", [measurable.id])).rows[0];
    const legacy = await one("insert into public.btp_takeoffs(project_id,catalog_version_id,work_id,template_id,scope_key,label,created_by) values($1,$2,$3,$4,'ancien','Ancien métré',$5) returning id", [project, template.catalog_version_id, measurable.id, template.id, U.clientA]);
    const report = await one('select dao_private.link_legacy_takeoffs_v1($1)', [project]);
    eq(report.linked, 0); eq(report.needsAssignment, 1); // deux occurrences possibles : jamais d'affectation arbitraire
    eq(await one('select project_work_item_id from public.btp_takeoffs where id=$1', [legacy]), null);
    eq((await one("select detail->>'reason' from dao_private.project_work_item_migration_log where kind='takeoff_needs_assignment' and subject_id=$1", [legacy])), 'ambiguous');
    await as('clientB', () => rejects(() => command('link_takeoff', { takeoffId: legacy, itemId: items.bWork.id }), '42501'));
    await as('clientA', () => rejects(() => command('link_takeoff', { takeoffId: legacy, itemId: items.aCustom.id }), '22023'));
    await as('clientA', async () => { await command('link_takeoff', { takeoffId: legacy, itemId: items.bWork.id }); });
    eq(await one('select project_work_item_id from public.btp_takeoffs where id=$1', [legacy]), items.bWork.id);
    // Unique candidate in another project: linked automatically, with evidence.
    const p2 = await one("insert into public.projects(client_id,project_type) values($1,'renovation') returning id", [U.clientA]);
    const r2 = await one('insert into public.project_requests(project_id) values($1) returning id', [p2]);
    const i2 = await one("insert into public.project_work_items(project_id,request_id,catalog_version_id,work_id,work_code,label,unit_code,origin) select $1,$2,w.catalog_version_id,w.id,w.code,w.label_fr,w.unit_code,'import' from public.btp_works w where w.id=$3 and w.catalog_version_id=$4 returning id", [p2, r2, measurable.id, template.catalog_version_id]);
    const t2 = await one("insert into public.btp_takeoffs(project_id,catalog_version_id,work_id,template_id,scope_key,label,created_by) values($1,$2,$3,$4,'default','Ancien',$5) returning id", [p2, template.catalog_version_id, measurable.id, template.id, U.clientA]);
    eq((await one('select dao_private.link_legacy_takeoffs_v1($1)', [p2])).linked, 1);
    eq(await one('select project_work_item_id from public.btp_takeoffs where id=$1', [t2]), i2);
    eq((await one('select dao_private.link_legacy_takeoffs_v1($1)', [p2])).linked, 0); // idempotent
  });

  await test('settings: assistant entry can be hidden; manual works stay available', async () => {
    const settingCommand = (action, input) => db.query('select public.admin_setting_command($1,$2::jsonb) r', [action, JSON.stringify(input)]);
    await as('admin', () => settingCommand('set', { key: 'client.project_assistant', scope: 'global', value: false, reason: 'Recette #577 : assistant masqué', expected_override_id: null }));
    try {
      await as('clientA', () => rejects(() => one('select public.save_project_assistant_draft_v1(null,null,$1,$2,$3::jsonb)', ['analyze', 'cmd', JSON.stringify({ projectType: 'renovation', description: 'Test', title: 'Masqué', governorateId: gov, proposal: { items: [] }, referential: { provider: 'fixture', catalogVersion: 'x' }, engineMode: 'rules' })]), '42501'));
      await as('clientA', async () => { const r = await command('add', { requestId: lotA, items: [{ workId: other.id }] }); ok(r.createdIds.length === 1, 'manual add still works'); });
    } finally {
      const live = await one("select id from dao_private.setting_overrides where key='client.project_assistant' and superseded_at is null");
      await as('admin', () => settingCommand('clear', { key: 'client.project_assistant', scope: 'global', reason: 'Fin de recette #577', expected_override_id: live }));
    }
  });

  await test('work items (#578 review): the same work twice in one sub-lot gives two distinct occurrences', () => as('clientA', async () => {
    const p = await one("select (public.create_project_draft('renovation',null,null,null,$1)).id", [gov]);
    const lot = await one('select (public.add_project_request($1,$2,$3,$4,null::bigint)).id', [p, trade, 'Revêtements', 'Deux pièces']);
    const before = await one('select public.native_request_sub_lots_v1($1)', [lot]);
    const sub = (await one('select public.replace_client_request_sub_lots_v1($1,$2,$3::jsonb)', [lot, before.requestVersionId, JSON.stringify([{ title: 'Chambres', scope: 'Deux chambres' }])])).items[0].id;
    const first = await command('add', { requestId: lot, items: [{ subLotId: sub, workId: measurable.id }] });
    const second = await command('add', { requestId: lot, items: [{ subLotId: sub, workId: measurable.id }] });
    ok(first.createdIds[0] !== second.createdIds[0], 'two occurrences expected');
    const same = (await snapshot(p)).lots[0].items.filter(i => i.workId === measurable.id && i.subLotId === sub);
    eq(same.length, 2); eq(same.every(i => i.measurable && i.modelState === 'available'), true);
    const a = await takeoff('calculate', { projectId: p, workId: measurable.id, workItemId: same[0].id, scopeKey: 'default', label: 'Chambre 1', canonicalInputs: {} });
    const b = await takeoff('calculate', { projectId: p, workId: measurable.id, workItemId: same[1].id, scopeKey: 'default', label: 'Chambre 2', canonicalInputs: {} });
    eq(a.workItemId, same[0].id); eq(b.workItemId, same[1].id);
  }));

  await test('work items (#578 review): an occurrence never borrows a measurement model from another catalogue version', async () => {
    const old = (await db.query(`select w.id,w.code,w.label_fr,w.unit_code,w.catalog_version_id from public.btp_measurement_templates m
      join public.btp_works w on w.id=m.work_id and w.catalog_version_id=m.catalog_version_id
      join public.btp_catalog_versions v on v.id=m.catalog_version_id and v.status<>'published'
      where m.active and exists(select 1 from public.btp_measurement_templates p join public.btp_catalog_versions pv on pv.id=p.catalog_version_id and pv.status='published'
        where p.work_id=m.work_id and p.active) order by w.code limit 1`)).rows[0];
    ok(old, 'fixture: a work with a model in a non-published version and in the published one');
    const p = await one("insert into public.projects(client_id,project_type) values($1,'renovation') returning id", [U.clientA]);
    const r = await one('insert into public.project_requests(project_id) values($1) returning id', [p]);
    const item = await one("insert into public.project_work_items(project_id,request_id,catalog_version_id,work_id,work_code,label,unit_code,origin) values($1,$2,$3,$4,$5,$6,$7,'import') returning id",
      [p, r, old.catalog_version_id, old.id, old.code, old.label_fr, old.unit_code]);
    const json = await one('select dao_private.project_work_item_json($1)', [item]);
    eq(json.measurable, false); eq(json.modelState, 'historical_unavailable'); eq(json.catalogVersionId, old.catalog_version_id); eq(json.unitCode, old.unit_code);
    const e = await as('clientA', () => rejects(() => takeoff('calculate', { projectId: p, workId: old.id, workItemId: item, scopeKey: 'default', label: 'Historique', canonicalInputs: {} }), '22023'));
    eq(e.hint, 'work_item_model_unavailable');
    eq(await one('select count(*)::int from public.btp_takeoffs where project_work_item_id=$1', [item]), 0);
    eq((await one('select dao_private.project_work_item_json($1)', [items.aCustom.id])).modelState, 'custom');
  });

  await test('takeoffs (owner decision 07/11): forecast takeoffs frozen after award; legacy link still allowed', async () => {
    const awarded = (await db.query(`select ai.request_id, ai.project_id, p.client_id from public.award_items ai join public.projects p on p.id=ai.project_id
      where ai.active order by ai.created_at limit 1`)).rows[0];
    ok(awarded, 'fixture: an active award');
    const template = (await db.query("select m.id,m.catalog_version_id from public.btp_measurement_templates m join public.btp_catalog_versions v on v.id=m.catalog_version_id and v.status='published' where m.work_id=$1 and m.active", [measurable.id])).rows[0];
    const item = await one("insert into public.project_work_items(project_id,request_id,catalog_version_id,work_id,work_code,label,unit_code,origin) select $1,$2,w.catalog_version_id,w.id,w.code,w.label_fr,w.unit_code,'import' from public.btp_works w where w.id=$3 and w.catalog_version_id=$4 returning id",
      [awarded.project_id, awarded.request_id, measurable.id, template.catalog_version_id]);
    eq(await one('select dao_private.btp_takeoff_forecast_frozen($1,$2)', [awarded.project_id, item]), true);
    eq(await one('select dao_private.btp_takeoff_forecast_frozen($1,$2)', [project, items.aWork.id]), false);
    const e = await rejects(() => db.query("insert into public.btp_takeoffs(project_id,catalog_version_id,work_id,template_id,scope_key,label,created_by,project_work_item_id) values($1,$2,$3,$4,'apres','Après attribution',$5,$6)",
      [awarded.project_id, template.catalog_version_id, measurable.id, template.id, awarded.client_id, item]), '23514');
    eq(e.hint, 'takeoff_frozen_after_award');
    // Métré antérieur (créé avant l'attribution) : consultable et rattachable, jamais recalculé ni validé.
    await db.exec("alter table public.btp_takeoffs disable trigger btp_takeoffs_frozen_after_award");
    let legacy;
    try { legacy = await one("insert into public.btp_takeoffs(project_id,catalog_version_id,work_id,template_id,scope_key,label,created_by) values($1,$2,$3,$4,'avant','Avant attribution',$5) returning id",
      [awarded.project_id, template.catalog_version_id, measurable.id, template.id, awarded.client_id]); }
    finally { await db.exec("alter table public.btp_takeoffs enable trigger btp_takeoffs_frozen_after_award"); }
    await db.query('update public.btp_takeoffs set project_work_item_id=$2 where id=$1', [legacy, item]);
    await rejects(() => db.query("update public.btp_takeoffs set status='submitted' where id=$1", [legacy]), '23514');
    await rejects(() => db.query("update public.btp_takeoffs set label='Renommé' where id=$1", [legacy]), '23514');
    eq(await one('select project_work_item_id from public.btp_takeoffs where id=$1', [legacy]), item);
  });

  await test('execution takeoffs (owner decision 07/11): after award only, own revisions, never in the forecast estimate', async () => {
    const exec = (action, input, key = `ex-${randomUUID()}`) => one('select public.btp_execution_takeoff_command_v1($1,$2::jsonb,$3)', [action, JSON.stringify(input), key]);
    const awarded = (await db.query(`select ai.request_id, ai.project_id, p.client_id from public.award_items ai join public.projects p on p.id=ai.project_id
      where ai.active order by ai.created_at limit 1`)).rows[0];
    eq(awarded.client_id, U.clientA, 'fixture: awarded project owned by Client A: ');
    const item = await one("select i.id from public.project_work_items i where i.request_id=$1 and i.work_id=$2 and i.status='active' limit 1", [awarded.request_id, measurable.id]);
    ok(item, 'fixture: occurrence on the awarded lot');
    const created = await as('clientA', () => exec('calculate', { projectId: awarded.project_id, workId: measurable.id, workItemId: item, scopeKey: 'execution-1', label: 'Relevé exécution', canonicalInputs: inputs('4') }));
    eq(created.kind, 'execution'); eq(created.workItemId, item); eq(created.currentRevision, 1);
    // Pas de métré d'exécution avant attribution ; pas de prévisionnel après.
    const before = await as('clientA', () => rejects(() => exec('calculate', { projectId: project, workId: measurable.id, workItemId: items.aWork.id, scopeKey: 'execution-1', label: 'Trop tôt', canonicalInputs: {} }), '23514'));
    eq(before.hint, 'execution_takeoff_requires_award');
    await as('clientA', () => rejects(() => takeoff('calculate', { projectId: awarded.project_id, workId: measurable.id, workItemId: item, scopeKey: 'prev-1', label: 'Prévisionnel', canonicalInputs: {} }), '23514'));
    // Révisions propres : recalcul, soumission, validation tracée.
    let t = await as('clientA', () => exec('calculate', { projectId: awarded.project_id, workId: measurable.id, workItemId: item, takeoffId: created.id, expectedRevision: 1, scopeKey: 'execution-1', label: 'Relevé exécution', canonicalInputs: inputs('5') }));
    eq(t.currentRevision, 2); eq(t.kind, 'execution');
    t = await as('clientA', () => exec('submit', { takeoffId: t.id, expectedRevision: 2 }));
    t = await as('admin', () => exec('validate', { takeoffId: t.id, expectedRevision: 2 }));
    eq(t.validatedRevision, 2); eq(t.history.length, 2);
    // Un métré prévisionnel ne passe pas par le point d'entrée « exécution ».
    await as('clientA', () => rejects(() => exec('submit', { takeoffId: tk.id, expectedRevision: tk.currentRevision }), '22023'));
    // L'estimation ne lit jamais un métré d'exécution.
    const r = (await as('clientA', () => estimate({ projectId: awarded.project_id, mode: 'reference' }))).result;
    eq(JSON.stringify(r).includes(t.id), false, 'execution takeoff must not reach the forecast estimate: ');
    await as('clientA', () => rejects(() => estimate({ projectId: awarded.project_id, mode: 'reference', lines: [{ workId: measurable.id, source: { kind: 'takeoff', takeoffId: t.id } }] }), '22023'));
    eq((await as('clientA', () => one('select public.btp_estimate_snapshot_v1($1)', [awarded.project_id]))).takeoffs.some(x => x.id === t.id), false);
    await rejects(() => db.query("update public.btp_takeoffs set kind='forecast' where id=$1", [t.id]), '23514');
    await as('proA', () => rejects(() => exec('calculate', { projectId: awarded.project_id, workId: measurable.id, workItemId: item, scopeKey: 'execution-2', label: 'Artisan', canonicalInputs: {} }), '42501'));
  });

  async function snapshot_as(name, projectId) { return as(name, () => snapshot(projectId)); }
}
