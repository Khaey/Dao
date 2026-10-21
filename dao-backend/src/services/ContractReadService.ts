import { DomainError } from '../lib/errors.js';

type Row = Record<string, any>;

function fail(error: any, message = 'Lecture contractuelle impossible') {
  if (error) throw error;
  throw new DomainError(message, 'NOT_FOUND');
}

function proposedChange(version: Row | undefined) {
  const content = version?.content ?? {};
  return {
    version_id: version?.id ?? null,
    version_no: version?.version_no ?? null,
    content_hash: version?.content_hash ?? null,
    created_at: version?.created_at ?? null,
    reason: content.reason ?? null,
    scope_clarification: content.scope_clarification ?? null,
    amount_delta_millimes: content.amount_delta_millimes ?? null,
    base_total_millimes: content.base_total_millimes ?? null,
    proposed_total_millimes: content.proposed_total_millimes ?? null,
    planned_start_date: content.planned_start_date ?? null,
    duration_days: content.duration_days ?? null,
    non_engaging: content.non_engaging === true,
  };
}

export class ContractReadService {
  constructor(private readonly db: any) {}

  async list() {
    const contracts = await this.db.from('contracts')
      .select('id,project_id,status,total_millimes,current_version_id,signature_mode,legal_effect_enabled,validated_at,cancelled_at,created_at,updated_at')
      .order('created_at', { ascending: false });
    if (contracts.error) throw contracts.error;
    const rows = (contracts.data ?? []) as Row[];
    if (!rows.length) return [];
    const ids = rows.map(row => row.id);
    const [parties, items, amendments] = await Promise.all([
      this.db.from('contract_parties').select('contract_id,role,legal_name').in('contract_id', ids),
      this.db.from('contract_items').select('contract_id,id').in('contract_id', ids),
      this.db.from('contract_amendments').select('contract_id,id,status').in('contract_id', ids),
    ]);
    for (const result of [parties, items, amendments]) if (result.error) throw result.error;
    return rows.map(contract => ({
      ...contract,
      non_engaging: contract.legal_effect_enabled !== true,
      parties: (parties.data ?? []).filter((row: Row) => row.contract_id === contract.id)
        .map((row: Row) => ({ role: row.role, legal_name: row.legal_name })),
      item_count: (items.data ?? []).filter((row: Row) => row.contract_id === contract.id).length,
      amendment_count: (amendments.data ?? []).filter((row: Row) => row.contract_id === contract.id).length,
    }));
  }

  async detail(contractId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(contractId)) throw new DomainError('Identifiant de contrat invalide', 'BAD_REQUEST');
    const contractResult = await this.db.from('contracts')
      .select('id,award_id,project_id,status,total_millimes,current_version_id,signature_mode,legal_effect_enabled,validated_at,cancelled_at,cancellation_reason,created_at,updated_at')
      .eq('id', contractId).maybeSingle();
    if (contractResult.error) throw contractResult.error;
    if (!contractResult.data) fail(null, 'Dossier contractuel introuvable ou inaccessible');
    const contract = contractResult.data as Row;
    const [version, items, parties, acceptances, events, archives, amendments] = await Promise.all([
      this.db.from('contract_versions').select('id,version_no,content_hash,created_at').eq('contract_id', contractId).eq('id', contract.current_version_id).maybeSingle(),
      this.db.from('contract_items').select('id,request_id,agreed_millimes,title,scope,duration_days,inclusions,exclusions').eq('contract_id', contractId).order('created_at'),
      this.db.from('contract_parties').select('role,legal_name').eq('contract_id', contractId).order('role'),
      this.db.from('contract_acceptances').select('party_role,method,accepted_at,created_at').eq('contract_id', contractId).eq('contract_version_id', contract.current_version_id).order('accepted_at'),
      this.db.from('contract_events').select('id,event_type,from_status,to_status,reason,created_at').eq('contract_id', contractId).order('created_at'),
      this.db.from('contract_archives').select('id,original_name,mime_type,size_bytes,content_hash,created_at').eq('contract_id', contractId).order('created_at'),
      this.db.from('contract_amendments').select('id,base_contract_version_id,status,legal_effect_enabled,validated_at,validation_reason,rejected_at,rejection_reason,cancelled_at,cancellation_reason,created_at,updated_at').eq('contract_id', contractId).order('created_at', { ascending: false }),
    ]);
    for (const result of [version, items, parties, acceptances, events, archives, amendments]) if (result.error) throw result.error;
    const amendmentRows = (amendments.data ?? []) as Row[];
    const amendmentIds = amendmentRows.map(row => row.id);
    let amendmentVersions: Row[] = [], amendmentAcceptances: Row[] = [], amendmentEvents: Row[] = [];
    if (amendmentIds.length) {
      const nested = await Promise.all([
        this.db.from('contract_amendment_versions').select('id,amendment_id,version_no,content,content_hash,created_at').in('amendment_id', amendmentIds),
        this.db.from('contract_amendment_acceptances').select('amendment_id,party_role,method,accepted_at,created_at').in('amendment_id', amendmentIds).order('accepted_at'),
        this.db.from('contract_amendment_events').select('id,amendment_id,event_type,from_status,to_status,reason,created_at').in('amendment_id', amendmentIds).order('created_at'),
      ]);
      for (const result of nested) if (result.error) throw result.error;
      amendmentVersions = nested[0].data ?? [];
      amendmentAcceptances = nested[1].data ?? [];
      amendmentEvents = nested[2].data ?? [];
    }
    return {
      contract: { ...contract, non_engaging: contract.legal_effect_enabled !== true },
      version: version.data,
      items: items.data ?? [],
      parties: parties.data ?? [],
      acceptances: acceptances.data ?? [],
      events: events.data ?? [],
      archives: archives.data ?? [],
      amendments: amendmentRows.map(amendment => ({
        ...amendment,
        non_engaging: amendment.legal_effect_enabled !== true,
        proposal: proposedChange(amendmentVersions.find(row => row.amendment_id === amendment.id)),
        acceptances: amendmentAcceptances.filter(row => row.amendment_id === amendment.id)
          .map(({ amendment_id: _id, ...row }) => row),
        events: amendmentEvents.filter(row => row.amendment_id === amendment.id)
          .map(({ amendment_id: _id, ...row }) => row),
      })),
    };
  }
}
