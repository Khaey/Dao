'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Clock3, LifeBuoy, MessageCircleQuestion, Plus, RefreshCw } from 'lucide-react';
import { Card } from '../ui';
import TicketThread, { StatusBadge } from './TicketThread';
import {
  createTicket, formatSupportDate, getTicket, LIMITS, listTickets, markTicketRead, openAssistant, supportAvailability, supportCategories,
  SupportUnavailable, ticketCategoryLabels, type SupportAvailability, type SupportMessage, type SupportOrigin, type SupportTicket, type TicketCategory,
} from '../../lib/support-client';

type View = { kind: 'list' } | { kind: 'new' } | { kind: 'ticket'; id: string };
const field = 'mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm text-ink outline-none transition focus:border-teal focus:ring-4 focus:ring-teal/10';

function NewRequest({ origin, onCancel, onCreated }: { origin: SupportOrigin | null; onCancel: () => void; onCreated: (ticket: SupportTicket) => void }) {
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<TicketCategory | ''>('');
  const [body, setBody] = useState('');
  const [shareOrigin, setShareOrigin] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (subject.trim().length < 4 || !category || !body.trim()) { setError('Indiquez un sujet (4 caractères minimum), une catégorie et votre message.'); return; }
    setSending(true); setError('');
    try { onCreated(await createTicket({ subject: subject.trim(), category, body: body.trim(), origin: shareOrigin ? origin : null })); }
    catch (exception) { setError(exception instanceof SupportUnavailable ? 'L’assistance n’est pas encore ouverte : votre demande n’a pas été envoyée.' : (exception as Error).message); }
    finally { setSending(false); }
  }
  return <form onSubmit={submit} className="space-y-4" aria-labelledby="new-request-title">
    <h2 id="new-request-title" className="text-lg font-bold text-ink">Nouvelle demande à D.A.O.</h2>
    <label className="block text-sm font-semibold text-ink">Sujet<input value={subject} onChange={(event) => setSubject(event.target.value)} maxLength={LIMITS.subject} className={field} placeholder="Ex. Je ne retrouve pas mon invitation" /></label>
    <label className="block text-sm font-semibold text-ink">Catégorie<select value={category} onChange={(event) => setCategory(event.target.value as TicketCategory)} className={field}>
      <option value="">Choisir une catégorie</option>{supportCategories.map((value) => <option key={value} value={value}>{ticketCategoryLabels[value]}</option>)}
    </select></label>
    <label className="block text-sm font-semibold text-ink">Votre message<textarea rows={5} value={body} onChange={(event) => setBody(event.target.value)} maxLength={LIMITS.body} className={field} />
      <span className="mt-1 block text-right text-xs font-normal text-black/45">{body.length} / {LIMITS.body}</span></label>
    {origin && <label className="flex min-h-11 items-start gap-3 rounded-xl bg-sand/70 px-3.5 py-3 text-sm text-ink">
      <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-teal" checked={shareOrigin} onChange={(event) => setShareOrigin(event.target.checked)} />
      <span>Indiquer à D.A.O. la page d’où je viens (<span className="font-mono text-xs">{origin.route}</span>). Aucun autre contenu n’est transmis.</span>
    </label>}
    <p className="text-xs text-black/50">N’indiquez ni mot de passe ni information bancaire. Vos échanges privés de chantier ne sont jamais transmis.</p>
    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
      <button type="button" onClick={onCancel} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink hover:border-teal">Annuler</button>
      <button type="submit" disabled={sending} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-white transition hover:bg-teal disabled:opacity-50">{sending ? 'Envoi…' : 'Envoyer la demande'}</button>
    </div>
  </form>;
}

/** « Assistance D.A.O. » tab: real requests when the support API is open, an honest state otherwise. */
export default function SupportPanel({ onShowProjects, origin = null, startNew = false }: { onShowProjects: () => void; origin?: SupportOrigin | null; startNew?: boolean }) {
  const [availability, setAvailability] = useState<SupportAvailability | null>(null);
  const [view, setView] = useState<View>(startNew ? { kind: 'new' } : { kind: 'list' });
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [thread, setThread] = useState<{ ticket: SupportTicket; messages: SupportMessage[] } | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadList = useCallback(async () => {
    setError('');
    try { const page = await listTickets(); setTickets(page.items); setCursor(page.next_cursor); }
    catch (exception) { if (exception instanceof SupportUnavailable) setAvailability({ state: 'unavailable' }); else setError((exception as Error).message); }
  }, []);
  const probe = useCallback(() => {
    setAvailability(null);
    void supportAvailability().then((result) => { setAvailability(result); if (result.state === 'available') void loadList(); });
  }, [loadList]);
  useEffect(() => { probe(); }, [probe]);

  async function openTicket(id: string) {
    setView({ kind: 'ticket', id }); setThread(null); setError('');
    try { const result = await getTicket(id); setThread(result); if (result.ticket.unread_count > 0) void markTicketRead(id).catch(() => undefined); }
    catch (exception) { setError((exception as Error).message); }
  }
  async function more() {
    if (!cursor) return;
    try { const page = await listTickets(cursor); setTickets((current) => [...current, ...page.items]); setCursor(page.next_cursor); }
    catch (exception) { setError((exception as Error).message); }
  }

  if (!availability) return <div aria-busy="true" className="space-y-3"><p role="status" className="sr-only">Chargement de l’assistance…</p><div className="h-40 animate-pulse rounded-2xl bg-black/5" /></div>;

  if (availability.state === 'error') return <Card className="space-y-3 border-red-100">
    <p role="alert" className="text-sm text-red-700">{availability.message}</p>
    <button type="button" onClick={probe} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:border-teal hover:text-teal"><RefreshCw aria-hidden="true" size={16} />Réessayer</button>
  </Card>;

  const helpActions = <div className="flex flex-col gap-2 sm:flex-row">
    <button type="button" onClick={openAssistant} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:border-teal hover:text-teal"><MessageCircleQuestion aria-hidden="true" size={17} />Consulter l’aide</button>
    <button type="button" onClick={onShowProjects} className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-teal transition hover:bg-teal/5">Question sur un chantier ? Voir mes conversations</button>
  </div>;

  if (availability.state === 'unavailable') return <Card className="space-y-5 p-5 sm:p-7">
    <div className="flex items-start gap-4">
      <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal/10 text-teal"><LifeBuoy size={24} /></span>
      <div className="min-w-0 space-y-1.5"><h2 className="text-lg font-bold text-ink">Assistance D.A.O.</h2>
        <p className="text-sm leading-relaxed text-black/60">Bientôt, vous pourrez écrire ici à l’équipe D.A.O., suivre l’état de vos demandes et recevoir ses réponses. Cette fonction n’est pas encore ouverte : aucune demande ne peut être envoyée pour le moment.</p></div>
    </div>
    <p className="flex items-center gap-2 rounded-xl bg-sand/70 px-4 py-3 text-sm text-black/60"><Clock3 aria-hidden="true" size={16} className="shrink-0 text-clay" />En attendant, l’aide en ligne répond aux questions les plus fréquentes.</p>
    {helpActions}
  </Card>;

  return <div className="space-y-4">
    {notice && <p role="status" className="rounded-xl bg-teal/10 px-4 py-3 text-sm font-medium text-teal">{notice}</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {view.kind === 'new' ? <Card className="p-5 sm:p-7"><NewRequest origin={origin} onCancel={() => setView({ kind: 'list' })}
      onCreated={(ticket) => { setNotice(`Demande ${ticket.reference} envoyée. La réponse de D.A.O. apparaîtra dans cette demande.`); void loadList(); void openTicket(ticket.id); }} /></Card>
    : view.kind === 'ticket' ? <Card className="space-y-4 p-5 sm:p-7">
      <button type="button" onClick={() => { setView({ kind: 'list' }); setNotice(''); void loadList(); }} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-black/60 hover:text-teal"><ArrowLeft aria-hidden="true" size={16} />Mes demandes</button>
      {!thread ? <div aria-busy="true" className="h-32 animate-pulse rounded-2xl bg-black/5" /> : <>
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-black/5 pb-4">
          <div className="min-w-0"><p className="text-xs font-semibold text-black/45">{thread.ticket.reference} · {ticketCategoryLabels[thread.ticket.category]}</p>
            <h2 className="mt-1 break-words text-lg font-bold text-ink">{thread.ticket.subject}</h2>
            {thread.ticket.assignee_label && <p className="mt-1 text-xs text-black/50">Suivie par {thread.ticket.assignee_label}</p>}</div>
          <StatusBadge status={thread.ticket.status} />
        </div>
        <TicketThread ticket={thread.ticket} messages={thread.messages} viewer="requester" onSent={() => openTicket(thread.ticket.id)} />
      </>}
    </Card>
    : <Card className="space-y-4 p-5 sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-lg font-bold text-ink">Mes demandes à D.A.O.</h2><p className="text-sm text-black/55">{availability.summary.open > 0 ? `${availability.summary.open} en cours` : 'Aucune demande en cours'}</p></div>
        <button type="button" onClick={() => { setNotice(''); setView({ kind: 'new' }); }} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-ink px-4 text-sm font-semibold text-white transition hover:bg-teal"><Plus aria-hidden="true" size={16} />Nouvelle demande</button>
      </div>
      {tickets.length === 0 ? <p className="rounded-xl border border-dashed border-black/10 px-4 py-8 text-center text-sm text-black/55">Vous n’avez encore envoyé aucune demande.</p>
        : <ul className="divide-y divide-black/5 rounded-xl border border-black/[0.07]">{tickets.map((ticket) => <li key={ticket.id}>
          <button type="button" onClick={() => void openTicket(ticket.id)} className="flex w-full min-h-11 items-start gap-3 px-4 py-3.5 text-left transition hover:bg-sand/50">
            <span className="min-w-0 flex-1"><span className={`block truncate ${ticket.unread_count ? 'font-bold' : 'font-semibold'} text-ink`}>{ticket.subject}</span>
              <span className="mt-0.5 block text-xs text-black/50">{ticket.reference} · {formatSupportDate(ticket.last_message_at)}</span></span>
            <span className="flex shrink-0 flex-col items-end gap-1.5"><StatusBadge status={ticket.status} />
              {ticket.unread_count > 0 && <span className="rounded-full bg-clay px-2 py-0.5 text-xs font-bold text-white" aria-label={`${ticket.unread_count} non lu${ticket.unread_count > 1 ? 's' : ''}`}>{ticket.unread_count}</span>}</span>
          </button></li>)}</ul>}
      {cursor && <button type="button" onClick={() => void more()} className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-black/10 bg-white text-sm font-semibold text-ink hover:border-teal">Voir plus</button>}
      {helpActions}
    </Card>}
  </div>;
}
