import { DomainError } from '../lib/errors.js';
import { verifyEstimateResult } from '../btp-estimate/engine.js';
import type { EstimateResult } from '../btp-estimate/contract.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PRICE_ACTIONS = new Set(['register_source', 'record', 'verify', 'reject', 'retire']);
export const ESTIMATE_ACTIONS = new Set(['preview', 'calculate', 'approve']);

function uuid(value: unknown, label: string) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new DomainError(`${label} invalide`, 'BAD_REQUEST');
  return value.toLowerCase();
}

/** Ajoute le contrôle arithmétique indépendant (BigInt) à chaque résultat renvoyé par la base. */
function withVerification(estimate: any) {
  if (!estimate) return estimate;
  const check = (rev: any) => rev?.result ? { ...rev, verification: verifyEstimateResult(rev.result as EstimateResult) } : rev;
  return { ...estimate, current: check(estimate.current), approved: check(estimate.approved) };
}

/**
 * Base de prix sourcés et estimation (#551). Toute règle métier (droits, sélection des tarifs,
 * calcul, révisions) est appliquée en base sous le JWT de l'utilisateur ; ce service ne fait que
 * valider la forme des entrées et revérifier l'arithmétique.
 */
export class BtpEstimateService {
  constructor(private readonly db: any) {}

  async prices(projectId: string | null) {
    const { data, error } = await this.db.rpc('btp_price_list_v1', { p_project_id: projectId ? uuid(projectId, 'Chantier') : null });
    if (error) throw error;
    return data;
  }

  async priceCommand(action: string, input: Record<string, unknown>, key: string) {
    if (!PRICE_ACTIONS.has(action)) throw new DomainError('Action tarifaire inconnue', 'BAD_REQUEST');
    const { data, error } = await this.db.rpc('btp_price_command_v1', { p_action: action, p_input: input, p_idempotency_key: key });
    if (error) throw error;
    return data;
  }

  async snapshot(projectId: string) {
    const { data, error } = await this.db.rpc('btp_estimate_snapshot_v1', { p_project_id: uuid(projectId, 'Chantier') });
    if (error) throw error;
    return { ...data, estimates: (data?.estimates ?? []).map(withVerification) };
  }

  async estimateCommand(action: string, input: Record<string, unknown>, key: string | null) {
    if (!ESTIMATE_ACTIONS.has(action)) throw new DomainError('Action d’estimation inconnue', 'BAD_REQUEST');
    if (action !== 'preview' && !key) throw new DomainError('Clé idempotente requise', 'BAD_REQUEST');
    const { data, error } = await this.db.rpc('btp_estimate_command_v1', { p_action: action, p_input: input, p_idempotency_key: key });
    if (error) throw error;
    if (action === 'preview') return { ...data, verification: verifyEstimateResult(data.result) };
    return withVerification(data);
  }
}
