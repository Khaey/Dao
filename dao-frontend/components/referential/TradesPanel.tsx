'use client';
import { useCallback, useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Button, Input } from '../ui';
import { adminReviewTradeProposal, adminSaveTrade, adminSetTradeActive, fetchTradeProposals, type TradeProposal } from '../../lib/settings';
import type { BtpTrade } from '../../lib/referential';

// Gestion des métiers, déplacée telle quelle depuis Paramètres (#547) : mêmes RPC, mêmes données
// (public.trades, audit setting_events), même ergonomie (recherche, ajout, renommage, activation).
type Props = { trades: BtpTrade[]; onChanged: (m: string) => Promise<void>; onError: (m: string) => void };
export default function TradesPanel(props: Props) {
  return <div className="space-y-4"><TradeEditor {...props} /><TradeList {...props} /></div>;
}

function TradeEditor({ trades, onChanged, onError }: Props) {
  const [name, setName] = useState(''), [reason, setReason] = useState(''), [proposals, setProposals] = useState<TradeProposal[]>([]);
  const [decision, setDecision] = useState<{ id: string; target: string; label: string; reason: string } | null>(null);
  const refresh = useCallback(() => fetchTradeProposals().then(setProposals).catch((e: any) => onError(e.message)), [onError]);
  useEffect(() => { void refresh(); }, [refresh]);
  const active = trades.filter(t => t.active);
  return <div className="space-y-4">
    <form className="flex flex-wrap gap-2 rounded-xl bg-sand/60 p-3" onSubmit={e => { e.preventDefault(); adminSaveTrade(null, name, reason).then(() => { setName(''); setReason(''); return onChanged(`Métier « ${name.trim()} » ajouté.`); }).catch((x: any) => onError(x.message)); }}>
      <Input aria-label="Nouveau métier" placeholder="Nouveau métier" value={name} maxLength={80} onChange={e => setName(e.target.value)} className="flex-1" />
      <Input aria-label="Motif de l’ajout" placeholder="Motif (5 caractères minimum)" value={reason} onChange={e => setReason(e.target.value)} className="flex-1" />
      <Button type="submit" disabled={name.trim().length < 2 || reason.trim().length < 5}>Ajouter</Button></form>
    <section aria-label="Propositions de métiers"><h3 className="text-sm font-bold">Propositions à examiner ({proposals.length})</h3>
      {!proposals.length ? <p className="text-sm text-black/60">Aucune proposition en attente.</p> : <ul className="divide-y divide-black/5">{proposals.map(p => <li key={p.id} className="py-2 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><span><strong>{p.label}</strong> <span className="text-xs text-black/50">· {p.context === 'profile' ? 'profil professionnel' : 'lot de chantier'} · {p.proposer}</span></span>
          <button type="button" className="min-h-10 rounded-xl px-3 font-semibold text-teal" onClick={() => setDecision(decision?.id === p.id ? null : { id: p.id, target: '', label: p.label, reason: '' })}>Examiner</button></div>
        {decision?.id === p.id && <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-semibold">Rattacher à<select aria-label="Rattacher à" className="mt-1 w-full rounded-xl border border-black/10 p-2.5" value={decision.target} onChange={e => setDecision({ ...decision, target: e.target.value })}>
            <option value="">Nouveau métier (nom ci-contre)</option>{active.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label className="text-xs font-semibold">Nom du nouveau métier<Input aria-label="Nom du nouveau métier" disabled={Boolean(decision.target)} value={decision.label} maxLength={80} onChange={e => setDecision({ ...decision, label: e.target.value })} /></label>
          <Input aria-label="Motif de la décision" placeholder="Motif (5 caractères minimum)" value={decision.reason} onChange={e => setDecision({ ...decision, reason: e.target.value })} className="sm:col-span-2" />
          <div className="flex gap-2 sm:col-span-2">
            <Button type="button" disabled={decision.reason.trim().length < 5} onClick={() => adminReviewTradeProposal(p.id, 'accept', decision.target || null, decision.target ? null : decision.label, decision.reason).then(() => { setDecision(null); void refresh(); return onChanged(`Proposition « ${p.label} » acceptée.`); }).catch((x: any) => onError(x.message))}>Accepter</Button>
            <Button type="button" className="bg-white text-red-700 ring-1 ring-red-200 hover:bg-red-50" disabled={decision.reason.trim().length < 5} onClick={() => adminReviewTradeProposal(p.id, 'reject', null, null, decision.reason).then(() => { setDecision(null); void refresh(); return onChanged(`Proposition « ${p.label} » refusée.`); }).catch((x: any) => onError(x.message))}>Refuser</Button></div></div>}</li>)}</ul>}
    </section></div>;
}

function TradeList({ trades, onChanged, onError }: Props) {
  const [editing, setEditing] = useState<string | null>(null), [reason, setReason] = useState(''), [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [filter, setFilter] = useState('');
  const visible = trades.filter(t => t.name.toLowerCase().includes(filter.trim().toLowerCase()));
  return <div className="space-y-2"><label className="flex items-center gap-2 rounded-xl border border-black/10 px-3"><Search size={16} aria-hidden="true" className="text-black/40" /><input aria-label="Rechercher un métier" placeholder={`Rechercher parmi ${trades.length} métiers`} className="min-h-11 flex-1 bg-transparent text-sm outline-none" value={filter} onChange={e => setFilter(e.target.value)} /></label>
  <ul className="divide-y divide-black/5">{visible.map(t => <li key={t.id} className="py-2 text-sm"><div className="flex items-center justify-between gap-2"><span>{t.name}</span><span className="flex gap-1">
    <button type="button" className="min-h-10 rounded-xl px-3 font-semibold text-teal" onClick={() => { setRenaming(renaming?.id === t.id ? null : { id: t.id, name: t.name }); setEditing(null); setReason(''); }}>Renommer</button>
    <button type="button" className={`min-h-10 rounded-xl px-3 font-semibold ${t.active ? 'bg-teal/10 text-teal' : 'bg-black/5 text-black/60'}`} onClick={() => { setEditing(editing === t.id ? null : t.id); setRenaming(null); setReason(''); }}>{t.active ? 'Actif' : 'Inactif'}</button></span></div>
    {renaming?.id === t.id && <div className="mt-2 flex flex-wrap gap-2"><Input aria-label="Nouveau nom" value={renaming.name} maxLength={80} onChange={e => setRenaming({ id: t.id, name: e.target.value })} className="flex-1" /><Input aria-label="Motif" placeholder="Motif (5 caractères minimum)" value={reason} onChange={e => setReason(e.target.value)} className="flex-1" />
      <Button type="button" disabled={reason.trim().length < 5 || renaming.name.trim().length < 2} onClick={() => adminSaveTrade(t.id, renaming.name, reason).then(() => { setRenaming(null); return onChanged(`Métier renommé en « ${renaming.name.trim()} ».`); }).catch((e: any) => onError(e.message))}>Renommer</Button></div>}
    {editing === t.id && <div className="mt-2 flex flex-wrap gap-2"><Input aria-label="Motif" placeholder="Motif (5 caractères minimum)" value={reason} onChange={e => setReason(e.target.value)} className="flex-1" />
      <Button type="button" disabled={reason.trim().length < 5} onClick={() => adminSetTradeActive(t.id, !t.active, reason).then(() => { setEditing(null); return onChanged(`Métier « ${t.name} » ${t.active ? 'désactivé' : 'activé'}.`); }).catch((e: any) => onError(e.message))}>{t.active ? 'Désactiver' : 'Activer'}</Button></div>}</li>)}</ul></div>;
}
