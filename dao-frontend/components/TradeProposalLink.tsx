'use client';
import { useState } from 'react';
import { proposeTrade } from '../lib/settings';

/**
 * « Métier absent ? » (#465) : proposition textuelle envoyée à l'Admin D.A.O. Aucune catégorie
 * publique n'est créée ; en attendant, l'utilisateur choisit le métier le plus proche.
 */
export default function TradeProposalLink({ context }: { context: 'project' | 'profile' }) {
  const [open, setOpen] = useState(false), [label, setLabel] = useState(''), [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok?: string; error?: string }>({});
  async function submit() {
    setBusy(true); setResult({});
    try {
      const response = await proposeTrade(label, context);
      setResult({ ok: response.status === 'exists' ? `« ${response.name} » existe déjà dans la liste : choisissez-le.` : 'Proposition envoyée à D.A.O. En attendant, choisissez le métier le plus proche.' });
      if (response.status !== 'exists') setLabel('');
    } catch (error: any) { setResult({ error: error?.message || 'Proposition impossible.' }); } finally { setBusy(false); }
  }
  if (!open) return <button type="button" className="mt-1 text-left text-xs font-semibold text-teal underline-offset-2 hover:underline" onClick={() => setOpen(true)}>Métier absent de la liste ? Proposer un métier</button>;
  return <div className="mt-2 space-y-2 rounded-xl bg-sand/60 p-3 text-sm">
    <label className="block text-xs font-semibold">Métier à proposer<input aria-label="Métier à proposer" className="mt-1 min-h-11 w-full rounded-xl border border-black/10 bg-white px-3" maxLength={80} value={label}
      onChange={event => setLabel(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); if (label.trim().length >= 2 && !busy) void submit(); } }} placeholder="Ex. Pisciniste" /></label>
    <div className="flex gap-2"><button type="button" disabled={busy || label.trim().length < 2} onClick={() => void submit()} className="min-h-10 rounded-xl bg-teal px-3 text-xs font-semibold text-white hover:bg-tealdark disabled:opacity-50">{busy ? 'Envoi…' : 'Envoyer la proposition'}</button>
      <button type="button" onClick={() => { setOpen(false); setResult({}); }} className="min-h-10 rounded-xl px-3 text-xs font-semibold text-black/60">Fermer</button></div>
    {result.ok && <p role="status" className="text-xs text-teal">{result.ok}</p>}
    {result.error && <p role="alert" className="text-xs text-red-700">{result.error}</p>}
  </div>;
}
