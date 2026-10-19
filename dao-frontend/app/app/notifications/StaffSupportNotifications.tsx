'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Bell, ArrowUpRight, RefreshCw } from 'lucide-react';
import { Card } from '../../../components/ui';
import { formatSupportDate, listQueue, staffStatusLabels, supportAvailability, type SupportTicket } from '../../../lib/support-client';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Staff-only presentation. Authorization and data scoping stay server-side in support_queue. */
export default function StaffSupportNotifications() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [page, availability] = await Promise.all([
        listQueue({ assignee: 'all' }),
        supportAvailability(),
      ]);
      setTickets(page.items);
      setCursor(page.next_cursor);
      if (availability.state !== 'available') throw new Error('Le compteur des demandes est indisponible.');
      setUnread(availability.summary.unread);
    } catch {
      setError('Impossible de charger les demandes d’assistance. Réessayez.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [load]);

  async function loadMore() {
    if (!cursor || moreLoading) return;
    setMoreLoading(true);
    setError('');
    try {
      const result = await listQueue({ assignee: 'all', cursor });
      setTickets(existing => [...existing, ...result.items].filter((ticket, i, all) => all.findIndex(t => t.id === ticket.id) === i));
      setCursor(result.next_cursor);
    } catch {
      setError('Impossible de charger la suite des demandes.');
    } finally {
      setMoreLoading(false);
    }
  }

  const visible = unreadOnly ? tickets.filter(ticket => ticket.unread_count > 0) : tickets;
  return <section className="mx-auto w-full max-w-4xl space-y-6" aria-labelledby="staff-notifications-title">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.16em] text-teal">Espace D.A.O.</p>
        <h1 id="staff-notifications-title" className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Notifications d’assistance</h1>
        <p className="mt-2 max-w-xl text-sm text-black/60">Nouvelles demandes et réponses des clients ou professionnels à traiter. Aucun message privé de chantier n’apparaît ici.</p>
      </div>
      <button type="button" aria-label="Actualiser les notifications" disabled={loading} onClick={() => void load()}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-teal disabled:opacity-50">
        <RefreshCw size={17} aria-hidden="true" />Actualiser
      </button>
    </div>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Filtrer les notifications" className="inline-flex rounded-xl border border-black/5 bg-white p-1">
        <button type="button" onClick={() => setUnreadOnly(false)} aria-pressed={!unreadOnly}
          className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${!unreadOnly ? 'bg-teal text-white' : 'text-black/60'}`}>Récentes</button>
        <button type="button" onClick={() => setUnreadOnly(true)} aria-pressed={unreadOnly}
          className={`min-h-11 rounded-lg px-4 text-sm font-semibold ${unreadOnly ? 'bg-teal text-white' : 'text-black/60'}`}>Non lues</button>
      </div>
      <span aria-label={`${unread} demandes d'assistance non lues`} className="rounded-full bg-teal/10 px-3 py-2 text-sm font-semibold text-teal">
        {unread} non lue{unread === 1 ? '' : 's'}
      </span>
    </div>
    {error && <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error} <button type="button" onClick={() => void load()} className="font-bold underline">Réessayer</button></div>}
    {loading && tickets.length === 0
      ? <div aria-busy="true" className="rounded-xl bg-white p-6 text-sm">Chargement des notifications…</div>
      : visible.length === 0
        ? <Card className="flex flex-col items-center gap-3 border-dashed px-5 py-12 text-center">
            <Bell size={28} aria-hidden="true" className="text-teal" />
            <h2 className="text-lg font-bold">{unreadOnly ? 'Aucune demande non lue dans cette page' : 'Aucune demande d’assistance'}</h2>
            <p className="text-sm text-black/60">{cursor && unreadOnly ? 'D’autres demandes peuvent figurer sur les pages suivantes.' : 'Les demandes autorisées apparaîtront ici.'}</p>
          </Card>
        : <Card className="overflow-hidden p-0"><ul className="divide-y divide-black/5" aria-label="Notifications d’assistance">
          {visible.map(ticket => <li key={ticket.id} className={`px-4 py-4 sm:px-6 ${ticket.unread_count > 0 ? 'bg-teal/[.035]' : ''}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs text-black/50">{ticket.reference} · {formatSupportDate(ticket.last_message_at)}</p>
                <h2 className="mt-1 break-words font-bold">{ticket.subject}</h2>
                <p className="mt-1 text-sm text-black/60">{staffStatusLabels[ticket.status]} · {ticket.assignee_label ? `Attribuée à ${ticket.assignee_label}` : 'Non attribuée'}</p>
                {ticket.unread_count > 0 && <span className="mt-2 inline-block rounded-full bg-teal/10 px-2 py-1 text-xs font-bold text-teal">Nouveau message</span>}
              </div>
              {uuid.test(ticket.id) && <Link href={`/app/dao/support?ticket=${encodeURIComponent(ticket.id)}`}
                className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-black/10 bg-white px-3 text-sm font-semibold text-teal">
                Consulter <ArrowUpRight size={15} aria-hidden="true" />
              </Link>}
            </div>
          </li>)}
        </ul></Card>}
    {cursor && <button type="button" disabled={moreLoading || loading} onClick={() => void loadMore()}
      className="min-h-11 w-full rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-teal disabled:opacity-50">
      {moreLoading ? 'Chargement…' : 'Voir les demandes plus anciennes'}
    </button>}
    <p className="text-xs text-black/50">Le compteur comprend toutes les demandes pertinentes non lues ; la liste est paginée. Une demande est marquée lue lorsque vous ouvrez son fil.</p>
  </section>;
}
