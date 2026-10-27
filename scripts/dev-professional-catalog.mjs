#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';

const PROJECT_REF = 'nmbpjdltirotoifwuzat';
const PASSWORD = process.env.DAO_PROFESSIONAL_FIXTURE_PASSWORD;
const COUNT = 20;

const businesses = [
  'Atelier Carthage Plomberie', 'Élec Sahloul Services', 'Bâtisseurs du Sahel',
  'Plomberie Cap Bon', 'Électricité Medina', 'Entreprise Atlas Travaux',
  'Les Artisans de La Marsa', 'Sfax Réno Services', 'Monastir Bâtiment Pro',
  'Hammamet Dépannage', 'Kairouan Énergie', 'Bizerte Habitat Services',
  'Ariana Plomberie Express', 'Mahdia Construction', 'Ben Arous Électricité',
  'Carthage Multi-Travaux', 'Nabeul Artisans Réunis', 'Sousse Rénovation',
  'La Médina Plomberie', 'Tunis Entreprise Générale',
];

const people = [
  'Sami Ben Salem', 'Youssef Trabelsi', 'Mehdi Gharbi', 'Anis Jaziri',
  'Walid Mansour', 'Hatem Ayari', 'Nabil Khelifi', 'Fares Bouaziz',
  'Karim Dridi', 'Amine Chaabane', 'Riadh Hamdi', 'Tarek Ben Amor',
  'Oussama Mejri', 'Mohamed Ali Saidi', 'Skander Baccouche', 'Aymen Hajji',
  'Seif Eddine Tlili', 'Marwen Rekik', 'Bilel Chatti', 'Nizar Karray',
];

const palettes = [
  ['#0b6b61','#f1c75b'], ['#244c66','#f39b53'], ['#7a3e48','#e8c07d'],
  ['#315b3f','#d6a85f'], ['#5c3f78','#e2b95b'], ['#8a4b24','#f0d39a'],
  ['#176b87','#e9b44c'], ['#6b705c','#dda15e'], ['#3d5a80','#ee6c4d'],
  ['#774936','#f6bd60'], ['#2a6f97','#f4a261'], ['#6a4c93','#ffca3a'],
  ['#386641','#f2cc8f'], ['#9c6644','#e9c46a'], ['#457b9d','#e76f51'],
  ['#264653','#e9c46a'], ['#5f0f40','#fb8b24'], ['#006d77','#e29578'],
  ['#4f5d75','#ef8354'], ['#335c67','#fff3b0'],
];

function fail(message) { throw new Error(message); }
function env(name) { const value = process.env[name]; if (!value) fail(`Missing protected DEV configuration: ${name}`); return value; }

function config() {
  if (process.env.DAO_FIXTURE_TARGET !== 'dev') fail('Refused: DAO_FIXTURE_TARGET must be dev');
  const url = env('DAO_SUPABASE_URL').replace(/\/$/, '');
  if (!url.includes(PROJECT_REF) || !url.startsWith('https://')) fail('Refused: unexpected Supabase target');
  if (!PASSWORD || PASSWORD.length < 10) fail('Refused: a protected temporary DEV fixture password is required');
  return { url, publishable: env('DAO_SUPABASE_PUBLISHABLE_KEY'), secret: env('DAO_SUPABASE_SECRET_KEY') };
}

function serviceHeaders(c, contentType = 'application/json') {
  return { apikey: c.secret, Authorization: `Bearer ${c.secret}`, 'Content-Type': contentType };
}

async function request(c, path, options = {}, mode = 'service') {
  const token = mode === 'service' ? c.secret : c.publishable;
  const response = await fetch(c.url + path, {
    ...options,
    headers: { apikey: token, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await response.text();
  let body = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }
  if (!response.ok) fail(`DEV catalog request failed: ${options.method || 'GET'} ${path} (${response.status})`);
  return body;
}

const json = body => ({ body: JSON.stringify(body) });
const enc = value => encodeURIComponent(value);

async function rows(c, table, query) {
  const result = await request(c, `/rest/v1/${table}?${query}`);
  if (!Array.isArray(result)) fail(`Unexpected ${table} response`);
  return result;
}

async function insert(c, table, body) {
  const result = await request(c, `/rest/v1/${table}`, {
    method: 'POST', headers: { Prefer: 'return=representation' }, ...json(Array.isArray(body) ? body : [body]),
  });
  return result[0];
}

async function patchOne(c, table, filter, body) {
  const result = await request(c, `/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' }, ...json(body),
  });
  if (!Array.isArray(result) || result.length !== 1) fail(`Expected one ${table} row to update`);
  return result[0];
}

async function ensureRow(c, table, filter, createBody, updateBody = createBody) {
  const existing = await rows(c, table, `${filter}&select=*`);
  if (existing.length > 1) fail(`Duplicate fixture row in ${table}`);
  return existing.length ? patchOne(c, table, filter, updateBody) : insert(c, table, createBody);
}

async function authUsers(c) {
  const body = await request(c, '/auth/v1/admin/users?page=1&per_page=1000');
  if (!Array.isArray(body?.users)) fail('Unexpected Auth users response');
  return body.users;
}

async function ensureUser(c, email) {
  const matches = (await authUsers(c)).filter(user => String(user.email).toLowerCase() === email);
  if (matches.length > 1) fail(`Duplicate Auth identity: ${email}`);
  if (matches.length === 1) {
    await request(c, `/auth/v1/admin/users/${enc(matches[0].id)}`, { method: 'PUT', ...json({ email, password: PASSWORD, email_confirm: true }) });
    return matches[0].id;
  }
  const created = await request(c, '/auth/v1/admin/users', { method: 'POST', ...json({ email, password: PASSWORD, email_confirm: true }) });
  const user = created?.user || created;
  if (!user?.id) fail(`Auth did not return an id for ${email}`);
  return user.id;
}

async function actorToken(c, email) {
  const session = await request(c, '/auth/v1/token?grant_type=password', { method: 'POST', ...json({ email, password: PASSWORD }) }, 'publishable');
  if (!session?.access_token) fail(`Temporary DEV login failed for ${email}`);
  return session.access_token;
}

async function professionalDetails(c, token, input) {
  return actorRpc(c, token, 'details', input);
}

async function actorRpc(c, token, action, input) {
  const response = await fetch(`${c.url}/rest/v1/rpc/professional_command`, {
    method: 'POST',
    headers: { apikey: c.publishable, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_action: action, p_input: input }),
  });
  if (!response.ok) fail(`Owner ${action} command failed (${response.status})`);
  return response.json();
}

async function ensureActorFile(c, token, userId, kind, input, bytes) {
  const table = kind === 'professional' ? 'contractor_files' : 'portfolio_assets';
  const existing = await rows(c, table, `object_path=eq.${enc(input.object_path)}&select=id,content_sha256`);
  if (existing.length > 1) fail(`Duplicate ${kind} media fixture`);
  const file = existing[0] || await actorRpc(c, token, 'file_create', { kind, ...input, size_bytes: bytes.length });
  const hash = await upload(c, input.object_path, bytes);
  if (!existing.length) {
    await request(c, '/rest/v1/rpc/professional_confirm_upload', {
      method: 'POST', ...json({ p_kind: kind === 'professional' ? 'professional' : 'portfolio', p_id: file.id, p_actor: userId, p_sha256: hash }),
    });
  }
  return file;
}

let crcTable;
function crc32(buffer) {
  if (!crcTable) crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n; for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type); const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function rgb(hex) { return [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16)); }
function png(width, height, primary, accent, variant) {
  const [pr, pg, pb] = rgb(primary); const [ar, ag, ab] = rgb(accent);
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const row = y * (width * 4 + 1); raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const stripe = ((x + y + variant * 17) % Math.max(30, Math.floor(width / 5))) < Math.max(10, Math.floor(width / 16));
      const circle = (x - width * .68) ** 2 + (y - height * .34) ** 2 < (Math.min(width, height) * .19) ** 2;
      const light = y < height * .18 || (variant % 2 === 0 && x < width * .14);
      const color = circle || stripe ? [ar, ag, ab] : light ? [Math.min(pr + 35, 255), Math.min(pg + 35, 255), Math.min(pb + 35, 255)] : [pr, pg, pb];
      const offset = row + 1 + x * 4; raw[offset] = color[0]; raw[offset + 1] = color[1]; raw[offset + 2] = color[2]; raw[offset + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

async function upload(c, path, bytes) {
  const response = await fetch(`${c.url}/storage/v1/object/dao-private/${path.split('/').map(enc).join('/')}`, {
    method: 'POST', headers: { ...serviceHeaders(c, 'image/png'), 'x-upsert': 'true' }, body: bytes,
  });
  if (!response.ok) fail(`Storage upload failed for ${path} (${response.status})`);
  return createHash('sha256').update(bytes).digest('hex');
}

async function provisionOne(c, index, trades, areas) {
  const number = index + 1; const email = `ahmedhattab.pro+${number}@gmail.com`;
  const userId = await ensureUser(c, email); const area = areas[index % areas.length];
  const selectedTrades = index % 4 === 3 ? [trades[index % trades.length], trades[(index + 1) % trades.length]] : [trades[index % trades.length]];
  const primaryTrade = selectedTrades[0]; const business = businesses[index];

  const roles = await rows(c, 'user_roles', `user_id=eq.${enc(userId)}&select=role`);
  if (roles.some(row => row.role !== 'contractor')) fail(`Refused to repurpose non-contractor account ${email}`);
  if (!roles.length) await insert(c, 'user_roles', { user_id: userId, role: 'contractor' });
  await ensureRow(c, 'profiles', `user_id=eq.${enc(userId)}`, { user_id: userId, display_name: people[index], last_workspace: 'contractor' }, { display_name: people[index], last_workspace: 'contractor' });
  await ensureRow(c, 'profile_contacts', `user_id=eq.${enc(userId)}`, { user_id: userId, phone_e164: `+21670010${String(number).padStart(3, '0')}`, contact_email: email }, { phone_e164: `+21670010${String(number).padStart(3, '0')}`, contact_email: email });
  await ensureRow(c, 'account_states', `user_id=eq.${enc(userId)}`, { user_id: userId, status: 'active' }, { status: 'active', updated_at: new Date().toISOString() });

  const profile = await ensureRow(c, 'contractor_profiles', `user_id=eq.${enc(userId)}`, {
    user_id: userId, business_name: business, contractor_type: index % 5 === 0 ? 'company' : 'artisan',
    public_presentation: `${business} accompagne les particuliers et entreprises pour des travaux soignés, planifiés et documentés. Profil synthétique de démonstration DEV.`,
    years_experience: 4 + (index % 17), availability: index % 4 === 0 ? 'scheduled' : 'available',
    available_from: index % 4 === 0 ? '2026-11-15' : null, public_trade_name: business,
    public_slug: `dev-artisan-${String(number).padStart(2, '0')}`, verification_status: 'verified', public_identity_status: 'approved',
  }, {
    business_name: business, contractor_type: index % 5 === 0 ? 'company' : 'artisan',
    public_presentation: `${business} accompagne les particuliers et entreprises pour des travaux soignés, planifiés et documentés. Profil synthétique de démonstration DEV.`,
    years_experience: 4 + (index % 17), availability: index % 4 === 0 ? 'scheduled' : 'available',
    available_from: index % 4 === 0 ? '2026-11-15' : null, public_trade_name: business,
    public_slug: `dev-artisan-${String(number).padStart(2, '0')}`, verification_status: 'verified', public_identity_status: 'approved',
  });

  const token = await actorToken(c, email);
  await professionalDetails(c, token, {
    website_url: `https://artisan-${number}.example`, professional_phone: `+21670020${String(number).padStart(3, '0')}`,
    whatsapp_phone: `+21620020${String(number).padStart(3, '0')}`, professional_email: email,
    social_links: [`https://www.facebook.com/dao.dev.artisan.${number}`],
    office_address: `${10 + number} rue des Artisans`, city: area.delegation,
    governorate_id: area.governorate_id, founded_year: 2004 + (index % 19),
    specialties: `${selectedTrades.map(t => t.name_fr).join(', ')} · rénovation · dépannage`,
    tax_identifier: `TEST-DEV-MF-${String(number).padStart(4, '0')}`, registration_identifier: `TEST-DEV-RNE-${String(number).padStart(4, '0')}`,
    legal_name: business, representative_name: people[index], show_website: true, show_phone: true,
    show_whatsapp: true, show_email: true, show_social_links: true, show_exact_address: false,
    service_areas: [{ governorate_id: area.governorate_id, delegation_id: area.delegation_id }],
  });

  await request(c, `/rest/v1/contractor_trades?contractor_id=eq.${enc(profile.id)}`, { method: 'DELETE' });
  await insert(c, 'contractor_trades', selectedTrades.map(trade => ({ contractor_id: profile.id, trade_id: trade.id })));
  await patchOne(c, 'contractor_profiles', `id=eq.${enc(profile.id)}`, { verification_status: 'verified', public_identity_status: 'approved' });

  const [primary, accent] = palettes[index];
  const logo = png(512, 512, primary, accent, index); const logoPath = `professional/${profile.id}/dev-catalog-logo.png`;
  await ensureActorFile(c, token, userId, 'professional', {
    purpose: 'logo', original_name: `logo-${number}.png`, object_path: logoPath,
    mime_type: 'image/png', public_consent: true,
  }, logo);

  const title = `Rénovation ${area.delegation} — ${primaryTrade.name_fr}`;
  const existingPortfolio = await rows(c, 'portfolio_projects', `contractor_id=eq.${enc(profile.id)}&title=eq.${enc(title)}&select=id`);
  if (existingPortfolio.length > 1) fail('Duplicate portfolio fixture');
  const portfolio = await actorRpc(c, token, 'portfolio_save', {
    ...(existingPortfolio[0] ? { id: existingPortfolio[0].id } : {}), title,
    description: `Réalisation synthétique DEV illustrant le savoir-faire de ${business}.`,
    completed_year: 2023 + (index % 3), governorate_id: area.governorate_id, trade_id: primaryTrade.id,
    approximate_location: area.delegation, publication_consent: true,
  });

  for (const [assetIndex, kind] of ['before', 'after'].entries()) {
    const image = png(960, 640, assetIndex ? accent : primary, assetIndex ? primary : accent, index + assetIndex * 7);
    const path = `portfolio/${portfolio.id}/dev-catalog-${kind}.png`;
    await ensureActorFile(c, token, userId, 'portfolio', {
      portfolio_project_id: portfolio.id, object_path: path,
      caption: kind === 'before' ? 'Avant intervention' : 'Après intervention',
      mime_type: 'image/png', original_name: `${kind}-${number}.png`, asset_kind: kind, public_consent: true,
    }, image);
  }
  return { email, userId, contractorId: profile.id };
}

async function signIn(c, email, expectedId) {
  const session = await request(c, '/auth/v1/token?grant_type=password', { method: 'POST', ...json({ email, password: PASSWORD }) }, 'publishable');
  if (!session?.access_token || session.user?.id !== expectedId) fail(`Login verification failed for ${email}`);
}

async function main() {
  const c = config();
  const trades = await rows(c, 'trades', 'active=eq.true&select=id,name_fr&order=code');
  const areas = await request(c, '/rest/v1/delegations?select=id,name_fr,governorate_id,governorates(name_fr)&order=name_fr');
  if (trades.length < 3 || !Array.isArray(areas) || areas.length < 10) fail('DEV reference catalog is incomplete');
  const normalizedAreas = areas.map(area => ({ delegation_id: area.id, delegation: area.name_fr, governorate_id: area.governorate_id }));
  const fixtures = [];
  for (let index = 0; index < COUNT; index += 1) fixtures.push(await provisionOne(c, index, trades, normalizedAreas));
  for (const fixture of fixtures) await signIn(c, fixture.email, fixture.userId);
  const ids = fixtures.map(item => item.contractorId).join(',');
  const profiles = await rows(c, 'contractor_profiles', `id=in.(${ids})&select=id,verification_status,public_identity_status`);
  const details = await rows(c, 'contractor_profile_details', `contractor_id=in.(${ids})&select=contractor_id,review_status`);
  const logos = await rows(c, 'contractor_files', `contractor_id=in.(${ids})&purpose=eq.logo&status=in.(ready,approved)&select=id`);
  const projects = await rows(c, 'portfolio_projects', `contractor_id=in.(${ids})&select=id`);
  const assets = await rows(c, 'portfolio_assets', `contractor_id=in.(${ids})&status=in.(ready,approved)&select=id`);
  if (profiles.length !== COUNT || profiles.some(row => row.verification_status !== 'verified' || row.public_identity_status !== 'approved')) fail('Published contractor verification failed');
  if (details.length !== COUNT) fail('Professional details verification failed');
  if (logos.length < COUNT || projects.length < COUNT || assets.length < COUNT * 2) fail('Published media verification failed');
  console.log(`DEV_PROFESSIONAL_CATALOG accounts=${fixtures.length} logins=PASS profiles=ready_for_final_moderation logos=${logos.length} portfolio_projects=${projects.length} portfolio_assets=${assets.length}`);
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'DEV catalog provisioning failed'); process.exit(1); });

