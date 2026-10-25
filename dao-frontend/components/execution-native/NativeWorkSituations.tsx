'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import type { NativeExecutionPlanDTO } from '../../../dao-backend/src/native-tracking/contract';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { cn } from '../../lib/utils';
import { Card, SectionHeading } from '../ui';
import { fromMilli, situationActions, situationEvent, situationStatus, toMilli, type SituationAction, type SituationStatus } from './work-situation-model';

// The plan may carry project-level capabilities (P13 #453); absent fields fall back to the server-scoped workspace.
type Plan = NativeExecutionPlanDTO & Partial<{ canReadWorkSituations: boolean; canComment: boolean }>;
type Lot = NativeExecutionPlanDTO['lots'][number];
type Summary = { id: string; createdAt: string; contractorId: string; periodStart: string; periodEnd: string; status: SituationStatus; revision: number; lineCount: number };
type Line = { lineId: string; awardItemId: string; quoteLineId: string | null; label: string; quantityUnit: string; quantityReportedMilli: string; quantityValidatedMilli: string | null };
type Statement = { lineId: string; previouslyValidatedMilli: string; currentValidatedMilli: string | null; cumulativeValidatedMilli: string | null };
type Detail = Summary & { lines: Line[]; technicalStatement: Statement[] };
type HistoryEvent = { id: string; createdAt: string; actorRole: string; revision: number; kind: string; statusAfter: SituationStatus; note: string | null; payload?: { suggestedLines?: Array<{ line_id?: string; lineId?: string; quantity_milli?: string; quantityValidatedMilli?: string }> } };
type Page<T> = { items: T[]; hasMore: boolean; nextCursor: string | null };
type DraftLine = { lineId: string; awardItemId: string; quoteLineId: string; label: string; unit: string; quantity: string };
type Editor = { mode: 'create' | 'save_draft'; situation: Detail | null; periodStart: string; periodEnd: string; lines: DraftLine[]; key: string };
type Pending = { action: SituationAction; key: string; note: string; quantities: Record<string, string> };

const field = 'mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink';
const button = 'inline-flex min-h-10 items-center justify-center rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50';
const primary = cn(button, 'border-teal bg-teal text-white hover:bg-teal/90');
const roles: Record<string, string> = { client: 'Client', contractor: 'Artisan', manager: 'Gestionnaire' };
const labels: Record<SituationAction, string> = {
  save_draft: 'Modifier le brouillon', submit: 'Soumettre au Client', start_review: 'Démarrer la revue', request_revision: 'Demander une correction',
  validate_technical: 'Valider techniquement les quantités', contest: 'Contester', manager_suggestion: 'Suggérer des quantités', withdraw: 'Retirer la situation',
};
const noteRequired: SituationAction[] = ['request_revision', 'contest'];
const confirmText: Partial<Record<SituationAction, string>> = {
  submit: 'Le Client pourra examiner ces quantités. Vous ne pourrez plus les modifier sauf demande de correction.',
  withdraw: 'La situation sera retirée. Son historique reste consultable.',
  validate_technical: 'Validation technique des quantités uniquement : ce n’est ni une facture, ni un paiement, ni une réception des travaux.',
};
const pretty = (raw: string) => new Date(raw.length === 10 ? raw + 'T00:00:00Z' : raw).toLocaleDateString('fr-TN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const newKey = () => 'ws-' + crypto.randomUUID();

class SituationError extends Error { constructor(public readonly status: number, message: string) { super(message); } }

/** API P12 existante (JWT) : aucun montant, aucune facture, aucun paiement. */
async function situationApi<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new SituationError(401, 'Session expirée. Reconnectez-vous.');
  const response = await fetch('/api/projects/native-execution/work-situations' + path, {
    method: body ? 'POST' : 'GET', cache: 'no-store',
    headers: { Authorization: 'Bearer ' + data.session.access_token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({})) as { data?: T };
  if (response.status === 409) throw new SituationError(409, 'La situation a changé entre-temps : elle a été rechargée, vérifiez puis recommencez.');
  if (response.status === 403) throw new SituationError(403, 'Action ou lecture non autorisée pour votre rôle sur ce chantier.');
  if (response.status === 401) throw new SituationError(401, 'Session expirée. Reconnectez-vous.');
  if (response.status === 400) throw new SituationError(400, 'Saisie incomplète ou invalide : vérifiez les lots, unités et quantités.');
  if (!response.ok || payload.data === undefined) throw new SituationError(503, 'Situations de travaux momentanément indisponibles.');
  return payload.data;
}

export default function NativeWorkSituations({ plan }: { plan: Plan }) {
  const workspace = plan.viewer.workspace;
  const awarded = useMemo(() => plan.lots.filter((lot): lot is Lot & { award: NonNullable<Lot['award']> } => Boolean(lot.award)), [plan.lots]);
  // An Artisan only declares on the lots the server lets them declare progress on.
  const ownLots = workspace === 'contractor' ? awarded.filter(lot => lot.permissions.canDeclareProgress) : [];
  const ownContractorId = ownLots[0]?.award.contractorId ?? null;
  const contractorName = (id: string) => awarded.find(lot => lot.award.contractorId === id)?.award.contractorName || 'Artisan attributaire';
  const lotTitle = (awardItemId: string) => awarded.find(lot => lot.award.awardItemId === awardItemId)?.title || 'Lot attribué';
  const canComment = plan.canComment !== false;

  const [list, setList] = useState<Page<Summary> | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [history, setHistory] = useState<Page<HistoryEvent> | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const loadList = useCallback(async () => {
    const page = await situationApi<Page<Summary>>(`?project_id=${encodeURIComponent(plan.projectId)}&limit=30`);
    setList(page); setPhase('ready');
  }, [plan.projectId]);
  const loadDetail = useCallback(async (id: string) => {
    const [next, events] = await Promise.all([
      situationApi<Detail>(`?situation_id=${encodeURIComponent(id)}`),
      situationApi<Page<HistoryEvent>>(`/events?situation_id=${encodeURIComponent(id)}&limit=30`),
    ]);
    setDetail(next); setHistory(events);
  }, []);

  useEffect(() => {
    if (plan.canReadWorkSituations === false) return;
    setPhase('loading');
    loadList().catch(cause => { setPhase('error'); setError(cause instanceof Error ? cause.message : 'Situations indisponibles.'); });
  }, [loadList, plan.canReadWorkSituations]);

  const groups = useMemo(() => {
    const byContractor = new Map<string, Summary[]>();
    for (const item of list?.items ?? []) byContractor.set(item.contractorId, [...(byContractor.get(item.contractorId) ?? []), item]);
    return [...byContractor.entries()].map(([id, items]) => ({ id, items: [...items].sort((a, b) => b.periodStart.localeCompare(a.periodStart)) }));
  }, [list]);

  if (plan.canReadWorkSituations === false || awarded.length === 0) return null;

  async function open(id: string) {
    if (openId === id) { setOpenId(null); setDetail(null); setHistory(null); return; }
    setOpenId(id); setDetail(null); setHistory(null); setPending(null); setEditor(null); setError('');
    try { await loadDetail(id); } catch (cause) { setOpenId(null); setError(cause instanceof Error ? cause.message : 'Situation indisponible.'); }
  }
  async function more() {
    if (!list?.nextCursor || busy) return;
    setBusy(true);
    try {
      const next = await situationApi<Page<Summary>>(`?project_id=${encodeURIComponent(plan.projectId)}&limit=30&before=${encodeURIComponent(list.nextCursor)}`);
      setList({ ...next, items: [...list.items, ...next.items] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Chargement impossible.'); }
    finally { setBusy(false); }
  }
  async function moreHistory() {
    if (!openId || !history?.nextCursor || busy) return;
    setBusy(true);
    try {
      const next = await situationApi<Page<HistoryEvent>>(`/events?situation_id=${encodeURIComponent(openId)}&limit=30&before=${encodeURIComponent(history.nextCursor)}`);
      setHistory({ ...next, items: [...history.items, ...next.items] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Historique indisponible.'); }
    finally { setBusy(false); }
  }

  // One idempotency key per prepared command, kept across retries; a conflict reloads and drops the stale form.
  async function send(body: Record<string, unknown>, message: string, situationId: string | null) {
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await situationApi<{ situationId: string }>('', body);
      setNotice(message); setPending(null); setEditor(null);
      await loadList();
      const target = situationId ?? result.situationId;
      setOpenId(target); await loadDetail(target);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Commande impossible.');
      if (cause instanceof SituationError && cause.status === 409) {
        setPending(null); setEditor(null);
        await loadList().catch(() => undefined);
        if (situationId) await loadDetail(situationId).catch(() => undefined);
      }
    } finally { setBusy(false); }
  }

  function startCreate() {
    const first = ownLots[0];
    setPending(null); setOpenId(null); setDetail(null); setNotice(''); setError('');
    setEditor({ mode: 'create', situation: null, periodStart: '', periodEnd: '', key: newKey(),
      lines: [{ lineId: crypto.randomUUID(), awardItemId: first.award.awardItemId, quoteLineId: '', label: '', unit: '', quantity: '' }] });
  }
  function startEdit(situation: Detail) {
    setPending(null); setNotice(''); setError('');
    setEditor({ mode: 'save_draft', situation, periodStart: situation.periodStart, periodEnd: situation.periodEnd, key: newKey(),
      lines: situation.lines.map(line => ({ lineId: line.lineId, awardItemId: line.awardItemId, quoteLineId: line.quoteLineId ?? '', label: line.label, unit: line.quantityUnit, quantity: fromMilli(line.quantityReportedMilli) })) });
  }
  const editorLines = editor?.lines.map(line => ({ line, milli: toMilli(line.quantity) })) ?? [];
  const editorValid = Boolean(editor) && editorLines.length > 0 && editorLines.every(({ line, milli }) => milli && line.label.trim() && line.unit.trim() && line.awardItemId)
    && (editor!.mode === 'save_draft' || (editor!.periodStart && editor!.periodEnd && editor!.periodEnd >= editor!.periodStart));
  function submitEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editor || busy || !editorValid) return;
    const lines = editorLines.map(({ line, milli }) => ({ line_id: line.lineId, award_item_id: line.awardItemId, quote_line_id: line.quoteLineId || null,
      label: line.label.trim(), quantity_unit: line.unit.trim(), quantity_reported_milli: milli }));
    if (editor.mode === 'create') void send({ action: 'create', project_id: plan.projectId, contractor_id: ownContractorId, period_start: editor.periodStart, period_end: editor.periodEnd, lines, idempotency_key: editor.key },
      'Brouillon créé. Soumettez-le au Client quand les quantités sont prêtes.', null);
    else void send({ action: 'save_draft', situation_id: editor.situation!.id, lines, expected_revision: editor.situation!.revision, idempotency_key: editor.key },
      'Brouillon enregistré.', editor.situation!.id);
  }
  function updateLine(index: number, patch: Partial<DraftLine>) {
    setEditor(current => current && { ...current, lines: current.lines.map((line, i) => i === index ? { ...line, ...patch } : line) });
  }

  function prepare(action: SituationAction, situation: Detail) {
    if (action === 'save_draft') { startEdit(situation); return; }
    const quantities = action === 'validate_technical' ? Object.fromEntries(situation.lines.map(line => [line.lineId, fromMilli(line.quantityReportedMilli)]))
      : action === 'manager_suggestion' ? Object.fromEntries(situation.lines.map(line => [line.lineId, ''])) : {};
    setEditor(null); setNotice(''); setError('');
    setPending({ action, key: newKey(), note: '', quantities });
  }
  const decisions = (situation: Detail) => pending ? situation.lines.filter(line => pending.action === 'validate_technical' || pending.quantities[line.lineId]?.trim())
    .map(line => ({ line_id: line.lineId, quantity_milli: toMilli(pending.quantities[line.lineId] ?? '', true) })) : [];
  function pendingValid(situation: Detail) {
    if (!pending) return false;
    if (noteRequired.includes(pending.action) && !pending.note.trim()) return false;
    if (pending.action === 'validate_technical' || pending.action === 'manager_suggestion') {
      const rows = decisions(situation);
      return rows.length > 0 && rows.every(row => row.quantity_milli !== null);
    }
    return true;
  }
  function submitPending(event: FormEvent<HTMLFormElement>, situation: Detail) {
    event.preventDefault();
    if (!pending || busy || !pendingValid(situation)) return;
    const withLines = pending.action === 'validate_technical' || pending.action === 'manager_suggestion';
    void send({ action: pending.action, situation_id: situation.id, expected_revision: situation.revision, idempotency_key: pending.key,
      note: pending.note.trim() || null, ...(withLines ? { validated_lines: decisions(situation) } : {}) },
      pending.action === 'manager_suggestion' ? 'Suggestion transmise aux parties ; elle ne modifie pas les quantités.' : 'Action enregistrée dans l’historique.', situation.id);
  }


  const editorForm = editor && <form onSubmit={submitEditor} className="space-y-3 rounded-xl border border-teal/20 bg-teal/[0.03] p-3" aria-label={editor.mode === 'create' ? 'Nouvelle situation de travaux' : 'Modifier le brouillon'}>
    {editor.mode === 'create' ? <div className="grid gap-2 sm:grid-cols-2">
      <label className="block text-xs font-semibold">Début de période<input type="date" className={field} required value={editor.periodStart} disabled={busy} onChange={e => setEditor({ ...editor, periodStart: e.target.value })} /></label>
      <label className="block text-xs font-semibold">Fin de période<input type="date" className={field} required min={editor.periodStart || undefined} value={editor.periodEnd} disabled={busy} onChange={e => setEditor({ ...editor, periodEnd: e.target.value })} /></label>
    </div> : <p className="text-xs text-black/60">Période du {pretty(editor.periodStart)} au {pretty(editor.periodEnd)} (non modifiable).</p>}
    <ul className="space-y-2">{editor.lines.map((line, index) => {
      const lot = ownLots.find(item => item.award.awardItemId === line.awardItemId);
      const quoteLines = (lot?.quantities ?? []).filter(item => item.quoteLineId);
      return <li key={line.lineId} className="grid gap-2 rounded-lg border border-black/10 bg-white p-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.6fr)_6rem_8rem_auto] lg:items-end">
        <label className="block text-xs font-semibold">Lot<select className={field} value={line.awardItemId} disabled={busy} onChange={e => updateLine(index, { awardItemId: e.target.value, quoteLineId: '' })}>
          {ownLots.map(item => <option key={item.award.awardItemId} value={item.award.awardItemId}>{item.title || 'Lot attribué'}</option>)}</select></label>
        <label className="block text-xs font-semibold">Poste du devis — facultatif<select className={field} value={line.quoteLineId} disabled={busy || quoteLines.length === 0}
          onChange={e => { const picked = quoteLines.find(item => item.quoteLineId === e.target.value); updateLine(index, { quoteLineId: e.target.value, unit: picked?.unit ?? line.unit }); }}>
          <option value="">{quoteLines.length ? 'Aucun' : 'Aucun poste quantifié'}</option>
          {quoteLines.map(item => <option key={item.quoteLineId!} value={item.quoteLineId!}>{item.unit} · réalisé déclaré {fromMilli(item.executedMilli)}{item.referenceMilli ? ` / prévu ${fromMilli(item.referenceMilli)}` : ''}</option>)}</select></label>
        <label className="block text-xs font-semibold">Intitulé<input className={field} required maxLength={240} value={line.label} disabled={busy} onChange={e => updateLine(index, { label: e.target.value })} placeholder={line.quoteLineId ? 'Remplacé par l’intitulé du devis' : 'Ex. Pose de carrelage'} /></label>
        <label className="block text-xs font-semibold">Unité<input className={field} required maxLength={40} value={line.unit} disabled={busy || Boolean(line.quoteLineId)} onChange={e => updateLine(index, { unit: e.target.value })} placeholder="m², u…" /></label>
        <label className="block text-xs font-semibold">Quantité déclarée<input className={field} required inputMode="decimal" value={line.quantity} disabled={busy} aria-invalid={line.quantity !== '' && !toMilli(line.quantity)} onChange={e => updateLine(index, { quantity: e.target.value })} placeholder="12,5" /></label>
        <button type="button" className={button} disabled={busy || editor.lines.length === 1} onClick={() => setEditor({ ...editor, lines: editor.lines.filter((_, i) => i !== index) })} aria-label={`Retirer la ligne ${index + 1}`}>Retirer</button>
      </li>;
    })}</ul>
    <p className="text-xs text-black/55">Quantités physiques avec 3 décimales au plus, sans prix ni montant. Une même situation peut couvrir plusieurs de vos lots.</p>
    <div className="flex flex-wrap gap-2">
      <button type="button" className={button} disabled={busy || editor.lines.length >= 100} onClick={() => setEditor({ ...editor, lines: [...editor.lines, { lineId: crypto.randomUUID(), awardItemId: editor.lines.at(-1)?.awardItemId ?? ownLots[0].award.awardItemId, quoteLineId: '', label: '', unit: '', quantity: '' }] })}>Ajouter une ligne</button>
      <button type="submit" className={primary} disabled={busy || !editorValid}>{busy ? 'Enregistrement…' : 'Enregistrer le brouillon'}</button>
      <button type="button" className={button} disabled={busy} onClick={() => setEditor(null)}>Annuler</button>
    </div>
  </form>;

  const detailBlock = (situation: Detail) => {
    const statement = new Map(situation.technicalStatement.map(row => [row.lineId, row]));
    const actions = situationActions(workspace, situation.status, { ownContractor: situation.contractorId === ownContractorId, canComment });
    const withQuantities = pending && (pending.action === 'validate_technical' || pending.action === 'manager_suggestion');
    return <div className="space-y-3 border-t border-black/5 pt-3">
      <div className="overflow-x-auto"><table className="w-full min-w-[36rem] text-left text-xs">
        <thead className="text-black/50"><tr><th className="py-1 pr-2 font-semibold">Lot</th><th className="py-1 pr-2 font-semibold">Intitulé</th><th className="py-1 pr-2 font-semibold">Unité</th>
          <th className="py-1 pr-2 text-right font-semibold">Déclaré</th><th className="py-1 pr-2 text-right font-semibold">Validé</th><th className="py-1 pr-2 text-right font-semibold">Validé avant</th><th className="py-1 text-right font-semibold">Cumul validé</th>
          {withQuantities && <th className="py-1 pl-2 font-semibold">{pending!.action === 'manager_suggestion' ? 'Suggestion' : 'Quantité validée'}</th>}</tr></thead>
        <tbody className="divide-y divide-black/5">{situation.lines.map(line => {
          const row = statement.get(line.lineId);
          return <tr key={line.lineId}><td className="py-1.5 pr-2">{lotTitle(line.awardItemId)}</td><td className="break-words py-1.5 pr-2">{line.label}</td><td className="py-1.5 pr-2">{line.quantityUnit}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{fromMilli(line.quantityReportedMilli)}</td><td className="py-1.5 pr-2 text-right tabular-nums">{fromMilli(line.quantityValidatedMilli)}</td>
            <td className="py-1.5 pr-2 text-right tabular-nums">{fromMilli(row?.previouslyValidatedMilli)}</td><td className="py-1.5 text-right tabular-nums">{fromMilli(row?.cumulativeValidatedMilli)}</td>
            {withQuantities && <td className="py-1.5 pl-2"><input aria-label={`Quantité pour ${line.label}`} inputMode="decimal" className="w-24 rounded-lg border border-black/15 px-2 py-1.5 text-right" value={pending!.quantities[line.lineId] ?? ''} disabled={busy}
              aria-invalid={Boolean(pending!.quantities[line.lineId]) && toMilli(pending!.quantities[line.lineId], true) === null}
              onChange={e => setPending({ ...pending!, quantities: { ...pending!.quantities, [line.lineId]: e.target.value } })} placeholder={pending!.action === 'manager_suggestion' ? '—' : '0'} /></td>}
          </tr>;
        })}</tbody></table></div>
      {actions.length > 0 && !pending && !editor && <div className="flex flex-wrap gap-2">{actions.map(action => <button key={action} type="button" className={action === 'submit' || action === 'validate_technical' ? primary : button} disabled={busy} onClick={() => prepare(action, situation)}>{labels[action]}</button>)}</div>}
      {editor?.situation?.id === situation.id && editorForm}
      {pending && <form onSubmit={event => submitPending(event, situation)} className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs" aria-label={labels[pending.action]}>
        <p className="font-semibold">{labels[pending.action]}</p>
        {confirmText[pending.action] && <p>{confirmText[pending.action]}</p>}
        {pending.action === 'manager_suggestion' && <p>Renseignez seulement les lignes à suggérer. Votre suggestion est tracée et ne remplace pas la décision du Client.</p>}
        {pending.action === 'validate_technical' && <p>Chaque ligne doit avoir une quantité ; 0 est admis.</p>}
        <label className="block font-semibold">{noteRequired.includes(pending.action) ? 'Note (obligatoire)' : 'Note — facultative'}
          <textarea className={field + ' min-h-16'} maxLength={2000} required={noteRequired.includes(pending.action)} value={pending.note} disabled={busy} onChange={e => setPending({ ...pending, note: e.target.value })} /></label>
        <div className="flex flex-wrap gap-2"><button type="submit" className={primary} disabled={busy || !pendingValid(situation)}>{busy ? 'Envoi…' : 'Confirmer'}</button>
          <button type="button" className={button} disabled={busy} onClick={() => setPending(null)}>Annuler</button></div>
      </form>}
      <section aria-label="Historique de la situation" className="space-y-1">
        <h5 className="text-xs font-bold uppercase tracking-wide text-black/50">Historique</h5>
        {history == null ? <p role="status" className="text-xs text-black/55">Chargement…</p>
          : history.items.length === 0 ? <p className="text-xs text-black/55">Aucun événement.</p>
            : <ol className="space-y-1 border-l-2 border-black/10 pl-3 text-xs text-black/70">{history.items.map(item => {
              const suggested = item.kind === 'manager_suggestion' ? item.payload?.suggestedLines ?? [] : [];
              return <li key={item.id}><span className="font-semibold">{pretty(item.createdAt)}</span> · {roles[item.actorRole] ?? 'Participant'} · {situationEvent[item.kind] ?? item.kind} · révision {item.revision}
                {item.note && <span className="block whitespace-pre-wrap break-words">{item.note}</span>}
                {suggested.length > 0 && <span className="block">Suggéré : {suggested.map(row => {
                  const id = row.lineId ?? row.line_id; const qty = row.quantityValidatedMilli ?? row.quantity_milli;
                  const line = situation.lines.find(l => l.lineId === id);
                  return `${line?.label ?? 'ligne'} ${fromMilli(qty)} ${line?.quantityUnit ?? ''}`.trim();
                }).join(' · ')}</span>}
              </li>;
            })}</ol>}
        {history?.hasMore && <button type="button" className={button} disabled={busy} onClick={() => void moreHistory()}>Afficher plus</button>}
      </section>
    </div>;
  };

  return <Card><section className="space-y-4" aria-label="Situations de travaux">
    <SectionHeading title="Situations de travaux" description="Quantités réalisées par période, déclarées par l’Artisan attributaire et validées techniquement par le Client. Ce n’est ni un devis, ni une facture, ni un paiement." />
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-teal/20 bg-teal/[0.04] p-3 text-sm text-teal">{notice}</p>}
    {phase === 'loading' && <div aria-busy="true" className="h-20 animate-pulse rounded-xl bg-black/5" />}
    {phase === 'error' && !list && <button type="button" className={button} onClick={() => { setError(''); setPhase('loading'); loadList().catch(cause => { setPhase('error'); setError(cause instanceof Error ? cause.message : 'Situations indisponibles.'); }); }}>Réessayer</button>}
    {phase === 'ready' && list && <>
      {list.items.length === 0 && <p className="rounded-xl bg-sand p-4 text-sm">Aucune situation de travaux sur ce chantier pour l’instant.{workspace === 'contractor' && ownContractorId ? ' Créez la première pour déclarer les quantités d’une période.' : ''}</p>}
      {groups.map(group => <div key={group.id} className="space-y-2">
        <h4 className="text-sm font-bold text-ink">{contractorName(group.id)}</h4>
        <ul className="space-y-2">{group.items.map(item => <li key={item.id} className="rounded-xl border border-black/10 bg-white p-3 text-sm">
          <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left" aria-expanded={openId === item.id} onClick={() => void open(item.id)}>
            <span className="font-semibold">Du {pretty(item.periodStart)} au {pretty(item.periodEnd)}</span>
            <span className="flex flex-wrap items-center gap-2 text-xs text-black/60"><span>{item.lineCount} ligne{item.lineCount > 1 ? 's' : ''}</span>
              <span className={'rounded-full px-2.5 py-1 font-semibold ' + (item.status === 'validated_technical' ? 'bg-teal/10 text-teal' : item.status === 'contested' || item.status === 'revision_requested' ? 'bg-clay/10 text-clay' : 'bg-sand text-ink')}>{situationStatus[item.status] ?? item.status}</span></span>
          </button>
          {openId === item.id && (detail?.id === item.id ? detailBlock(detail) : <p role="status" className="mt-2 text-xs text-black/55">Chargement…</p>)}
        </li>)}</ul>
      </div>)}
      {list.hasMore && <button type="button" className={button} disabled={busy} onClick={() => void more()}>Afficher plus</button>}
      {workspace === 'contractor' && ownContractorId && !editor && <button type="button" className={button} disabled={busy} onClick={startCreate}>Nouvelle situation de travaux</button>}
      {editor?.mode === 'create' && editorForm}
    </>}
  </section></Card>;
}
