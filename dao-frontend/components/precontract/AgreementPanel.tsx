'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDashed, History, RefreshCw, ShieldAlert } from 'lucide-react';
import { Badge, Button, Card } from '../ui';
import InstallmentPanel from './InstallmentPanel';
import { formatTnd } from '../../lib/contracts';
import {
  accept, cleanTerms, eventLabels, partyLabel, partyTo, partyWith, paymentLabels, PrecontractError, PrecontractUnavailable, propose, readAgreement, reject, termsDiff,
  type AgreementVersion, type PartyRole, type PaymentMode, type ReferenceSubLot, type Snapshot, type Terms, type Installment,
} from '../../lib/precontract';

const field = 'mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm text-ink outline-none transition focus:border-teal focus:ring-4 focus:ring-teal/10 disabled:bg-sand/60';
const secondary = 'bg-white text-ink ring-1 ring-black/10 hover:bg-sand';
const other = (role: PartyRole): PartyRole => role === 'client' ? 'contractor' : 'client';
const fmtDate = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'long' }).format(new Date(`${value}T00:00:00`)) : 'Non précisée';
const fmtStamp = (value: string) => new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const shortHash = (hash: string) => hash.slice(0, 12);

type Phase = 'loading' | 'ready' | 'unavailable' | 'error';

/** « Conditions et calendrier » — optional pre-contract agreement on one exact award (#346, backend #345). */
export default function AgreementPanel({ awardId }: { awardId: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editing, setEditing] = useState<Terms | null>(null);
  const [review, setReview] = useState<Terms | null>(null);
  const [confirm, setConfirm] = useState<'accept' | 'reject' | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try { setSnapshot(await readAgreement(awardId)); setPhase('ready'); }
    catch (exception) {
      if (exception instanceof PrecontractUnavailable) setPhase('unavailable');
      else { setLoadError((exception as Error).message); setPhase('error'); }
    }
  }, [awardId]);
  useEffect(() => { setPhase('loading'); void load(); }, [load]);

  // Every command is followed by a fresh server snapshot: nothing is ever simulated locally.
  async function run(operation: () => Promise<unknown>, success: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { await operation(); setConfirm(null); setReason(''); setEditing(null); setReview(null); setNotice(success); await load(); }
    catch (exception) {
      setError((exception as Error).message);
      if (exception instanceof PrecontractError && exception.kind === 'conflict') { setConfirm(null); setReview(null); await load(); }
    } finally { busyRef.current = false; setBusy(false); }
  }

  if (phase === 'loading') return <div aria-busy="true" className="space-y-3"><p role="status" className="sr-only">Chargement des conditions…</p><div className="h-36 animate-pulse rounded-2xl bg-black/5" /><div className="h-56 animate-pulse rounded-2xl bg-black/5" /></div>;
  if (phase === 'unavailable') return <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:p-7">
    <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal/10 text-teal"><CalendarClock size={24} /></span>
    <div className="space-y-2"><h2 className="text-lg font-bold text-ink">Accord sur les conditions bientôt disponible</h2>
      <p className="text-sm text-black/60">Vous pourrez ici convenir avec l’autre partie, avant le contrat, d’une date de début, d’une durée et de modalités de référence. Ce service n’est pas encore ouvert : aucune action n’est possible pour l’instant et rien n’est requis pour continuer votre chantier.</p>
      <Button type="button" className={`gap-2 ${secondary}`} onClick={() => { setPhase('loading'); void load(); }}><RefreshCw aria-hidden="true" size={16} />Vérifier à nouveau</Button></div>
  </Card>;
  if (phase === 'error' || !snapshot) return <Card className="space-y-3 p-5 sm:p-7"><h2 className="text-lg font-bold text-ink">Conditions indisponibles</h2><p role="alert" className="text-sm text-red-700">{loadError || 'Ces conditions ne peuvent pas être affichées.'}</p><Button type="button" className={`gap-2 ${secondary}`} onClick={() => { setPhase('loading'); void load(); }}><RefreshCw aria-hidden="true" size={16} />Réessayer</Button></Card>;

  const { agreement, permissions: can, reference } = snapshot;
  const me = can.party_role, them = other(me);
  const current = snapshot.current_version;
  const items = reference?.items ?? [];
  const subLots = items.flatMap(item => item.sub_lots ?? []);
  const versions = [...snapshot.versions].sort((a, b) => b.version_no - a.version_no);
  const versionNo = (id?: string) => versions.find(version => version.id === id)?.version_no;
  const previous = current ? versions.find(version => version.version_no === current.version_no - 1) ?? null : null;
  const acceptedBy = (version: AgreementVersion, role: PartyRole) => snapshot.acceptances.find(row => row.version_id === version.id && row.party_role === role);
  const rejection = current && agreement?.status === 'rejected' ? [...snapshot.events].reverse().find(event => event.event_type === 'rejected' && event.version_id === current.id) : undefined;
  const agreed = agreement?.status === 'agreed' && current;
  const iAccepted = current ? !!acceptedBy(current, me) : false;
  const headline = !agreement || !current ? { tone: 'neutral' as const, text: 'Aucune condition proposée' }
    : agreed ? { tone: 'teal' as const, text: `Accord commun sur la version ${current.version_no}` }
    : rejection ? { tone: 'red' as const, text: `Proposition refusée par ${partyWith[rejection.actor_role]}` }
    : current.proposed_role === them && !iAccepted ? { tone: 'clay' as const, text: `${partyLabel[them]} vous propose la version ${current.version_no}` }
    : !iAccepted ? { tone: 'clay' as const, text: 'Confirmez votre accord sur votre proposition' }
    : { tone: 'clay' as const, text: `En attente de l’accord de ${partyWith[them]}` };
  const startEditing = () => { setConfirm(null); setEditing(review ?? current?.terms ?? { payment_mode: 'none' }); };
  const canAct = can.can_accept || can.can_reject || can.can_propose;

  return <div className="space-y-5">
    <Card className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[0.14em] text-teal">Avant le contrat · facultatif</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">Conditions et calendrier</h1>
          <p className="mt-1 text-sm text-black/55">Vous êtes {me === 'client' ? 'le Client' : 'l’Artisan attributaire'}. L’accord n’est commun que si les deux parties acceptent exactement la même version.</p></div>
        <Badge tone={headline.tone}>{headline.text}</Badge>
      </div>
      {items.length > 0 && <ul className="divide-y divide-black/5 rounded-xl bg-sand/60 px-4">{items.map(item => <li key={item.award_item_id} className="flex flex-wrap items-baseline justify-between gap-2 py-3"><span className="min-w-0 break-words font-semibold text-ink">{item.title}</span><span className="text-sm tabular-nums text-black/70">{formatTnd(item.agreed_millimes)}</span></li>)}</ul>}
      {reference && <p className="text-xs text-black/50">Montant attribué de référence : <strong className="text-ink">{formatTnd(reference.total_millimes)}</strong>. Il n’est jamais modifié par ces conditions.{items.length > 1 ? ' Les lots d’une même attribution restent indivisibles.' : ''}</p>}
      <p className="flex items-start gap-2 rounded-xl border border-clay/20 bg-clay/[0.06] px-3 py-2.5 text-sm text-black/70"><ShieldAlert aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-clay" /><span><strong className="text-ink">Non signé — aucun effet juridique.</strong> Accepter des conditions n’est pas signer le contrat et ne modifie pas l’offre attribuée.</span></p>
    </Card>

    {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle aria-hidden="true" size={16} className="mt-0.5 shrink-0" />{error}</p>}
    {notice && <p role="status" className="flex items-start gap-2 rounded-xl bg-teal/[0.08] px-4 py-3 text-sm font-medium text-teal"><CheckCircle2 aria-hidden="true" size={16} className="mt-0.5 shrink-0" />{notice}</p>}

    {agreed && <Card className="flex items-start gap-3 border-teal/25 bg-teal/[0.04] p-5"><CheckCircle2 aria-hidden="true" size={22} className="shrink-0 text-teal" /><div><h2 className="font-bold text-ink">Le Client et l’Artisan ont accepté la version {current.version_no}</h2><p className="mt-1 text-sm text-black/60">Conditions convenues — contrat non signé. Cette version (empreinte {shortHash(current.content_hash)}) pourra être reprise dans le dossier contractuel. Une nouvelle proposition demanderait de nouveaux accords.</p></div></Card>}

    {agreed && (current.terms.installments ?? []).length > 0 && <InstallmentPanel awardId={awardId} />}

    {current && !editing && !review && <Card className="space-y-4 p-5 sm:p-6" aria-labelledby="current-version-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="current-version-title" className="text-lg font-bold text-ink">Version {current.version_no} — proposée par {current.proposed_role === me ? 'vous' : partyWith[current.proposed_role]}</h2><span className="text-xs text-black/50">{fmtStamp(current.created_at)} · empreinte {shortHash(current.content_hash)}</span></div>
      <TermsSummary terms={current.terms} subLots={subLots} />
      {previous && <Diff before={previous.terms} after={current.terms} title={`Ce qui change par rapport à la version ${previous.version_no}`} />}
      <div className="flex flex-wrap gap-2" aria-label="Accords sur cette version">{(['client', 'contractor'] as PartyRole[]).map(role => { const row = acceptedBy(current, role); return <span key={role} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${row ? 'bg-teal/10 text-teal' : 'bg-black/[0.05] text-black/55'}`}>{row ? <CheckCircle2 aria-hidden="true" size={13} /> : <CircleDashed aria-hidden="true" size={13} />}Accord {partyLabel[role]} : {row ? `donné le ${fmtStamp(row.accepted_at)}` : 'en attente'}</span>; })}</div>
      {rejection && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800">Motif du refus ({partyLabel[rejection.actor_role]}) : {rejection.reason}</p>}

      {confirm === 'accept' && agreement ? <div role="group" aria-label="Confirmer votre accord" className="space-y-3 rounded-xl border border-teal/25 bg-teal/[0.04] p-4">
        <p className="text-sm text-ink">Vous acceptez exactement la version {current.version_no} (empreinte {shortHash(current.content_hash)}). Ce n’est pas une signature : le contrat reste non signé.</p>
        <div className="grid gap-2 sm:flex"><Button type="button" disabled={busy} onClick={() => void run(() => accept(agreement.id, current.id), `Votre accord sur la version ${current.version_no} est enregistré.`)}>{busy ? 'Enregistrement…' : 'Confirmer mon accord'}</Button><Button type="button" disabled={busy} className={secondary} onClick={() => setConfirm(null)}>Annuler</Button></div>
      </div>
      : confirm === 'reject' && agreement ? <div role="group" aria-label="Refuser cette proposition" className="space-y-3 rounded-xl border border-red-200 bg-red-50/60 p-4">
        <label className="block text-sm font-semibold text-ink">Motif du refus<textarea rows={3} maxLength={2000} className={field} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="Ex. : la date de début ne convient pas, je propose plutôt…" /></label>
        <p className="text-xs text-black/50">Le motif est transmis {partyTo[them]}. Vous pourrez ensuite proposer une autre version.</p>
        <div className="grid gap-2 sm:flex"><Button type="button" disabled={busy || !reason.trim()} className="bg-red-700 hover:bg-red-800" onClick={() => void run(() => reject(agreement.id, current.id, reason.trim()), 'Refus envoyé avec votre motif.')}>{busy ? 'Envoi…' : 'Confirmer le refus'}</Button><Button type="button" disabled={busy} className={secondary} onClick={() => { setConfirm(null); setReason(''); }}>Annuler</Button></div>
      </div>
      : canAct && <div className="grid gap-2 border-t border-black/5 pt-4 sm:flex sm:flex-wrap">
        {can.can_accept && <Button type="button" disabled={busy} onClick={() => setConfirm('accept')}>Accepter la version {current.version_no}</Button>}
        {can.can_propose && <Button type="button" disabled={busy} className={secondary} onClick={startEditing}>Proposer une modification</Button>}
        {can.can_reject && <Button type="button" disabled={busy} className="bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50" onClick={() => setConfirm('reject')}>Refuser</Button>}
      </div>}
      {!canAct && !agreed && <p className="text-sm text-black/55">Aucune action n’est disponible pour vous sur cette version.</p>}
    </Card>}

    {!current && !editing && !review && <Card className="space-y-3 p-5 sm:p-6">
      <h2 className="text-lg font-bold text-ink">Aucune condition proposée</h2>
      <p className="text-sm text-black/60">Rien n’est obligatoire : sans accord ici, le dossier contractuel reprend simplement l’offre attribuée. Vous pouvez proposer une date, une durée et une modalité de paiement de référence en quelques secondes.</p>
      {can.can_propose ? <Button type="button" onClick={startEditing}>Proposer des conditions</Button> : <p className="text-sm text-black/50">Aucune action n’est disponible pour vous.</p>}
    </Card>}

    {editing && <TermsForm initial={editing} subLots={subLots} totalMillimes={reference?.total_millimes} onCancel={() => setEditing(null)} onReview={terms => { setReview(terms); setEditing(null); }} />}

    {review && <Card className="space-y-4 border-dashed p-5 sm:p-6" aria-labelledby="review-title">
      <div><h2 id="review-title" className="text-lg font-bold text-ink">Relisez votre proposition</h2><p className="mt-1 text-sm text-black/55">Rien n’est encore envoyé. Après l’envoi, {partyWith[them]} pourra l’accepter, la refuser ou contre-proposer.</p></div>
      <TermsSummary terms={review} subLots={subLots} />
      {current && <Diff before={current.terms} after={review} title={`Différences avec la version ${current.version_no}`} />}
      <div className="grid gap-2 sm:flex">
        <Button type="button" disabled={busy} onClick={() => void run(() => propose(awardId, current?.id ?? null, review), `Proposition envoyée ${partyTo[them]}. Confirmez aussi votre propre accord.`)}>{busy ? 'Envoi…' : `Envoyer ${partyTo[them]}`}</Button>
        <Button type="button" disabled={busy} className={secondary} onClick={() => { setEditing(review); setReview(null); }}>Modifier</Button>
        <Button type="button" disabled={busy} className={secondary} onClick={() => setReview(null)}>Abandonner</Button>
      </div>
    </Card>}

    {snapshot.events.length > 0 && <details className="group rounded-2xl border border-black/5 bg-white p-5">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-ink"><History aria-hidden="true" size={17} className="text-teal" />Historique ({snapshot.events.length})<span aria-hidden="true" className="ml-auto text-black/40 group-open:rotate-90">›</span></summary>
      <ol className="mt-3 space-y-2">{[...snapshot.events].reverse().map(event => <li key={event.id} className="rounded-xl bg-sand/60 px-3 py-2.5 text-sm"><p className="font-semibold text-ink">{eventLabels[event.event_type] ?? 'Événement'}{versionNo(event.version_id) ? ` · version ${versionNo(event.version_id)}` : ''}</p><p className="text-xs text-black/55">{partyLabel[event.actor_role]} · {fmtStamp(event.created_at)}</p>{event.reason && <p className="mt-1 text-black/70">Motif : {event.reason}</p>}</li>)}</ol>
    </details>}
  </div>;
}

function TermsSummary({ terms, subLots }: { terms: Terms; subLots: ReferenceSubLot[] }) {
  const rows: [string, string][] = [
    ['Début', fmtDate(terms.planned_start_date)],
    ['Durée', terms.duration_days ? `${terms.duration_days} jour${terms.duration_days > 1 ? 's' : ''}` : 'Non précisée'],
    ['Paiement de référence', paymentLabels[terms.payment_mode ?? 'none']],
  ];
  const schedule = terms.sub_lot_schedule ?? [];
  return <div className="space-y-3">
    <dl className="grid gap-2 sm:grid-cols-3">{rows.map(([label, value]) => <div key={label} className="rounded-xl bg-sand/60 px-3 py-2.5"><dt className="text-xs text-black/50">{label}</dt><dd className="mt-0.5 font-semibold text-ink">{value}</dd></div>)}</dl>
    {terms.execution_terms && <p className="whitespace-pre-wrap break-words text-sm text-black/70"><span className="font-semibold text-ink">Modalités d’exécution : </span>{terms.execution_terms}</p>}
    {schedule.length > 0 && <div><p className="text-sm font-semibold text-ink">Calendrier des sous-lots</p><ul className="mt-1 space-y-1 text-sm text-black/65">{schedule.map(row => <li key={row.node_key}>{subLots.find(sub => sub.node_key === row.node_key)?.title ?? 'Sous-lot'} : {fmtDate(row.start_date)} → {fmtDate(row.end_date)}</li>)}</ul></div>}
    {(terms.installments ?? []).length > 0 && <div><p className="text-sm font-semibold text-ink">Échéances indicatives</p><ul className="mt-1 space-y-1 text-sm text-black/65">{terms.installments!.map((row, index) => <li key={index} className="flex flex-wrap justify-between gap-2"><span>{row.label}{row.due_date ? ` · ${fmtDate(row.due_date)}` : ''}</span><span className="tabular-nums">{formatTnd(row.amount_millimes)}</span></li>)}</ul></div>}
    <p className="text-xs text-black/45">Modalité de paiement indicative : aucun montant n’est exigible et aucun paiement n’est effectué via D.A.O.</p>
  </div>;
}

function Diff({ before, after, title }: { before: Terms | null; after: Terms; title: string }) {
  const rows = termsDiff(before, after);
  if (!rows.length) return <p className="text-sm text-black/50">Aucun changement par rapport à la version précédente.</p>;
  return <section className="rounded-xl border border-black/[0.08] p-4" aria-label={title}>
    <h3 className="text-sm font-bold text-ink">{title}</h3>
    {rows.some(row => row.sensitive) && <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-clay"><AlertTriangle aria-hidden="true" size={13} />Dates ou modalités modifiées : relisez attentivement.</p>}
    <dl className="mt-3 space-y-2">{rows.map(row => <div key={row.label} className="grid gap-1 text-sm sm:grid-cols-[11rem_minmax(0,1fr)]"><dt className="font-semibold text-ink">{row.label}</dt><dd className="min-w-0 break-words"><span className="text-black/45 line-through decoration-black/30">{row.before}</span><span aria-hidden="true" className="mx-1.5 text-black/35">→</span><span className="sr-only"> devient </span><span className="font-semibold text-ink">{row.after}</span></dd></div>)}</dl>
  </section>;
}

// Convert editable TND input to integer millimes without floating-point arithmetic.
function parseMillimes(input: string): number | null {
  const match = /^([0-9]{1,12})(?:[.,]([0-9]{1,3}))?$/.exec(input.trim());
  if (!match) return null;
  const amount = Number(match[1]) * 1000 + Number((match[2] ?? '').padEnd(3, '0'));
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}
const tndInput = (millimes: number) => Math.trunc(millimes / 1000) + '.' + String(millimes % 1000).padStart(3, '0');

function TermsForm({ initial, subLots, totalMillimes, onReview, onCancel }: { initial: Terms; subLots: ReferenceSubLot[]; totalMillimes?: number; onReview: (terms: Terms) => void; onCancel: () => void }) {
  const [terms, setTerms] = useState<Terms>(initial);
  const [advanced, setAdvanced] = useState((initial.sub_lot_schedule ?? []).length > 0);
  const [problem, setProblem] = useState('');
  const [showInstallments, setShowInstallments] = useState((initial.installments ?? []).length > 0);
  const [installmentInputs, setInstallmentInputs] = useState((initial.installments ?? []).map(row => ({ label: row.label, due_date: row.due_date ?? '', amount_tnd: tndInput(row.amount_millimes) })));
  const changeInstallment = (index: number, patch: Partial<{ label: string; due_date: string; amount_tnd: string }>) => setInstallmentInputs(values => values.map((row, i) => index === i ? { ...row, ...patch } : row));
  const set = (patch: Partial<Terms>) => setTerms(current => ({ ...current, ...patch }));
  const schedule = terms.sub_lot_schedule ?? [];
  const subDate = (key: string) => schedule.find(row => row.node_key === key) ?? { node_key: key, start_date: null, end_date: null };
  const setSub = (key: string, patch: { start_date?: string | null; end_date?: string | null }) => set({ sub_lot_schedule: [...schedule.filter(row => row.node_key !== key), { ...subDate(key), ...patch }] });
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const duration = terms.duration_days;
    if (duration != null && (!Number.isInteger(duration) || duration < 1 || duration > 3650)) { setProblem('La durée doit être un nombre entier de jours entre 1 et 3650.'); return; }
    const values = installmentInputs.map(row => ({ label: row.label.trim(), due_date: row.due_date || null, amount_millimes: parseMillimes(row.amount_tnd) }));
    if (values.some(row => !row.label || row.label.length > 160 || row.amount_millimes == null)) { setProblem('Chaque échéance doit avoir un intitulé et un montant TND valide (3 décimales maximum).'); return; }
    if (values.length > 100) { setProblem('Limite de 100 échéances.'); return; }
    const installments = values as Installment[];
    if (installments.length && terms.payment_mode === 'none') { setProblem('Choisissez d’abord une modalité de paiement indicative.'); return; }
    if (installments.length && totalMillimes != null && installments.reduce((sum, row) => sum + row.amount_millimes, 0) !== totalMillimes) { setProblem('La somme des échéances doit être égale au montant attribué.'); return; }
    if (advanced && schedule.some(row => !!row.start_date !== !!row.end_date)) { setProblem('Pour chaque sous-lot, indiquez le début et la fin, ou aucun des deux.'); return; }
    if (advanced && schedule.some(row => row.start_date && row.end_date && row.end_date < row.start_date)) { setProblem('Pour chaque sous-lot, la fin doit suivre le début.'); return; }
    setProblem('');
    onReview(cleanTerms({ ...terms, installments, ...(!advanced ? { sub_lot_schedule: [] } : {}) }));
  }
  return <Card className="p-5 sm:p-6"><form onSubmit={submit} className="space-y-4" aria-labelledby="terms-form-title" noValidate>
    <div><h2 id="terms-form-title" className="text-lg font-bold text-ink">Votre proposition</h2><p className="mt-1 text-sm text-black/55">Tous les champs sont facultatifs. Le montant attribué ne change pas.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-semibold text-ink">Date de début souhaitée<input type="date" className={field} value={terms.planned_start_date ?? ''} onChange={event => set({ planned_start_date: event.target.value || null })} /></label>
      <label className="block text-sm font-semibold text-ink">Durée des travaux (jours)<input type="number" inputMode="numeric" min={1} max={3650} step={1} className={field} value={terms.duration_days ?? ''} onChange={event => set({ duration_days: event.target.value === '' ? null : Number(event.target.value) })} /></label>
      <label className="block text-sm font-semibold text-ink sm:col-span-2">Modalité de paiement de référence<select className={field} value={terms.payment_mode ?? 'none'} onChange={event => { set({ payment_mode: event.target.value as PaymentMode, installments: [] }); setInstallmentInputs([]); }}>{Object.entries(paymentLabels).filter(([value]) => value !== 'sub_lot' || subLots.length > 0).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <span className="mt-1 block text-xs font-normal text-black/50">Indicative uniquement : aucun paiement n’est déclenché.</span></label>
      <label className="block text-sm font-semibold text-ink sm:col-span-2">Modalités d’exécution<textarea rows={3} maxLength={4000} className={field} value={terms.execution_terms ?? ''} onChange={event => set({ execution_terms: event.target.value })} placeholder="Ex. : accès au chantier de 8 h à 17 h, eau et électricité fournies." /></label>
    </div>
    {terms.payment_mode !== 'none' && <div className="rounded-xl border border-black/[0.08] p-4">
      <button type="button" aria-expanded={showInstallments} onClick={() => setShowInstallments(value => !value)} className="min-h-11 text-sm font-semibold text-teal hover:underline">Échéancier indicatif (optionnel)</button>
      {showInstallments && <div className="mt-3 space-y-3"><p className="text-xs text-black/60">Facultatif. Si vous définissez des échéances chiffrées, leur somme doit correspondre au montant attribué ({totalMillimes != null ? formatTnd(totalMillimes) : 'à vérifier'}). Aucune somme n’est exigible ou payée ici.</p>
        {installmentInputs.map((item, index) => <div key={index} className="grid gap-2 rounded-lg bg-sand/50 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem_auto]">
          <label className="text-xs font-semibold text-ink">Intitulé de l’échéance {index + 1}<input className={field} maxLength={160} value={item.label} onChange={event => changeInstallment(index, { label: event.target.value })} /></label>
          <label className="text-xs font-semibold text-ink">Date indicative {index + 1}<input type="date" className={field} value={item.due_date} onChange={event => changeInstallment(index, { due_date: event.target.value })} /></label>
          <label className="text-xs font-semibold text-ink">Montant (TND) — échéance {index + 1}<input inputMode="decimal" className={field} value={item.amount_tnd} placeholder="125.000" onChange={event => changeInstallment(index, { amount_tnd: event.target.value })} /></label>
          <button type="button" className="min-h-11 self-end text-xs font-semibold text-red-700" onClick={() => setInstallmentInputs(values => values.filter((_, i) => i !== index))}>Supprimer</button>
        </div>)}
        {installmentInputs.length < 100 && <Button type="button" className={secondary} onClick={() => setInstallmentInputs(values => [...values, { label: '', due_date: '', amount_tnd: '' }])}>Ajouter une échéance</Button>}
      </div>}
    </div>}
    {subLots.length > 0 && <>
      <button type="button" aria-expanded={advanced} aria-controls="advanced-terms" onClick={() => setAdvanced(value => !value)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-teal hover:underline">{advanced ? 'Masquer les options avancées' : 'Options avancées'}</button>
      {advanced && <fieldset id="advanced-terms" className="min-w-0 rounded-xl bg-sand/50 p-4"><legend className="sr-only">Calendrier des sous-lots</legend><p className="text-sm font-semibold text-ink">Calendrier des sous-lots de l’offre attribuée</p><div className="mt-2 space-y-3">{subLots.map(sub => <div key={sub.node_key} className="grid gap-2 rounded-xl bg-white p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem] sm:items-end"><p className="min-w-0 break-words text-sm font-medium text-ink">{sub.title}</p>
        <label className="text-xs font-semibold text-black/60">Début<input type="date" aria-label={`Début — ${sub.title}`} className={field} value={subDate(sub.node_key).start_date ?? ''} onChange={event => setSub(sub.node_key, { start_date: event.target.value || null })} /></label>
        <label className="text-xs font-semibold text-black/60">Fin<input type="date" aria-label={`Fin — ${sub.title}`} className={field} value={subDate(sub.node_key).end_date ?? ''} onChange={event => setSub(sub.node_key, { end_date: event.target.value || null })} /></label></div>)}</div></fieldset>}
    </>}
    {problem && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{problem}</p>}
    <div className="grid gap-2 sm:flex"><Button type="submit">Relire avant envoi</Button><Button type="button" className={secondary} onClick={onCancel}>Annuler</Button></div>
  </form></Card>;
}
