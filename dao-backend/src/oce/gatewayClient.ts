import http from 'node:http';
import {
  OceGateway, OceGatewayError, requests, responses,
  type EnsureDependencyInput, type EnsureProjectInput, type RemoveActivityInput, type RemoveDependencyInput, type EnsureScheduleInput, type EnsureWbsInput, type MappingRef, type UpsertActivityInput,
} from './gatewayContract.js';

export const DEFAULT_GATEWAY_SOCKET = '/run/dao-oce-gateway/gateway.sock';
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Fixed allowlist: the client can only ever build these paths (no generic proxy, no caller-supplied path). */
const PATHS = {
  health: ['GET', '/health'], ready: ['GET', '/ready'],
  ensureProject: ['POST', '/v1/ensure-project'], ensureWbs: ['POST', '/v1/ensure-wbs'], ensureSchedule: ['POST', '/v1/ensure-schedule'],
  upsertActivity: ['POST', '/v1/upsert-activity'], ensureDependency: ['POST', '/v1/ensure-dependency'],
  removeDependency: ['POST', '/v1/remove-dependency'], removeActivity: ['POST', '/v1/remove-activity'],
  calculatePlanning: ['POST', '/v1/calculate-planning'], planningSummary: ['POST', '/v1/planning-summary'],
} as const;
type Operation = keyof typeof PATHS;

export type RawResponse = { status: number; body: string };
/** One HTTP exchange with the gateway. Replaceable in tests; the default speaks HTTP over a Unix socket. */
export type GatewayTransport = (request: { method: 'GET' | 'POST'; path: string; body?: string; timeoutMs: number }) => Promise<RawResponse>;

export function unixSocketTransport(socketPath: string): GatewayTransport {
  return ({ method, path, body, timeoutMs }) => new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = { Accept: 'application/json' };
    if (body !== undefined) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    const req = http.request({ socketPath, method, path, headers, agent: false, timeout: timeoutMs }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) { req.destroy(new OceGatewayError('protocol', 'response_too_large')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', error => reject(error));
    });
    req.on('timeout', () => req.destroy(new OceGatewayError('timeout', 'gateway_timeout')));
    req.on('error', error => reject(error));
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function failure(error: unknown): OceGatewayError {
  if (error instanceof OceGatewayError) return error;
  const code = (error as any)?.code;
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return new OceGatewayError('timeout', 'gateway_timeout');
  return new OceGatewayError('unavailable', typeof code === 'string' ? code.toLowerCase() : 'transport_error');
}

function fromStatus(status: number, raw: string): OceGatewayError {
  let code = 'gateway_error';
  try { const parsed = JSON.parse(raw); if (typeof parsed?.error === 'string' && /^[a-z0-9_]{1,64}$/.test(parsed.error)) code = parsed.error; } catch { /* keep the generic code */ }
  // La suppression refusée ou sans effet côté OCE est un résultat métier stable : ni nouvelle tentative, ni panne de passerelle.
  if (status === 502 && /^oce_delete_/.test(code)) return new OceGatewayError('rejected', code, status);
  if (status === 403) return new OceGatewayError('not_authorized', code, status);
  if (status === 409) return new OceGatewayError('conflict', code, status);
  if (status === 400 || status === 411 || status === 413) return new OceGatewayError('invalid_request', code, status);
  if (status >= 500) return new OceGatewayError('unavailable', code, status); // includes oce_write_ambiguous: safe to replay, the gateway reconciles
  return new OceGatewayError('rejected', code, status);
}

export type GatewayOptions = {
  transport: GatewayTransport;
  /** Total attempts for retryable failures (default 3). All gateway writes are idempotent and reconciled server-side. */
  attempts?: number;
  timeoutMs?: number;
  calculateTimeoutMs?: number;
  /** Consecutive outage failures before failing fast, and how long to stay open. */
  breakerThreshold?: number;
  breakerCooldownMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export class OceGatewayClient implements OceGateway {
  private failures = 0;
  private openedAt: number | null = null;
  private probing = false;
  private readonly opts: Required<Omit<GatewayOptions, 'transport'>> & { transport: GatewayTransport };

  constructor(options: GatewayOptions) {
    this.opts = {
      attempts: 3, timeoutMs: 10_000, calculateTimeoutMs: 35_000, breakerThreshold: 5, breakerCooldownMs: 30_000,
      now: () => Date.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), ...options,
    };
  }

  private admit() {
    if (this.openedAt === null) return;
    if (this.opts.now() - this.openedAt < this.opts.breakerCooldownMs || this.probing) throw new OceGatewayError('circuit_open', 'circuit_open');
    this.probing = true; // half-open: a single probe goes through
  }
  private record(error: OceGatewayError | null) {
    this.probing = false;
    if (error === null || !error.countsAsOutage) { if (error === null) { this.failures = 0; this.openedAt = null; } return; }
    this.failures += 1;
    if (this.failures >= this.opts.breakerThreshold || this.openedAt !== null) this.openedAt = this.opts.now();
  }

  private async call<T>(operation: Operation, parse: (data: any) => T, body?: unknown): Promise<T> {
    const [method, path] = PATHS[operation];
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const timeoutMs = operation === 'calculatePlanning' ? this.opts.calculateTimeoutMs : this.opts.timeoutMs;
    this.admit();
    let last: OceGatewayError | null = null;
    for (let attempt = 1; attempt <= this.opts.attempts; attempt++) {
      try {
        const raw = await this.opts.transport({ method, path, body: payload, timeoutMs });
        if (raw.status !== 200) throw fromStatus(raw.status, raw.body);
        let data: unknown;
        try { data = JSON.parse(raw.body); } catch { throw new OceGatewayError('protocol', 'invalid_json'); }
        const result = parse(data);
        this.record(null);
        return result;
      } catch (error) {
        last = failure(error);
        if (!last.retryable || attempt === this.opts.attempts) break;
        await this.opts.sleep(Math.min(100 * 2 ** (attempt - 1), 1000));
      }
    }
    this.record(last);
    throw last!;
  }

  async health() { return this.call('health', responses.ok); }
  async ready() { return this.call('ready', responses.ok); }
  async ensureProject(input: EnsureProjectInput) { return this.call('ensureProject', responses.ensure, requests.ensureProject(input)); }
  async ensureWbs(input: EnsureWbsInput) { return this.call('ensureWbs', responses.ensure, requests.ensureWbs(input)); }
  async ensureSchedule(input: EnsureScheduleInput) { return this.call('ensureSchedule', responses.ensure, requests.ensureSchedule(input)); }
  async upsertActivity(input: UpsertActivityInput) { return this.call('upsertActivity', responses.ensure, requests.upsertActivity(input)); }
  async ensureDependency(input: EnsureDependencyInput) { return this.call('ensureDependency', responses.dependency, requests.ensureDependency(input)); }
  async removeDependency(input: RemoveDependencyInput) { return this.call('removeDependency', responses.removal, requests.removeDependency(input)); }
  async removeActivity(input: RemoveActivityInput) { return this.call('removeActivity', responses.removal, requests.removeActivity(input)); }
  async calculatePlanning(input: MappingRef) { return this.call('calculatePlanning', responses.planning, requests.mapping(input)); }
  async planningSummary(input: MappingRef) { return this.call('planningSummary', responses.summary, requests.mapping(input)); }
}

/** Used when the integration is off: every call fails fast with `disabled`, nothing touches the network. */
export const disabledGateway: OceGateway = new Proxy({} as OceGateway, {
  get: (_target, key) => key === 'then' ? undefined : async () => { throw new OceGatewayError('disabled', 'oce_disabled'); },
});

/** The integration is opt-in: both the switch and an absolute socket path are required. No secret is read here. */
export function createOceGateway(env: Record<string, string | undefined> = process.env): OceGateway {
  if (env.DAO_OCE_ENABLED !== '1') return disabledGateway;
  const socket = env.DAO_OCE_GATEWAY_SOCKET || DEFAULT_GATEWAY_SOCKET;
  if (!socket.startsWith('/') || socket.includes('..') || socket.length > 100) return disabledGateway;
  return new OceGatewayClient({ transport: unixSocketTransport(socket) });
}

/** Isolation for commercial flows: an OCE failure becomes a value, never an exception on the caller's path. */
export async function settleOce<T>(operation: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: OceGatewayError }> {
  try { return { ok: true, value: await operation() }; } catch (error) { return { ok: false, error: failure(error) }; }
}
