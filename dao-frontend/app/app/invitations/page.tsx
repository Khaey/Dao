'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, HardHat, Inbox, Layers, UserRound } from 'lucide-react';
import { supabaseBrowser } from '../../../lib/supabase-browser';
import { Badge, Card } from '../../../components/ui';

type Invitation = {
  id: string; project_id: string; expected_role: 'client' | 'contractor'; recipient_name: string | null; status: string;
  created_at: string; expires_at: string; project_title: string; principal_request_id: string | null; lot_title: string | null;
};
const labels: Record<string, string> = { pending: 'À traiter', accepted: 'Acceptée', declined: 'Refusée', revoked: 'Révoquée', expired: 'Expirée' };
const tones: Record<string, 'neutral' | 'teal' | 'clay' | 'red'> = { pending: 'clay', accepted: 'teal', declined: 'neutral', revoked: 'red', expired: 'red' };
const DAY = 86400000;
const formatDay = (value: string) => new Date(value).toLocaleDateString('fr-TN', { day: 'numeric', month: 'long', year: 'numeric' });

function expiryHint(expiresAt: string) {
  const left = new Date(expiresAt).getTime() - Date.now();
  if (left <= 0) return { text: 'Délai dépassé', urgent: true };
  const days = Math.ceil(left / DAY);
  if (days <= 1) return { text: 'Expire aujourd’hui', urgent: true };
  return { text: `Expire dans ${days} jours`, urgent: days <= 3 };
}

// Structure kept for E2E: heading → text block → row that also holds the status badge and the actions.
function InvitationCard({ row, busy, onRespond }: { row: Invitation; busy: boolean; onRespond: (row: Invitation, accept: boolean) => void }) {
  const pending = row.status === 'pending';
  const expiry = pending ? expiryHint(row.expires_at) : null;
  const RoleIcon = row.expected_role === 'contractor' ? HardHat : UserRound;
  return <Card className={pending ? 'border-clay/20 sm:p-6' : 'sm:p-6'}>
    <div className="flex flex-wrap items-start gap-4 sm:flex-nowrap sm:items-center">
      <span aria-hidden="true" className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${pending ? 'bg-clay/10 text-clay' : 'bg-sand text-black/45'}`}><RoleIcon size={22} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap gap-2"><Badge tone={tones[row.status] ?? 'neutral'}>{labels[row.status] ?? row.status}</Badge><Badge>{row.expected_role === 'contractor' ? 'Invitation artisan' : 'Invitation client'}</Badge></div>
        <h3 className="mt-2.5 break-words text-lg font-bold tracking-tight text-ink">{row.project_title}</h3>
        <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-black/55">
          {row.lot_title && <span className="inline-flex items-center gap-1.5"><Layers aria-hidden="true" size={14} />Lot : {row.lot_title}</span>}
          <span>Reçue le {formatDay(row.created_at)}</span>
          {expiry ? <span className={`inline-flex items-center gap-1.5 font-medium ${expiry.urgent ? 'text-red-700' : ''}`}><CalendarClock aria-hidden="true" size={14} />{expiry.text}</span>
            : <span>Échéance : {formatDay(row.expires_at)}</span>}
        </div>
      </div>
      {pending ? <div className="flex w-full shrink-0 gap-2 sm:w-auto">
        <button type="button" disabled={busy} onClick={() => onRespond(row, false)}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-black/70 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700 focus:outline-none focus:ring-4 focus:ring-red-100 disabled:opacity-50 sm:flex-none">Refuser</button>
        <button type="button" disabled={busy} onClick={() => onRespond(row, true)}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-ink px-5 text-sm font-semibold text-white transition hover:bg-teal focus:outline-none focus:ring-4 focus:ring-teal/20 disabled:opacity-50 sm:flex-none">Accepter</button>
      </div> : row.status === 'accepted' ? <Link href={`/app/projects/${row.project_id}`}
        className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 rounded-xl border border-black/10 bg-white px-4 text-sm font-semibold text-ink transition hover:border-teal hover:text-teal sm:w-auto">Voir le chantier<ArrowRight aria-hidden="true" size={15} /></Link> : null}
    </div>
  </Card>;
}

export default function Invitations() {
  const [rows, setRows] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function load() {
    const { data, error: rpcError } = await supabaseBrowser().rpc('my_project_invitations');
    if (rpcError) setError('Impossible de charger vos invitations.'); else setRows((data ?? []) as Invitation[]);
    setLoading(false);
  }
  useEffect(() => { void load(); }, []);
  const pending = useMemo(() => rows.filter(r => r.status === 'pending').sort((a, b) => a.expires_at.localeCompare(b.expires_at)), [rows]);
  const history = useMemo(() => rows.filter(r => r.status !== 'pending'), [rows]);
  async function respond(row: Invitation, accept: boolean) {
    setBusy(row.id); setError(''); setMessage('');
    const { data, error: rpcError } = await supabaseBrowser().rpc('respond_my_project_invitation', { p_invitation_id: row.id, p_accept: accept });
    if (rpcError) setError(rpcError.message || 'Cette invitation ne peut plus être traitée.');
    else {
      setMessage(accept ? 'Invitation acceptée. Le chantier est maintenant disponible.' : 'Invitation refusée.');
      await load();
      if (accept && data) window.location.assign(`/app/projects/${data}`);
    }
    setBusy('');
  }

  return <section className="mx-auto w-full max-w-4xl space-y-8">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">Mon compte</p>
        <h1 className="text-3xl font-bold tracking-tight text-ink">Mes invitations</h1>
        <p className="max-w-2xl text-sm text-black/55">Les invitations à rejoindre un chantier, envoyées à l’adresse confirmée de votre compte.</p>
      </div>
      {!loading && pending.length > 0 && <p className="rounded-full bg-clay/10 px-3.5 py-1.5 text-sm font-semibold text-clay">{pending.length} en attente</p>}
    </header>
    {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-teal/10 px-4 py-3 text-sm font-medium text-teal">{message}</p>}
    {loading ? <div aria-label="Chargement de vos invitations" aria-busy="true" className="space-y-3">
      {[0, 1].map(i => <div key={i} className="h-28 animate-pulse rounded-2xl bg-black/5" />)}
    </div> : <>
      <div className="space-y-3">
        <h2 className="text-lg font-bold text-ink">À traiter</h2>
        {pending.length ? pending.map(row => <InvitationCard key={row.id} row={row} busy={busy === row.id} onRespond={(r, a) => void respond(r, a)} />)
          : <Card className="flex flex-col items-center gap-2 border-dashed py-10 text-center">
            <Inbox aria-hidden="true" size={26} className="text-black/25" />
            <p className="font-semibold text-ink">Aucune invitation en attente</p>
            <p className="max-w-sm text-sm text-black/55">Quand un client ou un professionnel vous invite sur un chantier, l’invitation apparaît ici.</p>
            <Link href="/app/projects" className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-teal">Mes chantiers<ArrowRight aria-hidden="true" size={15} /></Link>
          </Card>}
      </div>
      {history.length > 0 && <div className="space-y-3">
        <h2 className="text-lg font-bold text-ink">Historique</h2>
        {history.map(row => <InvitationCard key={row.id} row={row} busy={false} onRespond={() => undefined} />)}
      </div>}
    </>}
  </section>;
}
