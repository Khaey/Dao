import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// P15 / Mission 5 (#456): real Auth/JWT, PostgREST grants, RLS and private Storage
// for versioned plans shared per awarded lot, with non-legal technical reviews.
test('document dossier V2: lot-scoped plan versions, file control and technical review over real JWT', async () => {
  const url = process.env.DAO_SUPABASE_URL!;
  assert.equal(url, 'http://127.0.0.1:54321');
  const publishable = process.env.DAO_SUPABASE_PUBLISHABLE_KEY!;
  const admin = createClient(url, process.env.DAO_SUPABASE_SECRET_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = 'D0c-' + randomUUID();
  async function actor(label: string, role: string) {
    const created = await admin.auth.admin.createUser({ email: `dossier-${label}-${randomUUID()}@example.invalid`, password, email_confirm: true });
    assert.ifError(created.error);
    const id = created.data.user!.id;
    assert.ifError((await admin.from('profiles').insert({ user_id: id, display_name: label, last_workspace: role === 'contractor' ? 'contractor' : 'client' })).error);
    assert.ifError((await admin.from('user_roles').insert({ user_id: id, role })).error);
    const auth = createClient(url, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await auth.auth.signInWithPassword({ email: created.data.user!.email!, password });
    assert.ifError(signed.error);
    return { id, db: createClient(url, publishable, { global: { headers: { Authorization: `Bearer ${signed.data.session!.access_token}` } }, auth: { persistSession: false, autoRefreshToken: false } }) };
  }
  const key = () => 'dossier-' + randomUUID();
  const client = await actor('client', 'client');
  const artA = await actor('artisan-a', 'contractor');
  const artB = await actor('artisan-b', 'contractor');
  const manager = await actor('gestionnaire', 'dao_reviewer');
  const otherManager = await actor('gestionnaire-b', 'dao_reviewer');
  const stranger = await actor('tiers', 'client');

  const project = await admin.from('projects').insert({ client_id: client.id, initiator_id: client.id, project_origin: 'client_marketplace' }).select('id').single();
  assert.ifError(project.error);
  const P = project.data!.id;
  const trade = await admin.from('trades').select('id').limit(1).single();
  assert.ifError(trade.error);
  assert.ifError((await admin.from('review_assignments').insert({ project_id: P, reviewer_id: manager.id, assigned_at: new Date().toISOString() })).error);

  async function awardedLot(contractor: { id: string }, title: string) {
    const profile = await admin.from('contractor_profiles').insert({ user_id: contractor.id, business_name: title, verification_status: 'verified', contractor_type: 'artisan', public_identity_status: 'approved' }).select('id').single();
    assert.ifError(profile.error);
    const request = await admin.from('project_requests').insert({ project_id: P }).select('id').single();
    assert.ifError(request.error);
    const requestVersion = await admin.from('project_request_versions').insert({ project_id: P, request_id: request.data!.id, version_no: 1, trade_id: trade.data!.id, title, scope: 'Travaux', budget_millimes: 100000 }).select('id').single();
    assert.ifError(requestVersion.error);
    const bid = await admin.from('bids').insert({ project_id: P, contractor_id: profile.data!.id }).select('id').single();
    assert.ifError(bid.error);
    const bidVersion = await admin.from('bid_versions').insert({ bid_id: bid.data!.id, project_id: P, contractor_id: profile.data!.id, version_no: 1, status: 'draft', validity: 'current', expires_at: '2099-01-01' }).select('id').single();
    assert.ifError(bidVersion.error);
    const bidItem = await admin.from('bid_items').insert({ bid_version_id: bidVersion.data!.id, project_id: P, contractor_id: profile.data!.id, request_version_id: requestVersion.data!.id, request_id: request.data!.id, price_millimes: 100000, duration_days: 5, inclusions: 'Pose' }).select('id').single();
    assert.ifError(bidItem.error);
    assert.ifError((await admin.from('bid_versions').update({ status: 'submitted', submitted_at: new Date().toISOString() }).eq('id', bidVersion.data!.id)).error);
    const award = await admin.from('awards').insert({ project_id: P, contractor_id: profile.data!.id, status: 'confirmed' }).select('id').single();
    assert.ifError(award.error);
    assert.ifError((await admin.from('award_items').insert({ award_id: award.data!.id, project_id: P, contractor_id: profile.data!.id, request_id: request.data!.id, bid_item_id: bidItem.data!.id, agreed_millimes: 100000, active: true })).error);
    assert.ifError((await admin.from('project_requests').update({ status: 'awarded' }).eq('id', request.data!.id)).error);
    return request.data!.id as string;
  }
  const lotA = await awardedLot(artA, 'Lot A plomberie');
  const lotB = await awardedLot(artB, 'Lot B électricité');

  // Upload through the existing JWT-scoped document command and private bucket.
  async function upload(name: string) {
    const path = `project/${P}/${randomUUID()}-${name}`;
    const created = await client.db.rpc('create_project_document', { p_project_id: P, p_object_path: path, p_original_name: name, p_mime_type: 'application/pdf', p_size_bytes: 9 });
    assert.ifError(created.error);
    assert.ifError((await admin.storage.from('dao-private').upload(path, new Blob(['%PDF-1.4\n'], { type: 'application/pdf' }))).error);
    return created.data.id as string;
  }
  async function cmd(who: { db: any }, args: Record<string, unknown>) {
    return who.db.rpc('document_dossier_command_v1', {
      p_action: null, p_project_id: null, p_family_id: null, p_document_id: null, p_revision_id: null, p_title: null, p_category: null,
      p_visibility: null, p_request_ids: null, p_note: null, p_expected_version: null, p_expected_revision_id: null, p_idempotency_key: key(), ...args,
    });
  }
  const control = (who: { db: any }, document: string) => who.db.rpc('document_file_control_v1', { p_document_id: document, p_decision: 'approved', p_reason: null, p_idempotency_key: key() });
  const readable = async (who: { db: any }, document: string) => ((await who.db.from('documents').select('id').eq('id', document)).data ?? []).length === 1;

  const v1 = await upload('plan-v1.pdf');
  const created = await cmd(client, { p_action: 'create_family', p_project_id: P, p_document_id: v1, p_title: 'Plan RDC', p_category: 'plan', p_visibility: 'lots', p_request_ids: [lotA] });
  assert.ifError(created.error);
  assert.equal((await artA.db.from('document_families').select('id')).data?.length, 1);
  assert.equal((await artB.db.from('document_families').select('id')).data?.length, 0);
  assert.equal(await readable(artA, v1), false, 'quarantined file stays private');
  assert.equal((await control(otherManager, v1)).error?.code, '42501');
  assert.ifError((await control(manager, v1)).error);
  assert.equal(await readable(artA, v1), true);
  assert.equal(await readable(artB, v1), false);
  assert.equal(await readable(stranger, v1), false);

  const v2 = await upload('plan-v2.pdf');
  const stale = await cmd(client, { p_action: 'add_revision', p_family_id: created.data.familyId, p_document_id: v2, p_expected_revision_id: randomUUID() });
  assert.equal(stale.error?.code, '40001');
  const added = await cmd(client, { p_action: 'add_revision', p_family_id: created.data.familyId, p_document_id: v2, p_expected_revision_id: created.data.revisionId, p_note: 'Cotes corrigées' });
  assert.ifError(added.error);
  assert.ifError((await control(manager, v2)).error);
  assert.equal((await artA.db.rpc('document_dossier_v1', { p_project_id: P, p_request_id: lotB })).error?.code, '42501');
  const lotView = await artA.db.rpc('document_dossier_v1', { p_project_id: P, p_request_id: lotA });
  assert.ifError(lotView.error);
  assert.deepEqual(lotView.data.families[0].revisions.map((r: any) => [r.revisionNo, r.reviewStatus]), [[2, 'to_review'], [1, 'superseded']]);
  assert.equal((await stranger.db.rpc('document_dossier_v1', { p_project_id: P, p_request_id: null })).error?.code, '42501');

  // Holders read the row through RLS; the bucket itself stays closed to direct JWT reads.
  const row = await artA.db.from('documents').select('object_path').eq('id', v2).single();
  assert.ifError(row.error);
  assert.equal((await artA.db.storage.from('dao-private').download(row.data!.object_path)).error !== null, true, 'no direct bucket read');

  assert.equal((await cmd(artA, { p_action: 'reviewed', p_revision_id: added.data.revisionId })).error?.code, '42501');
  assert.equal((await cmd(client, { p_action: 'reviewed', p_revision_id: added.data.revisionId })).error?.code, '42501', 'no self-review');
  assert.equal((await cmd(manager, { p_action: 'reviewed', p_revision_id: created.data.revisionId })).error?.code, '40001');
  assert.ifError((await cmd(manager, { p_action: 'observations', p_revision_id: added.data.revisionId, p_note: 'Préciser les pentes' })).error);
  assert.ifError((await cmd(artA, { p_action: 'comment', p_revision_id: added.data.revisionId, p_note: 'Pente 2 %' })).error);
  assert.ifError((await cmd(manager, { p_action: 'reviewed', p_revision_id: added.data.revisionId })).error);
  const events = await artA.db.from('document_dossier_events').select('event_kind,idempotency_key');
  assert.ok(events.error, 'idempotency keys are not readable');
  assert.equal(((await artA.db.from('document_dossier_events').select('event_kind')).data ?? []).some((e: any) => e.event_kind === 'reviewed'), true);
  assert.ok((await artA.db.from('document_revisions').update({ note: 'x' }).eq('id', added.data.revisionId).select()).data?.length !== 1);
  assert.equal((await client.db.rpc('delete_project_document', { p_document_id: v1 })).error?.code, '23514');

  assert.ifError((await admin.from('account_states').upsert({ user_id: artA.id, status: 'suspended' })).error);
  assert.equal(await readable(artA, v2), false, 'suspended account loses access');
});
