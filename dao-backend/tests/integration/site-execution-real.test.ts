Warning: truncated output (original token count: 10983)
Total output lines: 657

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

test('site execution: real JWT, awarded-lot isolation, evidence and immutable history', async () => {
  const url = process.env.DAO_SUPABASE_URL!;
  assert.equal(url, 'http://127.0.0.1:54321');
  const publishable = process.env.DAO_SUPABASE_PUBLISHABLE_KEY!;
  const secret = process.env.DAO_SUPABASE_SECRET_KEY!;
  const admin = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = 'S!te-' + randomUUID();

  async function actor(label: string, roles: string[]) {
    const email = `site-${label}-${randomUUID()}@example.invalid`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error);
    const id = created.data.user!.id;
    assert.ifError((await admin.from('profiles').insert({ user_id: id, display_name: label, last_workspace: roles[0] === 'contractor' ? 'contractor' : 'client' })).error);
    for (const role of roles) assert.ifError((await admin.from('user_roles').insert({ user_id: id, role })).error);
    const auth = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await auth.auth.signInWithPassword({ email, password });
    assert.ifError(signed.error);
    return {
      id,
      db: createClient(url, publishable, {
        global: { headers: { Authorization: `Bearer ${signed.data.session!.access_token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      }),
    };
  }

  async function denied(db: any, name: string, args: Record<string, unknown>, code = '42501') {
    const result = await db.rpc(name, args);
    assert.ok(result.error, `${name} must be denied`);
    assert.equal(result.error.code, code);
  }

  const owner = await actor('client-a', ['client']);
  const otherClient = await actor('client-b', ['client']);
  const contractor = await actor('artisan-a', ['contractor']);
  const competitor = await actor('artisan-b', ['contractor']);
  const invited = await actor('invite-pending', ['contractor']);
  const staff = await actor('gestionnaire', ['dao_reviewer']);
  const unassignedStaff = await actor('gestionnaire-non-affecte', ['dao_reviewer']);
  const contractorProfile = await admin.from('contractor_profiles').insert({
    user_id: contractor.id, business_name: 'Atelier attributaire', verification_status: 'verified', contractor_type: 'artisan', public_identity_status: 'approved',
  }).select('id').single();
  assert.ifError(contractorProfile.error);
  const competitorProfile = await admin.from('contractor_profiles').insert({
    user_id: competitor.id, business_name: 'Atelier concurrent', verification_status: 'verified', contractor_type: 'artisan', public_identity_status: 'approved',
  }).select('id').single();
  assert.ifError(competitorProfile.error);
  assert.ifError((await admin.from('contractor_profiles').insert({
    user_id: invited.id, business_name: 'Invité', verification_status: 'verified', contractor_type: 'artisan', public_identity_status: 'approved',
  })).error);

  const project = await admin.from('projects').insert({ client_id: owner.id, initiator_id: owner.id, project_origin: 'client_marketplace' }).select('id').single();
  assert.ifError(project.error);
  const governorate = await admin.from('governorates').select('id').limit(1).single();
  const trade = await admin.from('trades').select('id').limit(1).single();
  assert.ifError(governorate.error); assert.ifError(trade.error);
  assert.ifError((await admin.from('project_versions').insert({
    project_id: project.data!.id, version_no: 1, title: 'Chantier carnet réel', description: 'Exécution', governorate_id: governorate.data!.id,
  })).error);
  const request = await admin.from('project_requests').insert({ project_id: project.data!.id, status: 'awarded' }).select('id').single();
  assert.ifError(request.error);
  const requestVersion = await admin.from('project_request_versions').insert({
    project_id: project.data!.id, request_id: request.data!.id, version_no: 1, trade_id: trade.data!.id,
    title: 'Lot plomberie attribué', scope: 'Travaux attribués', budget_millimes: 100000,
  }).select('id').single();
  assert.ifError(requestVersion.error);
  // Real marketplace awards do NOT create contractor team membership.  A2 must
  // work on the active awarded lot without inserting it as a test shortcut.
  const contractorMemberships = await admin.from('project_members').select('id')
    .eq('project_id', project.data!.id).eq('user_id', contractor.id);
  assert.ifError(contractorMemberships.error);
  assert.equal(contractorMemberships.data?.length, 0);
  // Even an ACCEPTED team member cannot negotiate or edit the competitor's award.
  assert.ifError((await admin.from('project_members').insert({
    project_id: project.data!.id, user_id: competitor.id,
    participation_role: 'contractor', status: 'accepted',
  })).error);
  assert.ifError((await admin.from('project_invitations').insert({
    project_id: project.data!.id, created_by: owner.id, expected_role: 'contractor',
    principal_request_id: request.data!.id,
    token_hash: randomUUID().replaceAll('-', '').padEnd(64, '0'), expires_at: '2099-01-01T00:00:00Z', status: 'pending',
  })).error);
  const bid = await admin.from('bids').insert({ project_id: project.data!.id, contractor_id: contractorProfile.data!.id }).select('id').single();
  assert.ifError(bid.error);
  const bidVersion = await admin.from('bid_versions').insert({
    bid_id: bid.data!.id, project_id: project.data!.id, contractor_id: contractorProfile.data!.id,
    version_no: 1, status: 'draft', validity: 'current', expires_at: '2099-01-01',
  }).select('id').single();
  assert.ifError(bidVersion.error);
  const bidItem = await admin.from('bid_items').insert({
    bid_version_id: bidVersion.data!.id, project_id: project.data!.id, contractor_id: contractorProfile.data!.id,
    request_version_id: requestVersion.data!.id, request_id: request.data!.id, price_millimes: 100000,
    duration_days: 5, inclusions: 'Pose', exclusions: null,
  }).select('id').single();
  assert.ifError(bidItem.error);
  const subLot = await admin.from('bid_sub_lots').insert({
    bid_version_id: bidVersion.data!.id, bid_item_id: bidItem.data!.id,
    project_id: project.data!.id, request_id: request.data!.id,
    contractor_id: contractorProfile.data!.id, node_key: randomUUID(), position: 1,
    title: 'Pose du réseau', scope: 'Sous-lot attribué',
  }).select('id').single();
  assert.ifError(subLot.error);
  const quoteLine = await admin.from('bid_quote_lines').insert({
    bid_version_id: bidVersion.data!.id, bid_item_id: bidItem.data!.id, position: 1,
    section: 'labor', designation: 'Canalisation posée', unit: 'm',
    quantity_milli: 10_000, unit_price_millimes: 1_000,
  }).select('id').single();
  assert.ifError(quoteLine.error);
  assert.ifError((await admin.from('bid_versions').update({
    status: 'submitted', submitted_at: new Date().toISOString(),
  }).eq('id', bidVersion.data!.id)).error);
  const award = await admin.from('awards').insert({
    project_id: project.data!.id, contractor_id: contractorProfile.data!.id, status: 'confirmed',
  }).select('id').single();
  assert.ifError(award.error);
  const awardItem = await admin.from('award_items').insert({
    award_id: award.data!.id, project_id: project.data!.id, contractor_id: contractorProfile.data!.id,
    request_id: request.data!.id, bid_item_id: bidItem.data!.id, agreed_millimes: 100000, active: true,
  }).select('id').single();
  assert.ifError(awardItem.error);
  assert.ifError((await admin.from('project_requests').update({ status: 'awarded' }).eq('id', request.data!.id)).error);

  const snapshotArgs = { p_project_id: project.data!.id, p_before_created_at: null, p_before_id: null, p_limit: 30 };
  for (const actor of [otherClient, competitor, invited, staff]) await denied(actor.db, 'site_execution_snapshot', snapshotArgs);
  const ownerSnapshot = await owner.db.rpc('site_execution_snapshot', snapshotArgs);
  assert.ifError(ownerSnapshot.error); assert.equal(ownerSnapshot.data.lots.length, 1); assert.equal(ownerSnapshot.data.can_observe, true);
  const contractorSnapshot = await contractor.db.rpc('site_execution_snapshot', snapshotArgs);
  assert.ifError(contractorSnapshot.error); assert.equal(contractorSnapshot.data.lots[0].can_write, true);

  // P10-N1: JWT-only native plan snapshot. Marketplace award access is scoped
  // by the active award itself; it does not require auto-adding the Artisan to project_members.
  const nativeArgs = { p_project_id: project.data!.id, p_after_request_id: null, p_limit: 50 };
  const anonymous = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
  assert.ok((await anonymous.rpc('native_execution_plan_v1', nativeArgs)).error, 'anonymous execution is not granted');
  const ownerNative = await owner.db.rpc('native_execution_plan_v1', nativeArgs);
  assert.ifError(ownerNative.error);
  assert.equal(ownerNative.data.schemaVersion, 1);
  assert.equal(ownerNative.data.viewer.workspace, 'client');
  assert.equal(ownerNative.data.lots.length, 1);
  assert.equal(ownerNative.data.lots[0].award.awardItemId, awardItem.data!.id);
  assert.equal(ownerNative.data.lots[0].executionSubLots.length, 1);
  assert.equal(ownerNative.data.lots[0].permissions.canReviewProgress, true);
  assert.equal(ownerNative.data.forecast, null, 'OCE forecast is not reused by the native endpoint');
  assert.equal(JSON.stringify(ownerNative.data).includes('agreed_millimes'), false);
  const contractorNative = await contractor.db.rpc('native_execution_plan_v1', nativeArgs);
  assert.ifError(contractorNative.error);
  assert.equal(contractorNative.data.viewer.workspace, 'contractor');
  assert.deepEqual(contractorNative.data.lots.map((lot: any) =>…5983 tokens truncated…error);
  assert.equal(createdSituationReplay.data.situationId, createdSituation.data.situationId);
  const situationId = createdSituation.data.situationId;
  const situationDetailArgs = {
    p_project_id: null, p_situation_id: situationId, p_before_created_at: null, p_before_id: null, p_limit: 30,
  };
  const contractorSituation = await contractor.db.rpc('native_work_situations_v1', situationDetailArgs);
  assert.ifError(contractorSituation.error);
  assert.equal(contractorSituation.data.lines[0].quantityReportedMilli, '2500');
  assert.equal(contractorSituation.data.lines[0].evidenceDocumentIds[0], document.data!.id);
  const managerDraftArgs = {
    ...situationArgs, p_action: 'save_draft', p_situation_id: situationId,
    p_project_id: null, p_contractor_id: null, p_period_start: null, p_period_end: null,
    p_expected_revision: 1, p_idempotency_key: randomUUID(),
  };
  await denied(staff.db, 'native_work_situation_command_v1', managerDraftArgs);
  await denied(unassignedStaff.db, 'native_work_situation_command_v1', {
    ...managerDraftArgs, p_idempotency_key: randomUUID(),
  });
  const unchangedDraft = await contractor.db.rpc('native_work_situations_v1', situationDetailArgs);
  assert.ifError(unchangedDraft.error);
  assert.equal(unchangedDraft.data.status, 'draft');
  assert.equal(unchangedDraft.data.revision, 1);
  await denied(otherClient.db, 'native_work_situations_v1', situationDetailArgs);
  await denied(competitor.db, 'native_work_situations_v1', situationDetailArgs);
  await denied(unassignedStaff.db, 'native_work_situations_v1', situationDetailArgs);
  assert.ok((await contractor.db.from('site_work_situations').update({ status: 'validated_technical' }).eq('id', situationId)).error);

  const submitArgs = { p_action: 'submit', p_situation_id: situationId, p_project_id: null, p_contractor_id: null,
    p_period_start: null, p_period_end: null, p_lines: null, p_validated_lines: null, p_note: null,
    p_expected_revision: 1, p_idempotency_key: randomUUID() };
  const submittedSituation = await contractor.db.rpc('native_work_situation_command_v1', submitArgs);
  assert.ifError(submittedSituation.error); assert.equal(submittedSituation.data.status, 'submitted');
  const submittedReplay = await contractor.db.rpc('native_work_situation_command_v1', submitArgs);
  assert.ifError(submittedReplay.error); assert.equal(submittedReplay.data.revision, submittedSituation.data.revision);
  const managerReviewArgs = {
    ...submitArgs, p_action: 'start_review', p_expected_revision: 2,
    p_idempotency_key: randomUUID(),
  };
  await denied(staff.db, 'native_work_situation_command_v1', managerReviewArgs);
  await denied(unassignedStaff.db, 'native_work_situation_command_v1', {
    ...managerReviewArgs, p_idempotency_key: randomUUID(),
  });
  const startReview = await owner.db.rpc('native_work_situation_command_v1', {
    ...submitArgs, p_action: 'start_review', p_expected_revision: 2, p_idempotency_key: randomUUID(),
  });
  assert.ifError(startReview.error); assert.equal(startReview.data.status, 'under_review');
  const managerSuggestion = await staff.db.rpc('native_work_situation_command_v1', {
    ...submitArgs, p_action: 'manager_suggestion', p_situation_id: situationId, p_expected_revision: 3,
    p_validated_lines: [{ lineId: situationLineId, quantityValidatedMilli: '2000' }],
    p_idempotency_key: randomUUID(),
  });
  assert.ifError(managerSuggestion.error); assert.equal(managerSuggestion.data.status, 'under_review');
  await denied(unassignedStaff.db, 'native_work_situation_command_v1', {
    ...submitArgs, p_action: 'manager_suggestion', p_situation_id: situationId, p_expected_revision: 4,
    p_validated_lines: [{ lineId: situationLineId, quantityValidatedMilli: '2000' }], p_idempotency_key: randomUUID(),
  });
  const quantityRace = await Promise.all([2000, 2100].map(quantity => owner.db.rpc('native_work_situation_command_v1', {
    ...submitArgs, p_action: 'validate_technical', p_situation_id: situationId, p_expected_revision: 4,
    p_validated_lines: [{ lineId: situationLineId, quantityValidatedMilli: String(quantity) }],
    p_idempotency_key: randomUUID(),
  })));
  assert.equal(quantityRace.filter(result => !result.error).length, 1);
  assert.equal(quantityRace.filter(result => result.error?.code === '40001').length, 1);
  const validatedSituation = await owner.db.rpc('native_work_situations_v1', situationDetailArgs);
  assert.ifError(validatedSituation.error);
  assert.ok(['2000','2100'].includes(validatedSituation.data.lines[0].quantityValidatedMilli));
  assert.equal(validatedSituation.data.technicalStatement[0].cumulativeValidatedMilli, validatedSituation.data.lines[0].quantityValidatedMilli);
  assert.equal(JSON.stringify(validatedSituation.data).toLowerCase().match(/(invoice|payment|debt|ledger|amountapproved|dueamount)/g), null);
  const secondLineId = randomUUID();
  const secondSituation = await contractor.db.rpc('native_work_situation_command_v1', {
    ...situationArgs, p_period_start: '2026-11-01', p_period_end: '2026-11-30',
    p_lines: [{ lineId: secondLineId, awardItemId: awardItem.data!.id, quoteLineId: quoteLine.data!.id,
      label: 'Canalisation posée', quantityUnit: 'm', quantityReportedMilli: '500',
      sourceEventIds: [], evidenceDocumentIds: [] }], p_idempotency_key: randomUUID(),
  });
  assert.ifError(secondSituation.error);
  const secondId = secondSituation.data.situationId;
  const secondSubmit = await contractor.db.rpc('native_work_situation_command_v1', {
    ...submitArgs, p_situation_id: secondId, p_expected_revision: 1, p_idempotency_key: randomUUID(),
  });
  assert.ifError(secondSubmit.error);
  const secondReview = await owner.db.rpc('native_work_situation_command_v1', {
    ...submitArgs, p_action: 'start_review', p_situation_id: secondId, p_expected_revision: 2, p_idempotency_key: randomUUID(),
  });
  assert.ifError(secondReview.error);
  const secondValidation = await owner.db.rpc('native_work_situation_command_v1', {
    ...submitArgs, p_action: 'validate_technical', p_situation_id: secondId, p_expected_revision: 3,
    p_validated_lines: [{ lineId: secondLineId, quantityValidatedMilli: '400' }], p_idempotency_key: randomUUID(),
  });
  assert.ifError(secondValidation.error);
  const secondDetail = await owner.db.rpc('native_work_situations_v1', {
    ...situationDetailArgs, p_situation_id: secondId,
  });
  assert.ifError(secondDetail.error);
  assert.equal(secondDetail.data.technicalStatement[0].previouslyValidatedMilli, validatedSituation.data.lines[0].quantityValidatedMilli);
  assert.equal(secondDetail.data.technicalStatement[0].cumulativeValidatedMilli,
    String(Number(validatedSituation.data.lines[0].quantityValidatedMilli) + 400));
  const requestedCorrection = await owner.db.rpc('native_work_situation_command_v1', {
    ...submitArgs, p_action: 'request_revision', p_situation_id: secondId, p_expected_revision: 4,
    p_note: 'Rectifier le métré de la dernière intervention.', p_idempotency_key: randomUUID(),
  });
  assert.ifError(requestedCorrection.error); assert.equal(requestedCorrection.data.status, 'revision_requested');
  const situationContest = await contractor.db.rpc('native_work_situation_command_v1', {
    ...submitArgs, p_action: 'contest', p_situation_id: situationId, p_expected_revision: 5,
    p_note: 'Désaccord sur la quantité validée.', p_idempotency_key: randomUUID(),
  });
  assert.ifError(situationContest.error); assert.equal(situationContest.data.status, 'contested');
  const afterContest = await owner.db.rpc('native_work_situations_v1', {
    ...situationDetailArgs, p_situation_id: secondId,
  });
  assert.ifError(afterContest.error); assert.equal(afterContest.data.technicalStatement[0].previouslyValidatedMilli, '0');
  const situationPage = await contractor.db.rpc('native_work_situations_v1', {
    p_project_id: project.data!.id, p_situation_id: null, p_before_created_at: null, p_before_id: null, p_limit: 1,
  });
  assert.ifError(situationPage.error); assert.equal(situationPage.data.items.length, 1); assert.equal(situationPage.data.hasMore, true);
  const situationHistory = await contractor.db.rpc('native_work_situation_events_v1', {
    p_situation_id: situationId, p_before_created_at: null, p_before_id: null, p_limit: 50,
  });
  assert.ifError(situationHistory.error);
  assert.ok(situationHistory.data.items.some((event: any) => event.kind === 'quantities_validated'));
  assert.ok((await admin.from('site_work_situation_events').update({ note: 'altération' }).eq('situation_id', situationId)).error);

  const raceKey = randomUUID();
  const [raceProgress, raceCancel] = await Promise.all([
    contractor.db.rpc('record_site_progress_v2', { ...progressArgs, p_idempotency_key: raceKey, p_percent: 50 }),
    owner.db.rpc('cancel_award_item_atomic', {
      p_idempotency_key: randomUUID(), p_award_item_id: awardItem.data!.id,
      p_reason: 'mutual_agreement', p_comment: null,
    }),
  ]);
  assert.equal([raceProgress, raceCancel].filter(result => !result.error).length >= 1, true);
  await denied(contractor.db, 'record_site_progress_v2', { ...progressArgs, p_idempotency_key: randomUUID(), p_percent: 55 });
  await denied(contractor.db, 'site_execution_snapshot', snapshotArgs);
  const retainedQuality = await owner.db.rpc('native_technical_reserves_v1', {
    p_project_id: project.data!.id, p_award_item_id: awardItem.data!.id, p_inspection_id: null,
    p_before_created_at: null, p_before_id: null, p_limit: 50,
  });
  assert.ifError(retainedQuality.error); assert.equal(retainedQuality.data.items.length, 2);
  const retainedReserve = await admin.from('site_technical_reserves').select('id').eq('id', reserveId).single();
  assert.ifError(retainedReserve.error);
  await denied(contractor.db, 'record_native_technical_reserve_event_v1', {
    p_reserve_id: reserveId, p_action: 'comment', p_note: 'Après annulation.', p_document_ids: [],
    p_expected_revision: 9, p_idempotency_key: randomUUID(),
  });


});
