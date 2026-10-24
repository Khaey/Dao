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
  assert.deepEqual(contractorNative.data.lots.map((lot: any) => lot.requestId), [request.data!.id]);
  assert.equal(contractorNative.data.lots[0].permissions.canDeclareProgress, true);
  assert.equal(contractorNative.data.lots[0].permissions.canEditActivities, true);
  assert.equal(contractorNative.data.lots[0].award.contractorId, null, 'no contractor identity leak into own-table DTO');
  for (const deniedActor of [otherClient, competitor, invited, staff]) {
    await denied(deniedActor.db, 'native_execution_plan_v1', nativeArgs);
  }
  assert.ifError((await admin.from('review_assignments').insert({
    project_id: project.data!.id, reviewer_id: staff.id, assigned_at: new Date().toISOString(),
  })).error);
  const managerNative = await staff.db.rpc('native_execution_plan_v1', nativeArgs);
  assert.ifError(managerNative.error);
  assert.equal(managerNative.data.viewer.workspace, 'dao_manager');
  assert.equal(managerNative.data.lots[0].permissions.canPrepareChange, true);
  assert.equal(managerNative.data.lots[0].permissions.canEditActivities, false);
  assert.equal(managerNative.data.lots[0].permissions.canAcceptEngagingChange, false);

  const nativeWrite = {
    p_award_item_id: awardItem.data!.id, p_activity_id: null, p_action: 'create', p_parent_activity_id: null,
    p_kind: 'activity', p_title: 'Préparation', p_scope: null, p_position: 1,
    p_planned_start: null, p_planned_end: null, p_duration_days: null, p_expected_revision: null,
    p_idempotency_key: randomUUID(),
  };
  const activityCreated = await contractor.db.rpc('native_execution_activity_write', nativeWrite);
  assert.ifError(activityCreated.error);
  assert.equal(activityCreated.data.active, true);
  assert.equal(activityCreated.data.revision, 1);
  await denied(owner.db, 'native_execution_activity_write', nativeWrite);
  const nativeEventArgs = {
    p_award_item_id: awardItem.data!.id, p_native_activity_id: activityCreated.data.id, p_event_kind: 'progress',
    p_status: 'in_progress', p_percent: 55, p_work_date: null, p_title: null, p_target_date: null,
    p_note: 'Activité native en cours', p_quote_line_id: null, p_executed_quantity_milli: null,
    p_quantity_unit: null, p_document_ids: [], p_idempotency_key: randomUUID(),
  };
  const nativeEvent = await contractor.db.rpc('record_native_activity_event_v1', nativeEventArgs);
  assert.ifError(nativeEvent.error);
  assert.equal(nativeEvent.data.native_activity_id, activityCreated.data.id);
  await denied(owner.db, 'record_native_activity_event_v1', nativeEventArgs);
  const prepared = await staff.db.rpc('native_execution_prepare_activity_change', {
    p_award_item_id: awardItem.data!.id, p_action: 'create', p_activity_id: null, p_parent_activity_id: null,
    p_kind: 'sub_lot', p_title: 'Sous-lot préparé', p_scope: null, p_position: 2,
    p_planned_start: null, p_planned_end: null, p_duration_days: null, p_expected_revision: null,
    p_idempotency_key: randomUUID(),
  });
  assert.ifError(prepared.error);
  assert.equal(prepared.data.state, 'pending_acceptance');
  const clientApproval = await owner.db.rpc('native_execution_accept_activity_change', {
    p_proposal_id: prepared.data.proposalId, p_decision: 'accepted', p_idempotency_key: randomUUID(),
  });
  assert.ifError(clientApproval.error);
  assert.equal(clientApproval.data.state, 'pending_acceptance');
  const artisanApproval = await contractor.db.rpc('native_execution_accept_activity_change', {
    p_proposal_id: prepared.data.proposalId, p_decision: 'accepted', p_idempotency_key: randomUUID(),
  });
  assert.ifError(artisanApproval.error);
  assert.equal(artisanApproval.data.state, 'accepted');
  const nativeAfterChanges = await owner.db.rpc('native_execution_plan_v1', nativeArgs);
  assert.ifError(nativeAfterChanges.error);
  assert.equal(nativeAfterChanges.data.activities.supported, true);
  assert.equal(nativeAfterChanges.data.activities.items.length, 2);
  assert.equal(nativeAfterChanges.data.activities.items.find((item: any) => item.id === activityCreated.data.id).execution.progress.percent, 55);
  assert.equal(nativeAfterChanges.data.changeProposals[0].state, 'accepted');

  const document = await admin.from('documents').insert({
    project_id: project.data!.id, owner_id: contractor.id, object_path: `project/${project.data!.id}/${randomUUID()}.jpg`,
    original_name: 'preuve.jpg', mime_type: 'image/jpeg', size_bytes: 10, status: 'approved', share_scope: 'project_members',
  }).select('id').single();
  assert.ifError(document.error);
  const foreignDocument = await admin.from('documents').insert({
    project_id: project.data!.id, owner_id: owner.id, object_path: `project/${project.data!.id}/${randomUUID()}.jpg`,
    original_name: 'client.jpg', mime_type: 'image/jpeg', size_bytes: 10, status: 'approved', share_scope: 'project_members',
  }).select('id').single();
  assert.ifError(foreignDocument.error);

  const progressKey = randomUUID();
  const progressArgs = {
    p_award_item_id: awardItem.data!.id, p_bid_sub_lot_id: subLot.data!.id,
    p_status: 'in_progress', p_percent: 40,
    p_reason: 'Réseau principal posé', p_document_ids: [document.data!.id], p_idempotency_key: progressKey,
  };
  const progress = await contractor.db.rpc('record_site_progress_v2', progressArgs);
  assert.ifError(progress.error);
  const replay = await contractor.db.rpc('record_site_progress_v2', progressArgs);
  assert.ifError(replay.error); assert.equal(replay.data.id, progress.data.id);
  await denied(contractor.db, 'record_site_progress_v2', { ...progressArgs, p_percent: 41 }, '22023');
  await denied(contractor.db, 'record_site_progress_v2', { ...progressArgs, p_idempotency_key: randomUUID(), p_percent: 101 }, '22023');
  await denied(contractor.db, 'record_site_progress_v2', { ...progressArgs, p_idempotency_key: randomUUID(), p_document_ids: [foreignDocument.data!.id] });
  await denied(competitor.db, 'record_site_progress_v2', { ...progressArgs, p_idempotency_key: randomUUID() });
  await denied(contractor.db, 'record_site_progress_v2', { ...progressArgs, p_idempotency_key: randomUUID(), p_bid_sub_lot_id: randomUUID() });

  const intervention = await contractor.db.rpc('record_site_intervention_v2', {
    p_award_item_id: awardItem.data!.id, p_bid_sub_lot_id: subLot.data!.id,
    p_work_date: '2026-10-19', p_note: 'Pose et contrôle visuel', p_percent: 45,
    p_quote_line_id: quoteLine.data!.id, p_executed_quantity_milli: 2_500,
    p_quantity_unit: 'm', p_document_ids: [document.data!.id], p_idempotency_key: randomUUID(),
  });
  assert.ifError(intervention.error);
  await denied(contractor.db, 'record_site_intervention_v2', {
    p_award_item_id: awardItem.data!.id, p_bid_sub_lot_id: subLot.data!.id,
    p_work_date: '2026-10-19', p_note: 'Unité forgée', p_percent: null,
    p_quote_line_id: quoteLine.data!.id, p_executed_quantity_milli: 1_000,
    p_quantity_unit: 'kg', p_document_ids: [], p_idempotency_key: randomUUID(),
  });
  // An explicitly revoked participation must still deny execution, without
  // modifying the user's unrelated commercial award or general project RLS.
  const membership = await admin.from('project_members').insert({
    project_id: project.data!.id, user_id: contractor.id,
    participation_role: 'contractor', status: 'accepted',
  }).select('id').single();
  assert.ifError(membership.error);
  assert.ifError((await admin.from('project_members').update({
    status: 'revoked', revoked_at: new Date().toISOString(),
  }).eq('id', membership.data!.id)).error);
  await denied(contractor.db, 'record_site_progress_v2', {
    ...progressArgs, p_idempotency_key: randomUUID(),
  });
  await denied(contractor.db, 'site_execution_snapshot_v2', snapshotArgs);
  assert.ifError((await admin.from('project_members').update({
    status: 'accepted', revoked_at: null,
  }).eq('id', membership.data!.id)).error);

  const milestone = await contractor.db.rpc('create_site_milestone', {
    p_award_item_id: awardItem.data!.id, p_title: 'Essai réseau', p_target_date: null,
    p_status: 'planned', p_note: null, p_idempotency_key: randomUUID(),
  });
  assert.ifError(milestone.error); assert.ok(milestone.data.milestone_key);
  const milestoneDone = await contractor.db.rpc('update_site_milestone', {
    p_milestone_key: milestone.data.milestone_key, p_target_date: null,
    p_status: 'completed', p_note: 'Essai déclaré terminé', p_idempotency_key: randomUUID(),
  });
  assert.ifError(milestoneDone.error);
  await denied(contractor.db, 'update_site_milestone', {
    p_milestone_key: milestone.data.milestone_key, p_target_date: null,
    p_status: 'planned', p_note: null, p_idempotency_key: randomUUID(),
  }, '23514');

  const observation = await owner.db.rpc('record_site_observation', {
    p_event_id: progress.data.id, p_outcome: 'disputed', p_reason: 'Photo complémentaire demandée', p_idempotency_key: randomUUID(),
  });
  assert.ifError(observation.error);
  const technical = await owner.db.rpc('record_site_observation', {
    p_event_id: intervention.data.id, p_outcome: 'technical_validated',
    p_reason: 'Validé techniquement avec réserve documentaire', p_idempotency_key: randomUUID(),
  });
  assert.ifError(technical.error);
  const detailed = await owner.db.rpc('site_execution_snapshot_v2', snapshotArgs);
  assert.ifError(detailed.error);
  assert.equal(detailed.data.lots[0].sub_lots[0].latest_progress.percent, 40);
  assert.deepEqual(detailed.data.lots[0].sub_lots[0].quantities[0], {
    quote_line_id: quoteLine.data!.id, unit: 'm', executed_quantity_milli: 2500,
    reference_quantity_milli: 10000, ratio_percent: 25,
  });
  assert.equal(detailed.data.events.find((row: any) => row.id === intervention.data.id).quantity.designation, 'Canalisation posée');
  await denied(otherClient.db, 'record_site_observation', {
    p_event_id: progress.data.id, p_outcome: 'acknowledged', p_reason: null, p_idempotency_key: randomUUID(),
  });
  assert.ok((await contractor.db.from('site_log_events').update({ note: 'modifié' }).eq('id', progress.data.id)).error);
  assert.ok((await admin.from('site_log_events').update({ note: 'modifié' }).eq('id', progress.data.id)).error);
  assert.ok((await admin.from('site_client_observations').delete().eq('id', observation.data.id)).error);

  assert.ifError((await admin.from('user_roles').insert({ user_id: contractor.id, role: 'client' })).error);
  assert.ifError((await admin.from('profiles').update({ last_workspace: 'client' }).eq('user_id', contractor.id)).error);
  await denied(contractor.db, 'record_site_progress_v2', { ...progressArgs, p_idempotency_key: randomUUID() });
  assert.ifError((await admin.from('profiles').update({ last_workspace: 'contractor' }).eq('user_id', contractor.id)).error);
  assert.ifError((await admin.from('account_states').insert({ user_id: contractor.id, status: 'suspended' })).error);
  await denied(contractor.db, 'site_execution_snapshot', snapshotArgs);
  assert.ifError((await admin.from('account_states').update({ status: 'active' }).eq('user_id', contractor.id)).error);

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
});
