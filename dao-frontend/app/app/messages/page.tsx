'use client';

import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { HelpCircle, LifeBuoy, MessageCircle, Search } from 'lucide-react';
import { Card, Input } from '../../../components/ui';
import { projectApi } from '../../../lib/collaboration';
import SupportPanel from '../../../components/support/SupportPanel';
import { originRoute, type SupportOrigin } from '../../../lib/support-client';
import RfiPanel from '../../../components/rfi/RfiPanel';

type Tab = 'chantiers' | 'assistance' | 'rfi';

type Conversation = { id: string; project_title: string; participant_name: string; last_message_at: string | null; last_message: string | null; unread_count: number };

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const initials = (name: string) => name.split(/[\s&.,'’()/-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || '·';

/** « 14:32 » today, « Hier », weekday this week, otherwise a short date. */
function conversationDate(value: string | null) {
  if (!value) return '';
  const date = new Date(value); const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(date.toDateString()).getTime()) / 86400000);
  if (days <= 0) return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'Hier';
  if (days < 7) return date.toLocaleDateString('fr-FR', { weekday: 'long' });
  return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

export default function MessagesPage() {
  const [rows, setRows] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('chantiers');
  const tabRefs = { chantiers: useRef<HTMLButtonElement>(null), assistance: useRef<HTMLButtonElement>(null), rfi: useRef<HTMLButtonElement>(null) };
  const [rfiRequestId,setRfiRequestId]=useState<string|null>(null);
  const [rfiStartNew,setRfiStartNew]=useState(false);
  const [rfiQuestionId,setRfiQuestionId]=useState<string|null>(null);
  // Tab kept in the URL (?onglet=assistance) so links and Back/Forward land on the right view.
  const [supportOrigin, setSupportOrigin] = useState<SupportOrigin | null>(null);
  const [startNew, setStartNew] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested=params.get('onglet');
    if(requested==='rfi'){setTab('rfi');setRfiRequestId(params.get('lot'));setRfiQuestionId(params.get('question'));setRfiStartNew(params.get('nouvelle')==='1');return;}
    if (requested !== 'assistance') return;
    setTab('assistance'); setStartNew(params.get('nouvelle') === '1');
    const route = params.get('origine');
    // Only an internal path chosen by the assistant link; anything else is dropped.
    if (route && /^\/[A-Za-z0-9/_-]{0,159}$/.test(route) && !route.includes('..')) setSupportOrigin({ route: originRoute(route), faq_id: null });
  }, []);
  function selectTab(next: Tab, focus = false) {
    setTab(next);
    const url = new URL(window.location.href);
    if (next === 'assistance'||next==='rfi') url.searchParams.set('onglet', next); else url.searchParams.delete('onglet');
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    if (focus) tabRefs[next].current?.focus();
  }
  function onTabKey(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const order:Tab[]=['chantiers','assistance','rfi'];const index=order.indexOf(tab);selectTab(event.key==='Home'?'chantiers':event.key==='End'?'rfi':order[(index+(event.key==='ArrowRight'?1:order.length-1))%order.length],true);
  }
  useEffect(() => { projectApi<Conversation[]>('/api/messages/conversations').then(setRows).catch((e) => setError(e.message)).finally(() => setLoading(false)); }, []);

  const unread = rows.reduce((sum, row) => sum + Number(row.unread_count || 0), 0);
  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    const sorted = [...rows].sort((a, b) => (b.last_message_at ?? '').localeCompare(a.last_message_at ?? ''));
    return needle ? sorted.filter((row) => normalize(`${row.participant_name} ${row.project_title}`).includes(needle)) : sorted;
  }, [rows, query]);

  return <section className="mx-auto w-full max-w-4xl space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-xs font-bold uppercase tracking-[.16em] text-teal">Communication privée</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Messages & Assistance</h1>
        <p className="mt-2 text-sm text-black/55">Vos échanges de chantier et votre lien avec l’équipe D.A.O.</p>
      </div>
    </div>
    <div role="tablist" aria-label="Type de messages" onKeyDown={onTabKey} className="flex gap-1 rounded-2xl border border-black/[0.06] bg-white p-1">
      {([['chantiers', 'Conversations', MessageCircle], ['assistance', 'Assistance D.A.O.', LifeBuoy], ['rfi','Questions techniques',HelpCircle]] as const).map(([key, label, Icon]) => <button key={key} ref={tabRefs[key]} type="button" role="tab" id={`tab-${key}`}
        aria-selected={tab === key} aria-controls={`panel-${key}`} tabIndex={tab === key ? 0 : -1} onClick={() => selectTab(key)}
        className={`inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-teal/25 ${tab === key ? 'bg-ink text-white' : 'text-black/60 hover:bg-sand hover:text-ink'}`}>
        <Icon aria-hidden="true" size={16} />{label}
        {key === 'chantiers' && unread > 0 && <span className={`rounded-full px-1.5 text-xs font-bold ${tab === key ? 'bg-white text-ink' : 'bg-clay text-white'}`} aria-label={`${unread} non lu${unread > 1 ? 's' : ''}`}>{unread}</span>}
      </button>)}
    </div>
    {tab === 'assistance' ? <div role="tabpanel" id="panel-assistance" aria-labelledby="tab-assistance"><SupportPanel key={startNew ? 'new' : 'list'} origin={supportOrigin} startNew={startNew} onShowProjects={() => selectTab('chantiers', true)} /></div>
    : tab==='rfi'?<div role="tabpanel" id="panel-rfi" aria-labelledby="tab-rfi"><RfiPanel publicationRequestId={rfiRequestId} startNew={rfiStartNew} initialQuestionId={rfiQuestionId}/></div>
    : <div role="tabpanel" id="panel-chantiers" aria-labelledby="tab-chantiers" className="space-y-6">
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {loading ? <div aria-busy="true" className="space-y-3"><p role="status" className="sr-only">Chargement des conversations…</p>{[0, 1, 2].map((key) => <div key={key} className="h-20 animate-pulse rounded-2xl bg-black/5" />)}</div>
      : rows.length === 0 ? <Card className="flex flex-col items-center gap-3 border-dashed px-5 py-14 text-center">
        <span aria-hidden="true" className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal/10 text-teal"><MessageCircle size={24} /></span>
        <h2 className="font-bold">Aucune conversation</h2>
        <p className="max-w-md text-sm text-black/55">Ouvrez un chantier confirmé pour démarrer un échange avec son professionnel.</p>
        <Link href="/app/projects" className="mt-2 inline-flex min-h-11 items-center rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink hover:border-teal hover:text-teal">Mes chantiers</Link>
      </Card>
      : <Card className="overflow-hidden p-0">
        {rows.length > 4 && <div className="border-b border-black/5 p-3 sm:p-4">
          <label htmlFor="conversation-search" className="sr-only">Rechercher une conversation</label>
          <div className="relative"><Search aria-hidden="true" size={17} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-black/40" />
            <Input id="conversation-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} className="min-h-11 pl-10" placeholder="Nom ou chantier…" /></div>
        </div>}
        {visible.length === 0 ? <p className="p-6 text-center text-sm text-black/55">Aucune conversation ne correspond.</p>
          : <ul className="divide-y divide-black/5">{visible.map((row) => {
            const count = Number(row.unread_count || 0);
            return <li key={row.id}><Link href={`/app/messages/${row.id}`} className="flex min-h-11 items-start gap-3 px-4 py-4 transition hover:bg-sand/50 focus-visible:bg-sand/60 focus-visible:outline-none sm:px-5">
              <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal/10 text-sm font-bold text-teal">{initials(row.participant_name)}</span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-3">
                  <span className={`truncate ${count ? 'font-bold text-ink' : 'font-semibold text-ink'}`}>{row.participant_name}</span>
                  <span className={`shrink-0 text-xs ${count ? 'font-semibold text-clay' : 'text-black/45'}`}>{conversationDate(row.last_message_at)}</span>
                </span>
                <span className="mt-0.5 block truncate text-xs font-semibold text-teal">{row.project_title}</span>
                <span className="mt-1 flex items-center justify-between gap-3">
                  <span className={`truncate text-sm ${count ? 'font-medium text-ink' : 'text-black/55'}`}>{row.last_message || 'Conversation ouverte — écrivez votre premier message.'}</span>
                  {count > 0 && <span className="inline-flex min-w-6 shrink-0 justify-center rounded-full bg-clay px-2 py-0.5 text-xs font-bold text-white" aria-label={`${count} non lu${count > 1 ? 's' : ''}`}>{count}</span>}
                </span>
              </span>
            </Link></li>;
          })}</ul>}
      </Card>}
    </div>}
  </section>;
}
