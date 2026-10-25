'use client';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Input } from '../ui';
import { useTargets } from './useTargets';
import { SETTINGS_CATALOG, adminDelegationCommand, fetchAdminDelegations, scopeLabels, settingLabel, type Delegations } from '../../lib/settings';

const delegable = SETTINGS_CATALOG.filter(d => d.delegable && d.family === 'capability' && d.implemented);
const actionLabels: Record<string, string> = { restrict: 'Restreindre', lift_own_restriction: 'Lever ses propres restrictions' };
const field = 'mt-1 w-full rounded-xl border border-black/10 p-3';

// A1/A2/A8: a Gestionnaire acts only through a dated Admin mandate, on its portfolio
// accounts or assigned chantiers. Revocation keeps the history.
export default function AdminDelegations({ onStatus }: { onStatus: (m: string) => void }) {
  const { targets } = useTargets();
  const [data, setData] = useState<Delegations | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [grant, setGrant] = useState({ staff: '', keys: [] as string[], actions: ['restrict'], scopes: ['account', 'project'], until: '', reason: '' });
  const [assign, setAssign] = useState({ staff: '', account: '', reason: '' });
  const [revoke, setRevoke] = useState<{ action: 'revoke_mandate' | 'unassign_account'; id: string; label: string } | null>(null), [revokeReason, setRevokeReason] = useState('');
  const load = useCallback(async () => { try { setData(await fetchAdminDelegations()); } catch (e: any) { setError(e.message); } }, []);
  useEffect(() => { void load(); }, [load]);
  async function run(action: Parameters<typeof adminDelegationCommand>[0], input: Record<string, unknown>, done: string) {
    setBusy(true); setError('');
    try { await adminDelegationCommand(action, input); onStatus(done); await load(); return true; }
    catch (e: any) { setError(e.message || 'Action refusée.'); return false; } finally { setBusy(false); }
  }
  const toggle = (list: string[], v: string) => list.includes(v) ? list.filter(x => x !== v) : [...list, v];
  if (!data) return error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p className="text-sm text-black/60">Chargement…</p>;
  const mandates = data.mandates.filter(m => m.live), past = data.mandates.filter(m => !m.live);
  return <div className="space-y-4">
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <Card className="space-y-3"><h2 className="font-bold">Confier un mandat à un Gestionnaire</h2>
      <p className="text-sm text-black/60">Sans mandat, un Gestionnaire n’a aucun droit sur les paramètres. Il ne peut que restreindre, jamais ouvrir, pour 90 jours au plus, sur son portefeuille ou ses chantiers affectés.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Gestionnaire<select className={field} value={grant.staff} onChange={e => setGrant({ ...grant, staff: e.target.value })}>
          <option value="">Choisir…</option>{data.managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className="text-sm font-semibold">Fin du mandat (obligatoire)<Input type="date" value={grant.until} onChange={e => setGrant({ ...grant, until: e.target.value })} className="mt-1" /></label>
        <fieldset className="text-sm sm:col-span-2"><legend className="font-semibold">Fonctions confiées</legend><div className="mt-1 flex flex-wrap gap-3">{delegable.map(d =>
          <label key={d.key} className="flex items-center gap-2"><input type="checkbox" checked={grant.keys.includes(d.key)} onChange={() => setGrant({ ...grant, keys: toggle(grant.keys, d.key) })} />{d.label}</label>)}</div></fieldset>
        <fieldset className="text-sm"><legend className="font-semibold">Actions</legend><div className="mt-1 flex flex-wrap gap-3">{Object.entries(actionLabels).map(([a, l]) =>
          <label key={a} className="flex items-center gap-2"><input type="checkbox" checked={grant.actions.includes(a)} onChange={() => setGrant({ ...grant, actions: toggle(grant.actions, a) })} />{l}</label>)}</div></fieldset>
        <fieldset className="text-sm"><legend className="font-semibold">Portées</legend><div className="mt-1 flex flex-wrap gap-3">{['account', 'project'].map(s =>
          <label key={s} className="flex items-center gap-2"><input type="checkbox" checked={grant.scopes.includes(s)} onChange={() => setGrant({ ...grant, scopes: toggle(grant.scopes, s) })} />{scopeLabels[s]}</label>)}</div></fieldset>
        <label className="text-sm font-semibold sm:col-span-2">Motif (obligatoire)<Input value={grant.reason} maxLength={500} onChange={e => setGrant({ ...grant, reason: e.target.value })} className="mt-1" /></label>
      </div>
      <Button type="button" disabled={busy || !grant.staff || !grant.keys.length || !grant.actions.length || !grant.scopes.length || !grant.until || grant.reason.trim().length < 5}
        onClick={() => void run('grant_mandate', { staff_user_id: grant.staff, keys: grant.keys, actions: grant.actions, scopes: grant.scopes,
          valid_until: new Date(`${grant.until}T23:59:59`).toISOString(), reason: grant.reason }, 'Mandat accordé et historisé.').then(ok => ok && setGrant({ ...grant, keys: [], reason: '' }))}>Accorder le mandat</Button></Card>

    <Card><h2 className="font-bold">Mandats actifs ({mandates.length})</h2>{!mandates.length ? <p className="mt-2 text-sm text-black/60">Aucun mandat actif.</p> :
      <ul className="mt-3 divide-y divide-black/5">{mandates.map(m => <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div>
        <p className="font-semibold">{m.staff_label ?? 'Gestionnaire'} · {m.keys.map(settingLabel).join(', ')}</p>
        <p className="text-xs text-black/50">{m.actions.map(a => actionLabels[a]).join(' + ')} · {m.scopes.map(s => scopeLabels[s]).join(', ')} · jusqu’au {new Date(m.valid_until).toLocaleDateString('fr-FR')} · {m.reason}</p></div>
        <button type="button" className="min-h-10 rounded-xl px-3 font-semibold text-red-700" onClick={() => { setRevoke({ action: 'revoke_mandate', id: m.id, label: `mandat de ${m.staff_label ?? 'Gestionnaire'}` }); setRevokeReason(''); }}>Révoquer</button></li>)}</ul>}
      {past.length > 0 && <p className="mt-3 text-xs text-black/45">{past.length} mandat(s) expiré(s) ou révoqué(s) conservé(s) dans l’historique.</p>}</Card>

    <Card className="space-y-3"><h2 className="font-bold">Portefeuille de comptes</h2>
      <p className="text-sm text-black/60">Comptes Client ou Artisan suivis par un Gestionnaire, en plus des chantiers qui lui sont affectés.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm font-semibold">Gestionnaire<select className={field} value={assign.staff} onChange={e => setAssign({ ...assign, staff: e.target.value })}>
          <option value="">Choisir…</option>{data.managers.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></label>
        <label className="text-sm font-semibold">Compte<select className={field} value={assign.account} onChange={e => setAssign({ ...assign, account: e.target.value })}>
          <option value="">Choisir…</option>{targets?.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
        <label className="text-sm font-semibold">Motif<Input value={assign.reason} maxLength={500} onChange={e => setAssign({ ...assign, reason: e.target.value })} className="mt-1" /></label></div>
      <Button type="button" disabled={busy || !assign.staff || !assign.account || assign.reason.trim().length < 5}
        onClick={() => void run('assign_account', { staff_user_id: assign.staff, account_user_id: assign.account, reason: assign.reason }, 'Compte ajouté au portefeuille.').then(ok => ok && setAssign({ ...assign, account: '', reason: '' }))}>Ajouter au portefeuille</Button>
      {data.portfolio.length > 0 && <ul className="divide-y divide-black/5">{data.portfolio.map(p => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
        <span>{p.staff_label ?? 'Gestionnaire'} → <strong>{p.account_label ?? 'Compte'}</strong> <Badge>{new Date(p.created_at).toLocaleDateString('fr-FR')}</Badge></span>
        <button type="button" className="min-h-10 rounded-xl px-3 font-semibold text-teal" onClick={() => { setRevoke({ action: 'unassign_account', id: p.id, label: `${p.account_label ?? 'compte'} du portefeuille` }); setRevokeReason(''); }}>Retirer</button></li>)}</ul>}</Card>

    {revoke && <Card className="space-y-3 border-red-200"><h2 className="font-bold">Confirmer : retirer {revoke.label}</h2>
      <p className="text-sm text-black/60">Effet immédiat pour les nouvelles actions du Gestionnaire. Les restrictions déjà posées restent visibles dans Exceptions jusqu’à leur échéance.</p>
      <Input aria-label="Motif" placeholder="Motif (5 caractères minimum)" value={revokeReason} onChange={e => setRevokeReason(e.target.value)} />
      <div className="flex gap-2"><Button type="button" disabled={busy || revokeReason.trim().length < 5} onClick={() => void run(revoke.action, { id: revoke.id, reason: revokeReason }, 'Délégation retirée.').then(ok => ok && setRevoke(null))}>Confirmer</Button>
        <button type="button" className="min-h-10 rounded-xl px-4 text-sm font-semibold" onClick={() => setRevoke(null)}>Annuler</button></div></Card>}
  </div>;
}
