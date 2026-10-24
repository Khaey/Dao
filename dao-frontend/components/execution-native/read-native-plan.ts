import type { NativeExecutionPlanDTO } from '../../../dao-backend/src/native-tracking/contract';
import { supabaseBrowser } from '../../lib/supabase-browser';

export class NativePlanReadError extends Error {
  constructor(public readonly status: number, message: string) { super(message); this.name = 'NativePlanReadError'; }
}

function messageFor(status: number) {
  switch (status) {
    case 400: return 'La demande de suivi est invalide.';
    case 401: return 'Session expirée. Reconnectez-vous.';
    case 403: return 'Vous n’avez pas accès au suivi de ce chantier.';
    case 404: return 'Ce chantier est introuvable.';
    case 503: return 'Le suivi est momentanément indisponible.';
    default: return 'Impossible de charger le suivi.';
  }
}
function isPlan(value: unknown): value is NativeExecutionPlanDTO {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Partial<NativeExecutionPlanDTO>;
  return obj.schemaVersion === 1 && typeof obj.projectId === 'string'
    && Array.isArray(obj.lots) && !!obj.viewer && !!obj.page;
}

/** Lecture réelle JWT ; pas de filtre de sécurité local et aucune écriture. */
export async function readNativeExecutionPlan(projectId: string, signal?: AbortSignal): Promise<NativeExecutionPlanDTO> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (signal?.aborted) throw new DOMException('Lecture annulée', 'AbortError');
  const token = data.session?.access_token;
  if (!token) throw new NativePlanReadError(401, messageFor(401));
  const allLots: NativeExecutionPlanDTO['lots'] = [];
  let first: NativeExecutionPlanDTO | null = null;
  let cursor: string | null = null;
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ project_id: projectId, limit: '50' });
    if (cursor) query.set('cursor', cursor);
    const response = await fetch('/api/projects/native-execution?' + query.toString(), {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + token },
      cache: 'no-store',
      signal,
    });
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new NativePlanReadError(response.status, messageFor(response.status));
    if (!json || typeof json !== 'object' || !('data' in json) || !isPlan(json.data)) {
      throw new NativePlanReadError(503, 'Format de suivi inattendu.');
    }
    const result = json.data;
    if (result.projectId !== projectId) throw new NativePlanReadError(503, 'Réponse liée à un autre chantier.');
    if (first && (result.sourceRevisions.plan !== first.sourceRevisions.plan
      || result.viewer.workspace !== first.viewer.workspace)) {
      throw new NativePlanReadError(409, 'Le chantier a changé pendant le chargement. Actualisez.');
    }
    first ??= result;
    for (const lot of result.lots) {
      if (!seen.has(lot.requestId)) { allLots.push(lot); seen.add(lot.requestId); }
    }
    cursor = result.page.nextCursor;
    if (!cursor) return { ...first, lots: allLots, page: { ...result.page, nextCursor: null } };
  }
  throw new NativePlanReadError(409, 'Le suivi dépasse la limite de chargement. Actualisez ou affinez la lecture.');
}
