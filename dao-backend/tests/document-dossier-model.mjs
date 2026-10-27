import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

// P15 / Mission 5 (#456): document families, revisions, lot sharing and
// technical reviews, exercised with JWT-like identities on the real migrations.
const db = new PGlite();
let passed = 0;
async function check(name, fn) {
  try { await fn(); passed++; }
  catch (error) { console.error('FAIL', name, error.code ?? '', error.message); throw error; }
}
async function as(user, fn) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec('set role authenticated');
  try { return await fn(); }
  finally { await db.exec("reset role; select set_config('request.jwt.claim.sub','',false)"); }
}
async function rejects(promise, code) {
  await assert.rejects(promise, error => { assert.equal(error.code, code, error.message); return true; });
}
async function insert(table, row) {
  const keys = Object.keys(row);
  return (await db.query(`insert into public.${table}(${keys.join(',')}) values(${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning id`, Object.values(row))).rows[0].id;
}
let keySeq = 0;
const key = () => `doc-key-${++keySeq}-${randomUUID().slice(0, 8)}`;
async function command(user, action, args = {}) {
  return as(user, async () => (await db.query(
    'select public.document_dossier_command_v1($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid[],$10,$11,$12,$13) as value',
    [action, args.project ?? null, args.family ?? null, args.document ?? null, args.revision ?? null, args.title ?? null,
      args.category ?? null, args.visibility ?? null, args.lots ?? null, args.note ?? null, args.version ?? null,
      args.expected ?? null, args.key ?? key()])).rows[0].value);
}
async function dossier(user, project, request = null) {
  return as(user, async () => (await db.query('select public.document_dossier_v1($1,$2) as value', [project, request])).rows[0].value);
}
async function canSeeDocument(user, id) {
  return as(user, async () => (await db.query('select id from public.documents where id=$1', [id])).rows.length === 1);
}

await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
  $$;
  grant usage on schema public,auth to anon,authenticated,service_role;
  grant execute on function auth.uid() to anon,authenticated,service_role;
  create schema storage;
  create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
  alter table storage.objects enable row level security;
  grant usage on schema storage to anon,authenticated;
  grant select,insert,update,delete on storage.objects to anon,authenticated;
  create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
`);
for (const file of readdirSync(new URL('../supabase/migrations/', import.meta.url)).filter(f => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(new URL('../supabase/migrations/' + file, import.meta.url), 'utf8'));
}
await db.exec(readFileSync(new URL('../supabase/seed.sql', import.meta.url), 'utf8'));

const U = {};
for (const [name, role] of [['client', 'client'], ['artA', 'contractor'], ['artB', 'contractor'], ['member', 'contractor'],
  ['manager', 'dao_reviewer'], ['otherManager', 'dao_reviewer'], ['stranger', 'client']]) {
  U[name] = randomUUID();
  await db.query('insert into auth.users(id) values($1)', [U[name]]);
  await db.query("insert into public.profiles(user_id,display_name) values($1,$2)", [U[name], name]);
  await db.query('insert into public.user_roles(user_id,role) values($1,$2)', [U[name], role]);
}
const C = {};
for (const name of ['artA', 'artB', 'member']) {
  C[name] = await insert('contractor_profiles', { user_id: U[name], business_name: name, verification_status: 'verified' });
}
const trade = (await db.query('select id from public.trades limit 1')).rows[0].id;
const P = await insert('projects', { client_id: U.client });
if (!(await db.query("select 1 from public.project_members where project_id=$1 and user_id=$2", [P, U.client])).rows.length) {
  await insert('project_members', { project_id: P, user_id: U.client, participation_role: 'client', status: 'accepted' });
}
const memberRow = await insert('project_members', { project_id: P, user_id: U.member, participation_role: 'contractor', status: 'accepted' });
const lots = [];
for (const title of ['Lot A plomberie', 'Lot B électricité', 'Lot C équipe']) {
  const r = await insert('project_requests', { project_id: P });
  const rv = await insert('project_request_versions', { request_id: r, project_id: P, version_no: 1, trade_id: trade, title, scope: 'Test' });
  lots.push({ r, rv });
}
async function award(contractor, lot) {
  const b = await insert('bids', { project_id: P, contractor_id: contractor });
  const v = await insert('bid_versions', { bid_id: b, project_id: P, contractor_id: contractor, version_no: 1, expires_at: '2099-01-01T00:00:00Z' });
  const item = await insert('bid_items', { bid_version_id: v, project_id: P, contractor_id: contractor, request_id: lot.r, request_version_id: lot.rv, price_millimes: 1000, duration_days: 5, inclusions: 'Test' });
  await db.query("update public.bid_versions set status='submitted',submitted_at=now() where id=$1", [v]);
  const a = await insert('awards', { project_id: P, contractor_id: contractor });
  const ai = await insert('award_items', { award_id: a, project_id: P, contractor_id: contractor, request_id: lot.r, bid_item_id: item, agreed_millimes: 1000 });
  await db.query("update public.project_requests set status='awarded' where id=$1", [lot.r]);
  return ai;
}
const awardA = await award(C.artA, lots[0]);
await award(C.artB, lots[1]);
await db.query('update public.project_requests set contractor_member_id=$2 where id=$1', [lots[2].r, memberRow]);
await db.query('insert into public.review_assignments(project_id,reviewer_id,assigned_at) values($1,$2,now())', [P, U.manager]);

async function doc(owner, name, status = 'quarantined', share = 'owner_only') {
  return insert('documents', { project_id: P, owner_id: owner, object_path: `project/${P}/${randomUUID()}-${name}`, original_name: name,
    mime_type: 'application/pdf', size_bytes: 10, status, share_scope: share });
}

const v1 = await doc(U.client, 'plan-v1.pdf');
const v2 = await doc(U.client, 'plan-v2.pdf');
const hidden = await doc(U.client, 'note-privee.pdf', 'approved');
let family, rev1, rev2;

await check('only the document owner, still a participant, can classify it', async () => {
  await rejects(command(U.member, 'create_family', { project: P, document: v1, title: 'Plan', key: key() }), '42501');
  await rejects(command(U.stranger, 'create_family', { project: P, document: v1, title: 'Plan', key: key() }), '42501');
  const created = await command(U.client, 'create_family', { project: P, document: v1, title: ' Plan RDC ', category: 'plan', visibility: 'lots', lots: [lots[0].r], note: 'Première émission' });
  family = created.familyId; rev1 = created.revisionId;
  assert.equal(created.version, 1);
  await rejects(command(U.client, 'create_family', { project: P, document: v1, title: 'Doublon' }), '23505');
});

await check('commands are idempotent per actor and key', async () => {
  const k = key();
  const first = await command(U.client, 'create_family', { project: P, document: hidden, title: 'Note', visibility: 'private', key: k });
  const replay = await command(U.client, 'create_family', { project: P, document: hidden, title: 'Note', visibility: 'private', key: k });
  assert.equal(replay.replayed, true); assert.equal(replay.familyId, first.familyId);
});

await check('quarantined files stay invisible to lot holders until the assigned manager controls them', async () => {
  assert.equal(await canSeeDocument(U.artA, v1), false);
  const seen = await dossier(U.artA, P);
  assert.equal(seen.families.length, 1);
  assert.equal(seen.families[0].revisions[0].document, null);
  await rejects(as(U.otherManager, () => db.query("select public.document_file_control_v1($1,'approved',null,$2)", [v1, key()])), '42501');
  await rejects(as(U.client, () => db.query("select public.document_file_control_v1($1,'approved',null,$2)", [v1, key()])), '42501');
  await rejects(as(U.manager, () => db.query("select public.document_file_control_v1($1,'rejected',null,$2)", [v1, key()])), '22023');
  await as(U.manager, () => db.query("select public.document_file_control_v1($1,'approved',null,$2)", [v1, key()]));
  await rejects(as(U.manager, () => db.query("select public.document_file_control_v1($1,'approved',null,$2)", [v1, key()])), '40001');
  assert.equal(await canSeeDocument(U.artA, v1), true);
});

await check('lot sharing follows the active award: the other lot holder and strangers see nothing', async () => {
  assert.equal(await canSeeDocument(U.artB, v1), false);
  assert.equal(await canSeeDocument(U.stranger, v1), false);
  assert.equal(await canSeeDocument(U.member, v1), false);
  assert.equal((await dossier(U.artB, P)).families.length, 0);
  await rejects(dossier(U.stranger, P), '42501');
  await rejects(dossier(U.artB, P, lots[0].r), '42501');
  const lotView = await dossier(U.artA, P, lots[0].r);
  assert.equal(lotView.families.length, 1);
  assert.deepEqual(lotView.lots.map(l => l.id), [lots[0].r]);
  assert.equal(lotView.actor.canReview, false);
  assert.equal((await dossier(U.artA, P)).families[0].title, 'Plan RDC');
  assert.equal((await dossier(U.client, P)).families.length, 2);
  // Private families are never exposed to the Client of another author or to lot holders.
  assert.equal(await canSeeDocument(U.artA, hidden), false);
});

await check('a new revision supersedes the previous one, with optimistic concurrency', async () => {
  await rejects(command(U.client, 'add_revision', { family, document: v2, expected: randomUUID() }), '40001');
  await rejects(command(U.artA, 'add_revision', { family, document: v2, expected: rev1 }), '42501');
  const added = await command(U.client, 'add_revision', { family, document: v2, expected: rev1, note: 'Cotes corrigées' });
  rev2 = added.revisionId;
  await rejects(command(U.client, 'add_revision', { family, document: await doc(U.client, 'plan-v3.pdf'), expected: rev1 }), '40001');
  const view = await dossier(U.client, P);
  const fam = view.families.find(f => f.id === family);
  assert.equal(fam.currentRevisionNo, 2);
  assert.deepEqual(fam.revisions.map(r => [r.revisionNo, r.reviewStatus]), [[2, 'to_review'], [1, 'superseded']]);
  // V2 is still quarantined: the lot holder keeps V1 (marked superseded) and never sees the unchecked file.
  const holder = (await dossier(U.artA, P)).families[0];
  assert.equal(holder.revisions[0].document, null);
  assert.equal(holder.revisions[1].document.originalName, 'plan-v1.pdf');
});

await check('technical review: Client or assigned manager only, current controlled revision only, never self-review', async () => {
  await rejects(command(U.manager, 'reviewed', { revision: rev2 }), '23514');
  await as(U.manager, () => db.query("select public.document_file_control_v1($1,'approved',null,$2)", [v2, key()]));
  await rejects(command(U.client, 'reviewed', { revision: rev2 }), '42501');
  await rejects(command(U.artA, 'start_review', { revision: rev2 }), '42501');
  await rejects(command(U.otherManager, 'start_review', { revision: rev2 }), '42501');
  await rejects(command(U.manager, 'reviewed', { revision: rev1 }), '40001');
  await rejects(command(U.manager, 'observations', { revision: rev2 }), '22023');
  await command(U.manager, 'start_review', { revision: rev2 });
  assert.equal((await dossier(U.client, P)).families.find(f => f.id === family).revisions[0].reviewStatus, 'in_review');
  await command(U.manager, 'observations', { revision: rev2, note: 'Préciser la pente des évacuations' });
  await command(U.artA, 'comment', { revision: rev2, note: 'Pente 2 % prévue' });
  await rejects(command(U.artA, 'comment', { revision: rev2 }), '22023');
  await command(U.manager, 'reviewed', { revision: rev2, note: 'Revu techniquement, sans effet juridique' });
  const fam = (await dossier(U.artA, P)).families[0];
  assert.equal(fam.revisions[0].reviewStatus, 'reviewed');
  assert.ok(fam.events.some(e => e.kind === 'comment' && e.actorRole === 'participant'));
});

await check('a newer revision never inherits the previous visa', async () => {
  const v3 = await doc(U.client, 'plan-v3b.pdf', 'approved');
  const added = await command(U.client, 'add_revision', { family, document: v3, expected: rev2 });
  const fam = (await dossier(U.client, P)).families.find(f => f.id === family);
  assert.deepEqual(fam.revisions.map(r => r.reviewStatus), ['to_review', 'superseded', 'superseded']);
  await rejects(command(U.manager, 'reviewed', { revision: rev2 }), '40001');
  await command(U.manager, 'correction_requested', { revision: added.revisionId, note: 'Nouvelle version demandée' });
  const after = (await dossier(U.client, P)).families.find(f => f.id === family);
  assert.equal(after.revisions[0].reviewStatus, 'observations');
  assert.equal(after.revisions[0].correctionRequested, true);
});

await check('metadata updates are versioned and lot links are revoked, never deleted', async () => {
  const before = (await dossier(U.client, P)).families.find(f => f.id === family);
  await rejects(command(U.client, 'update_family', { family, title: 'Plan', visibility: 'lots', version: before.version - 1 }), '40001');
  await rejects(command(U.client, 'update_family', { family, title: 'Plan', visibility: 'lots', lots: [randomUUID()], version: before.version }), '23514');
  await command(U.client, 'update_family', { family, title: 'Plan RDC indice C', category: 'plan', visibility: 'lots', lots: [lots[1].r], version: before.version });
  assert.equal(await canSeeDocument(U.artA, v1), false);
  assert.equal(await canSeeDocument(U.artB, v1), true);
  assert.equal(Number((await db.query('select count(*) from public.document_family_lots where family_id=$1', [family])).rows[0].count), 2);
  await rejects(db.query('delete from public.document_family_lots where family_id=$1', [family]), '23514');
});

await check('team member assigned to a lot and project visibility', async () => {
  const memberDoc = await doc(U.member, 'detail-equipe.pdf', 'approved');
  const created = await command(U.member, 'create_family', { project: P, document: memberDoc, title: 'Détail', visibility: 'lots', lots: [lots[2].r] });
  assert.equal(await canSeeDocument(U.client, memberDoc), true);
  assert.equal(await canSeeDocument(U.artA, memberDoc), false);
  const shared = await doc(U.client, 'note-chantier.pdf', 'approved', 'project_members');
  await rejects(command(U.client, 'create_family', { project: P, document: shared, title: 'Note', visibility: 'lots' }), '23514');
  await command(U.client, 'create_family', { project: P, document: shared, title: 'Note', visibility: 'project' });
  assert.equal(await canSeeDocument(U.member, shared), true);
  assert.ok(created.familyId);
});

await check('versioned files cannot be deleted, re-shared or rewritten', async () => {
  await rejects(as(U.client, () => db.query('select public.delete_project_document($1)', [v1])), '23514');
  await rejects(as(U.client, () => db.query("select public.set_project_document_sharing($1,'project_members')", [v1])), '23514');
  await rejects(db.query('update public.document_revisions set note=$2 where id=$1', [rev1, 'rewrite']), '23514');
  await rejects(db.query('delete from public.document_dossier_events where family_id=$1', [family]), '23514');
  await rejects(as(U.client, () => db.query('insert into public.document_families(project_id,created_by,title) values($1,$2,$3)', [P, U.client, 'direct'])), '42501');
  const legacy = await doc(U.client, 'legacy.pdf');
  await as(U.client, () => db.query('select public.delete_project_document($1)', [legacy]));
});

await check('revoked award and suspended account lose access immediately', async () => {
  assert.equal(await canSeeDocument(U.artB, v1), true);
  await db.query("insert into public.account_states(user_id,status) values($1,'suspended') on conflict (user_id) do update set status='suspended'", [U.artB]);
  assert.equal(await canSeeDocument(U.artB, v1), false);
  await rejects(dossier(U.artB, P), '42501');
  await db.query("update public.account_states set status='active' where user_id=$1", [U.artB]);
  // A Client-revoked contractor participation removes award-based access at once.
  await db.query("insert into public.project_members(project_id,user_id,participation_role,status,revoked_at) values($1,$2,'contractor','revoked',now())", [P, U.artB]);
  assert.equal(await canSeeDocument(U.artB, v1), false);
  assert.ok(awardA);
});

console.log(JSON.stringify({ suite: 'document-dossier-model', passed }));
