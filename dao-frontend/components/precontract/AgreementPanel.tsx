'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDashed, FileText, History, RefreshCw, ShieldAlert } from 'lucide-react';
import { Badge, Button, Card } from '../ui';
import { formatTnd } from '../../lib/contracts';
import {
  acceptVersion, emptyTerms, eventLabels, partyLabel, paymentLabels, PrecontractUnavailable, readAgreement, rejectVersion, saveDraft, sendVersion, termsDiff,
  type Agreement, type AgreementVersion, type PartyRole, type PaymentFrequency, type Terms,
} from '../../lib/precontract';

const field = 'mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm text-ink outline-none transition focus:border-teal focus:ring-4 focus:ring-teal/10 disabled:bg-sand/60';
const secondary = 'bg-white text-ink ring-1 ring-black/10 hover:bg-sand';
const other = (role: PartyRole): PartyRole => role === 'client' ? 'contractor' : 'client';
const fmtDate = (value: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'long' }).format(new Date(`${value}T00:00:00`)) : 'Non précisée';
const fmtStamp = (value: string) => new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const shortHash = (hash: string) => hash.slice(0, 12);

type Phase = 'loading' | 'ready' | 'unavailable' | 'error';

/** « Conditions et calendrier » — optional pre-contract agreement on one exact award (#346, backend #345). */
export default function AgreementPanel({ awardId }: { awardId: string }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [agreement, setAgreement] = useState<Agreement | null>(null);
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'accept' | 'reject' | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try { setAgreement(await readAgreement(awardId)); setPhase('ready'); }
    catch (exception) {
      if (exception instanceof PrecontractUnavailable) setPhase('unavailable');
      else { setLoadError((exception as Error).message); setPhase('error'); }
    }
  }, [awardId]);
  useEffect(() => { setPhase('loading'); void load(); }, [load]);

  async function run(operation: () => Promise<Agreement>, success: string) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(''); setNotice('');
    try { setAgreement(await operation()); setNotice(success); setConfirm(null); setReason(''); setEditing(false); }
    catch (exception) {
      setError((exception as Error).message);
      if ((exception as { code?: string }).code === 'version_conflict') { setConfirm(null); await load(); }
    } finally { busyRef.current = false; setBusy(false); }
  }

  if (phase === 'loading') return <div aria-busy="true" className="space-y-3"><p role="status" className="sr-only">Chargement des conditions…</p><div className="h-36 animate-pulse rounded-2xl bg-black/5" /><div className="h-56 animate-pulse rounded-2xl bg-black/5" /></div>;
  if (phase === 'unavailable') return <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:p-7">
    <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal/10 text-teal"><CalendarClock size={24} /></span>
    <div className="space-y-2"><h2 className="text-lg font-bold text-ink">Accord sur les conditions bientôt disponible</h2>
      <p className="text-sm text-black/60">Vous pourrez ici convenir avec l’autre partie, avant le contrat, d’une date de début, d’une durée et de modalités de référence. Ce service n’est pas encore ouvert : aucune action n’est possible pour l’instant et rien n’est requis pour continuer votre chantier.</p>
      <Button type="button" className={`gap-2 ${secondary}`} onClick={() => { setPhase('loading'); void load(); }}><RefreshCw aria-hidden="true" size={16} />Vérifier à nouveau</Button></div>
  </Card>;
  if (phase === 'error' || !agreement) return <Card className="space-y-3 p-5 sm:p-7"><h2 className="text-lg font-bold text-ink">Conditions indisponibles</h2><p role="alert" className="text-sm text-red-700">{loadError || 'Ces conditions ne peuvent pas être affichées.'}</p><Button type="button" className={`gap-2 ${secondary}`} onClick={() => { setPhase('loading'); void load(); }}><RefreshCw aria-hidden="true" size={16} />Réessayer</Button></Card>;

  const me = agreement.viewer_role, them = other(me);
  const current = agreement.current;
  const agreed = agreement.agreed_version_id ? agreement.versions.find(version => version.id === agreement.agreed_version_id) ?? null : null;
  const previous = current ? agreement.versions.filter(version => version.version_no < current.version_no && version.status !== 'draft').sort((a, b) => b.version_no - a.version_no)[0] ?? null : null;
  const accepted = (version: AgreementVersion, role: PartyRole) => version.acceptances.find(row => row.party_role === role);
  const headline = agreed ? { tone: 'teal' as const, text: `Accord commun sur la version ${agreed.version_no}` }
    : !current ? { tone: 'neutral' as const, text: 'Aucune condition proposée' }
    : current.status === 'rejected' ? { tone: 'red' as const, text: `Proposition refusée par ${current.rejection ? partyLabel[current.rejection.party_role] : 'l’autre partie'}` }
    : current.author_role === me ? { tone: 'clay' as const, text: `En attente de la réponse ${me === 'client' ? 'de l’Artisan' : 'du Client'}` }
    : { tone: 'clay' as const, text: `${partyLabel[them]} vous propose la version ${current.version_no}` };

  return <div className="space-y-5">
    <Card className="space-y-4 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1"><p className="text-xs font-bold uppercase tracking-[0.14em] text-teal">Avant le contrat · facultatif</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-ink sm:text-3xl">Conditions et calendrier</h1>
          <p className="mt-1 text-sm text-black/55">Vous êtes {me === 'client' ? 'le Client' : 'l’Artisan attributaire'}. Les deux parties doivent accepter exactement la même version.</p></div>
        <Badge tone={headline.tone}>{headline.text}</Badge>
      </div>
      <ul className="divide-y divide-black/5 rounded-xl bg-sand/60 px-4">{agreement.lots.map(lot => <li key={lot.request_id} className="flex flex-wrap items-baseline justify-between gap-2 py-3"><span className="min-w-0 break-words font-semibold text-ink">{lot.title}</span><span className="text-sm tabular-nums text-black/70">{formatTnd(lot.agreed_millimes)}</span></li>)}</ul>
      <p className="text-xs text-black/50">Montant attribué de référence : <strong className="text-ink">{formatTnd(agreement.total_millimes)}</strong>. Il n’est jamais modifié par ces conditions.{agreement.lots.length > 1 ? ' Les lots d’un même package restent indivisibles.' : ''}</p>
      <p className="flex items-start gap-2 rounded-xl border border-clay/20 bg-clay/[0.06] px-3 py-2.5 text-sm text-black/70"><ShieldAlert aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-clay" /><span><strong className="text-ink">Non signé — aucun effet juridique.</strong> Accepter des conditions n’est pas signer le contrat et ne modifie pas l’offre attribuée.</span></p>
      {agreement.contract_id && <Link href={`/app/contracts/${agreement.contract_id}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-teal hover:underline"><FileText aria-hidden="true" size={16} />Voir le dossier contractuel (non signé)</Link>}
    </Card>

    {error && <p role="alert" className="flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle aria-hidden="true" size={16} className="mt-0.5 shrink-0" />{error}</p>}
    {notice && <p role="status" className="flex items-start gap-2 rounded-xl bg-teal/[0.08] px-4 py-3 text-sm font-medium text-teal"><CheckCircle2 aria-hidden="true" size={16} className="mt-0.5 shrink-0" />{notice}</p>}

    {agreed && <Card className="flex items-start gap-3 border-teal/25 bg-teal/[0.04] p-5"><CheckCircle2 aria-hidden="true" size={22} className="shrink-0 text-teal" /><div><h2 className="font-bold text-ink">Le Client et l’Artisan ont accepté la version {agreed.version_no}</h2><p className="mt-1 text-sm text-black/60">Cette version (empreinte {shortHash(agreed.content_hash)}) pourra être annexée en lecture seule au dossier contractuel. Une nouvelle proposition demanderait de nouveaux accords.</p></div></Card>}

    {current && !editing && <Card className="space-y-4 p-5 sm:p-6" aria-labelledby="current-version-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="current-version-title" className="text-lg font-bold text-ink">Version {current.version_no} — proposée par {current.author_role === me ? 'vous' : partyLabel[current.author_role] === 'Client' ? 'le Client' : 'l’Artisan'}</h2><span className="text-xs text-black/50">{fmtStamp(current.created_at)} · empreinte {shortHash(current.content_hash)}</span></div>
      <TermsSummary terms={current.terms} agreement={agreement} />
      {previous && <Diff before={previous.terms} after={current.terms} title={`Ce qui change par rapport à la version ${previous.version_no}`} />}
      <div className="flex flex-wrap gap-2" aria-label="Accords sur cette version">{(['client', 'contractor'] as PartyRole[]).map(role => { const row = accepted(current, role); return <span key={role} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${row ? 'bg-teal/10 text-teal' : 'bg-black/[0.05] text-black/55'}`}>{row ? <CheckCircle2 aria-hidden="true" size={13} /> : <CircleDashed aria-hidden="true" size={13} />}Accord {partyLabel[role]} : {row ? `donné le ${fmtStamp(row.accepted_at)}` : 'en attente'}</span>; })}</div>
      {current.rejection && <p className="rounded-xl bg-red-50 px-3 py-2.5 text-sm text-red-800">Motif du refus ({partyLabel[current.rejection.party_role]}) : {current.rejection.reason}</p>}

      {confirm === 'accept' ? <div role="group" aria-label="Confirmer votre accord" className="space-y-3 rounded-xl border border-teal/25 bg-teal/[0.04] p-4">
        <p className="text-sm text-ink">Vous acceptez exactement la version {current.version_no} (empreinte {shortHash(current.content_hash)}). Ce n’est pas une signature : le contrat reste non signé.</p>
        <div className="grid gap-2 sm:flex"><Button type="button" disabled={busy} onClick={() => void run(() => acceptVersion(agreement.award_id, current), `Votre accord sur la version ${current.version_no} est enregistré.`)}>{busy ? 'Enregistrement…' : 'Confirmer mon accord'}</Button><Button type="button" disabled={busy} className={secondary} onClick={() => setConfirm(null)}>Annuler</Button></div>
      </div>
      : confirm === 'reject' ? <div role="group" aria-label="Refuser cette proposition" className="space-y-3 rounded-xl border border-red-200 bg-red-50/60 p-4">
        <label className="block text-sm font-semibold text-ink">Motif du refus<textarea rows={3} maxLength={1000} className={field} value={reason} disabled={busy} onChange={event => setReason(event.target.value)} placeholder="Ex. : la date de début ne convient pas, je propose plutôt…" /></label>
        <p className="text-xs text-black/50">Le motif est transmis {them === 'client' ? 'au Client' : 'à l’Artisan'}. Vous pourrez ensuite proposer une autre version.</p>
        <div className="grid gap-2 sm:flex"><Button type="button" disabled={busy || !reason.trim()} className="bg-red-700 hover:bg-red-800" onClick={() => void run(() => rejectVersion(agreement.award_id, current.id, reason.trim()), 'Refus envoyé avec votre motif.')}>{busy ? 'Envoi…' : 'Confirmer le refus'}</Button><Button type="button" disabled={busy} className={secondary} onClick={() => { setConfirm(null); setReason(''); }}>Annuler</Button></div>
      </div>
      : (agreement.can.accept || agreement.can.reject || agreement.can.save_draft) && <div className="grid gap-2 border-t border-black/5 pt-4 sm:flex sm:flex-wrap">
        {agreement.can.accept && <Button type="button" disabled={busy} onClick={() => setConfirm('accept')}>Accepter la version {current.version_no}</Button>}
        {agreement.can.save_draft && !agreement.draft && <Button type="button" disabled={busy} className={secondary} onClick={() => setEditing(true)}>Proposer une modification</Button>}
        {agreement.can.reject && <Button type="button" disabled={busy} className="bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50" onClick={() => setConfirm('reject')}>Refuser</Button>}
      </div>}
      {!agreement.can.accept && !agreement.can.reject && !agreement.can.save_draft && !agreed && <p className="text-sm text-black/55">Aucune action n’est disponible pour vous sur cette version.</p>}
    </Card>}

    {agreement.draft && !editing && <Card className="space-y-4 border-dashed p-5 sm:p-6" aria-labelledby="draft-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 id="draft-title" className="text-lg font-bold text-ink">Votre brouillon — non envoyé</h2><span className="text-xs text-black/50">Visible par vous seul · {fmtStamp(agreement.draft.created_at)}</span></div>
      <TermsSummary terms={agreement.draft.terms} agreement={agreement} />
      <Diff before={current?.terms ?? null} after={agreement.draft.terms} title={current ? `Différences avec la version ${current.version_no}` : 'Votre proposition'} />
      <div className="grid gap-2 sm:flex">
        {agreement.can.send && <Button type="button" disabled={busy} onClick={() => void run(() => sendVersion(agreement.award_id, agreement.draft!.id), `Proposition envoyée ${them === 'client' ? 'au Client' : 'à l’Artisan'}.`)}>{busy ? 'Envoi…' : `Envoyer ${them === 'client' ? 'au Client' : 'à l’Artisan'}`}</Button>}
        {agreement.can.save_draft && <Button type="button" disabled={busy} className={secondary} onClick={() => setEditing(true)}>Modifier le brouillon</Button>}
      </div>
    </Card>}

    {!current && !agreement.draft && !editing && <Card className="space-y-3 p-5 sm:p-6">
      <h2 className="text-lg font-bold text-ink">Aucune condition proposée</h2>
      <p className="text-sm text-black/60">Rien n’est obligatoire : sans accord ici, le dossier contractuel reprend simplement l’offre attribuée. Vous pouvez proposer une date, une durée et une modalité de paiement de référence en quelques secondes.</p>
      {agreement.can.save_draft ? <Button type="button" onClick={() => setEditing(true)}>Proposer des conditions</Button> : <p className="text-sm text-black/50">Aucune action n’est disponible pour vous.</p>}
    </Card>}

    {editing && <TermsForm agreement={agreement} busy={busy} initial={agreement.draft?.terms ?? current?.terms ?? emptyTerms()} onCancel={() => setEditing(false)}
      onSave={terms => void run(() => saveDraft(agreement.award_id, current?.id ?? null, terms), 'Brouillon enregistré. Relisez-le puis envoyez-le.')} />}

    {agreement.events.length > 0 && <details className="group rounded-2xl border border-black/5 bg-white p-5">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 font-semibold text-ink"><History aria-hidden="true" size={17} className="text-teal" />Historique ({agreement.events.length})<span aria-hidden="true" className="ml-auto text-black/40 group-open:rotate-90">›</span></summary>
      <ol className="mt-3 space-y-2">{[...agreement.events].sort((a, b) => b.created_at.localeCompare(a.created_at)).map(event => <li key={event.id} className="rounded-xl bg-sand/60 px-3 py-2.5 text-sm"><p className="font-semibold text-ink">{eventLabels[event.type] ?? 'Événement'}{event.version_no ? ` · version ${event.version_no}` : ''}</p><p className="text-xs text-black/55">{event.actor_role === 'dao' ? 'D.A.O' : partyLabel[event.actor_role]} · {fmtStamp(event.created_at)}</p>{event.reason && <p className="mt-1 text-black/70">Motif : {event.reason}</p>}</li>)}</ol>
    </details>}
  </div>;
}

function TermsSummary({ terms, agreement }: { terms: Terms; agreement: Agreement }) {
  const subLots = agreement.lots.flatMap(lot => lot.sub_lots);
  const rows: [string, string][] = [
    ['Début', fmtDate(terms.start_date)],
    ['Durée', terms.duration_days ? `${terms.duration_days} jour${terms.duration_days > 1 ? 's' : ''}` : 'Non précisée'],
    ...(terms.end_date ? [['Fin', fmtDate(terms.end_date)] as [string, string]] : []),
    ['Paiement de référence', paymentLabels[terms.payment.frequency]],
  ];
  return <div className="space-y-3">
    <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{rows.map(([label, value]) => <div key={label} className="rounded-xl bg-sand/60 px-3 py-2.5"><dt className="text-xs text-black/50">{label}</dt><dd className="mt-0.5 font-semibold text-ink">{value}</dd></div>)}</dl>
    {terms.payment.note && <p className="text-sm text-black/65"><span className="font-semibold text-ink">Précision sur le paiement : </span>{terms.payment.note}</p>}
    {terms.conditions && <p className="whitespace-pre-wrap break-words text-sm text-black/70"><span className="font-semibold text-ink">Conditions essentielles : </span>{terms.conditions}</p>}
    {terms.mode === 'advanced' && terms.sub_lots.length > 0 && <div><p className="text-sm font-semibold text-ink">Calendrier des sous-lots</p><ul className="mt-1 space-y-1 text-sm text-black/65">{terms.sub_lots.map(row => <li key={row.sub_lot_id}>{subLots.find(sub => sub.id === row.sub_lot_id)?.title ?? 'Sous-lot'} : {fmtDate(row.start_date)} → {fmtDate(row.end_date)}</li>)}</ul></div>}
    <p className="text-xs text-black/45">Modalité de paiement indicative : aucun montant n’est exigible et aucun paiement n’est effectué via D.A.O.</p>
  </div>;
}

function Diff({ before, after, title }: { before: Terms | null; after: Terms; title: string }) {
  const rows = termsDiff(before, after);
  if (!rows.length) return <p className="text-sm text-black/50">Aucun changement par rapport à la version précédente.</p>;
  const sensitive = rows.some(row => row.sensitive);
  return <section className="rounded-xl border border-black/[0.08] p-4" aria-label={title}>
    <h3 className="text-sm font-bold text-ink">{title}</h3>
    {sensitive && <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-clay"><AlertTriangle aria-hidden="true" size={13} />Dates ou modalités modifiées : relisez attentivement.</p>}
    <dl className="mt-3 space-y-2">{rows.map(row => <div key={row.label} className="grid gap-1 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]"><dt className="font-semibold text-ink">{row.label}</dt><dd className="min-w-0 break-words"><span className="text-black/45 line-through decoration-black/30">{row.before}</span><span aria-hidden="true" className="mx-1.5 text-black/35">→</span><span className="sr-only"> devient </span><span className="font-semibold text-ink">{row.after}</span></dd></div>)}</dl>
  </section>;
}

function TermsForm({ agreement, initial, busy, onSave, onCancel }: { agreement: Agreement; initial: Terms; busy: boolean; onSave: (terms: Terms) => void; onCancel: () => void }) {
  const [terms, setTerms] = useState<Terms>(initial);
  const [advanced, setAdvanced] = useState(initial.mode === 'advanced');
  const [problem, setProblem] = useState('');
  const subLots = agreement.lots.flatMap(lot => lot.sub_lots);
  const set = (patch: Partial<Terms>) => setTerms(current => ({ ...current, ...patch }));
  const subDate = (id: string) => terms.sub_lots.find(row => row.sub_lot_id === id) ?? { sub_lot_id: id, start_date: null, end_date: null };
  const setSub = (id: string, patch: { start_date?: string | null; end_date?: string | null }) => set({ sub_lots: [...terms.sub_lots.filter(row => row.sub_lot_id !== id), { ...subDate(id), ...patch }] });
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const duration = terms.duration_days;
    if (duration != null && (!Number.isInteger(duration) || duration < 1 || duration > 3650)) { setProblem('La durée doit être un nombre entier de jours entre 1 et 3650.'); return; }
    if (terms.start_date && terms.end_date && terms.end_date < terms.start_date) { setProblem('La date de fin doit suivre la date de début.'); return; }
    if (terms.sub_lots.some(row => row.start_date && row.end_date && row.end_date < row.start_date)) { setProblem('Pour chaque sous-lot, la fin doit suivre le début.'); return; }
    setProblem('');
    const clean: Terms = advanced
      ? { ...terms, mode: 'advanced', conditions: terms.conditions?.trim() || null, payment: { ...terms.payment, note: terms.payment.note?.trim() || null }, sub_lots: terms.sub_lots.filter(row => row.start_date || row.end_date) }
      : { ...terms, mode: 'simple', end_date: null, conditions: terms.conditions?.trim() || null, payment: { frequency: terms.payment.frequency, note: null }, sub_lots: [] };
    onSave(clean);
  }
  return <Card className="p-5 sm:p-6"><form onSubmit={submit} className="space-y-4" aria-labelledby="terms-form-title" noValidate>
    <div><h2 id="terms-form-title" className="text-lg font-bold text-ink">Votre proposition</h2><p className="mt-1 text-sm text-black/55">Tous les champs sont facultatifs. Le montant attribué ne change pas.</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-semibold text-ink">Date de début souhaitée<input type="date" className={field} value={terms.start_date ?? ''} disabled={busy} onChange={event => set({ start_date: event.target.value || null })} /></label>
      <label className="block text-sm font-semibold text-ink">Durée des travaux (jours)<input type="number" inputMode="numeric" min={1} max={3650} step={1} className={field} value={terms.duration_days ?? ''} disabled={busy} onChange={event => set({ duration_days: event.target.value === '' ? null : Number(event.target.value) })} /></label>
      <label className="block text-sm font-semibold text-ink sm:col-span-2">Modalité de paiement de référence<select className={field} value={terms.payment.frequency} disabled={busy} onChange={event => set({ payment: { ...terms.payment, frequency: event.target.value as PaymentFrequency } })}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <span className="mt-1 block text-xs font-normal text-black/50">Indicative uniquement : aucun paiement n’est déclenché.</span></label>
      <label className="block text-sm font-semibold text-ink sm:col-span-2">Conditions essentielles<textarea rows={3} maxLength={2000} className={field} value={terms.conditions ?? ''} disabled={busy} onChange={event => set({ conditions: event.target.value })} placeholder="Ex. : accès au chantier de 8 h à 17 h, eau et électricité fournies." /></label>
    </div>
    <button type="button" aria-expanded={advanced} aria-controls="advanced-terms" onClick={() => setAdvanced(value => !value)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-teal hover:underline">{advanced ? 'Masquer les options avancées' : 'Options avancées'}</button>
    {advanced && <div id="advanced-terms" className="grid gap-4 rounded-xl bg-sand/50 p-4 sm:grid-cols-2">
      <label className="block text-sm font-semibold text-ink">Date de fin souhaitée<input type="date" className={field} value={terms.end_date ?? ''} disabled={busy} onChange={event => set({ end_date: event.target.value || null })} /></label>
      <label className="block text-sm font-semibold text-ink">Précision sur le paiement<input type="text" maxLength={500} className={field} value={terms.payment.note ?? ''} disabled={busy} onChange={event => set({ payment: { ...terms.payment, note: event.target.value } })} placeholder="Ex. : à chaque fin de sous-lot" /></label>
      {subLots.length > 0 ? <fieldset className="min-w-0 sm:col-span-2"><legend className="text-sm font-semibold text-ink">Calendrier des sous-lots</legend><div className="mt-2 space-y-3">{subLots.map(sub => <div key={sub.id} className="grid gap-2 rounded-xl bg-white p-3 sm:grid-cols-[minmax(0,1fr)_10rem_10rem] sm:items-end"><p className="min-w-0 break-words text-sm font-medium text-ink">{sub.title}</p>
        <label className="text-xs font-semibold text-black/60">Début<input type="date" aria-label={`Début — ${sub.title}`} className={field} value={subDate(sub.id).start_date ?? ''} disabled={busy} onChange={event => setSub(sub.id, { start_date: event.target.value || null })} /></label>
        <label className="text-xs font-semibold text-black/60">Fin<input type="date" aria-label={`Fin — ${sub.title}`} className={field} value={subDate(sub.id).end_date ?? ''} disabled={busy} onChange={event => setSub(sub.id, { end_date: event.target.value || null })} /></label></div>)}</div></fieldset>
        : <p className="text-sm text-black/50 sm:col-span-2">Aucun sous-lot dans l’offre attribuée : un calendrier global suffit.</p>}
    </div>}
    {problem && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{problem}</p>}
    <div className="grid gap-2 sm:flex"><Button type="submit" disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer le brouillon'}</Button><Button type="button" disabled={busy} className={secondary} onClick={onCancel}>Annuler</Button></div>
  </form></Card>;
}
