'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle, CalendarDays, Check, ChevronLeft, Layers, Lock, Send } from 'lucide-react';
import { supabaseBrowser } from '../../../../../lib/supabase-browser';
import { Card } from '../../../../../components/ui';
import { cn } from '../../../../../lib/utils';
import { DossierSteps, ErrorPanel, primaryAction, secondaryAction, StatusPill } from '../../_components/ProjectUi';

type LotSnapshot = {
  id: string;
  request_id: string;
  title: string;
  scope: string;
  budget_millimes: number | null;
  version_no: number;
  trade_name?: string;
};

const typeLabels: Record<string, string> = { construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' };
const formatTnd = (value?: number | null) => value == null ? 'Non renseigné' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000);
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(value)) : 'Non renseignée';

export default function ProjectReview() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [isClient, setIsClient] = useState(false);
  const [project, setProject] = useState<any>();
  const [version, setVersion] = useState<any>();
  const [requests, setRequests] = useState<LotSnapshot[]>([]);
  const [location, setLocation] = useState('');
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const supabase = supabaseBrowser();
      const [projectResult, versionResult, projectRequestsResult, docsResult] = await Promise.all([
        supabase.from('projects').select('*').eq('id', id).single(),
        supabase.from('project_versions').select('*').eq('project_id', id).order('version_no', { ascending: false }).limit(1),
        supabase.from('project_requests').select('id,status').eq('project_id', id).neq('status', 'withdrawn'),
        supabase.from('documents').select('id,original_name,status').eq('project_id', id),
      ]);
      const current = versionResult.data?.[0];
      if (projectResult.error || versionResult.error || projectRequestsResult.error || docsResult.error || !current) {
        setError('Impossible de charger la revue du projet.');
        setLoading(false);
        return;
      }

      const linksResult = await supabase.from('project_version_requests').select('request_version_id').eq('project_version_id', current.id);
      if (linksResult.error) {
        setError('Impossible de charger les lots liés à cette version du projet.');
        setLoading(false);
        return;
      }
      const versionIds = new Set((linksResult.data ?? []).map(link => link.request_version_id));
      const [{ data: snapshots, error: snapshotsError }, { data: trades, error: tradesError }] = versionIds.size ? await Promise.all([
        supabase.from('project_request_versions').select('id,request_id,project_id,trade_id,title,scope,budget_millimes,version_no').in('id', [...versionIds]),
        supabase.from('trades').select('id,name_fr'),
      ]) : [{ data: [], error: null }, { data: [], error: null }];
      if (snapshotsError || tradesError) {
        setError('Impossible de charger les lots liés à cette version du projet.');
        setLoading(false);
        return;
      }

      const requestById = new Map((projectRequestsResult.data ?? []).map(request => [request.id, request]));
      const snapshotById = new Map((snapshots ?? []).map(snapshot => [snapshot.id, snapshot]));
      const tradeById = new Map((trades ?? []).map(trade => [trade.id, trade.name_fr]));
      const linkedLots = (linksResult.data ?? []).flatMap(link => {
        const snapshot = snapshotById.get(link.request_version_id);
        const request = snapshot ? requestById.get(snapshot.request_id) : undefined;
        if (!snapshot || !request) return [];
        return [{ ...snapshot, trade_name: tradeById.get(snapshot.trade_id) ?? 'Métier' }];
      });

      const { data: auth } = await supabase.auth.getSession();
      setIsClient(Boolean(auth.session && projectResult.data?.client_id === auth.session.user.id));
      setProject(projectResult.data);
      setVersion(current);
      setDocuments(docsResult.data ?? []);
      setRequests(linkedLots);
      const names: string[] = [];
      if (current.governorate_id) { const result = await supabase.from('governorates').select('name_fr').eq('id', current.governorate_id).maybeSingle(); if (result.data?.name_fr) names.push(result.data.name_fr); }
      if (current.delegation_id) { const result = await supabase.from('delegations').select('name_fr').eq('id', current.delegation_id).maybeSingle(); if (result.data?.name_fr) names.push(result.data.name_fr); }
      if (current.locality_id) { const result = await supabase.from('localities').select('name_fr').eq('id', current.locality_id).maybeSingle(); if (result.data?.name_fr) names.push(result.data.name_fr); }
      setLocation(names.join(' · '));
      setLoading(false);
    })();
  }, [id]);

  async function submit() {
    if (!version?.desired_start_date || !version?.desired_end_date || version.desired_end_date < version.desired_start_date) {
      setError('Renseignez les dates de début et de fin souhaitées avant de soumettre le DAO.');
      return;
    }
    setSaving(true); setError('');
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) { setError('Session expirée.'); setSaving(false); return; }
    const response = await fetch('/api/projects/review', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify({ project_id: id }) });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? 'Soumission refusée.');
    else router.push('/app/projects/' + id);
    setSaving(false);
  }

  async function correct() {
    setSaving(true); setError('');
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) { setError('Session expirée.'); setSaving(false); return; }
    const response = await fetch('/api/projects/correction', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify({ project_id: id }) });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? 'Correction impossible.'); else router.push('/app/projects/' + id);
    setSaving(false);
  }

  const total = useMemo(() => requests.reduce((sum, request) => sum + Number(request.budget_millimes || 0), 0), [requests]);
  if (loading) return <div aria-busy="true" className="mx-auto max-w-4xl space-y-6"><span className="sr-only">Chargement de la revue…</span><div className="rounded-2xl border border-black/[0.06] bg-white p-5 sm:p-7"><div className="h-3 w-24 animate-pulse rounded bg-ink/[0.07]" /><div className="mt-4 h-8 w-2/3 animate-pulse rounded bg-ink/[0.08]" /><div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-ink/[0.05]" /><div className="mt-7 grid grid-cols-4 gap-2">{[0, 1, 2, 3].map(item => <div key={item} className="h-1.5 animate-pulse rounded-full bg-ink/[0.08]" />)}</div></div>{[0, 1].map(item => <div key={item} className="h-40 animate-pulse rounded-2xl border border-black/[0.04] bg-white" />)}</div>;
  if (!project || !version) return <div className="mx-auto max-w-4xl"><ErrorPanel title="Revue indisponible" message={error || 'Projet introuvable.'} backHref="/app/projects" /></div>;
  const rejected = version.status === 'rejected';
  const datesReady = Boolean(version.desired_start_date && version.desired_end_date) && version.desired_end_date >= version.desired_start_date;
  const titleReady = Boolean(version.title && version.title !== 'Nouveau projet' && version.description && version.description !== 'Brouillon');
  const checks: { label: string; done: boolean; detail: string; optional?: boolean }[] = [
    { label: 'Titre et description', done: titleReady, detail: titleReady ? 'Renseignés' : 'À compléter' },
    { label: 'Localisation', done: Boolean(location), detail: location || 'À compléter' },
    { label: 'Dates souhaitées', done: datesReady, detail: datesReady ? `${formatDate(version.desired_start_date)} → ${formatDate(version.desired_end_date)}` : 'À compléter' },
    { label: 'Lots actifs', done: requests.length > 0, detail: requests.length > 0 ? `${requests.length} lot${requests.length > 1 ? 's' : ''}` : 'À compléter' },
    { label: 'Documents', done: documents.length > 0, detail: documents.length ? `${documents.length} fichier${documents.length > 1 ? 's' : ''}` : 'Aucun, facultatif', optional: true },
  ];
  const required = checks.filter(check => !check.optional);
  const canSubmit = requests.length > 0 && datesReady && version.status === 'draft';
  return <section className="mx-auto max-w-4xl space-y-6 pb-4" aria-labelledby="review-title">
    <Link href={'/app/projects/' + id} className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-teal transition hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"><ChevronLeft size={16} aria-hidden="true" />Fiche du chantier</Link>
    <header className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_1px_2px_rgba(23,32,42,0.04)] sm:p-7">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Revue du DAO</p>
      <div className="mt-2 flex flex-wrap items-start gap-x-3 gap-y-2"><h1 id="review-title" className="min-w-0 break-words text-[1.75rem] font-bold leading-tight tracking-tight text-ink sm:text-3xl">{version.title}</h1><span className="mt-1.5"><StatusPill status={version.status} /></span></div>
      <p className="mt-3 max-w-3xl whitespace-pre-wrap text-sm leading-relaxed text-ink/70">{version.description || 'Sans description'}</p>
      <div className="mt-6 border-t border-black/[0.06] pt-5"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">Parcours du dossier</p><div className="mt-3"><DossierSteps status={version.status} /></div></div>
    </header>
    {rejected && <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5"><AlertCircle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-red-600" /><div className="min-w-0"><h2 className="font-semibold text-red-800">Des corrections sont demandées</h2><p className="mt-1.5 text-sm text-red-800">Consultez le commentaire de revue sur la page du projet, corrigez les lots concernés puis soumettez une nouvelle version.</p></div></div>}
    {!datesReady && version.status === 'draft' && isClient && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><div className="flex items-start gap-3"><CalendarDays size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-700" /><div className="min-w-0"><h2 className="font-semibold text-amber-900">Dates souhaitées à compléter avant la soumission.</h2><p className="mt-1.5 text-sm text-amber-900/90">Renseignez une date de début et une date de fin souhaitées pour que D.A.O. puisse préparer la revue du chantier.</p><button type="button" className={cn(primaryAction, 'mt-4')} onClick={() => router.push('/app/projects/' + id + '?tab=overview&edit=project')}>Renseigner les dates</button></div></div></div>}
    {requests.length === 0 && version.status === 'draft' && <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5"><div className="flex items-start gap-3"><Layers size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-700" /><div className="min-w-0"><h2 className="font-semibold text-amber-900">Un lot actif est nécessaire avant la soumission.</h2><p className="mt-1.5 text-sm text-amber-900/90">Créez le lot principal depuis la fiche projet. Aucun lot ne sera créé avant votre validation.</p><button type="button" className={cn(primaryAction, 'mt-4')} onClick={() => router.push('/app/projects/' + id + '?tab=lots')}>Créer le lot principal</button></div></div></div>}
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-bold tracking-tight text-ink">Checklist avant soumission</h2><p className="mt-1 text-sm text-ink/70">Les éléments indispensables pour que D.A.O. puisse relire votre dossier.</p></div><span className="rounded-full bg-ink/[0.06] px-2.5 py-1 text-xs font-semibold tabular-nums text-ink/80">{required.filter(check => check.done).length}/{required.length} prêts</span></div>
      <ul className="mt-5 grid gap-3 sm:grid-cols-2">{checks.map(check => <li key={check.label} className="flex items-start gap-3 rounded-xl bg-sand/70 p-3.5"><span aria-hidden="true" className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${check.done ? 'bg-teal text-white' : check.optional ? 'border border-dashed border-ink/25 bg-white' : 'bg-amber-100 text-amber-800'}`}>{check.done ? <Check size={13} /> : !check.optional && <AlertCircle size={13} />}</span><div className="min-w-0 text-sm"><p className="font-semibold text-ink">{check.label}</p><p className={`mt-0.5 break-words ${check.done || check.optional ? 'text-ink/65' : 'font-medium text-amber-800'}`}>{check.detail}</p></div><span className="sr-only">{check.done ? ' — prêt' : check.optional ? ' — facultatif' : ' — à compléter'}</span></li>)}</ul>
    </Card>
    <Card className="p-5 sm:p-6">
      <h2 className="text-lg font-bold tracking-tight text-ink">Résumé du chantier</h2>
      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3">
        <div className="min-w-0"><dt className="text-xs text-ink/65">Type</dt><dd className="mt-0.5 font-semibold text-ink">{typeLabels[version.project_type] ?? 'Autre'}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-ink/65">Surface</dt><dd className="mt-0.5 font-semibold tabular-nums text-ink">{version.surface_m2 ? `${version.surface_m2} m²` : '—'}</dd></div>
        <div className="col-span-2 min-w-0 sm:col-span-1"><dt className="text-xs text-ink/65">Localisation</dt><dd className="mt-0.5 break-words font-semibold text-ink">{location || 'Non renseignée'}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-ink/65">Début souhaité</dt><dd className="mt-0.5 font-semibold text-ink">{formatDate(version.desired_start_date)}</dd></div>
        <div className="min-w-0"><dt className="text-xs text-ink/65">Fin souhaitée</dt><dd className="mt-0.5 font-semibold text-ink">{formatDate(version.desired_end_date)}</dd></div>
        <div className="col-span-2 min-w-0 sm:col-span-1"><dt className="text-xs text-ink/65">Budget projet</dt><dd className="mt-0.5 font-semibold tabular-nums text-ink">{formatTnd(version.indicative_budget_millimes)}</dd></div>
      </dl>
    </Card>
    <Card className="p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3"><h2 className="text-lg font-bold tracking-tight text-ink">Lots inclus</h2><span className="rounded-full bg-ink/[0.06] px-2.5 py-1 text-xs font-semibold tabular-nums text-ink/80">{requests.length} lot{requests.length > 1 ? 's' : ''}</span></div>
      {requests.length === 0 ? <p className="mt-4 rounded-xl bg-sand px-4 py-3 text-sm text-ink/70">Aucun lot n’est lié à cette version du projet.</p> : <ul className="mt-5 divide-y divide-black/[0.06] rounded-xl border border-black/[0.08]">{requests.map(request => <li key={request.id} className="p-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4"><div className="min-w-0"><p className="text-xs font-semibold text-teal">{request.trade_name}</p><h3 className="mt-1 break-words font-semibold text-ink">{request.title}</h3></div><span className="text-sm font-semibold tabular-nums text-ink">{formatTnd(request.budget_millimes)}</span></div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink/70">{request.scope}</p>
        <p className="mt-2 text-xs text-ink/65">Version {request.version_no}</p>
      </li>)}</ul>}
      <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-black/[0.06] pt-4 text-sm"><span className="text-ink/70">Total des lots</span><span className="text-base font-bold tabular-nums text-ink">{formatTnd(total)}</span></div>
    </Card>
    {!isClient && <p className="flex items-start gap-2 rounded-xl bg-sand px-4 py-3 text-sm text-ink/70"><Lock size={15} aria-hidden="true" className="mt-0.5 shrink-0" />Seul le client peut soumettre le DAO. La confirmation du chantier et la revue DAO sont deux démarches distinctes.</p>}
    {error && <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{error}</p>}
    <div className="sticky bottom-0 z-10 -mx-4 border-t border-black/[0.08] bg-sand/95 px-4 pb-[max(12px,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:bg-white/95 sm:px-5 sm:py-4">
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" className={cn(secondaryAction, isClient && 'hidden sm:inline-flex')} onClick={() => router.push('/app/projects/' + id)}>Retour au projet</button>
        {isClient && <div className="flex flex-col gap-1.5 sm:items-end">{rejected ? <button type="button" className={primaryAction} onClick={() => void correct()} disabled={saving}>{saving ? 'Préparation…' : 'Créer une version de correction'}</button> : <button type="button" className={primaryAction} onClick={() => void submit()} disabled={saving || !canSubmit}><Send size={16} aria-hidden="true" />{saving ? 'Soumission…' : 'Soumettre pour revue DAO'}</button>}{!rejected && !canSubmit && version.status === 'draft' && <p className="text-center text-xs text-ink/65 sm:text-right">Complétez la checklist pour activer la soumission.</p>}</div>}
      </div>
    </div>
  </section>;
}
