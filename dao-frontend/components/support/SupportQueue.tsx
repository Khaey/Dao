'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, Inbox, LifeBuoy, RefreshCw, UserCheck } from 'lucide-react';
import { Card } from '../ui';
import TicketThread, { StatusBadge } from './TicketThread';
import {
  assignToMe, formatSupportDate, getTicket, LIMITS, listQueue, markTicketRead, setTicketStatus, staffStatusLabels, supportStatuses, SupportUnavailable,
  ticketCategoryLabels, type QueueFilter, type SupportMessage, type SupportTicket, type TicketStatus,
} from '../../lib/support-client';

const select = 'min-h-11 rounded-xl border border-black/10 bg-white px-3 text-sm text-ink outline-none transition focus:border-teal focus:ring-4 focus:ring-teal/10';
const assigneeLabels: Record<NonNullable<QueueFilter['assignee']>, string> = { all: 'Toutes', me: 'Attribuées à moi', unassigned: 'Non attribuées' };

function StatusForm({ ticket, onChanged }: { ticket: SupportTicket; onChanged: () => Promise<void> }) {
  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [reason, setReason] = useState('');
  // Follow server-side status changes (e.g. after a reply) without discarding a change the staff member started.
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setStatus(ticket.status); }, [ticket.status]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const needsReason = status === 'resolved' || status === 'closed';
  async function save(event: FormEvent) {
    event.preventDefault();
    if (needsReason && reason.trim().length < 4) { setError('Un motif (4 caractères minimum) est obligatoire pour résoudre ou fermer.'); return; }
    setSaving(true); setError('');
    try { await setTicketStatus(ticket.id, status, reason.trim() || null); setReason(''); dirty.current = false; await onChanged(); }
    catch (exception) { setError((exception as Error).message); } finally { setSaving(false); }
  }
  return <form onSubmit={save} className="space-y-3 rounded-2xl bg-sand/60 p-4" aria-label="Statut de la demande">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <label className="block flex-1 text-sm font-semibold text-ink">Statut<select value={status} onChange={(event) => { dirty.current = true; setStatus(event.target.value as TicketStatus); }} className={`${select} mt-1.5 w-full`}>
        {supportStatuses.map((value) => <option key={value} value={value}>{staffStatusLabels[value]}</option>)}</select></label>
      <button type="submit" disabled={saving || (status === ticket.status && !needsReason)} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ink px-4 text-sm font-semibold text-white transition hover:bg-teal disabled:opacity-50">{saving ? 'Enregistrement…' : 'Mettre à jour'}</button>
    </div>
    {needsReason && <label className="block text-sm font-semibold text-ink">Motif (visible par le demandeur)<textarea rows={2} maxLength={LIMITS.reason} value={reason} onChange={(event) => { dirty.current = true; setReason(event.target.value); }}
      className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm outline-none focus:border-teal focus:ring-4 focus:ring-teal/10" /></label>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </form>;
}

/** Staff support queue (dao_reviewer / dao_admin). Shows support requests only — never project conversations. */
export default function SupportQueue() {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [filter, setFilter] = useState<{ status: TicketStatus | ''; assignee: NonNullable<QueueFilter['assignee']> }>({ status: '', assignee: 'all' });
  const [items, setItems] = useState<SupportTicket[]>([]);
  const [total, setTotal] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ ticket: SupportTicket; messages: SupportMessage[] } | null>(null);
  const [error, setError] = useState('');
  const deepLinkOpened = useRef(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const page = await listQueue({ status: filter.status || null, assignee: filter.assignee });
      setItems(page.items); setTotal(page.total); setCursor(page.next_cursor); setState('ready');
    } catch (exception) {
      if (exception instanceof SupportUnavailable) setState('unavailable'); else { setError((exception as Error).message); setState('ready'); }
    }
  }, [filter]);
  useEffect(() => { setState('loading'); void load(); }, [load]);

  async function open(id: string) {
    setError('');
    try {
      const detail = await getTicket(id);
      setSelected(detail);
      // Per-staff receipt: reading as one reviewer must not mark an admin's
      // notification read. The server checks ticket access on every operation.
      try { await markTicketRead(id); void load(); }
      catch { setError('La lecture n’a pas pu être enregistrée. Réessayez en rouvrant la demande.'); }
    } catch (exception) { setError((exception as Error).message); }
  }

  useEffect(() => {
    if (deepLinkOpened.current) return;
    deepLinkOpened.current = true;
    const id = new URLSearchParams(window.location.search).get('ticket');
    if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) void open(id);
  }, [load]);
  async function refreshSelected() { if (selected) { await open(selected.ticket.id); void load(); } }
  async function claim() {
    if (!selected) return;
    try { await assignToMe(selected.ticket.id); await refreshSelected(); } catch (exception) { setError((exception as Error).message); }
  }
  async function more() {
    if (!cursor) return;
    try { const page = await listQueue({ status: filter.status || null, assignee: filter.assignee, cursor }); setItems((current) => [...current, ...page.items]); setCursor(page.next_cursor); }
    catch (exception) { setError((exception as Error).message); }
  }

  return <section className="mx-auto w-full max-w-5xl space-y-6">
    <header className="space-y-2">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Relations</p>
      <h1 className="text-3xl font-bold tracking-tight text-ink">Assistance</h1>
      <p className="max-w-2xl text-sm text-black/55">Demandes adressées à D.A.O. par les clients et les professionnels. Les conversations privées de chantier n’apparaissent jamais ici.</p>
    </header>
    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {state === 'loading' && <div aria-busy="true" className="space-y-3"><span className="sr-only">Chargement des demandes…</span>{[0, 1, 2].map((key) => <div key={key} className="h-20 animate-pulse rounded-2xl bg-black/5" />)}</div>}
    {state === 'unavailable' && <Card className="flex items-start gap-4 p-5 sm:p-7">
      <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal/10 text-teal"><LifeBuoy size={24} /></span>
      <div className="space-y-2"><h2 className="text-lg font-bold text-ink">File d’assistance pas encore ouverte</h2>
        <p className="text-sm text-black/60">Le service d’assistance n’est pas encore déployé sur cet environnement : aucune demande ne peut être reçue pour le moment.</p>
        <button type="button" onClick={() => { setState('loading'); void load(); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink hover:border-teal"><RefreshCw aria-hidden="true" size={16} />Vérifier à nouveau</button></div>
    </Card>}
    {state === 'ready' && (selected ? <Card className="space-y-5 p-5 sm:p-7">
      <button type="button" onClick={() => setSelected(null)} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-black/60 hover:text-teal"><ArrowLeft aria-hidden="true" size={16} />File d’assistance</button>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/5 pb-4">
        <div className="min-w-0"><p className="text-xs font-semibold text-black/45">{selected.ticket.reference} · {ticketCategoryLabels[selected.ticket.category]}{selected.ticket.requester_label ? ` · ${selected.ticket.requester_label}` : ''}</p>
          <h2 className="mt-1 break-words text-lg font-bold text-ink">{selected.ticket.subject}</h2>
          <p className="mt-1 text-xs text-black/50">{selected.ticket.assignee_label ? `Attribuée à ${selected.ticket.assignee_label}` : 'Non attribuée'}</p></div>
        <div className="flex flex-wrap items-center gap-2"><StatusBadge status={selected.ticket.status} staff />
          {!selected.ticket.assignee_label && <button type="button" onClick={() => void claim()} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink hover:border-teal hover:text-teal"><UserCheck aria-hidden="true" size={16} />Me l’attribuer</button>}</div>
      </div>
      <TicketThread ticket={selected.ticket} messages={selected.messages} viewer="staff" onSent={refreshSelected} />
      <StatusForm key={selected.ticket.id} ticket={selected.ticket} onChanged={refreshSelected} />
    </Card> : <>
      <div className="flex flex-col gap-2 sm:flex-row" role="group" aria-label="Filtres">
        <label><span className="sr-only">Statut</span><select aria-label="Statut" value={filter.status} onChange={(event) => setFilter((current) => ({ ...current, status: event.target.value as TicketStatus | '' }))} className={`${select} w-full sm:w-56`}>
          <option value="">Tous les statuts</option>{supportStatuses.map((value) => <option key={value} value={value}>{staffStatusLabels[value]}</option>)}</select></label>
        <label><span className="sr-only">Attribution</span><select aria-label="Attribution" value={filter.assignee} onChange={(event) => setFilter((current) => ({ ...current, assignee: event.target.value as NonNullable<QueueFilter['assignee']> }))} className={`${select} w-full sm:w-56`}>
          {Object.entries(assigneeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {items.length === 0 ? <Card className="flex items-center gap-3 border-dashed text-sm text-black/60"><Inbox aria-hidden="true" size={20} className="text-black/35" />Aucune demande dans cette file.</Card>
        : <Card className="overflow-hidden p-0"><p className="border-b border-black/5 px-4 py-3 text-sm text-black/55 sm:px-5" aria-live="polite">{items.length} sur {total}</p>
          <ul className="divide-y divide-black/5">{items.map((ticket) => <li key={ticket.id}>
            <button type="button" onClick={() => void open(ticket.id)} className="flex w-full min-h-11 items-start gap-3 px-4 py-3.5 text-left transition hover:bg-sand/50 sm:px-5">
              <span className="min-w-0 flex-1"><span className={`block truncate ${ticket.unread_count ? 'font-bold' : 'font-semibold'} text-ink`}>{ticket.subject}</span>
                <span className="mt-0.5 block truncate text-xs text-black/50">{ticket.reference} · {ticket.requester_label ?? 'Demandeur'} · {formatSupportDate(ticket.last_message_at)}{ticket.assignee_label ? ` · ${ticket.assignee_label}` : ' · non attribuée'}</span></span>
              <span className="flex shrink-0 flex-col items-end gap-1.5"><StatusBadge status={ticket.status} staff />
                {ticket.unread_count > 0 && <span className="rounded-full bg-clay px-2 py-0.5 text-xs font-bold text-white" aria-label={`${ticket.unread_count} non lu${ticket.unread_count > 1 ? 's' : ''}`}>{ticket.unread_count}</span>}</span>
            </button></li>)}</ul>
          {cursor && <div className="border-t border-black/5 p-3"><button type="button" onClick={() => void more()} className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-black/10 bg-white text-sm font-semibold text-ink hover:border-teal">Voir plus</button></div>}
        </Card>}
    </>)}
  </section>;
}
