'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CalendarClock, ChevronRight, Hammer, Trophy } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { readAgreement } from '../../lib/precontract';

// #356: what the awarded Artisan really won, from rows their JWT may read (award_items/awards of their own
// contractor profile, their own bid_items, published lot titles). No project row is needed: an award does not
// make the Artisan a team member, and nothing here widens project, team or document access.
export type AwardedLot = { awardItemId: string; awardId: string; title: string; agreedMillimes: number; bidVersionId: string };
export type AwardedProject = { projectId: string; publicationId: string | null; title: string; lots: AwardedLot[]; awardIds: string[] };

export function useAwardedWork(enabled = true) {
  const [state, setState] = useState<{ projects: AwardedProject[]; activeByVersion: Record<string, number>; cancelledByVersion: Record<string, number>; ready: boolean; failed: boolean }>({ projects: [], activeByVersion: {}, cancelledByVersion: {}, ready: false, failed: false });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void (async () => {
      const supabase = supabaseBrowser();
      const { data: user } = await supabase.auth.getUser();
      const profile = user.user ? await supabase.from('contractor_profiles').select('id').eq('user_id', user.user.id).maybeSingle() : { data: null, error: null };
      if (!profile.data) { if (active) setState({ projects: [], activeByVersion: {}, cancelledByVersion: {}, ready: true, failed: false }); return; }
      // Every award line of this Artisan (active or not): inactive ones are cancellations kept for the history.
      const items = await supabase.from('award_items').select('id,award_id,project_id,bid_item_id,agreed_millimes,active').eq('contractor_id', profile.data.id);
      if (items.error) { if (active) setState(current => ({ ...current, ready: true, failed: true })); return; }
      const rows = (items.data ?? []) as { id: string; award_id: string; project_id: string; bid_item_id: string; agreed_millimes: number; active: boolean }[];
      if (!rows.length) { if (active) setState({ projects: [], activeByVersion: {}, cancelledByVersion: {}, ready: true, failed: false }); return; }
      const [awards, bidItems] = await Promise.all([
        supabase.from('awards').select('id,status').in('id', [...new Set(rows.map(row => row.award_id))]),
        supabase.from('bid_items').select('id,bid_version_id,request_version_id').in('id', rows.map(row => row.bid_item_id)),
      ]);
      if (awards.error || bidItems.error) { if (active) setState(current => ({ ...current, ready: true, failed: true })); return; }
      const liveAwards = new Set(((awards.data ?? []) as { id: string; status: string }[]).filter(row => row.status !== 'cancelled').map(row => row.id));
      const items2 = new Map(((bidItems.data ?? []) as { id: string; bid_version_id: string; request_version_id: string }[]).map(row => [row.id, row]));
      const versionIds = [...new Set([...items2.values()].map(row => row.request_version_id))];
      const [lots, publications] = await Promise.all([
        supabase.from('publication_requests').select('publication_id,request_version_id,safe_title').in('request_version_id', versionIds),
        supabase.from('publications').select('id,project_id,safe_title,published_at').in('project_id', [...new Set(rows.map(row => row.project_id))]).order('published_at', { ascending: false }),
      ]);
      const lotTitle = new Map(((lots.data ?? []) as { request_version_id: string; safe_title: string; publication_id: string }[]).map(row => [row.request_version_id, row]));
      const pubByProject = new Map<string, { id: string; safe_title: string }>();
      for (const row of (publications.data ?? []) as { id: string; project_id: string; safe_title: string }[]) if (!pubByProject.has(row.project_id)) pubByProject.set(row.project_id, row);
      const grouped = new Map<string, AwardedProject>();
      const activeByVersion: Record<string, number> = {}, cancelledByVersion: Record<string, number> = {};
      for (const row of rows) {
        const item = items2.get(row.bid_item_id);
        if (!row.active || !liveAwards.has(row.award_id)) { if (item) cancelledByVersion[item.bid_version_id] = (cancelledByVersion[item.bid_version_id] ?? 0) + 1; continue; }
        if (item) activeByVersion[item.bid_version_id] = (activeByVersion[item.bid_version_id] ?? 0) + 1;
        const lot = item ? lotTitle.get(item.request_version_id) : undefined;
        const publication = lot ? { id: lot.publication_id, safe_title: pubByProject.get(row.project_id)?.safe_title ?? '' } : pubByProject.get(row.project_id) ?? null;
        const group = grouped.get(row.project_id) ?? { projectId: row.project_id, publicationId: publication?.id ?? null, title: publication?.safe_title || 'Chantier attribué', lots: [], awardIds: [] };
        group.lots.push({ awardItemId: row.id, awardId: row.award_id, title: lot?.safe_title ?? 'Lot attribué', agreedMillimes: Number(row.agreed_millimes), bidVersionId: item?.bid_version_id ?? '' });
        if (!group.awardIds.includes(row.award_id)) group.awardIds.push(row.award_id);
        grouped.set(row.project_id, group);
      }
      if (active) setState({ projects: [...grouped.values()], activeByVersion, cancelledByVersion, ready: true, failed: false });
    })();
    return () => { active = false; };
  }, [enabled]);
  return state;
}

const money = (value: number) => new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(value / 1000);

/** « Mes chantiers attribués » — the Artisan's active awards grouped by chantier, with the useful next actions. */
export function AwardedProjects({ projects, compact = false }: { projects: AwardedProject[]; compact?: boolean }) {
  const live = useLiveAgreements(projects.flatMap(project => project.awardIds));
  const journals = useLiveJournals(projects.map(project => project.projectId));
  if (!projects.length) return null;
  return <section aria-labelledby="awarded-title" className="rounded-2xl border border-teal/20 bg-teal/[0.03] p-5 sm:p-6">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="awarded-title" className="flex items-center gap-2 text-xl font-bold text-ink"><Trophy aria-hidden="true" size={19} className="text-teal" />Mes chantiers attribués</h2><p className="text-sm text-black/55">{projects.length} chantier{projects.length > 1 ? 's' : ''} · {projects.reduce((sum, project) => sum + project.lots.length, 0)} lot{projects.reduce((sum, project) => sum + project.lots.length, 0) > 1 ? 's' : ''} retenu{projects.reduce((sum, project) => sum + project.lots.length, 0) > 1 ? 's' : ''}</p></div>
    <p className="mt-1 text-sm text-black/60">Le Client vous a choisi pour ces lots. Les travaux ne sont pas démarrés et aucun contrat n’est signé : convenez d’abord des conditions.</p>
    <ul className={`mt-4 grid gap-3 ${compact ? '' : 'lg:grid-cols-2'}`}>{projects.map(project => <li key={project.projectId} className="min-w-0 rounded-2xl border border-black/[0.06] bg-white p-4">
      <h3 className="break-words font-bold text-ink">{project.title}</h3>
      <ul className="mt-2 divide-y divide-black/5 text-sm">{project.lots.map(lot => <li key={lot.awardItemId} className="flex flex-wrap items-baseline justify-between gap-2 py-2"><span className="min-w-0 break-words text-ink">{lot.title}</span><span className="tabular-nums text-black/60">{money(lot.agreedMillimes)}</span></li>)}</ul>
      <p className="mt-2 text-xs text-black/55">Lot retenu · Conditions à convenir · Travaux non démarrés</p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        {project.awardIds.filter(id => live.includes(id)).map((id, index, list) => <Link key={id} href={`/app/awards/${id}/conditions`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-white hover:bg-teal"><CalendarClock aria-hidden="true" size={16} />Voir les conditions du lot{list.length > 1 ? ` (${index + 1})` : ''}</Link>)}
        {journals.includes(project.projectId) && <Link href={`/app/execution/${project.projectId}`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink hover:border-teal"><Hammer aria-hidden="true" size={16} />Carnet de chantier</Link>}
        {project.publicationId && <Link href={`/app/artisan/publications/${project.publicationId}`} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl px-3 text-sm font-semibold text-teal hover:bg-teal/5">Voir le DAO<ChevronRight aria-hidden="true" size={15} /></Link>}
      </div>
    </li>)}</ul>
  </section>;
}

export function useLiveAgreements(awardIds: string[]) {
  const [live, setLive] = useState<string[]>([]);
  const key = awardIds.join(',');
  useEffect(() => {
    let active = true;
    void Promise.all(awardIds.map(id => readAgreement(id).then(() => id).catch(() => null))).then(rows => { if (active) setLive(rows.filter((id): id is string => Boolean(id))); });
    return () => { active = false; };
  }, [key]);
  return live;
}

/** Projects whose award-scoped journal answers for this viewer (hidden while the service fails, e.g. #355). */
export function useLiveJournals(projectIds: string[]) {
  const [live, setLive] = useState<string[]>([]);
  const key = projectIds.join(',');
  useEffect(() => {
    let active = true;
    void (async () => {
      const { data } = await supabaseBrowser().auth.getSession();
      if (!data.session) return;
      const rows = await Promise.all(projectIds.map(id => fetch(`/api/projects/execution?project_id=${encodeURIComponent(id)}&limit=1`, { headers: { Authorization: `Bearer ${data.session!.access_token}` }, cache: 'no-store' }).then(response => response.ok ? id : null).catch(() => null)));
      if (active) setLive(rows.filter((id): id is string => Boolean(id)));
    })();
    return () => { active = false; };
  }, [key]);
  return live;
}
