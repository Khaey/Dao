import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { OceGatewayClient, createOceGateway, disabledGateway, settleOce, unixSocketTransport } from '../src/oce/gatewayClient.js';
import { InMemoryOceGateway } from '../src/oce/inMemoryGateway.js';
import { OceGatewayError } from '../src/oce/gatewayContract.js';

// #58 — D.A.O -> OCE gateway adapter: protocol, bounds, failure isolation. No live gateway, no secret.
const ref = { dao_project_id: '11111111-1111-4111-8111-111111111111', dao_lot_id: '22222222-2222-4222-8222-222222222222' };
type Seen = { method: string; url: string; headers: http.IncomingHttpHeaders; body: any };

async function fakeGateway(handler: (seen: Seen, res: http.ServerResponse, n: number) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oce-gw-'));
  const socket = path.join(dir, 'g.sock'); const seen: Seen[] = [];
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', c => raw += c);
    req.on('end', () => { const s = { method: req.method!, url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : null }; seen.push(s); handler(s, res, seen.length); });
  });
  await new Promise<void>(resolve => server.listen(socket, resolve));
  const json = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  return { socket, seen, json, close: () => new Promise<void>(resolve => { server.closeAllConnections?.(); server.close(() => { fs.rmSync(dir, { recursive: true, force: true }); resolve(); }); }) };
}
const fast = (socket: string, extra: any = {}) => new OceGatewayClient({ transport: unixSocketTransport(socket), sleep: async () => {}, timeoutMs: 300, calculateTimeoutMs: 300, ...extra });
const rejects = async (promise: Promise<unknown>, kind: string, code?: string) => {
  try { await promise; } catch (error: any) { assert.ok(error instanceof OceGatewayError, String(error)); assert.equal(error.kind, kind); if (code) assert.equal(error.code, code); return error; }
  assert.fail('must reject');
};

test('speaks only the allowlisted operations with exact bodies and no credential', async () => {
  const gw = await fakeGateway((s, res) => gw.json(res, 200, s.url === '/v1/ensure-dependency' ? { ok: true, created: true, updated: false } : s.url.startsWith('/v1/calc') ? { ok: true, project_duration_days: 12, critical_activity_codes: ['A1'] } : s.url.startsWith('/v1/planning') ? { ok: true, total_activities: 2, critical_count: 1, on_track: 1, delayed: 0, completed: 0, not_started: 1, in_progress: 0, progress_pct: 10, total_duration_days: 12, next_milestone: null, extra: 'dropped' } : { ok: true, created: true }));
  try {
    const client = fast(gw.socket);
    await client.health(); await client.ready();
    await client.ensureProject({ ...ref, name: ' Chantier ', region: 'Sousse', currency: 'tnd' });
    await client.ensureWbs({ ...ref, code: 'LOT-1', name: 'Gros œuvre' });
    await client.ensureSchedule({ ...ref, start_date: '2026-11-01', end_date: '2026-12-31' });
    await client.upsertActivity({ ...ref, activity_code: 'A1', name: 'Fondations', wbs_code: 'LOT-1', start_date: '2026-11-01', end_date: '2026-11-10' });
    await client.ensureDependency({ ...ref, predecessor_activity_code: 'A1', successor_activity_code: 'A2' });
    assert.deepEqual(await client.calculatePlanning(ref), { ok: true, project_duration_days: 12, critical_activity_codes: ['A1'] });
    const summary = await client.planningSummary(ref);
    assert.equal((summary as any).extra, undefined); assert.equal(summary.next_milestone, null);
    assert.deepEqual(gw.seen.map(s => `${s.method} ${s.url}`), ['GET /health', 'GET /ready', 'POST /v1/ensure-project', 'POST /v1/ensure-wbs', 'POST /v1/ensure-schedule', 'POST /v1/upsert-activity', 'POST /v1/ensure-dependency', 'POST /v1/calculate-planning', 'POST /v1/planning-summary']);
    assert.deepEqual(gw.seen[2].body, { ...ref, name: 'Chantier', description: '', region: 'Sousse', currency: 'TND' });
    assert.deepEqual(Object.keys(gw.seen[5].body).sort(), ['activity_code', 'activity_type', 'dao_lot_id', 'dao_project_id', 'description', 'end_date', 'name', 'progress_pct', 'start_date', 'status', 'wbs_code']);
    for (const s of gw.seen) for (const header of ['authorization', 'cookie', 'x-api-key', 'apikey']) assert.equal(s.headers[header], undefined);
  } finally { await gw.close(); }
});

test('invalid input is rejected locally: nothing reaches the gateway', async () => {
  const gw = await fakeGateway((_s, res) => gw.json(res, 200, { ok: true, created: true }));
  try {
    const client = fast(gw.socket);
    await rejects(client.ensureProject({ ...ref, dao_project_id: 'not-a-uuid', name: 'x', region: 'r', currency: 'TND' }), 'invalid_request', 'invalid_dao_project_id');
    await rejects(client.ensureWbs({ ...ref, code: '../etc', name: 'x' }), 'invalid_request', 'invalid_code');
    await rejects(client.ensureSchedule({ ...ref, start_date: '2026-02-30', end_date: '2026-03-01' }), 'invalid_request', 'invalid_start_date');
    await rejects(client.ensureSchedule({ ...ref, start_date: '2026-03-02', end_date: '2026-03-01' }), 'invalid_request', 'invalid_date_range');
    await rejects(client.upsertActivity({ ...ref, activity_code: 'A1', name: 'x', start_date: '2026-11-01', end_date: '2026-11-02', progress_pct: 101 }), 'invalid_request', 'invalid_progress_pct');
    await rejects(client.upsertActivity({ ...ref, activity_code: 'A1', name: 'x', start_date: '2026-11-01', end_date: '2026-11-02', status: 'done' as any }), 'invalid_request', 'invalid_status');
    await rejects(client.ensureDependency({ ...ref, predecessor_activity_code: 'A1', successor_activity_code: 'A1' }), 'invalid_request', 'dependency_self_reference');
    await rejects(client.ensureWbs({ ...ref, code: 'L1', name: 'x', token: 'secret' } as any), 'invalid_request', 'unexpected_field');
    await rejects(client.calculatePlanning({ dao_project_id: ref.dao_project_id } as any), 'invalid_request');
    assert.equal(gw.seen.length, 0);
  } finally { await gw.close(); }
});

test('gateway answers map to typed errors; only outages are retried', async () => {
  const answers: Record<string, [number, unknown]> = {
    '/v1/ensure-project': [403, { ok: false, error: 'mapping_not_authorized' }], '/v1/ensure-wbs': [409, { ok: false, error: 'wbs_ownership_mismatch' }],
    '/v1/ensure-schedule': [400, { ok: false, error: 'invalid_date_range' }], '/v1/upsert-activity': [404, { ok: false, error: 'operation_not_allowed' }],
    '/v1/calculate-planning': [503, { ok: false, error: 'oce_unhealthy' }],
  };
  const gw = await fakeGateway((s, res) => { const [status, body] = answers[s.url]; gw.json(res, status, body); });
  try {
    const client = fast(gw.socket, { breakerThreshold: 99 });
    const count = (url: string) => gw.seen.filter(s => s.url === url).length;
    await rejects(client.ensureProject({ ...ref, name: 'x', region: 'r', currency: 'TND' }), 'not_authorized', 'mapping_not_authorized'); assert.equal(count('/v1/ensure-project'), 1);
    await rejects(client.ensureWbs({ ...ref, code: 'L1', name: 'x' }), 'conflict', 'wbs_ownership_mismatch'); assert.equal(count('/v1/ensure-wbs'), 1);
    await rejects(client.ensureSchedule({ ...ref, start_date: '2026-11-01', end_date: '2026-11-02' }), 'invalid_request', 'invalid_date_range'); assert.equal(count('/v1/ensure-schedule'), 1);
    await rejects(client.upsertActivity({ ...ref, activity_code: 'A1', name: 'x', start_date: '2026-11-01', end_date: '2026-11-02' }), 'rejected', 'operation_not_allowed'); assert.equal(count('/v1/upsert-activity'), 1);
    await rejects(client.calculatePlanning(ref), 'unavailable', 'oce_unhealthy'); assert.equal(count('/v1/calculate-planning'), 3); // initial + 2 bounded retries
  } finally { await gw.close(); }
});

test('an ambiguous write is replayed and converges (idempotent), then succeeds', async () => {
  const gw = await fakeGateway((_s, res, n) => n === 1 ? gw.json(res, 502, { ok: false, error: 'oce_write_ambiguous' }) : gw.json(res, 200, { ok: true, created: false }));
  try { assert.deepEqual(await fast(gw.socket).ensureWbs({ ...ref, code: 'L1', name: 'x' }), { ok: true, created: false }); assert.equal(gw.seen.length, 2); } finally { await gw.close(); }
});

test('timeouts, oversized, malformed and mis-shaped answers fail closed', async () => {
  let mode = 'slow';
  const gw = await fakeGateway((_s, res) => {
    if (mode === 'slow') return void setTimeout(() => { try { res.end('{}'); } catch { /* closed */ } }, 1000);
    if (mode === 'big') { res.writeHead(200); return void res.end('x'.repeat(1024 * 1024 + 10)); }
    if (mode === 'html') { res.writeHead(200); return void res.end('<html>'); }
    gw.json(res, 200, { ok: true, created: 'yes' });
  });
  try {
    const client = fast(gw.socket, { attempts: 1, breakerThreshold: 99 });
    await rejects(client.health(), 'timeout');
    mode = 'big'; await rejects(client.health(), 'protocol', 'response_too_large');
    mode = 'html'; await rejects(client.health(), 'protocol', 'invalid_json');
    mode = 'shape'; await rejects(client.ensureWbs({ ...ref, code: 'L1', name: 'x' }), 'protocol', 'response_shape');
  } finally { await gw.close(); }
});

test('a missing socket is an outage; the breaker opens, fails fast, then probes once after the cooldown', async () => {
  let now = 0; let calls = 0;
  const client = new OceGatewayClient({ transport: async () => { calls++; throw Object.assign(new Error('x'), { code: 'ENOENT' }); }, sleep: async () => {}, now: () => now, attempts: 2, breakerThreshold: 2, breakerCooldownMs: 1000 });
  await rejects(client.health(), 'unavailable', 'enoent'); assert.equal(calls, 2);
  await rejects(client.health(), 'unavailable'); assert.equal(calls, 4); // threshold reached: breaker opens
  await rejects(client.health(), 'circuit_open'); assert.equal(calls, 4); // no I/O while open
  now = 1500; await rejects(client.health(), 'unavailable'); assert.equal(calls, 6); // single probe, still down -> reopened
  await rejects(client.health(), 'circuit_open'); assert.equal(calls, 6);
});

test('caller mistakes never trip the breaker; recovery closes it', async () => {
  let status = 403;
  const client = new OceGatewayClient({ transport: async () => ({ status, body: status === 200 ? '{"ok":true}' : '{"error":"mapping_not_authorized"}' }), sleep: async () => {}, breakerThreshold: 2 });
  for (let i = 0; i < 5; i++) await rejects(client.health(), 'not_authorized');
  status = 200; assert.deepEqual(await client.health(), { ok: true });
});

test('integration switch: off by default, bad socket paths refused, commercial flows stay isolated', async () => {
  for (const env of [{}, { DAO_OCE_ENABLED: '0' }, { DAO_OCE_ENABLED: '1', DAO_OCE_GATEWAY_SOCKET: 'relative.sock' }, { DAO_OCE_ENABLED: '1', DAO_OCE_GATEWAY_SOCKET: '/run/../etc/x' }]) {
    const gateway = createOceGateway(env); assert.equal(gateway, disabledGateway);
    await rejects(gateway.ensureProject({ ...ref, name: 'x', region: 'r', currency: 'TND' }), 'disabled', 'oce_disabled');
  }
  assert.ok(createOceGateway({ DAO_OCE_ENABLED: '1' }) instanceof OceGatewayClient);
  const settled = await settleOce(() => disabledGateway.health());
  assert.equal(settled.ok, false); assert.equal((settled as any).error.kind, 'disabled');
  assert.deepEqual(await settleOce(async () => 42), { ok: true, value: 42 });
});

test('in-memory double follows the gateway rules (admission, order, idempotence)', async () => {
  const gw = new InMemoryOceGateway();
  await rejects(gw.ensureProject({ ...ref, name: 'x', region: 'r', currency: 'TND' }), 'not_authorized');
  gw.authorize(ref);
  await rejects(gw.ensureSchedule({ ...ref, start_date: '2026-11-01', end_date: '2026-11-02' }), 'conflict', 'project_not_ensured');
  assert.equal((await gw.ensureProject({ ...ref, name: 'x', region: 'r', currency: 'TND' })).created, true);
  assert.equal((await gw.ensureProject({ ...ref, name: 'x', region: 'r', currency: 'TND' })).created, false);
  await gw.ensureSchedule({ ...ref, start_date: '2026-11-01', end_date: '2026-11-30' });
  const activity = { ...ref, activity_code: 'A1', name: 'a', start_date: '2026-11-01', end_date: '2026-11-10' };
  assert.equal((await gw.upsertActivity(activity)).created, true); assert.equal((await gw.upsertActivity({ ...activity, name: 'b' })).created, false);
  await gw.upsertActivity({ ...activity, activity_code: 'A2', start_date: '2026-11-11', end_date: '2026-11-20' });
  assert.equal((await gw.ensureDependency({ ...ref, predecessor_activity_code: 'A1', successor_activity_code: 'A2' })).created, true);
  assert.equal((await gw.calculatePlanning(ref)).project_duration_days, 20);
  assert.equal((await gw.planningSummary(ref)).total_activities, 2);
  gw.revoke(ref); await rejects(gw.planningSummary(ref), 'not_authorized');
  gw.authorize(ref); gw.failNext = new OceGatewayError('unavailable', 'x'); await rejects(gw.health().then(() => gw.planningSummary(ref)), 'unavailable');
});
