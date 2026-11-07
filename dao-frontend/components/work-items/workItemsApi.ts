'use client';

// #577 — Client de l'API des ouvrages du chantier (liste commune Lot › Sous-lot facultatif › Ouvrage).
// Toutes les règles (droits, verrou après publication, référentiel) sont vérifiées par la base.
import { useCallback, useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import type { GuidedCatalog } from '../../../dao-backend/src/btp-reference/guided-selection';

export type WorkItem = {
  id: string; requestId: string; subLotId: string | null; workId: string | null; workCode: string | null;
  catalogVersionId: string | null; catalogVersionCode: string | null; label: string; unitCode: string | null;
  custom: boolean; confirmation: 'selected' | 'to_confirm'; origin: 'assistant' | 'manual' | 'import'; ordinal: number;
  status: 'active' | 'removed'; revision: number; catalogPath: { lot: string; subLot: string } | null;
  measurable: boolean; modelState?: 'available' | 'historical_unavailable' | 'no_model' | 'custom'; takeoffs: number; validatedTakeoffs: number; subLotCurrent: boolean;
};
export type WorkItemLot = {
  requestId: string; requestVersionId: string; requestVersion: number; title: string; tradeId: string | null; status: string;
  lockReason: 'project_not_draft' | 'project_in_review' | 'request_closed' | 'awarded' | 'published' | null;
  subLots: Array<{ id: string; title: string; ordinal: number }>; items: WorkItem[];
};
export type WorkItemsSnapshot = { projectId: string; canEdit: boolean; catalogVersion: { id: string; code: string } | null; lots: WorkItemLot[]; removedCount: number };

export class WorkItemsError extends Error { constructor(message: string, readonly status: number, readonly code?: string) { super(message); } }

export const LOCK_LABELS: Record<NonNullable<WorkItemLot['lockReason']>, string> = {
  published: 'Lot publié : ses ouvrages sont figés dans la version envoyée aux Artisans.',
  awarded: 'Lot attribué : ses ouvrages ne sont plus modifiables.',
  project_in_review: 'Dossier en revue D.A.O. : les ouvrages redeviennent modifiables si des corrections sont demandées.',
  project_not_draft: 'Chantier hors préparation : les ouvrages ne sont plus modifiables.',
  request_closed: 'Lot fermé : ses ouvrages ne sont plus modifiables.',
};

export const workItemKey = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export async function workItemsApi<T = any>(path: string, body?: unknown): Promise<T> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new WorkItemsError('Session expirée. Reconnectez-vous.', 401);
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: body ? JSON.stringify(body) : undefined });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new WorkItemsError(response.status === 401 ? 'Session expirée. Reconnectez-vous.' : payload.error ?? 'Opération refusée.', response.status, payload.code);
  return payload.data as T;
}

export const workItemCommand = (body: Record<string, unknown>) =>
  workItemsApi<WorkItemsSnapshot & { createdIds?: string[] }>('/api/projects/work-items', { idempotencyKey: workItemKey(String(body.action)), ...body });

/** Charge la liste commune ; `forbidden` pour un Artisan ou un tiers (la base refuse). */
export function useProjectWorkItems(projectId: string, enabled = true) {
  const [snapshot, setSnapshot] = useState<WorkItemsSnapshot | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'error'>('loading');
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      setSnapshot(await workItemsApi<WorkItemsSnapshot>(`/api/projects/work-items?project_id=${encodeURIComponent(projectId)}`));
      setState('ready'); setError('');
    } catch (e: any) {
      if (e instanceof WorkItemsError && (e.status === 403 || e.status === 401)) setState('forbidden');
      else { setState('error'); setError(e?.message ?? 'Ouvrages indisponibles.'); }
    }
  }, [projectId, enabled]);
  useEffect(() => { void reload(); }, [reload]);
  return { snapshot, setSnapshot, state, error, reload };
}

let guidedCache: Promise<GuidedCatalog> | null = null;
/**
 * Contrat de consultation guidée #578 (référentiel publié complet, attesté par le serveur) :
 * version, chemin, unité, modèles, règles et provenance conservés ; aucune copie aplatie du catalogue.
 */
export function loadGuidedCatalog(): Promise<GuidedCatalog> {
  guidedCache ??= workItemsApi<GuidedCatalog>('/api/btp/catalog/guided?country=TN').catch(e => { guidedCache = null; throw e; });
  return guidedCache;
}

export const normalizeSearch = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
