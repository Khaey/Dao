// Assistant BTP (Coordinateur Mission 1) : brouillon append-only, RLS propriétaire
// et création atomique idempotente du chantier (lots + sous-lots officiels).
export async function projectAssistantCases(db, test, { U, gov, as }) {
  const eq = (a, b) => { if (a !== b) throw Error(`Expected ${b}, received ${a}`); };
  const denied = async (fn, code) => { try { await fn(); } catch (e) { if (code) eq(e.code, code); return; } throw Error('Unexpected success'); };
  const item = (id, code, kind, parentId, label, extra = {}) => ({ id, code, kind, parentId, label, tradeCode: null, unit: null, relevance: 'usual', selected: true, origin: 'usual', tentative: false, provenance: { source: 'fixture', version: 'fixture-1' }, ...extra });
  const items = [
    item('fx:lot_plumbing', 'lot_plumbing', 'lot', null, 'Plomberie et sanitaires', { tradeCode: 'plumbing' }),
    item('fx:sub_sanitary', 'sub_sanitary', 'sub_lot', 'fx:lot_plumbing', 'Équipements sanitaires'),
    item('fx:work_bathroom', 'work_bathroom', 'work', 'fx:sub_sanitary', 'Équipement des salles de bain', { relevance: 'verify' }),
    item('fx:lot_unknown_trade', 'lot_unknown_trade', 'lot', null, 'Lot au métier inconnu', { tradeCode: 'does_not_exist' }),
    item('fx:lot_pool', 'lot_pool', 'lot', null, 'Piscine', { tradeCode: 'trade_pool', selected: false }),
  ];
  const draft = (extra = {}) => ({ projectType: 'renovation', description: 'Rénovation salle de bain', title: 'Rénovation d’un appartement', governorateId: gov,
    proposal: { items, decisions: [] }, referential: { provider: 'fixture', catalogVersion: 'fixture-1' }, engineMode: 'rules', ...extra });
  const save = (id, rev, kind, payload) => db.query('select public.save_project_assistant_draft_v1($1,$2,$3,$4,$5::jsonb) as d', [id, rev, kind, 'cmd', JSON.stringify(payload)]).then(r => r.rows[0].d);

  let d;
  await test('assistant: client saves a draft and each revision is append-only', () => as('clientA', async () => {
    d = await save(null, null, 'analyze', draft());
    eq(d.revision, 1); eq(d.status, 'draft'); eq(d.creation_key, undefined);
    const next = await save(d.id, 1, 'edit', draft({ description: 'Rénovation salle de bain et cuisine' }));
    eq(next.revision, 2);
    await denied(() => save(d.id, 1, 'edit', draft()), '40001');
    eq((await db.query('select count(*)::int c from public.project_assistant_draft_revisions where draft_id=$1', [d.id])).rows[0].c, 2);
    await denied(() => db.query('update public.project_assistant_draft_revisions set command=null where draft_id=$1', [d.id]));
    await denied(() => db.query("update public.project_assistant_drafts set title='x' where id=$1", [d.id]), '42501');
    await denied(() => save(null, null, 'analyze', { ...draft(), sql: 'drop table projects' }), '22023');
  }));

  await test('assistant: another client can neither read nor change the draft', () => as('clientB', async () => {
    eq((await db.query('select count(*)::int c from public.project_assistant_drafts where id=$1', [d.id])).rows[0].c, 0);
    eq((await db.query('select count(*)::int c from public.project_assistant_draft_revisions where draft_id=$1', [d.id])).rows[0].c, 0);
    await denied(() => save(d.id, 2, 'edit', draft()), 'P0002');
    await denied(() => db.query('select public.create_project_from_assistant_draft_v1($1,$2)', [d.id, 'creation-key-b']), 'P0002');
  }));

  await test('assistant: a non-owner professional cannot create a project from the draft', () => as('proA', async () => {
    await denied(() => db.query('select public.create_project_from_assistant_draft_v1($1,$2)', [d.id, 'creation-key-pro'])); // 42501 (rôle) ou P0002 (pas propriétaire)
  }));

  await test('assistant: creation builds draft project, lots and sub-lots once, idempotently', () => as('clientA', async () => {
    const first = (await db.query('select public.create_project_from_assistant_draft_v1($1,$2) as r', [d.id, 'creation-key-1'])).rows[0].r;
    eq(first.created, true); eq(first.lots, 2);
    const again = (await db.query('select public.create_project_from_assistant_draft_v1($1,$2) as r', [d.id, 'creation-key-2'])).rows[0].r;
    eq(again.projectId, first.projectId); eq(again.created, false);
    const project = (await db.query('select p.status,p.client_id,v.title,v.description from public.projects p join public.project_versions v on v.project_id=p.id where p.id=$1', [first.projectId])).rows[0];
    eq(project.status, 'draft'); eq(project.client_id, U.clientA); eq(project.title, 'Rénovation d’un appartement');
    if (!/Aucun prix, quantité ni délai/.test(project.description)) throw Error('missing no-estimate notice');
    const lots = (await db.query('select rv.title,t.code,rv.budget_millimes from public.project_request_versions rv join public.trades t on t.id=rv.trade_id where rv.project_id=$1 order by rv.title', [first.projectId])).rows;
    eq(lots.length, 2); eq(lots[0].code, 'general_contractor'); eq(lots[1].code, 'plumbing'); eq(lots[1].budget_millimes, null);
    const subs = (await db.query('select title,scope,budget_millimes from public.request_sub_lot_versions where project_id=$1', [first.projectId])).rows;
    eq(subs.length, 1); eq(subs[0].title, 'Équipements sanitaires'); eq(subs[0].budget_millimes, null);
    if (!/Équipement des salles de bain \(à vérifier\)/.test(subs[0].scope)) throw Error('work missing in sub-lot scope');
    eq((await db.query('select count(*)::int c from public.project_assistant_scope_links where project_id=$1', [first.projectId])).rows[0].c, 4);
    eq((await db.query("select count(*)::int c from public.project_assistant_scope_links where project_id=$1 and item_id='fx:lot_pool'", [first.projectId])).rows[0].c, 0);
    await denied(() => save(d.id, 4, 'edit', draft()), '23514');
  }));

  await test('assistant: creation requires a governorate and at least one lot', () => as('clientA', async () => {
    const noGov = await save(null, null, 'analyze', draft({ governorateId: null }));
    await denied(() => db.query('select public.create_project_from_assistant_draft_v1($1,$2)', [noGov.id, 'creation-key-3']), '23514');
    const noLot = await save(null, null, 'analyze', draft({ proposal: { items: [items[4]] } }));
    await denied(() => db.query('select public.create_project_from_assistant_draft_v1($1,$2)', [noLot.id, 'creation-key-4']), '23514');
    const orphan = await save(null, null, 'analyze', draft({ proposal: { items: [items[0], item('fx:w', 'w', 'work', 'fx:missing', 'Orphelin')] } }));
    await denied(() => db.query('select public.create_project_from_assistant_draft_v1($1,$2)', [orphan.id, 'creation-key-5']), '23514');
    const abandoned = (await db.query('select public.abandon_project_assistant_draft_v1($1) as r', [noGov.id])).rows[0].r;
    eq(abandoned.status, 'abandoned');
  }));

  await test('assistant: anon has no access to drafts or commands', async () => {
    await db.exec("set role anon; select set_config('request.jwt.claim.sub','',false)");
    try {
      await denied(() => db.query('select * from public.project_assistant_drafts'), '42501');
      await denied(() => db.query('select public.save_project_assistant_draft_v1(null,null,$1,null,$2::jsonb)', ['analyze', '{}']), '42501');
    } finally { await db.exec('reset role'); }
  });
}

// Référentiel réel DEV 5 (#541) lu par un Client, adapté au contrat v1 puis exploité par le moteur.
export async function projectAssistantRealReferentialCases(db, test, { as }) {
  const eq = (a, b) => { if (a !== b) throw Error(`Expected ${b}, received ${a}`); };
  const { mapDaoCatalog } = await import('../dist/src/assistant/referential/daoReferential.js');
  const { validateReferentialSnapshot } = await import('../dist/src/assistant/referential/contract.js');
  const { buildProposal, initialState, interpretCommand } = await import('../dist/src/assistant/engine.js');
  await test('assistant: published DEV 5 referential satisfies contract v1 and drives proposals', () => as('clientA', async () => {
    const catalog = (await db.query("select public.btp_catalog_snapshot(null,'TN') as c")).rows[0].c;
    const trades = new Map((await db.query('select id,code from public.trades')).rows.map(r => [r.id, r.code]));
    const snapshot = mapDaoCatalog(catalog, trades);
    eq(JSON.stringify(validateReferentialSnapshot(snapshot)), '[]');
    eq(snapshot.items.filter(i => i.kind === 'lot').every(i => i.tradeCode), true);
    const selected = state => new Set(buildProposal(snapshot, state).items.filter(i => i.selected).map(i => i.code));
    const villa = initialState('Villa R+1 à Sousse, garage, cuisine séparée, 2 salles de bain, jardin et terrasse si possible, sans piscine, plans absents.', null);
    const a = selected(villa);
    for (const code of ['btp_work_foundations', 'btp_work_garage', 'btp_work_kitchen', 'btp_work_terrace', 'btp_work_architectural_plans']) if (!a.has(code)) throw Error('villa missing ' + code);
    if (a.has('btp_work_pool')) throw Error('pool must stay excluded');
    const reno = selected(initialState('Rénovation de mon appartement : salle de bain et peinture.', null));
    for (const code of ['btp_work_foundations', 'btp_work_earthworks', 'btp_lot_earth_structure']) if (reno.has(code)) throw Error('renovation proposes ' + code);
    const edited = interpretCommand(snapshot, villa, 'retire le garage et ajoute des fenêtres');
    const e = selected(edited.state);
    eq(e.has('btp_work_garage'), false); eq(e.has('btp_work_external_joinery'), true);
  }));
}
