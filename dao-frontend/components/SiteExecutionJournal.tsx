'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, CalendarDays, Check, ChevronDown, ClipboardCheck, FileText, Hammer, History, Milestone, RefreshCw } from 'lucide-react';
import { supabaseBrowser } from '../lib/supabase-browser';
import { Badge, Card, Input, SectionHeading } from './ui';
import { cn } from '../lib/utils';
import { fieldClass, primaryAction, secondaryAction } from '../app/app/projects/_components/ProjectUi';

type SiteLot = { award_item_id: string; request_id: string; title: string; trade_id?: string | null; can_write: boolean; latest_progress?: { status: string; percent: number } | null };
type Evidence = { document_id: string; name: string; mime_type: string; created_at: string };
type Observation = { id: string; created_at: string; outcome: 'acknowledged' | 'disputed'; reason?: string | null };
type SiteEvent = { id: string; created_at: string; award_item_id: string; actor_id: string; kind: 'progress' | 'intervention' | 'milestone'; milestone_key?: string | null; status?: string | null; percent?: number | null; work_date?: string | null; title?: string | null; target_date?: string | null; note?: string | null; evidence: Evidence[]; observations: Observation[] };
type Snapshot = { project_id: string; can_observe: boolean; lots: SiteLot[]; events: SiteEvent[]; next_cursor: string | null };
type ProjectDocument = { id: string; owner_id: string; original_name: string; status: string; share_scope: string };

const progressLabels: Record<string, string> = { not_started: 'Non commencé', in_progress: 'En cours', completed: 'Terminé' };
const milestoneLabels: Record<string, string> = { planned: 'Planifié', in_progress: 'En cours', completed: 'Terminé', cancelled: 'Annulé' };
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(value)) : 'À préciser';

async function siteApi<T>(path: string, method = 'GET', body?: Record<string, unknown>): Promise<T> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('Session expirée. Reconnectez-vous.');
  const response = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Le carnet de chantier est momentanément indisponible.');
  return payload.data;
}

function EvidencePicker({ documents, selected, onChange }: { documents: ProjectDocument[]; selected: string[]; onChange: (ids: string[]) => void }) {
  if (!documents.length) return <p className="rounded-xl bg-sand px-3.5 py-3 text-sm text-ink/65">Aucun justificatif approuvé et partagé ne peut être joint. Ajoutez-le d’abord dans l’onglet Documents.</p>;
  return <fieldset className="rounded-xl border border-black/[0.08] p-3"><legend className="px-1 text-sm font-semibold text-ink">Justificatifs privés — facultatif</legend><div className="mt-2 space-y-2">{documents.map(document => <label key={document.id} className="flex min-h-11 items-center gap-3 rounded-lg px-2 text-sm hover:bg-sand"><input type="checkbox" checked={selected.includes(document.id)} onChange={event => onChange(event.target.checked ? [...selected, document.id] : selected.filter(id => id !== document.id))} className="h-4 w-4 accent-teal" /><span className="min-w-0 break-all">{document.original_name}</span></label>)}</div></fieldset>;
}

export default function SiteExecutionJournal({ projectId, userId, documents }: { projectId: string; userId: string; documents: ProjectDocument[] }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true); const [loadingMore, setLoadingMore] = useState(false);
  const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [progress, setProgress] = useState({ lot: '', status: 'in_progress', percent: '0', reason: '', documents: [] as string[] });
  const [intervention, setIntervention] = useState({ lot: '', workDate: new Date().toISOString().slice(0, 10), percent: '', note: '', documents: [] as string[] });
  const [milestone, setMilestone] = useState({ lot: '', title: '', targetDate: '', status: 'planned', note: '' });
  const [milestoneEdit, setMilestoneEdit] = useState<Record<string, { status: string; targetDate: string; note: string }>>({});
  const [observation, setObservation] = useState<Record<string, { outcome: string; reason: string }>>({});

  const load = useCallback(async (cursor?: string | null, append = false) => {
    append ? setLoadingMore(true) : setLoading(true); setError('');
    try {
      const query = new URLSearchParams({ project_id: projectId, limit: '30' });
      if (cursor) query.set('before', cursor);
      const next = await siteApi<Snapshot>(`/api/projects/execution?${query}`);
      setSnapshot(previous => append && previous ? { ...next, events: [...previous.events, ...next.events] } : next);
    } catch (exception: any) { setError(exception.message); }
    finally { append ? setLoadingMore(false) : setLoading(false); }
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const writable = snapshot?.lots.find(lot => lot.can_write)?.award_item_id ?? '';
    if (writable) {
      setProgress(value => value.lot ? value : { ...value, lot: writable });
      setIntervention(value => value.lot ? value : { ...value, lot: writable });
      setMilestone(value => value.lot ? value : { ...value, lot: writable });
    }
  }, [snapshot?.lots]);

  const writableLots = snapshot?.lots.filter(lot => lot.can_write) ?? [];
  const evidenceDocuments = documents.filter(document => document.owner_id === userId && document.status === 'approved' && document.share_scope === 'project_members');
  const lotNames = useMemo(() => new Map((snapshot?.lots ?? []).map(lot => [lot.award_item_id, lot.title])), [snapshot?.lots]);
  async function mutate(method: string, body: Record<string, unknown>, message: string) {
    setSaving(true); setError(''); setSuccess('');
    try { await siteApi('/api/projects/execution', method, { ...body, idempotency_key: crypto.randomUUID() }); setSuccess(message); await load(); }
    catch (exception: any) { setError(exception.message); }
    finally { setSaving(false); }
  }
  async function saveProgress(event: FormEvent) { event.preventDefault(); await mutate('POST', { kind: 'progress', award_item_id: progress.lot, status: progress.status, percent: Number(progress.percent), reason: progress.reason, document_ids: progress.documents }, 'Avancement du lot ajouté à l’historique.'); }
  async function saveIntervention(event: FormEvent) { event.preventDefault(); await mutate('POST', { kind: 'intervention', award_item_id: intervention.lot, work_date: intervention.workDate, note: intervention.note, percent: intervention.percent === '' ? null : Number(intervention.percent), document_ids: intervention.documents }, 'Intervention ajoutée au journal.'); }
  async function saveMilestone(event: FormEvent) { event.preventDefault(); await mutate('POST', { kind: 'milestone', award_item_id: milestone.lot, title: milestone.title, target_date: milestone.targetDate || null, status: milestone.status, note: milestone.note || null }, 'Jalon technique ajouté.'); }
  async function updateMilestone(event: FormEvent, row: SiteEvent) { event.preventDefault(); const value = milestoneEdit[row.milestone_key!] ?? { status: row.status ?? 'planned', targetDate: row.target_date ?? '', note: '' }; await mutate('PATCH', { milestone_key: row.milestone_key, target_date: value.targetDate || null, status: value.status, note: value.note || null }, 'Nouvel état du jalon ajouté à l’historique.'); }
  async function saveObservation(event: FormEvent, row: SiteEvent) {
    event.preventDefault(); const value = observation[row.id] ?? { outcome: 'acknowledged', reason: '' };
    setSaving(true); setError(''); setSuccess('');
    try { await siteApi('/api/projects/execution/observations', 'POST', { event_id: row.id, outcome: value.outcome, reason: value.reason || null, idempotency_key: crypto.randomUUID() }); setSuccess(value.outcome === 'disputed' ? 'Contestation enregistrée avec son motif.' : 'Prise de connaissance enregistrée.'); await load(); }
    catch (exception: any) { setError(exception.message); } finally { setSaving(false); }
  }

  if (loading) return <Card className="p-5 sm:p-6" aria-busy="true"><span className="sr-only">Chargement du carnet de chantier…</span><div className="h-6 w-52 animate-pulse rounded bg-ink/[0.08]" /><div className="mt-3 h-4 w-4/5 animate-pulse rounded bg-ink/[0.05]" /><div className="mt-6 grid gap-3 md:grid-cols-2">{[0, 1].map(item => <div key={item} className="h-28 animate-pulse rounded-xl bg-sand" />)}</div></Card>;
  if (!snapshot) return <Card className="p-5 sm:p-6"><div className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="flex items-start gap-2 font-semibold text-red-800"><AlertCircle size={18} className="mt-0.5 shrink-0" />Carnet de chantier indisponible</p><p className="mt-1 text-sm text-red-700">{error || 'Votre accès au carnet n’a pas pu être confirmé.'}</p><button type="button" className={cn(secondaryAction, 'mt-4')} onClick={() => void load()}><RefreshCw size={15} />Réessayer</button></div></Card>;

  return <div className="space-y-4">
    <Card className="p-5 sm:p-6"><SectionHeading eyebrow="Après attribution" title="Carnet de chantier" description="Suivi déclaratif par lot attribué. Une progression à 100 % ne vaut ni réception, ni acceptation des travaux, ni paiement." />
      {snapshot.lots.length === 0 ? <div className="mt-6 rounded-xl border border-dashed border-black/15 px-5 py-9 text-center"><Hammer className="mx-auto text-ink/45" aria-hidden="true" /><p className="mt-3 font-semibold">Aucun lot attribué accessible</p><p className="mx-auto mt-1 max-w-lg text-sm text-ink/65">Le carnet s’ouvre après attribution active et acceptation du professionnel dans l’équipe du chantier.</p></div>
        : <ul className="mt-6 grid gap-3 md:grid-cols-2">{snapshot.lots.map(lot => <li key={lot.award_item_id} className="rounded-xl border border-black/[0.07] p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="break-words font-bold text-ink">{lot.title}</p><p className="mt-1 text-xs text-ink/60">Lot effectivement attribué</p></div>{lot.can_write && <Badge tone="teal">Votre lot</Badge>}</div><div className="mt-4 flex items-center gap-3"><span className="text-2xl font-bold tabular-nums text-teal">{lot.latest_progress?.percent ?? 0}%</span><span className="text-sm text-ink/65">{progressLabels[lot.latest_progress?.status ?? 'not_started']}</span></div></li>)}</ul>}
    </Card>

    {writableLots.length > 0 && <Card className="p-5 sm:p-6"><SectionHeading title="Ajouter au carnet" description="Chaque enregistrement est daté par le serveur et reste dans l’historique." />
      <div className="mt-5 space-y-3">
        <details className="rounded-xl border border-black/[0.08] p-4"><summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 font-semibold"><span className="flex items-center gap-2"><ClipboardCheck size={17} className="text-teal" />Déclarer un avancement</span><ChevronDown size={16} /></summary><form onSubmit={saveProgress} className="mt-5 grid gap-4 sm:grid-cols-2"><LotSelect lots={writableLots} value={progress.lot} onChange={lot => setProgress(value => ({ ...value, lot }))} /><label className="text-sm font-semibold">État<select className={cn(fieldClass, 'mt-2')} value={progress.status} onChange={event => setProgress(value => ({ ...value, status: event.target.value }))}>{Object.entries(progressLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-semibold">Progression déclarée (%)<Input className="mt-2" type="number" min="0" max="100" value={progress.percent} onChange={event => setProgress(value => ({ ...value, percent: event.target.value }))} required /></label><label className="text-sm font-semibold sm:col-span-2">Justification<textarea className={cn(fieldClass, 'mt-2 min-h-24 resize-y')} minLength={3} maxLength={1000} value={progress.reason} onChange={event => setProgress(value => ({ ...value, reason: event.target.value }))} required /></label><div className="sm:col-span-2"><EvidencePicker documents={evidenceDocuments} selected={progress.documents} onChange={documents => setProgress(value => ({ ...value, documents }))} /></div><button className={cn(primaryAction, 'sm:col-span-2 sm:w-fit')} disabled={saving}>{saving ? 'Enregistrement…' : 'Ajouter l’avancement'}</button></form></details>
        <details className="rounded-xl border border-black/[0.08] p-4"><summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 font-semibold"><span className="flex items-center gap-2"><Hammer size={17} className="text-teal" />Consigner une intervention</span><ChevronDown size={16} /></summary><form onSubmit={saveIntervention} className="mt-5 grid gap-4 sm:grid-cols-2"><LotSelect lots={writableLots} value={intervention.lot} onChange={lot => setIntervention(value => ({ ...value, lot }))} /><label className="text-sm font-semibold">Date des travaux<Input className="mt-2" type="date" value={intervention.workDate} onChange={event => setIntervention(value => ({ ...value, workDate: event.target.value }))} required /></label><label className="text-sm font-semibold">Progression après intervention — facultatif<Input className="mt-2" type="number" min="0" max="100" value={intervention.percent} onChange={event => setIntervention(value => ({ ...value, percent: event.target.value }))} /></label><label className="text-sm font-semibold sm:col-span-2">Rapport court<textarea className={cn(fieldClass, 'mt-2 min-h-28 resize-y')} minLength={3} maxLength={2000} value={intervention.note} onChange={event => setIntervention(value => ({ ...value, note: event.target.value }))} required /></label><div className="sm:col-span-2"><EvidencePicker documents={evidenceDocuments} selected={intervention.documents} onChange={documents => setIntervention(value => ({ ...value, documents }))} /></div><button className={cn(primaryAction, 'sm:col-span-2 sm:w-fit')} disabled={saving}>{saving ? 'Enregistrement…' : 'Ajouter l’intervention'}</button></form></details>
        <details className="rounded-xl border border-black/[0.08] p-4"><summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 font-semibold"><span className="flex items-center gap-2"><Milestone size={17} className="text-teal" />Ajouter un jalon technique</span><ChevronDown size={16} /></summary><form onSubmit={saveMilestone} className="mt-5 grid gap-4 sm:grid-cols-2"><LotSelect lots={writableLots} value={milestone.lot} onChange={lot => setMilestone(value => ({ ...value, lot }))} /><label className="text-sm font-semibold">Titre<Input className="mt-2" maxLength={160} value={milestone.title} onChange={event => setMilestone(value => ({ ...value, title: event.target.value }))} required /></label><label className="text-sm font-semibold">Date cible — facultative<Input className="mt-2" type="date" value={milestone.targetDate} onChange={event => setMilestone(value => ({ ...value, targetDate: event.target.value }))} /></label><label className="text-sm font-semibold">État<select className={cn(fieldClass, 'mt-2')} value={milestone.status} onChange={event => setMilestone(value => ({ ...value, status: event.target.value }))}>{Object.entries(milestoneLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-semibold sm:col-span-2">Note — facultative<textarea className={cn(fieldClass, 'mt-2 min-h-20 resize-y')} maxLength={1000} value={milestone.note} onChange={event => setMilestone(value => ({ ...value, note: event.target.value }))} /></label><button className={cn(primaryAction, 'sm:col-span-2 sm:w-fit')} disabled={saving}>{saving ? 'Enregistrement…' : 'Ajouter le jalon'}</button></form></details>
      </div>
    </Card>}

    <Card className="p-5 sm:p-6"><SectionHeading title="Historique d’exécution" description="Déclarations, rapports, jalons et observations sont conservés sans écrasement." action={<Badge>{snapshot.events.length} événement{snapshot.events.length > 1 ? 's' : ''}</Badge>} />
      {error && <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertCircle size={16} className="mt-0.5 shrink-0" />{error}<button type="button" className="ml-auto font-semibold underline" onClick={() => void load()}>Réessayer</button></p>}
      {success && <p role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-teal/20 bg-teal/[0.07] px-4 py-3 text-sm text-teal"><Check size={16} className="mt-0.5 shrink-0" />{success}</p>}
      {snapshot.events.length === 0 ? <div className="mt-6 rounded-xl bg-sand px-5 py-8 text-center"><History className="mx-auto text-ink/40" /><p className="mt-3 font-semibold">Aucune déclaration pour le moment.</p><p className="mt-1 text-sm text-ink/65">Le suivi global ci-dessus reste disponible et distinct du carnet par lot.</p></div>
        : <ol className="mt-6 space-y-4">{snapshot.events.map(row => <li key={row.id} className="rounded-xl border border-black/[0.07] p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-teal">{row.kind === 'progress' ? 'Avancement' : row.kind === 'intervention' ? 'Intervention' : 'Jalon technique'}</p><h3 className="mt-1 break-words font-bold">{row.title || lotNames.get(row.award_item_id) || 'Lot attribué'}</h3></div><time className="text-xs text-ink/60" dateTime={row.created_at}>{formatDate(row.created_at)}</time></div><div className="mt-3 space-y-2 text-sm text-ink/75">{row.status && <p><strong>État :</strong> {row.kind === 'milestone' ? milestoneLabels[row.status] : progressLabels[row.status]}</p>}{row.percent != null && <p><strong>Progression déclarée :</strong> {row.percent} %</p>}{row.kind === 'intervention' && <p><strong>Date des travaux :</strong> {formatDate(row.work_date)}</p>}{row.kind === 'milestone' && <p className="flex items-center gap-1.5"><CalendarDays size={14} /><strong>Date cible :</strong> {formatDate(row.target_date)}</p>}{row.note && <p className="whitespace-pre-wrap break-words">{row.note}</p>}</div>{row.evidence.length > 0 && <ul className="mt-4 flex flex-wrap gap-2" aria-label="Justificatifs privés">{row.evidence.map(file => <li key={file.document_id}><Badge><FileText size={12} className="mr-1" />{file.name}</Badge></li>)}</ul>}{row.observations.length > 0 && <ul className="mt-4 space-y-2">{row.observations.map(item => <li key={item.id} className={cn('rounded-lg px-3 py-2 text-sm', item.outcome === 'disputed' ? 'bg-amber-50 text-amber-900' : 'bg-teal/[0.07] text-teal')}><strong>{item.outcome === 'disputed' ? 'Observation Client' : 'Prise de connaissance Client'}</strong>{item.reason && <span> — {item.reason}</span>}</li>)}</ul>}
          {row.kind === 'milestone' && row.milestone_key && !['completed', 'cancelled'].includes(row.status ?? '') && writableLots.some(lot => lot.award_item_id === row.award_item_id) && <details className="mt-4 rounded-lg bg-sand p-3"><summary className="cursor-pointer font-semibold">Mettre à jour ce jalon</summary><form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={event => void updateMilestone(event, row)}><label className="text-sm font-semibold">Nouvel état<select className={cn(fieldClass, 'mt-1')} value={(milestoneEdit[row.milestone_key]?.status ?? row.status) || 'planned'} onChange={event => setMilestoneEdit(values => ({ ...values, [row.milestone_key!]: { status: event.target.value, targetDate: values[row.milestone_key!]?.targetDate ?? row.target_date ?? '', note: values[row.milestone_key!]?.note ?? '' } }))}>{Object.entries(milestoneLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="text-sm font-semibold">Date cible<Input className="mt-1" type="date" value={milestoneEdit[row.milestone_key]?.targetDate ?? row.target_date ?? ''} onChange={event => setMilestoneEdit(values => ({ ...values, [row.milestone_key!]: { status: values[row.milestone_key!]?.status ?? row.status ?? 'planned', targetDate: event.target.value, note: values[row.milestone_key!]?.note ?? '' } }))} /></label><label className="text-sm font-semibold sm:col-span-2">Note<textarea className={cn(fieldClass, 'mt-1 min-h-20')} value={milestoneEdit[row.milestone_key]?.note ?? ''} onChange={event => setMilestoneEdit(values => ({ ...values, [row.milestone_key!]: { status: values[row.milestone_key!]?.status ?? row.status ?? 'planned', targetDate: values[row.milestone_key!]?.targetDate ?? row.target_date ?? '', note: event.target.value } }))} /></label><button className={cn(secondaryAction, 'sm:w-fit')} disabled={saving}>Ajouter le nouvel état</button></form></details>}
          {snapshot.can_observe && <details className="mt-4 rounded-lg bg-sand p-3"><summary className="cursor-pointer font-semibold">Ajouter une observation Client</summary><form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={event => void saveObservation(event, row)}><label className="text-sm font-semibold">Retour<select className={cn(fieldClass, 'mt-1')} value={observation[row.id]?.outcome ?? 'acknowledged'} onChange={event => setObservation(values => ({ ...values, [row.id]: { outcome: event.target.value, reason: values[row.id]?.reason ?? '' } }))}><option value="acknowledged">Prendre connaissance</option><option value="disputed">Contester la déclaration</option></select></label><label className="text-sm font-semibold sm:col-span-2">Motif {observation[row.id]?.outcome === 'disputed' ? '— obligatoire' : '— facultatif'}<textarea className={cn(fieldClass, 'mt-1 min-h-20')} minLength={observation[row.id]?.outcome === 'disputed' ? 3 : undefined} maxLength={1000} required={observation[row.id]?.outcome === 'disputed'} value={observation[row.id]?.reason ?? ''} onChange={event => setObservation(values => ({ ...values, [row.id]: { outcome: values[row.id]?.outcome ?? 'acknowledged', reason: event.target.value } }))} /></label><button className={cn(secondaryAction, 'sm:w-fit')} disabled={saving}>Enregistrer le retour</button></form></details>}
        </li>)}</ol>}
      {snapshot.next_cursor && <button type="button" className={cn(secondaryAction, 'mt-5 w-full sm:w-auto')} disabled={loadingMore} onClick={() => void load(snapshot.next_cursor, true)}>{loadingMore ? 'Chargement…' : 'Afficher l’historique précédent'}</button>}
      <p className="mt-5 rounded-xl bg-sand px-4 py-3 text-xs leading-relaxed text-ink/65">Ce carnet n’est pas un procès-verbal de réception. Il ne modifie ni contrat, ni attribution, ni situation de paiement.</p>
    </Card>
  </div>;
}

function LotSelect({ lots, value, onChange }: { lots: SiteLot[]; value: string; onChange: (value: string) => void }) {
  return <label className="text-sm font-semibold">Lot attribué<select className={cn(fieldClass, 'mt-2')} value={value} onChange={event => onChange(event.target.value)} required>{lots.map(lot => <option key={lot.award_item_id} value={lot.award_item_id}>{lot.title}</option>)}</select></label>;
}
