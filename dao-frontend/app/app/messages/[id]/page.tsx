'use client';

import Link from 'next/link';
import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, Lock, Send } from 'lucide-react';
import { Card } from '../../../../components/ui';
import { supabaseBrowser } from '../../../../lib/supabase-browser';

type Message = { id: string; created_at: string; author_id: string; body: string };
type Conversation = { id: string; project_title: string; participant_name: string };
async function api(path: string, init?: RequestInit) {
  const { data } = await supabaseBrowser().auth.getSession(); if (!data.session) throw new Error('Session expirée.');
  const response = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}`, ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Opération refusée.'); return payload.data;
}
const dayLabel = (value: string) => {
  const date = new Date(value); const today = new Date();
  const days = Math.floor((new Date(today.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86400000);
  if (days === 0) return 'Aujourd’hui'; if (days === 1) return 'Hier';
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) });
};
const time = (value: string) => new Date(value).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export default function ThreadPage() {
  const { id } = useParams<{ id: string }>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [userId, setUserId] = useState(''); const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true); const [sending, setSending] = useState(false); const [error, setError] = useState('');
  const end = useRef<HTMLDivElement>(null); const input = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const [rows, session] = await Promise.all([api(`/api/messages?conversation_id=${id}&limit=50`), supabaseBrowser().auth.getSession()]);
      setMessages(rows); setUserId(session.data.session?.user.id || '');
      await api('/api/messages', { method: 'PATCH', body: JSON.stringify({ conversation_id: id }) });
    } catch (e: any) { setError(e.message); } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  // Header context (participant + chantier) from the inbox; optional, the thread works without it.
  useEffect(() => { void api('/api/messages/conversations').then((rows: Conversation[]) => setConversation(rows?.find((row) => row.id === id) ?? null)).catch(() => undefined); }, [id]);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [messages]);
  useEffect(() => { const el = input.current; if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 200)}px`; } }, [body]);

  async function send(event?: FormEvent) {
    event?.preventDefault(); if (!body.trim() || sending) return;
    setSending(true); setError(''); const value = body; setBody('');
    try { await api('/api/messages', { method: 'POST', body: JSON.stringify({ conversation_id: id, body: value, idempotency_key: crypto.randomUUID() }) }); await load(); }
    catch (e: any) { setBody(value); setError(e.message); } finally { setSending(false); input.current?.focus(); }
  }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
  }

  const groups: Array<{ day: string; items: Message[] }> = [];
  for (const message of messages) {
    const day = dayLabel(message.created_at);
    if (groups[groups.length - 1]?.day !== day) groups.push({ day, items: [] });
    groups[groups.length - 1].items.push(message);
  }

  return <section className="mx-auto w-full max-w-4xl space-y-4">
    <div>
      <Link href="/app/messages" className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-black/60 hover:text-teal"><ArrowLeft aria-hidden="true" size={16} />Messages &amp; Assistance</Link>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">{conversation?.participant_name || 'Discussion du chantier'}</h1>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-black/55">
        {conversation?.project_title && <span className="font-semibold text-teal">{conversation.project_title}</span>}
        <span className="inline-flex items-center gap-1"><Lock aria-hidden="true" size={13} />Messages privés, horodatés et conservés dans l’historique.</span>
      </p>
    </div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <Card className="flex h-[calc(100dvh-15rem)] min-h-[420px] flex-col overflow-hidden p-0">
      <div aria-live="polite" className="flex-1 space-y-5 overflow-y-auto bg-[linear-gradient(180deg,rgba(247,245,239,0.55),transparent_120px)] p-4 sm:p-6">
        {loading ? <p role="status" className="text-sm text-black/45">Chargement…</p>
          : messages.length === 0 ? <p className="py-16 text-center text-sm text-black/45">Aucun message. Vous pouvez commencer la discussion.</p>
          : groups.map((group) => <div key={group.day} className="space-y-2">
            <p className="flex items-center gap-3 text-xs font-semibold text-black/40"><span aria-hidden="true" className="h-px flex-1 bg-black/10" /><span className="first-letter:uppercase">{group.day}</span><span aria-hidden="true" className="h-px flex-1 bg-black/10" /></p>
            {group.items.map((message, index) => {
              const mine = message.author_id === userId;
              const grouped = index > 0 && group.items[index - 1].author_id === message.author_id;
              return <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'} ${grouped ? '-mt-1' : ''}`}>
                <div className={`max-w-[85%] px-4 py-2.5 shadow-sm sm:max-w-[70%] ${mine ? 'rounded-2xl rounded-br-md bg-teal text-white' : 'rounded-2xl rounded-bl-md border border-black/5 bg-white text-ink'}`}>
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{message.body}</p>
                  <p className={`mt-1 text-right text-[11px] ${mine ? 'text-white/75' : 'text-black/45'}`}><span className="sr-only">{mine ? 'Vous, ' : ''}</span>{time(message.created_at)}</p>
                </div>
              </div>;
            })}
          </div>)}
        <div ref={end} />
      </div>
      <form onSubmit={(event) => void send(event)} className="border-t border-black/5 bg-white p-3 sm:p-4">
        <label className="sr-only" htmlFor="message-body">Votre message</label>
        <div className="flex items-end gap-2">
          <textarea ref={input} id="message-body" aria-label="Votre message" aria-describedby="message-hint" maxLength={4000} rows={1}
            className="max-h-[200px] min-h-11 flex-1 resize-none rounded-2xl border border-black/10 bg-sand/40 px-4 py-3 text-sm outline-none transition focus:border-teal focus:bg-white focus:ring-4 focus:ring-teal/10"
            placeholder="Écrire un message…" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKey} />
          <button type="submit" disabled={sending || !body.trim()} aria-label="Envoyer le message"
            className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-full bg-ink px-3 text-sm font-semibold text-white transition hover:bg-teal focus:outline-none focus:ring-4 focus:ring-teal/20 disabled:cursor-not-allowed disabled:opacity-40 sm:px-5">
            <Send aria-hidden="true" size={17} /><span className="hidden sm:inline">Envoyer</span>
          </button>
        </div>
        <p id="message-hint" className="mt-2 flex justify-between gap-3 text-xs text-black/40"><span className="hidden sm:inline">Entrée pour envoyer · Maj + Entrée pour aller à la ligne</span><span className="ml-auto tabular-nums">{body.length}/4000</span></p>
      </form>
    </Card>
  </section>;
}
