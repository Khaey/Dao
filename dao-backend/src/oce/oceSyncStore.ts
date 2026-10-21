import { createHash } from 'node:crypto';

/** Durable side of the synchronisation (migration 20261018060000). Only D.A.O codes and hashes, never OCE identifiers. */
export type SyncState = 'run' | 'replay' | 'in_progress';
export type ObjectKind = 'wbs' | 'activity' | 'dependency';
export type SyncOperation = 'ensure-project' | 'ensure-wbs' | 'ensure-schedule' | 'upsert-activity' | 'ensure-dependency' | 'calculate-planning';

export interface OceSyncStore {
  requestMapping(projectId: string, requestId: string): Promise<string>;
  begin(mappingId: string, operation: SyncOperation, key: string, payloadHash: string): Promise<{ id: string; state: SyncState }>;
  finish(journalId: string, ok: boolean, errorKind?: string, errorCode?: string): Promise<void>;
  objectChanged(mappingId: string, kind: ObjectKind, code: string, code2: string | null, hash: string): Promise<boolean>;
  recordObject(mappingId: string, kind: ObjectKind, code: string, code2: string | null, hash: string): Promise<void>;
  /** Objects already applied in OCE for this mapping (D.A.O codes only): the basis of the removal reconciliation (#325). */
  listObjects(mappingId: string): Promise<{ activities: string[]; dependencies: [string, string][] }>;
  forgetObject(mappingId: string, kind: 'activity' | 'dependency', code: string, code2: string | null): Promise<void>;
  /** Records that a complete synchronisation applied plan `revision` (the lot reads as synchronised only once it reaches the current revision). */
  markSynced(mappingId: string, revision: number): Promise<void>;
}

/** Canonical JSON (sorted keys) so the same content always hashes the same. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
export const sha256 = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');

type RpcClient = { rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string; code?: string } | null }> };

/** Supabase implementation: RPCs are executable by service_role only, so this must be given the server-side client. */
export class SupabaseOceSyncStore implements OceSyncStore {
  constructor(private readonly db: RpcClient) {}
  private async call(fn: string, args: Record<string, unknown>) {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) throw Object.assign(new Error(`oce_sync_store_${fn}`), { code: error.code, detail: error.message });
    return data;
  }
  requestMapping(projectId: string, requestId: string) { return this.call('oce_request_mapping', { p_project_id: projectId, p_request_id: requestId }) as Promise<string>; }
  begin(mappingId: string, operation: SyncOperation, key: string, payloadHash: string) {
    return this.call('oce_begin_sync', { p_mapping_id: mappingId, p_operation: operation, p_key: key, p_payload_hash: payloadHash }) as Promise<{ id: string; state: SyncState }>;
  }
  async finish(journalId: string, ok: boolean, errorKind?: string, errorCode?: string) {
    await this.call('oce_finish_sync', { p_journal_id: journalId, p_ok: ok, p_error_kind: errorKind ?? null, p_error_code: errorCode ?? null });
  }
  objectChanged(mappingId: string, kind: ObjectKind, code: string, code2: string | null, hash: string) {
    return this.call('oce_object_changed', { p_mapping_id: mappingId, p_kind: kind, p_code: code, p_code2: code2, p_hash: hash }) as Promise<boolean>;
  }
  async recordObject(mappingId: string, kind: ObjectKind, code: string, code2: string | null, hash: string) {
    await this.call('oce_record_object', { p_mapping_id: mappingId, p_kind: kind, p_code: code, p_code2: code2, p_hash: hash });
  }
  async listObjects(mappingId: string) {
    const data = await this.call('oce_list_objects', { p_mapping_id: mappingId });
    return { activities: (data?.activities ?? []) as string[], dependencies: (data?.dependencies ?? []) as [string, string][] };
  }
  async forgetObject(mappingId: string, kind: 'activity' | 'dependency', code: string, code2: string | null) {
    await this.call('oce_forget_object', { p_mapping_id: mappingId, p_kind: kind, p_code: code, p_code2: code2 });
  }
  async markSynced(mappingId: string, revision: number) { await this.call('oce_mark_synced', { p_mapping_id: mappingId, p_revision: revision }); }
}

/** Test double mirroring the SQL semantics (replay, in progress, hash conflict, retry after failure). */
export class InMemoryOceSyncStore implements OceSyncStore {
  mappings = new Map<string, { project: string; request: string; revoked: boolean }>();
  journal = new Map<string, { mapping: string; operation: string; key: string; hash: string; status: 'pending' | 'succeeded' | 'failed'; attempts: number; errorKind?: string; errorCode?: string }>();
  objects = new Map<string, string>();
  private n = 0;
  async requestMapping(projectId: string, requestId: string) {
    for (const [id, m] of this.mappings) if (m.project === projectId && m.request === requestId) return id;
    const id = `m${++this.n}`; this.mappings.set(id, { project: projectId, request: requestId, revoked: false }); return id;
  }
  async begin(mappingId: string, operation: SyncOperation, key: string, payloadHash: string) {
    const m = this.mappings.get(mappingId); if (!m) throw new Error('mapping_not_found');
    if (m.revoked) throw Object.assign(new Error('mapping_revoked'), { code: '42501' });
    for (const [id, j] of this.journal) if (j.mapping === mappingId && j.operation === operation && j.key === key) {
      if (j.hash !== payloadHash) throw Object.assign(new Error('idempotency_key_reused'), { code: '22023' });
      if (j.status === 'succeeded') return { id, state: 'replay' as const };
      if (j.status === 'pending') return { id, state: 'in_progress' as const };
      j.status = 'pending'; j.attempts++; return { id, state: 'run' as const };
    }
    const id = `j${++this.n}`; this.journal.set(id, { mapping: mappingId, operation, key, hash: payloadHash, status: 'pending', attempts: 1 });
    return { id, state: 'run' as const };
  }
  async finish(journalId: string, ok: boolean, errorKind?: string, errorCode?: string) {
    const j = this.journal.get(journalId); if (!j || j.status !== 'pending') throw new Error('journal_not_pending');
    j.status = ok ? 'succeeded' : 'failed'; j.errorKind = errorKind; j.errorCode = errorCode;
  }
  private k(m: string, kind: string, a: string, b: string | null) { return `${m}|${kind}|${a}|${b ?? ''}`; }
  async objectChanged(m: string, kind: ObjectKind, a: string, b: string | null, hash: string) { return this.objects.get(this.k(m, kind, a, b)) !== hash; }
  async recordObject(m: string, kind: ObjectKind, a: string, b: string | null, hash: string) { this.objects.set(this.k(m, kind, a, b), hash); }
  async listObjects(m: string) {
    const activities: string[] = []; const dependencies: [string, string][] = [];
    for (const key of this.objects.keys()) {
      const [mapping, kind, a, b] = key.split('|');
      if (mapping !== m) continue;
      if (kind === 'activity') activities.push(a); else if (kind === 'dependency') dependencies.push([a, b]);
    }
    return { activities: activities.sort(), dependencies: dependencies.sort() };
  }
  async forgetObject(m: string, kind: 'activity' | 'dependency', a: string, b: string | null) { this.objects.delete(this.k(m, kind, a, b)); }
  synced = new Map<string, number>(); syncedRevision = new Map<string, number>();
  async markSynced(mappingId: string, revision: number) {
    const m = this.mappings.get(mappingId); if (!m) throw new Error('mapping_not_found');
    if (m.revoked) throw Object.assign(new Error('mapping_revoked'), { code: '42501' });
    this.synced.set(mappingId, (this.synced.get(mappingId) ?? 0) + 1);
    this.syncedRevision.set(mappingId, Math.max(this.syncedRevision.get(mappingId) ?? 0, revision));
  }
  revoke(mappingId: string) { this.mappings.get(mappingId)!.revoked = true; }
}
