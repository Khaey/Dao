// #547 — administration versionnée du référentiel BTP (PGlite, JWT simulé par claim SQL).
// Brouillon → modification → validation → publication atomique, ids canoniques stables,
// refus non-Admin et immutabilité des versions publiées/archivées.
export async function btpAdminCases(db, test, { as }) {
  const eq = (a, b) => { if (a !== b) throw Error(`Expected ${b}, received ${a}`); };
  const rejects = async (fn, code) => { try { await fn(); } catch (e) { eq(e.code, code); return; } throw Error('Unexpected success'); };
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const admin = (sql, args) => as('admin', async () => Object.values(await one(sql, args))[0]);
  const snapshot = () => as('clientA', async () => (await one("select public.btp_catalog_snapshot(null,'TN') as c")).c);
  const reason = 'Recette #547 locale';
  const works = s => s.lots.flatMap(l => l.subLots.flatMap(x => x.works));
  const { mapDaoCatalog } = await import('../dist/src/assistant/referential/daoReferential.js');
  const { validateReferentialSnapshot } = await import('../dist/src/assistant/referential/contract.js');
  const before = await snapshot();
  // #561 seeds a deliberate draft; archive it here so the existing #547
  // lifecycle assertions can create their isolated TN-2026.2 draft.
  const seeded = await one("select id from public.btp_catalog_versions where code='TN-2026.3' and status='draft'");
  if (seeded) await admin('select public.btp_admin_abandon_draft($1,$2) as r', [seeded.id, 'Préparation recette #547']);
  const masonry = works(before).find(w => w.code === 'btp_work_masonry');
  let draft;

  await test('btp admin: anonymous, Client and Artisan cannot administer the referential', async () => {
    await db.exec('set role anon');
    try { await rejects(() => db.query('select public.btp_admin_catalog()'), '42501'); } finally { await db.exec('reset role'); }
    for (const n of ['clientA', 'proA']) {
      await as(n, () => rejects(() => db.query('select public.btp_admin_catalog()'), '42501'));
      await as(n, () => rejects(() => db.query("select public.btp_admin_create_draft('TN','TN-2026.9',$1)", [reason]), '42501'));
      await as(n, () => rejects(() => db.query("update public.btp_works set label_fr='x' where code='btp_work_masonry'"), '42501'));
    }
  });

  await test('btp admin: full read of the published DEV 5 catalogue', async () => {
    const c = await admin('select public.btp_admin_catalog() as c');
    eq(c.version.code, 'TN-2026.1'); eq(c.version.status, 'published');
    eq(c.lots.length, 10); eq(c.subLots.length, 12); eq(c.works.length, 20); eq(c.units.length, 7);
    eq(c.rules.length, 5); eq(c.dependencies.length, 5); eq(c.measurementTemplates.length, 5); eq(c.validation, null);
    eq(c.units.find(u => u.code === 'm2').workCount > 0, true);
  });

  await test('btp admin: published rows are immutable even for a privileged session', async () => {
    await rejects(() => db.query("update public.btp_works set label_fr='altéré' where code='btp_work_masonry'"), '42501');
    await rejects(() => db.query("delete from public.btp_work_dependencies where id='54110000-0000-4000-8000-000000000505'"), '42501');
    await rejects(() => db.query("update public.btp_catalog_versions set provenance=provenance||'{\"x\":1}' where code='TN-2026.1'"), '42501');
    await rejects(() => db.query("delete from public.btp_catalog_versions where code='TN-2026.1'"), '42501');
  });

  await test('btp admin: a draft copies the published version with the same canonical ids', async () => {
    await as('admin', () => rejects(() => db.query("select public.btp_admin_create_draft('TN','FR-2026.2',$1)", [reason]), '22023'));
    await as('admin', () => rejects(() => db.query("select public.btp_admin_create_draft('TN','TN-2026.2','x')"), '22023'));
    const created = await admin("select public.btp_admin_create_draft('TN','TN-2026.2',$1) as r", [reason]);
    draft = created.versionId; eq(created.basedOn, 'TN-2026.1');
    await as('admin', () => rejects(() => db.query("select public.btp_admin_create_draft('TN','TN-2026.3',$1)", [reason]), '23505'));
    const c = await admin('select public.btp_admin_catalog($1) as c', [draft]);
    eq(c.version.status, 'draft'); eq(c.works.length, 20);
    eq(c.works.find(w => w.code === 'btp_work_masonry').id, masonry.id);
    eq(c.validation.ok, true); eq(c.validation.issues.some(i => i.code === 'no_change'), true);
    const live = await snapshot();
    eq(live.catalogVersion.code, 'TN-2026.1'); eq(works(live).length, 20); eq(live.dependencies.length, 5);
  });

  await test('btp admin: draft edits are validated and audited, published version untouched', async () => {
    await as('admin', () => rejects(() => db.query("select public.btp_admin_save_item($1,'work',$2,$3)", [draft, { id: masonry.id, code: 'btp_work_other' }, reason]), '22023'));
    await as('admin', () => rejects(() => db.query("select public.btp_admin_save_item($1,'work',$2,$3)", [draft, { id: masonry.id, price: 10 }, reason]), '22023'));
    await as('admin', () => rejects(() => db.query("select public.btp_admin_save_item($1,'work',$2,$3)", [before.catalogVersion.id, { id: masonry.id, label: 'Maçonnerie' }, reason]), '42501'));
    const saved = await admin("select public.btp_admin_save_item($1,'work',$2,$3) as r", [draft, { id: masonry.id, label: 'Maçonnerie et élévation des murs' }, reason]);
    eq(saved.changed, true);
    eq((await admin("select public.btp_admin_save_item($1,'work',$2,$3) as r", [draft, { id: masonry.id, label: 'Maçonnerie et élévation des murs' }, reason])).changed, false);
    const sub = (await admin('select public.btp_admin_catalog($1) as c', [draft])).works.find(w => w.id === masonry.id).subLotId;
    await as('admin', () => rejects(() => db.query("select public.btp_admin_save_item($1,'work',$2,$3)", [draft, { code: 'btp_work_masonry', subLotId: sub, label: 'Doublon', unitCode: 'm2', relevance: 'usual', projectTypes: ['construction'], sourceRef: 'Recette #547' }, reason]), '23505'));
    await as('admin', () => rejects(() => db.query("select public.btp_admin_save_item($1,'work',$2,$3)", [draft, { code: 'btp_work_recette_547', subLotId: sub, label: 'Sans unité', relevance: 'usual', projectTypes: ['construction'], sourceRef: 'Recette #547' }, reason]), '22023'));
    const added = await admin("select public.btp_admin_save_item($1,'work',$2,$3) as r", [draft, { code: 'btp_work_recette_547', subLotId: sub, label: 'Chaînages de recette', unitCode: 'm', relevance: 'optional', projectTypes: ['construction'], aliases: ['chaînage'], sourceRef: 'Recette locale #547' }, reason]);
    eq(added.changed, true);
    eq(works(await snapshot()).find(w => w.id === masonry.id).label, masonry.label);
  });

  await test('btp admin: dependencies stay acyclic and validation blocks an inconsistent draft', async () => {
    const c = await admin('select public.btp_admin_catalog($1) as c', [draft]);
    const id = code => c.works.find(w => w.code === code).id;
    await as('admin', () => rejects(() => db.query("select public.btp_admin_save_item($1,'dependency',$2,$3)", [draft, { predecessorWorkId: id('btp_work_structure'), successorWorkId: id('btp_work_earthworks'), relationType: 'finish_to_start', explanation: 'Cycle volontaire', sourceRef: 'Recette #547' }, reason]), '22023'));
    const sub = c.works.find(w => w.code === 'btp_work_recette_547').subLotId;
    await admin("select public.btp_admin_save_item($1,'sub_lot',$2,$3) as r", [draft, { id: sub, active: false }, reason]);
    const report = await admin('select public.btp_admin_validate_draft($1) as r', [draft]);
    eq(report.ok, false); eq(report.issues.some(i => i.code === 'work_parent_inactive'), true);
    await as('admin', () => rejects(() => db.query('select public.btp_admin_publish_draft($1,$2)', [draft, reason]), '22023'));
    await admin("select public.btp_admin_save_item($1,'sub_lot',$2,$3) as r", [draft, { id: sub, active: true }, reason]);
    eq((await admin('select public.btp_admin_validate_draft($1) as r', [draft])).ok, true);
  });

  await test('btp admin: atomic publication keeps ids, retires the old version and satisfies the assistant contract v1', async () => {
    await as('clientA', () => rejects(() => db.query('select public.btp_admin_publish_draft($1,$2)', [draft, reason]), '42501'));
    const published = await admin('select public.btp_admin_publish_draft($1,$2) as r', [draft, reason]);
    eq(published.retired, 'TN-2026.1');
    const versions = (await db.query("select code,status from public.btp_catalog_versions where country_code='TN' order by code")).rows;
    eq(JSON.stringify(versions), JSON.stringify([{ code: 'TN-2026.1', status: 'retired' }, { code: 'TN-2026.2', status: 'published' }, { code: 'TN-2026.3', status: 'retired' }]));
    const live = await snapshot();
    eq(live.catalogVersion.code, 'TN-2026.2'); eq(works(live).length, 21); eq(live.dependencies.length, 5);
    eq(works(live).find(w => w.id === masonry.id).label, 'Maçonnerie et élévation des murs');
    eq(JSON.stringify(live.lots.map(l => l.id)), JSON.stringify(before.lots.map(l => l.id)));
    const trades = new Map((await db.query('select id,code from public.trades')).rows.map(r => [r.id, r.code]));
    eq(JSON.stringify(validateReferentialSnapshot(mapDaoCatalog(live, trades))), '[]');
    await rejects(() => db.query("update public.btp_works set label_fr='altéré' where code='btp_work_masonry' and catalog_version_id=$1", [draft]), '42501');
    await rejects(() => db.query("update public.btp_catalog_versions set status='published',effective_to=null where code='TN-2026.1'"), '42501');
    const history = await admin('select public.btp_admin_catalog($1) as c', [draft]);
    eq(history.events.map(e => e.action).includes('draft_publish'), true);
    eq(history.events.filter(e => e.action === 'item_create').length, 1);
  });

  await test('btp admin: an abandoned draft is archived, never published', async () => {
    const created = await admin("select public.btp_admin_create_draft('TN','TN-2026.4',$1) as r", [reason]);
    await admin('select public.btp_admin_abandon_draft($1,$2) as r', [created.versionId, reason]);
    await as('admin', () => rejects(() => db.query('select public.btp_admin_publish_draft($1,$2)', [created.versionId, reason]), '42501'));
    eq((await snapshot()).catalogVersion.code, 'TN-2026.2');
    eq((await one("select status from public.btp_catalog_versions where code='TN-2026.4'")).status, 'retired');
  });
}
