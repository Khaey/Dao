// #551 — base de prix sourcés et estimation déterministe (PGlite, JWT simulé par claim SQL).
// Tous les tarifs ci-dessous sont FICTIFS (source `test_fixture`) ou étiquetés réels de test local :
// aucun n'est un prix de marché.
import { randomUUID } from 'node:crypto';

export async function btpEstimateCases(db, test, { U, P, Q, gov, as }) {
  const eq = (a, b) => { if (a !== b) throw Error(`Expected ${b}, received ${a}`); };
  const rejects = async (fn, code) => { try { await fn(); } catch (e) { eq(e.code, code); return; } throw Error('Unexpected success'); };
  const one = async (sql, args = []) => Object.values((await db.query(sql, args)).rows[0])[0];
  const price = (action, input, key) => one('select public.btp_price_command_v1($1,$2::jsonb,$3)', [action, JSON.stringify(input), key]);
  const estimate = (action, input, key = null) => one('select public.btp_estimate_command_v1($1,$2::jsonb,$3)', [action, JSON.stringify(input), key]);
  const work = async code => (await db.query("select w.id,w.unit_code from public.btp_works w join public.btp_catalog_versions v on v.id=w.catalog_version_id and v.status='published' where w.code=$1", [code])).rows[0];
  const { verifyEstimateResult } = await import('../dist/src/btp-estimate/engine.js');

  // Un relecteur D.A.O. (staff) saisit, un Admin différent vérifie.
  U.reviewer551 = randomUUID();
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [U.reviewer551, 'reviewer551@example.invalid']);
  await db.query("insert into public.user_roles(user_id,role) values($1,'dao_reviewer')", [U.reviewer551]);
  const otherGov = (await db.query("insert into public.governorates(code,name_fr,name_ar) values('TEST_OTHER_551','Autre territoire synthétique','اختبار') returning id")).rows[0].id;
  const tiling = await work('btp_work_tiling');
  const painting = await work('btp_work_painting');
  const masonry = await work('btp_work_masonry');
  const today = new Date().toISOString().slice(0, 10);
  const past = '2020-01-01';
  let fixture, real, tilingItem;

  await test('btp estimate: anonymous, Artisan and foreign Client are refused', async () => {
    await db.exec('set role anon');
    try { await rejects(() => db.query("select public.btp_estimate_snapshot_v1($1)", [P]), '42501'); } finally { await db.exec('reset role'); }
    await as('proA', () => rejects(() => db.query('select public.btp_estimate_snapshot_v1($1)', [P]), '42501'));
    await as('clientB', () => rejects(() => estimate('preview', { projectId: P }), '42501'));
    await as('clientB', () => rejects(() => db.query('select public.btp_price_list_v1($1)', [P]), '42501'));
  });

  await test('btp prices: only an Admin registers sources; real sources need an HTTPS URI and licence', async () => {
    await as('clientA', () => rejects(() => price('register_source', { code: 'x-src', name: 'Forgée', publisher: 'X', sourceKind: 'market_survey', dataNature: 'real', uri: 'https://example.invalid', licenseNote: 'Aucune' }, 'src-denied-01'), '42501'));
    await as('admin', () => rejects(() => price('register_source', { code: 'no-uri', name: 'Sans URI', publisher: 'X', sourceKind: 'official_publication', dataNature: 'real', licenseNote: 'Licence ouverte' }, 'src-nouri-01'), '23514'));
    await as('admin', () => rejects(() => price('register_source', { code: 'fake-real', name: 'Fictif réel', publisher: 'X', sourceKind: 'test_fixture', dataNature: 'real', licenseNote: 'Test local' }, 'src-mixed-01'), '23514'));
    fixture = (await as('admin', () => price('register_source', { code: 'test-551-fictif', name: 'Jeu de test FICTIF #551', publisher: 'D.A.O. tests', sourceKind: 'test_fixture', dataNature: 'fictitious_test', licenseNote: 'Données fictives de test, aucune valeur de marché' }, 'src-fixture-01'))).source;
    real = (await as('admin', () => price('register_source', { code: 'test-551-real-local', name: 'Source réelle simulée (PGlite)', publisher: 'Éditeur local', sourceKind: 'official_publication', dataNature: 'real', uri: 'https://example.invalid/bareme', licenseNote: 'Fixture locale uniquement' }, 'src-real-01'))).source;
    eq(fixture.data_nature, 'fictitious_test');
  });

  await test('btp prices: Client cannot record an observed price; author cannot verify own price', async () => {
    await as('clientA', () => rejects(() => price('record', { sourceId: fixture.id, workId: tiling.id, amountMinMinor: 25000, taxBasis: 'HT', vatRateBp: 1900, observedOn: past, validFrom: past, sourceLocator: 'Tableau T1' }, 'rec-denied-01'), '42501'));
    tilingItem = (await as('reviewer551', () => price('record', { sourceId: fixture.id, workId: tiling.id, component: 'composite', amountMinMinor: 25000, taxBasis: 'HT', vatRateBp: 1900, includes: ['supply', 'installation'], observedOn: past, validFrom: past, sourceLocator: 'Tableau T1, ligne 3' }, 'rec-tiling-01'))).item;
    eq(tilingItem.status, 'pending'); eq(tilingItem.unitCode, tiling.unit_code);
    await as('reviewer551', () => rejects(() => price('verify', { itemId: tilingItem.id, expectedRevision: 1 }, 'ver-self-01'), '42501'));
    await as('clientA', async () => eq((await one('select public.btp_price_list_v1()')).items.some(i => i.id === tilingItem.id), false));
    const verified = (await as('admin', () => price('verify', { itemId: tilingItem.id, expectedRevision: 1, note: 'Contrôlé' }, 'ver-tiling-01'))).item;
    eq(verified.status, 'verified'); eq(verified.verifiedRevision, 1);
    await as('clientA', async () => eq((await one('select public.btp_price_list_v1()')).items.find(i => i.id === tilingItem.id).verified.amountMinMinor, 25000));
  });

  await test('btp prices: history is append-only and no direct write grant exists', async () => {
    await as('admin', () => rejects(() => db.query("update public.btp_price_items set status='verified'"), '42501'));
    await rejects(() => db.query('update public.btp_price_item_revisions set amount_min_minor=1 where item_id=$1', [tilingItem.id]), '23514');
    await rejects(() => db.query('delete from public.btp_price_events where item_id=$1', [tilingItem.id]), '23514');
  });

  await test('btp estimate: villa without quantities stays unavailable, nothing invented', () => as('clientA', async () => {
    const r = (await estimate('preview', { projectId: P, lines: [{ workId: tiling.id }, { workId: masonry.id }] })).result;
    eq(r.coverage.status, 'unavailable'); eq(r.totals.htMinMinor, null); eq(r.totals.scope, 'none');
    eq(r.missing.length, 2); eq(r.lines.every(l => l.status === 'missing' && l.quantity === null), true);
    // Le seul tarif carrelage est fictif : il n'existe pas en mode référence.
    eq(r.lines.find(l => l.workId === tiling.id).missing.includes('price_missing'), true);
    eq(r.warnings.includes('incomplete_estimate_total_is_not_a_budget'), true);
  }));

  await test('btp estimate: simulation computes exact millimes with explicit VAT and is marked fictitious', () => as('clientA', async () => {
    const r = (await estimate('preview', { projectId: P, mode: 'simulation', lines: [{ workId: tiling.id, quantity: { value: '12.345' }, source: { kind: 'declared', reference: 'Plan client A-1' } }] })).result;
    const line = r.lines[0];
    eq(r.coverage.status, 'complete'); eq(line.status, 'priced');
    eq(line.totals.htMinMinor, 308625); eq(line.totals.ttcMinMinor, 367264); // 12,345 × 25,000 = 308,625 ; × 1,19 = 367,26375
    eq(r.totals.htMinMinor, 308625); eq(r.warnings.includes('simulation_fictitious_test_data'), true);
    eq(line.candidates[0].source.dataNature, 'fictitious_test'); eq(line.warnings.includes('declared_quantity_not_validated'), true);
    eq(verifyEstimateResult(r).ok, true);
  }));

  await test('btp estimate: unit conversion is never implicit and inputs are strictly validated', () => as('clientA', async () => {
    await rejects(() => estimate('preview', { projectId: P, mode: 'simulation', lines: [{ workId: tiling.id, quantity: { value: '10', unit: 'm3' }, source: { kind: 'declared', reference: 'Plan' } }] }), '22023');
    await rejects(() => estimate('preview', { projectId: P, lines: [{ workId: tiling.id, quantity: { value: '-1' }, source: { kind: 'declared', reference: 'Plan' } }] }), '22023');
    await rejects(() => estimate('preview', { projectId: P, lines: [{ workId: randomUUID() }] }), '22023');
    await rejects(() => estimate('preview', { projectId: P, mode: 'simulation', includePrivateAssumptions: true }), '22023');
    await rejects(() => estimate('preview', { projectId: P, forgedTotal: 1 }), '22023');
  }));

  await test('btp estimate: regional price wins, other governorate and expired prices are excluded', async () => {
    const add = async (input, key) => {
      const item = (await as('reviewer551', () => price('record', { sourceId: fixture.id, observedOn: past, validFrom: past, sourceLocator: 'Tableau T2', taxBasis: 'HT', vatRateBp: 1900, ...input }, key))).item;
      await as('admin', () => price('verify', { itemId: item.id, expectedRevision: 1 }, key + '-v'));
      return item;
    };
    await add({ workId: painting.id, amountMinMinor: 10000 }, 'paint-national-01');
    await add({ workId: painting.id, amountMinMinor: 12000, governorateId: gov }, 'paint-regional-01');
    await add({ workId: painting.id, amountMinMinor: 1, governorateId: otherGov }, 'paint-other-01');
    await add({ workId: masonry.id, amountMinMinor: 50000, validTo: '2020-12-31' }, 'mason-expired-01');
    await as('clientA', async () => {
      const r = (await estimate('preview', { projectId: P, mode: 'simulation', lines: [
        { workId: painting.id, quantity: { value: '2' }, source: { kind: 'declared', reference: 'Relevé' } },
        { workId: masonry.id, quantity: { value: '3' }, source: { kind: 'declared', reference: 'Relevé' } }] })).result;
      const paint = r.lines.find(l => l.workId === painting.id); const mason = r.lines.find(l => l.workId === masonry.id);
      eq(paint.candidates.length, 1); eq(paint.candidates[0].zone, 'governorate'); eq(paint.totals.htMinMinor, 24000);
      eq(mason.status, 'missing'); eq(mason.missing.includes('price_out_of_validity_period'), true);
      eq(r.coverage.status, 'partial'); eq(r.totals.scope, 'priced_lines_only'); eq(r.totals.htMinMinor, 24000);
      eq(verifyEstimateResult(r).ok, true);
    });
  });

  await test('btp estimate: equal sources give a range; components-only lines stay partial; TTC without rate gives no HT', async () => {
    const add = async (input, key) => {
      const item = (await as('reviewer551', () => price('record', { sourceId: fixture.id, observedOn: '2024-06-01', validFrom: '2024-06-01', sourceLocator: 'Tableau T3', ...input }, key))).item;
      await as('admin', () => price('verify', { itemId: item.id, expectedRevision: 1 }, key + '-v'));
    };
    const waterproofing = await work('btp_work_waterproofing');
    const terrace = await work('btp_work_terrace');
    await add({ workId: waterproofing.id, amountMinMinor: 8000, taxBasis: 'HT', vatRateBp: 1900 }, 'wp-a-01-551');
    await add({ workId: waterproofing.id, amountMinMinor: 9000, amountMaxMinor: 9500, taxBasis: 'HT', vatRateBp: 1900 }, 'wp-b-01-551');
    await add({ workId: terrace.id, component: 'material', amountMinMinor: 30000, taxBasis: 'TTC' }, 'tr-mat-01-551');
    await as('clientA', async () => {
      const r = (await estimate('preview', { projectId: P, mode: 'simulation', referenceDate: today, lines: [
        { workId: waterproofing.id, quantity: { value: '10' }, source: { kind: 'declared', reference: 'Plan' } },
        { workId: terrace.id, quantity: { value: '4' }, source: { kind: 'declared', reference: 'Plan' } }] })).result;
      const wp = r.lines.find(l => l.workId === waterproofing.id); const tr = r.lines.find(l => l.workId === terrace.id);
      eq(wp.totals.htMinMinor, 80000); eq(wp.totals.htMaxMinor, 95000); eq(wp.warnings.includes('several_sources_range'), true);
      eq(tr.status, 'priced_components'); eq(tr.totals.htMinMinor, null); eq(tr.totals.ttcMinMinor, 120000);
      eq(r.coverage.status, 'partial'); eq(r.totals.htMinMinor, null); eq(r.totals.linesWithoutHt, 1);
      eq(verifyEstimateResult(r).ok, true);
    });
  });

  await test('btp estimate: private assumptions are opt-in, project-scoped and invisible to others', async () => {
    const item = (await as('clientA', () => price('record', { priceKind: 'private_assumption', projectId: P, workId: masonry.id, amountMinMinor: 40000, taxBasis: 'HT', observedOn: today, validFrom: today, sourceLocator: 'Devis reçu par le client' }, 'priv-01-551'))).item;
    eq(item.status, 'declared'); eq(item.verifiedRevision, null);
    await as('clientB', () => rejects(() => price('record', { priceKind: 'private_assumption', projectId: P, workId: masonry.id, amountMinMinor: 1, taxBasis: 'HT', observedOn: today, validFrom: today, sourceLocator: 'Intrusion' }, 'priv-denied-01'), '42501'));
    await as('proA', async () => eq((await db.query('select id from public.btp_price_items where id=$1', [item.id])).rows.length, 0));
    await as('clientA', async () => {
      const line = { workId: masonry.id, quantity: { value: '2' }, source: { kind: 'declared', reference: 'Plan' } };
      const without = (await estimate('preview', { projectId: P, lines: [line] })).result;
      eq(without.lines[0].status, 'missing');
      const withPrivate = (await estimate('preview', { projectId: P, includePrivateAssumptions: true, lines: [line] })).result;
      eq(withPrivate.lines[0].candidates[0].priceKind, 'private_assumption'); eq(withPrivate.lines[0].totals.htMinMinor, 80000);
      eq(withPrivate.lines[0].totals.ttcMinMinor, null);
    });
    await as('admin', () => rejects(() => price('verify', { itemId: item.id, expectedRevision: 1 }, 'priv-verify-01'), '22023'));
  });

  let est;
  await test('btp estimate: revisions are idempotent, optimistic and immutable after approval', async () => {
    const input = { projectId: P, label: 'Budget simulation #551', mode: 'simulation', lines: [{ workId: tiling.id, quantity: { value: '10' }, source: { kind: 'declared', reference: 'Plan A' } }] };
    await as('clientA', async () => {
      est = await estimate('calculate', input, 'est-calc-0001');
      const replay = await estimate('calculate', input, 'est-calc-0001');
      eq(replay.id, est.id); eq(replay.current.resultSha256, est.current.resultSha256);
      await rejects(() => estimate('calculate', { ...input, label: 'Autre' }, 'est-calc-0001'), '22023');
      eq(est.current.result.totals.htMinMinor, 250000);
      await rejects(() => estimate('approve', { estimateId: est.id, expectedRevision: 2 }, 'est-appr-stale'), '40001');
      const approved = await estimate('approve', { estimateId: est.id, expectedRevision: 1, note: 'Référence de travail' }, 'est-appr-0001');
      eq(approved.status, 'approved'); eq(approved.approvedRevision, 1);
      const revised = await estimate('calculate', { ...input, estimateId: est.id, expectedRevision: 1, lines: [{ ...input.lines[0], quantity: { value: '11' } }] }, 'est-calc-0002');
      eq(revised.status, 'draft'); eq(revised.currentRevision, 2); eq(revised.approvedRevision, 1);
      eq(revised.approved.result.totals.htMinMinor, 250000); eq(revised.current.result.totals.htMinMinor, 275000);
      eq(revised.events.some(e => e.type === 'approval_superseded'), true); eq(revised.history.length, 2);
      await rejects(() => db.query('update public.btp_estimates set label=$1 where id=$2', ['forgé', est.id]), '42501');
    });
    await rejects(() => db.query('update public.btp_estimate_revisions set result=$1 where estimate_id=$2', ['{}', est.id]), '23514');
    await rejects(() => db.query('delete from public.btp_estimates where id=$1', [est.id]), '42501');
    await as('proA', async () => eq((await db.query('select id from public.btp_estimates where id=$1', [est.id])).rows.length, 0));
    await as('admin', async () => eq((await one('select public.btp_estimate_snapshot_v1($1)', [P])).estimates[0].id, est.id));
  });

  await test('btp estimate: unavailable estimate cannot be retained', () => as('clientA', async () => {
    const e = await estimate('calculate', { projectId: P, label: 'Sans quantités', lines: [{ workId: masonry.id }] }, 'est-unav-0001');
    eq(e.current.coverageStatus, 'unavailable');
    await rejects(() => estimate('approve', { estimateId: e.id, expectedRevision: 1 }, 'est-unav-appr'), '22023');
  }));

  await test('btp estimate: validated takeoff quantities are read by contract, never trusted from the client', async () => {
    const real548 = (await db.query("select to_regclass('public.btp_takeoffs') is not null as ok")).rows[0].ok;
    await db.exec('begin');
    try {
      if (!real548) {
        // Contrat minimal de #548 (colonnes lues par le moteur), seulement si le moteur de métrés n'est pas installé.
        await db.exec(`create table public.btp_takeoffs(id uuid primary key,project_id uuid,work_id uuid,scope_key text,label text,status text,current_revision int,validated_revision int);
          create table public.btp_takeoff_revisions(takeoff_id uuid,revision int,calculation_status text,justification jsonb);
          grant select on public.btp_takeoffs,public.btp_takeoff_revisions to authenticated;`);
      }
      const t = randomUUID(); const foreign = randomUUID();
      if (!real548) {
        await db.query("insert into public.btp_takeoffs values($1,$2,$3,'main','Carrelage séjour','draft',2,1),($4,$5,$3,'main','Autre chantier','validated',1,1)", [t, P, tiling.id, foreign, Q]);
        await db.query(`insert into public.btp_takeoff_revisions values($1,1,'calculated','{"result":{"value":"20.00","unit":"${tiling.unit_code}"}}'),($2,1,'calculated','{"result":{"value":"5","unit":"${tiling.unit_code}"}}')`, [t, foreign]);
      }
      await as('clientA', async () => {
        const r = (await estimate('preview', { projectId: P, mode: 'simulation' })).result;
        const line = r.lines.find(l => l.origin === 'validated_takeoff');
        eq(line.quantity.value, '20.00'); eq(line.quantitySource.revision, 1); eq(line.totals.htMinMinor, 500000);
        eq(line.warnings.includes('newer_takeoff_revision_not_validated'), true);
      });
      // Dans une transaction, chaque refus est isolé par un point de sauvegarde.
      const refusedInTx = async input => {
        let err; await db.exec('savepoint t551');
        try { await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${U.clientA}',false);`); await estimate('preview', input); } catch (e) { err = e; }
        await db.exec('rollback to savepoint t551'); eq(err?.code, '22023');
      };
      await refusedInTx({ projectId: P, mode: 'simulation', lines: [{ workId: tiling.id, source: { kind: 'takeoff', takeoffId: foreign } }] });
      await refusedInTx({ projectId: P, lines: [{ workId: tiling.id, quantity: { value: '999' }, source: { kind: 'takeoff', takeoffId: t } }] });
    } finally { await db.exec('rollback'); }
  });
}
