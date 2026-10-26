'use client';

import { FormEvent, useState } from 'react';
import { Send } from 'lucide-react';
import { formatSupportDate, LIMITS, replyToTicket, SupportUnavailable, ticketStatusLabels, staffStatusLabels, type SupportMessage, type SupportTicket, type TicketStatus } from '../../lib/support-client';

const tones: Record<TicketStatus, string> = {
  open: 'bg-teal/10 text-teal', waiting_staff: 'bg-sand text-ink', waiting_user: 'bg-clay/10 text-clay', resolved: 'bg-ink/[0.06] text-ink/70', closed: 'bg-ink/[0.06] text-ink/60',
};
export function StatusBadge({ status, staff = false }: { status: TicketStatus; staff?: boolean }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${tones[status]}`}>{(staff ? staffStatusLabels : ticketStatusLabels)[status]}</span>;
}

/** Conversation of one support request + reply box. Messages are rendered as plain text (untrusted input). */
export default function TicketThread({ ticket, messages, viewer, onSent }: {
  ticket: SupportTicket; messages: SupportMessage[]; viewer: 'requester' | 'staff'; onSent: () => Promise<void> | void;
}) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const closed = ticket.status === 'closed';

  async function send(event: FormEvent) {
    event.preventDefault();
    const text = body.trim();
    if (!text) return;
    setSending(true); setError('');
    try { await replyToTicket(ticket.id, text); setBody(''); await onSent(); }
    catch (exception) { setError(exception instanceof SupportUnavailable ? 'L’assistance est momentanément indisponible. Votre message n’a pas été envoyé.' : (exception as Error).message); }
    finally { setSending(false); }
  }

  return <div className="space-y-4">
    <ol className="space-y-3" aria-label="Messages de la demande">
      {messages.map((message) => {
        const own = message.author_role === viewer;
        if (message.author_role === 'system') return <li key={message.id} className="text-center text-xs text-black/50">{message.body} · {formatSupportDate(message.created_at)}</li>;
        return <li key={message.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}>
          <div className={`max-w-[85%] rounded-2xl px-4 py-3 ${own ? 'bg-ink text-white' : 'border border-black/[0.07] bg-white text-ink'}`}>
            <p className={`text-xs font-semibold ${own ? 'text-white/70' : 'text-black/50'}`}>{message.author_label} · {formatSupportDate(message.created_at)}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>
          </div>
        </li>;
      })}
    </ol>
    {closed ? <p className="rounded-xl bg-sand/70 px-4 py-3 text-sm text-black/60">Cette demande est fermée.{viewer === 'requester' ? ' Pour une nouvelle question, créez une nouvelle demande.' : ''}</p>
      : <form onSubmit={send} className="space-y-2">
        <label htmlFor={`reply-${ticket.id}`} className="block text-sm font-semibold text-ink">Votre réponse</label>
        <textarea id={`reply-${ticket.id}`} rows={3} maxLength={LIMITS.body} value={body} onChange={(event) => setBody(event.target.value)}
          className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm outline-none transition focus:border-teal focus:ring-4 focus:ring-teal/10" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-black/45">{body.length} / {LIMITS.body}</span>
          <button type="submit" disabled={sending || !body.trim()} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-teal px-4 text-sm font-semibold text-white transition hover:bg-tealdark disabled:opacity-50">
            <Send aria-hidden="true" size={16} />{sending ? 'Envoi…' : 'Envoyer la réponse'}
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      </form>}
  </div>;
}
