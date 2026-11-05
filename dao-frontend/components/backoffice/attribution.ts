'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabase-browser';

// #568 — Attribution réelle par lot pour le staff (Admin / Gestionnaire), lue par lots de chantiers avec
// les droits RLS existants du staff (publications, lots publiés, retraits, attributions actives).
// Aucune écriture, aucun état stocké. En cas d'échec de lecture : `null`, et l'écran n'affirme aucune
// attribution (il garde l'état de publication).

export type StaffAttribution = {
  /** Lots mis en concurrence (dans une publication publiée, suspendue ou clôturée), non retirés. */
  lots: number;
  /** Lots ayant une attribution active. */
  awardedLots: number;
  /** Identifiants `project_requests` publiés en ce moment (publication publiée ou suspendue, non retirés). */
  liveRequestIds: Set<string>;
  /** Identifiants `project_requests` attribués (attribution active). */
  awardedRequestIds: Set<string>;
};

const CHUNK = 100;

export async function readStaffAttribution(projectIds: string[]): Promise<Record<string, StaffAttribution> | null> {
  if (!projectIds.length) return {};
  const db = supabaseBrowser();
  const byProject: Record<string, StaffAttribution> = {};
  for (const id of projectIds) byProject[id] = { lots: 0, awardedLots: 0, liveRequestIds: new Set(), awardedRequestIds: new Set() };
  for (let offset = 0; offset < projectIds.length; offset += CHUNK) {
    const ids = projectIds.slice(offset, offset + CHUNK);
    const [publications, awards] = await Promise.all([
      db.from('publications').select('id,project_id,status').in('project_id', ids),
      db.from('award_items').select('project_id,request_id').in('project_id', ids).eq('active', true),
    ]);
    if (publications.error || awards.error) return null;
    const relevant = (publications.data ?? []).filter(row => ['published', 'suspended', 'closed'].includes(row.status));
    const publicationOf = new Map(relevant.map(row => [row.id as string, row as { id: string; project_id: string; status: string }]));
    const lots: { id: string; publication_id: string; request_id: string }[] = [];
    let withdrawn = new Set<string>();
    if (publicationOf.size) {
      const [requests, withdrawals] = await Promise.all([
        db.from('publication_requests').select('id,publication_id,project_request_versions!publication_requests_request_version_id_fkey(request_id)').in('publication_id', [...publicationOf.keys()]),
        db.from('publication_lot_withdrawals').select('publication_request_id').in('project_id', ids),
      ]);
      if (requests.error || withdrawals.error) return null;
      for (const row of (requests.data ?? []) as any[]) {
        const requestId = Array.isArray(row.project_request_versions) ? row.project_request_versions[0]?.request_id : row.project_request_versions?.request_id;
        if (!requestId) return null;
        lots.push({ id: row.id, publication_id: row.publication_id, request_id: requestId });
      }
      withdrawn = new Set((withdrawals.data ?? []).map(row => row.publication_request_id as string));
    }
    const competed = new Map<string, Set<string>>();
    for (const lot of lots) {
      if (withdrawn.has(lot.id)) continue;
      const publication = publicationOf.get(lot.publication_id)!;
      const target = byProject[publication.project_id];
      if (!target) continue;
      if (!competed.has(publication.project_id)) competed.set(publication.project_id, new Set());
      competed.get(publication.project_id)!.add(lot.request_id);
      if (publication.status === 'published' || publication.status === 'suspended') target.liveRequestIds.add(lot.request_id);
    }
    for (const row of (awards.data ?? []) as { project_id: string; request_id: string }[]) byProject[row.project_id]?.awardedRequestIds.add(row.request_id);
    for (const id of ids) {
      const target = byProject[id];
      const all = competed.get(id) ?? new Set<string>();
      for (const requestId of target.awardedRequestIds) all.add(requestId);
      target.lots = all.size;
      target.awardedLots = target.awardedRequestIds.size;
    }
  }
  return byProject;
}

/** Lecture groupée pour une liste ; `failed` reste vrai tant qu'une lecture a échoué. */
export function useStaffAttribution(projectIds: string[], enabled: boolean) {
  const [state, setState] = useState<{ byProject: Record<string, StaffAttribution>; ready: boolean; failed: boolean }>({ byProject: {}, ready: false, failed: false });
  const key = projectIds.join(',');
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setState(current => ({ ...current, ready: false }));
    void readStaffAttribution(projectIds).then(result => {
      if (!active) return;
      setState(result ? { byProject: result, ready: true, failed: false } : { byProject: {}, ready: true, failed: true });
    }).catch(() => { if (active) setState({ byProject: {}, ready: true, failed: true }); });
    return () => { active = false; };
  }, [key, enabled]);
  return state;
}
