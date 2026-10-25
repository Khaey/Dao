'use client';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Input } from '../ui';
import {
  MANAGER_MAX_DAYS, definitionOf, fetchManagerPreview, fetchMyDelegation, formatSettingValue, managerSettingCommand, modeLabels, scopeLabels,
  settingLabel, workspaceLabels, type EffectiveSettings, type MyDelegation, type SettingOverride,
} from '../../lib/settings';

const field = 'mt-1 w-full rounded-xl border border-black/10 p-3';
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

// Gestionnaire with an Admin mandate: restrict (never open) within its portfolio or
// assigned chantiers, at most 90 days, and lift only its own restrictions.
export default function ManagerSettings() {
  const [data, setData] = useState<MyDelegation | null>(null), [error, setError] = useState(''), [status, setStatus] = useState(''), [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ key: '', scope: 'account', target: '', workspace: '', until: isoDay(new Date(Date.now() + 30 * 86400000)), modes: [] as string[], reason: '' });
  const [lift, setLift] = useState<SettingOverride | null>(null), [liftReason, setLiftReason] = useState('');
  const load = useCallback(async () => { try { setData(await fetchMyDelegation()); } catch (e: any) { setError(e.message || 'Chargement impossible.'); } }, []);
  useEffect(() => { void load(); }, [load]);
  if (!data) return error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p className="text-sm text-black/60">Chargement…</p>;
  if (!data.mandates.length) return <Card><h1 className="text-xl font-bold">Paramètres</h1><p className="mt-2 text-sm text-black/60">Aucune délégation active. Un Administrateur D.A.O. peut vous confier un mandat.</p></Card>;

  const restrictMandates = data.mandates.filter(m => m.actions.includes('restrict'));
  const keys = [...new Set(restrictMandates.flatMap(m => m.keys))];
  const key = form.key || keys[0] || '', def = definitionOf(key);
  const scopes = [...new Set(restrictMandates.filter(m => m.keys.includes(key)).flatMap(m => m.scopes))].filter(s => def?.scopes.includes(s as any));
  const scope = scopes.includes(form.scope) ? form.scope : scopes[0] ?? 'account';
  const accounts = (data.accounts ?? []).filter(a => a.roles.some(r => def?.workspaces.includes(r as any))), projects = data.projects ?? [];
  const maxDay = isoDay(new Date(Date.now() + MANAGER_MAX_DAYS * 86400000));
  const canLift = (o: SettingOverride) => data.mandates.some(m => m.actions.includes('lift_own_restriction') && m.keys.includes(o.key) && m.scopes.includes(o.scope));
  async function run(action: 'set' | 'clear', input: Record<string, unknown>, done: string) {
    setBusy(true); setError(''); setStatus('');
    try { await managerSettingCommand(action, input); setStatus(done); await load(); return true; }
    catch (e: any) { setError(e.message || 'Action refusée.'); return false; } finally { setBusy(false); }
  }
  const targetName = (scope === 'account' ? accounts : projects).find(t => t.id === form.target)?.name ?? '';
  return <section className="space-y-6" aria-labelledby="manager-settings-title">
    <div><p className="text-xs font-bold uppercase tracking-[.16em] text-teal">Espace Gestionnaire</p><h1 id="manager-settings-title" className="mt-2 text-3xl font-bold">Mes délégations</h1>
      <p className="mt-2 max-w-3xl text-sm text-black/60">Vous pouvez restreindre temporairement certaines fonctions pour les comptes de votre portefeuille ou vos chantiers affectés. Vous ne pouvez rien ouvrir ni modifier une décision de l’administration.</p></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <p role="status" aria-live="polite" className={status ? 'rounded-xl bg-teal/10 p-3 text-sm text-teal' : 'sr-only'}>{status}</p>
    <Card><h2 className="font-bold">Mandats</h2><ul className="mt-2 space-y-1 text-sm">{data.mandates.map(m => <li key={m.id}>{m.keys.map(settingLabel).join(', ')} · {m.scopes.map(s => scopeLabels[s]).join(', ')} · jusqu’au {new Date(m.valid_until).toLocaleDateString('fr-FR')}</li>)}</ul></Card>
    {keys.length > 0 && <Card className="space-y-3"><h2 className="font-bold">Nouvelle restriction</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold">Fonction<select className={field} value={key} onChange={e => setForm({ ...form, key: e.target.value, target: '', modes: [] })}>{keys.map(k => <option key={k} value={k}>{settingLabel(k)}</option>)}</select></label>
        <label className="text-sm font-semibold">Portée<select className={field} value={scope} onChange={e => setForm({ ...form, scope: e.target.value, target: '' })}>{scopes.map(s => <option key={s} value={s}>{scopeLabels[s]}</option>)}</select></label>
        <label className="text-sm font-semibold">{scope === 'account' ? 'Compte du portefeuille' : 'Chantier affecté'}<select className={field} value={form.target} onChange={e => setForm({ ...form, target: e.target.value })}>
          <option value="">Choisir…</option>{(scope === 'account' ? accounts : projects).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
        {def && def.workspaces.length > 1 && <label className="text-sm font-semibold">Espace<select className={field} value={form.workspace} onChange={e => setForm({ ...form, workspace: e.target.value })}>
          <option value="">Tous</option>{def.workspaces.map(w => <option key={w} value={w}>{workspaceLabels[w]}</option>)}</select></label>}
        {def?.type.kind === 'enum_set' && <fieldset className="text-sm"><legend className="font-semibold">Modes conservés</legend><div className="mt-1 flex flex-wrap gap-3">{def.type.values.map(m =>
          <label key={m} className="flex items-center gap-2"><input type="checkbox" checked={form.modes.includes(m)} onChange={() => setForm({ ...form, modes: form.modes.includes(m) ? form.modes.filter(x => x !== m) : [...form.modes, m] })} />{modeLabels[m]}</label>)}</div></fieldset>}
        <label className="text-sm font-semibold">Fin (90 jours au plus)<Input type="date" min={isoDay(new Date())} max={maxDay} value={form.until} onChange={e => setForm({ ...form, until: e.target.value })} className="mt-1" /></label>
        <label className="text-sm font-semibold sm:col-span-2">Motif (obligatoire)<Input value={form.reason} maxLength={500} onChange={e => setForm({ ...form, reason: e.target.value })} className="mt-1" /></label>
      </div>
      <Button type="button" disabled={busy || !form.target || !form.until || form.until > maxDay || form.reason.trim().length < 5 || (def?.type.kind === 'enum_set' && !form.modes.length)}
        onClick={() => void run('set', { key, scope, [scope === 'account' ? 'user_id' : 'project_id']: form.target, workspace: form.workspace || null,
          value: def?.type.kind === 'enum_set' ? (def.type as any).values.filter((m: string) => form.modes.includes(m)) : false,
          valid_until: new Date(`${form.until}T23:59:59`).toISOString(), reason: form.reason, expected_override_id: null }, `${settingLabel(key)} restreint pour ${targetName}.`)
          .then(ok => ok && setForm({ ...form, target: '', reason: '' }))}>Restreindre</Button></Card>}
    <Card><h2 className="font-bold">Mes restrictions en vigueur</h2>{!data.overrides?.length ? <p className="mt-2 text-sm text-black/60">Aucune.</p> :
      <ul className="mt-3 divide-y divide-black/5">{data.overrides.map(o => <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div>
        <p className="font-semibold">{settingLabel(o.key)} · {scopeLabels[o.scope]} {o.target_label ?? ''}{o.workspace ? ` (${workspaceLabels[o.workspace]})` : ''}</p>
        <p className="text-xs text-black/50">{formatSettingValue(o.key, o.value)} · jusqu’au {o.valid_until ? new Date(o.valid_until).toLocaleDateString('fr-FR') : '—'}{!o.live ? ' · expirée' : ''} · {o.reason}</p></div>
        {canLift(o) && <button type="button" className="min-h-10 rounded-xl px-3 font-semibold text-teal" onClick={() => { setLift(o); setLiftReason(''); }}>Lever</button>}</li>)}</ul>}
      {lift && <div className="mt-3 flex flex-wrap gap-2"><Input aria-label="Motif" placeholder="Motif (5 caractères minimum)" value={liftReason} onChange={e => setLiftReason(e.target.value)} className="flex-1" />
        <Button type="button" disabled={busy || liftReason.trim().length < 5} onClick={() => void run('clear', { key: lift.key, scope: lift.scope, workspace: lift.workspace, user_id: lift.user_id,
          project_id: lift.project_id, reason: liftReason, expected_override_id: lift.id }, 'Restriction levée.').then(ok => ok && setLift(null))}>Confirmer la levée</Button></div>}</Card>
    <ManagerPreview data={data} />
  </section>;
}

function ManagerPreview({ data }: { data: MyDelegation }) {
  const [user, setUser] = useState(''), [ws, setWs] = useState('client'), [project, setProject] = useState(''), [result, setResult] = useState<EffectiveSettings | null>(null), [failure, setFailure] = useState('');
  const account = data.accounts?.find(a => a.id === user);
  if (!data.accounts?.length) return null;
  return <Card className="space-y-3"><h2 className="font-bold">Voir comme…</h2>
    {failure && <p role="alert" className="text-sm text-red-700">{failure}</p>}
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm font-semibold">Compte<select className={field} value={user} onChange={e => { setUser(e.target.value); setResult(null); const a = data.accounts?.find(x => x.id === e.target.value); if (a && !a.roles.includes(ws)) setWs(a.roles[0]); }}>
        <option value="">Choisir…</option>{data.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="text-sm font-semibold">Espace<select className={field} value={ws} onChange={e => setWs(e.target.value)}>{(account?.roles ?? ['client', 'contractor']).map(r => <option key={r} value={r}>{workspaceLabels[r]}</option>)}</select></label>
      <label className="text-sm font-semibold">Chantier affecté<select className={field} value={project} onChange={e => setProject(e.target.value)}><option value="">Aucun</option>{data.projects?.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
    <Button type="button" disabled={!user} onClick={() => { setFailure(''); fetchManagerPreview(user, ws, project || null).then(setResult).catch((e: any) => setFailure(e.message)); }}>Simuler</Button>
    {result && <ul className="divide-y divide-black/5 text-sm">{Object.entries(result.settings).filter(([k]) => definitionOf(k)?.family === 'capability').map(([k, e]) =>
      <li key={k} className="flex justify-between gap-2 py-2"><span>{settingLabel(k)}</span>{e.state === 'unavailable' ? <Badge tone="clay">Indisponible</Badge> : <span className="text-teal">{formatSettingValue(k, e.value)}</span>}</li>)}</ul>}</Card>;
}
