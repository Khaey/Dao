'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { Badge, Button, Card, Input } from '../ui';
import { readAllBackoffice } from '../../lib/backoffice';
import {
  SETTINGS_CATALOG, adminSetTradeActive, adminSettingCommand, fetchAdminHistory, fetchAdminOverview, fetchAdminPreview, formatSettingValue,
  modeLabels, scopeLabels, settingLabel, sourceLabels, unitLabels, workspaceLabels, type AdminOverview, type EffectiveSettings, type SettingEvent, type SettingOverride,
} from '../../lib/settings';

type Tab = 'features' | 'values' | 'exceptions' | 'catalog' | 'preview' | 'history' | 'fixed';
const tabs: Array<[Tab, string]> = [['features', 'Fonctions'], ['values', 'Règles & délais'], ['exceptions', 'Exceptions'], ['catalog', 'Référentiels'],
  ['preview', 'Simulation'], ['history', 'Historique'], ['fixed', 'Règles fixes']];
const fixedRules = ['Attribution commerciale par lot uniquement, jamais par sous-lot.', 'Accès aux données : JWT et RLS font foi ; un paramètre ne donne jamais un accès.',
  'Suspension de compte : gérée dans Utilisateurs & rôles, pas ici.', 'Signature électronique, effets juridiques de la réception et garanties : décision séparée.',
  'Devise TND / millimes ; fiscalité et paiements réels hors paramètres.', 'Notifications critiques (attribution, revue, contrat) non désactivables.',
  'Secrets et exploitation (Supabase, e-mail, VPS, OCE) hors de l’interface produit.', 'Choix des titulaires (opt-in Artisan, coordonnées publiques, contrat par chantier) : modifiables seulement par eux.'];
type Pending = { action: 'set' | 'clear'; input: Record<string, unknown>; summary: string } | null;
type Target = { id: string; name: string };

export default function AdminSettings() {
  const [tab, setTab] = useState<Tab>('features'), [data, setData] = useState<AdminOverview | null>(null), [error, setError] = useState(''), [status, setStatus] = useState('');
  const [pending, setPending] = useState<Pending>(null), [reason, setReason] = useState(''), [saving, setSaving] = useState(false);
  const load = useCallback(async () => { setError(''); try { setData(await fetchAdminOverview()); } catch (e: any) { setError(e.message || 'Chargement impossible.'); } }, []);
  useEffect(() => { void load(); }, [load]);
  const active = useCallback((key: string, scope: string, ws: string | null = null, user: string | null = null, project: string | null = null) =>
    data?.overrides.find(o => o.key === key && o.scope === scope && o.workspace === ws && o.user_id === user && o.project_id === project), [data]);
  function ask(action: 'set' | 'clear', input: Record<string, unknown>, summary: string) {
    const current = active(String(input.key), String(input.scope), (input.workspace as string) ?? null, (input.user_id as string) ?? null, (input.project_id as string) ?? null);
    setPending({ action, input: { ...input, expected_override_id: current?.id ?? null }, summary }); setReason(''); setStatus('');
  }
  async function confirm() {
    if (!pending) return; setSaving(true); setError('');
    try { await adminSettingCommand(pending.action, { ...pending.input, reason }); setStatus('Modification enregistrée et historisée.'); setPending(null); await load(); }
    catch (e: any) { setError(e.message || 'Modification refusée.'); } finally { setSaving(false); }
  }
  const definitions = useMemo(() => new Map((data?.definitions ?? []).map(d => [d.key, d])), [data]);
  const capabilities = SETTINGS_CATALOG.filter(d => d.family === 'capability'), values = SETTINGS_CATALOG.filter(d => d.family === 'value');
  return <section className="space-y-6" aria-labelledby="dao-settings-title">
    <div><p className="text-xs font-bold uppercase tracking-[.16em] text-teal">Administration</p><h1 id="dao-settings-title" className="mt-2 text-3xl font-bold">Paramètres D.A.O.</h1>
      <p className="mt-2 max-w-3xl text-sm text-black/60">Chaque changement s’applique aux nouvelles actions uniquement : offres, accords, contrats et dossiers existants ne sont jamais réécrits. Motif obligatoire, historique complet.</p>
      {data && <p className="mt-1 text-xs text-black/45">Catalogue v{data.catalog_version} · version {data.version}</p>}</div>
    <nav aria-label="Rubriques des paramètres" className="flex gap-2 overflow-x-auto pb-1">{tabs.map(([id, label]) =>
      <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)} className={`min-h-10 shrink-0 rounded-xl px-3 text-sm font-semibold ${tab === id ? 'bg-ink text-white' : 'bg-black/5 text-black/70'}`}>{label}</button>)}</nav>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{error}</p>}
    <p role="status" aria-live="polite" className={status ? 'rounded-xl bg-teal/10 p-3 text-sm text-teal' : 'sr-only'}>{status}</p>
    {pending && <Card className="space-y-3 border-teal/30"><h2 className="font-bold">Confirmer : {pending.summary}</h2>
      <p className="text-sm text-black/60">Effet sur les nouvelles actions uniquement. Les éléments déjà créés restent visibles et terminables.</p>
      <label className="block text-sm font-semibold">Motif (obligatoire)<textarea value={reason} onChange={e => setReason(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-xl border border-black/10 p-3 text-sm" /></label>
      <div className="flex gap-2"><Button type="button" disabled={saving || reason.trim().length < 5} onClick={() => void confirm()}>{saving ? 'Enregistrement…' : 'Confirmer'}</Button>
        <button type="button" className="min-h-10 rounded-xl px-4 text-sm font-semibold" onClick={() => setPending(null)}>Annuler</button></div></Card>}
    {!data ? !error && <p className="text-sm text-black/60">Chargement…</p> : <>
      {tab === 'features' && <div className="space-y-3">{capabilities.map(def => {
        const global = active(def.key, 'global'), exceptions = data.overrides.filter(o => o.key === def.key && ['account', 'project'].includes(o.scope)).length;
        const current = global ? global.value : def.default;
        return <Card key={def.key} className="space-y-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{def.label}</h2>
            <p className="text-xs text-black/50">{def.workspaces.map(w => workspaceLabels[w]).join(' · ')}{def.ownerChoice ? ' · + consentement de l’Artisan' : ''}{def.delegable ? ' · délégable' : ''}</p></div>
          <div className="flex items-center gap-2">{global?.locked && <Badge tone="red"><Lock size={12} className="mr-1" aria-hidden="true" />Verrouillée</Badge>}
            <Badge tone={current === false || (Array.isArray(current) && !current.length) ? 'clay' : 'teal'}>{formatSettingValue(def.key, current)}</Badge>{exceptions > 0 && <Badge>{exceptions} exception(s)</Badge>}</div></div>
          <div className="flex flex-wrap gap-2">{def.type.kind === 'enum_set' ? def.type.values.map(mode => {
              const list: string[] = Array.isArray(current) ? current : [], next = list.includes(mode) ? list.filter(m => m !== mode) : [...list, mode];
              return <Button key={mode} type="button" className={list.includes(mode) ? '' : 'bg-black/10 text-black/70'} disabled={!next.length}
                onClick={() => ask('set', { key: def.key, scope: 'global', value: (def.type as any).values.filter((m: string) => next.includes(m)) }, `${def.label} : ${list.includes(mode) ? 'retirer' : 'ajouter'} « ${modeLabels[mode]} »`)}>{modeLabels[mode]}</Button>;
            }) : <Button type="button" onClick={() => ask('set', { key: def.key, scope: 'global', value: current === false, locked: false }, `${def.label} : ${current === false ? 'activer' : 'restreindre'} sur la plateforme`)}>{current === false ? 'Activer' : 'Restreindre'}</Button>}
            {def.type.kind === 'boolean' && <Button type="button" className="bg-black/10 text-black/70" onClick={() => ask('set', { key: def.key, scope: 'global', value: current, locked: !global?.locked }, `${def.label} : ${global?.locked ? 'déverrouiller' : 'verrouiller (coupe toutes les exceptions)'}`)}>{global?.locked ? 'Déverrouiller' : 'Verrouiller'}</Button>}
            {global && <button type="button" className="min-h-10 rounded-xl px-3 text-sm font-semibold text-teal" onClick={() => ask('clear', { key: def.key, scope: 'global' }, `${def.label} : revenir à la valeur par défaut`)}>Valeur par défaut</button>}</div>
          {def.scopes.includes('role') && def.type.kind === 'boolean' && def.workspaces.length > 1 && <div className="flex flex-wrap gap-3 text-sm">{def.workspaces.map(ws => {
            const role = active(def.key, 'role', ws);
            return <label key={ws} className="flex items-center gap-2">{workspaceLabels[ws]}<select value={role ? String(role.value) : 'inherit'} className="rounded-lg border border-black/10 p-2"
              onChange={e => e.target.value === 'inherit' ? ask('clear', { key: def.key, scope: 'role', workspace: ws }, `${def.label} (${workspaceLabels[ws]}) : hériter`) : ask('set', { key: def.key, scope: 'role', workspace: ws, value: e.target.value === 'true' }, `${def.label} (${workspaceLabels[ws]}) : ${e.target.value === 'true' ? 'actif' : 'restreint'}`)}>
              <option value="inherit">Hérite</option><option value="true">Actif</option><option value="false">Restreint</option></select></label>;
          })}</div>}</Card>;
      })}</div>}
      {tab === 'values' && <div className="space-y-3">{values.map(def => <ValueRow key={def.key} def={def} current={definitions.get(def.key)?.global_value ?? (def.default as number)} overridden={!!active(def.key, 'global')}
        onSave={value => ask('set', { key: def.key, scope: 'global', value }, `${def.label} : ${value} ${unitLabels[(def.type as any).unit]}`)} onReset={() => ask('clear', { key: def.key, scope: 'global' }, `${def.label} : revenir à ${def.default}`)} />)}</div>}
      {tab === 'exceptions' && <Exceptions overview={data} ask={ask} />}
      {tab === 'catalog' && <Card className="space-y-2"><h2 className="font-bold">Métiers</h2><p className="text-sm text-black/60">Un métier inactif n’est plus proposé pour les nouveaux lots ; les lots existants restent intacts.</p>
        <TradeList trades={data.trades} onChanged={async (msg) => { setStatus(msg); await load(); }} onError={setError} /></Card>}
      {tab === 'preview' && <Preview />}
      {tab === 'history' && <History />}
      {tab === 'fixed' && <Card><h2 className="font-bold">Règles fixes (non configurables)</h2><ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-black/70">{fixedRules.map(r => <li key={r}>{r}</li>)}</ul></Card>}
    </>}
  </section>;
}

function ValueRow({ def, current, overridden, onSave, onReset }: { def: any; current: number; overridden: boolean; onSave: (v: number) => void; onReset: () => void }) {
  const [value, setValue] = useState(String(current)); useEffect(() => setValue(String(current)), [current]);
  const n = Number(value), valid = Number.isInteger(n) && n >= def.type.min && n <= def.type.max && n !== current;
  return <Card className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-bold">{def.label}</h2>
    <p className="text-xs text-black/50">Défaut {def.default} · bornes {def.type.min}–{def.type.max} {unitLabels[def.type.unit]} · {def.effect === 'live' ? 'effet immédiat' : 'nouveaux dossiers uniquement'}</p></div>
    <div className="flex items-end gap-2"><label className="text-sm font-semibold">Valeur<Input type="number" min={def.type.min} max={def.type.max} value={value} onChange={e => setValue(e.target.value)} className="mt-1 w-28" /></label>
      <Button type="button" disabled={!valid} onClick={() => onSave(n)}>Enregistrer</Button>{overridden && <button type="button" className="min-h-10 px-2 text-sm font-semibold text-teal" onClick={onReset}>Défaut</button>}</div></Card>;
}

function useTargets() {
  const [targets, setTargets] = useState<{ accounts: Array<Target & { roles: string[] }>; projects: Target[] } | null>(null), [error, setError] = useState('');
  useEffect(() => { let live = true; Promise.all([readAllBackoffice('clients'), readAllBackoffice('professionals'), readAllBackoffice('projects')]).then(([clients, pros, projects]) => {
    if (!live) return; const accounts = new Map<string, Target & { roles: string[] }>();
    for (const c of clients) accounts.set(c.user_id || c.id, { id: c.user_id || c.id, name: c.display_name, roles: ['client'] });
    for (const p of pros) { const id = p.user_id || p.id, prev = accounts.get(id); accounts.set(id, { id, name: prev?.name ?? p.business_name, roles: [...(prev?.roles ?? []), 'contractor'] }); }
    setTargets({ accounts: [...accounts.values()].sort((a, b) => a.name.localeCompare(b.name)), projects: projects.map((p: any) => ({ id: p.id, name: p.version?.title ?? p.id })) });
  }).catch(() => live && setError('Liste des comptes indisponible.')); return () => { live = false; }; }, []);
  return { targets, error };
}

function Exceptions({ overview, ask }: { overview: AdminOverview; ask: (a: 'set' | 'clear', i: Record<string, unknown>, s: string) => void }) {
  const { targets, error } = useTargets();
  const keys = SETTINGS_CATALOG.filter(d => d.family === 'capability' && d.scopes.some(s => s === 'account' || s === 'project'));
  const [form, setForm] = useState({ key: keys[0]?.key ?? '', scope: 'account', target: '', workspace: '', value: 'false', until: '', modes: [] as string[] });
  const def = keys.find(d => d.key === form.key), scopes = (def?.scopes ?? []).filter(s => s === 'account' || s === 'project');
  const list = overview.overrides.filter(o => o.scope === 'account' || o.scope === 'project');
  const label = (o: SettingOverride) => `${settingLabel(o.key)} · ${scopeLabels[o.scope]} ${o.target_label ?? ''}${o.workspace ? ` (${workspaceLabels[o.workspace]})` : ''}`;
  return <div className="space-y-4"><Card className="space-y-3"><h2 className="font-bold">Nouvelle exception</h2>
    <p className="text-sm text-black/60">Restreindre une fonction pour un compte ou un chantier, ou l’ouvrir temporairement quand la plateforme l’a restreinte (Admin uniquement, échéance obligatoire). Impossible si la valeur est verrouillée.</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm font-semibold">Fonction<select className="mt-1 w-full rounded-xl border border-black/10 p-3" value={form.key} onChange={e => setForm({ ...form, key: e.target.value, scope: 'account', target: '' })}>{keys.map(k => <option key={k.key} value={k.key}>{k.label}</option>)}</select></label>
      <label className="text-sm font-semibold">Portée<select className="mt-1 w-full rounded-xl border border-black/10 p-3" value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value, target: '' })}>{scopes.map(s => <option key={s} value={s}>{scopeLabels[s]}</option>)}</select></label>
      <label className="text-sm font-semibold">{form.scope === 'account' ? 'Compte' : 'Chantier'}<select className="mt-1 w-full rounded-xl border border-black/10 p-3" value={form.target} onChange={e => setForm({ ...form, target: e.target.value })}>
        <option value="">Choisir…</option>{(form.scope === 'account' ? targets?.accounts.filter(a => a.roles.some(r => def?.workspaces.includes(r as any))) : targets?.projects)?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
      {def && def.workspaces.length > 1 && <label className="text-sm font-semibold">Espace<select className="mt-1 w-full rounded-xl border border-black/10 p-3" value={form.workspace} onChange={e => setForm({ ...form, workspace: e.target.value })}>
        <option value="">Tous</option>{def.workspaces.map(w => <option key={w} value={w}>{workspaceLabels[w]}</option>)}</select></label>}
      {def?.type.kind === 'boolean' && <label className="text-sm font-semibold">Effet<select className="mt-1 w-full rounded-xl border border-black/10 p-3" value={form.value} onChange={e => setForm({ ...form, value: e.target.value })}>
        <option value="false">Restreindre</option><option value="true">Ouvrir (exception positive)</option></select></label>}
      {def?.type.kind === 'enum_set' && <fieldset className="text-sm"><legend className="font-semibold">Modes autorisés</legend><div className="mt-1 flex flex-wrap gap-3">{def.type.values.map(m =>
        <label key={m} className="flex items-center gap-2"><input type="checkbox" checked={form.modes.includes(m)} onChange={() => setForm({ ...form, modes: form.modes.includes(m) ? form.modes.filter(x => x !== m) : [...form.modes, m] })} />{modeLabels[m]}</label>)}</div></fieldset>}
      <label className="text-sm font-semibold">Fin {form.value === 'true' ? '(obligatoire)' : '(facultative)'}<Input type="date" value={form.until} onChange={e => setForm({ ...form, until: e.target.value })} className="mt-1" /></label>
    </div>
    <Button type="button" disabled={!form.target || (def?.type.kind === 'enum_set' ? !form.modes.length : form.value === 'true' && !form.until)} onClick={() => ask('set', {
      key: form.key, scope: form.scope, [form.scope === 'account' ? 'user_id' : 'project_id']: form.target, workspace: form.workspace || null,
      value: def?.type.kind === 'enum_set' ? (def.type as any).values.filter((m: string) => form.modes.includes(m)) : form.value === 'true', valid_until: form.until ? new Date(`${form.until}T23:59:59`).toISOString() : null,
    }, `${def?.label} : ${form.value === 'true' ? 'ouvrir' : 'restreindre'} pour ${(form.scope === 'account' ? targets?.accounts : targets?.projects)?.find(t => t.id === form.target)?.name ?? ''}`)}>Préparer l’exception</Button></Card>
    <Card><h2 className="font-bold">Exceptions en vigueur ({list.length})</h2>{!list.length ? <p className="mt-2 text-sm text-black/60">Aucune exception.</p> :
      <ul className="mt-3 divide-y divide-black/5">{list.map(o => <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm"><div><p className="font-semibold">{label(o)}</p>
        <p className="text-xs text-black/50">{formatSettingValue(o.key, o.value)} · {o.valid_until ? `jusqu’au ${new Date(o.valid_until).toLocaleDateString('fr-FR')}` : 'sans échéance'}{!o.live ? ' · expirée' : ''}{o.mandate_id ? ' · posée par un Gestionnaire mandaté' : ''} · {o.reason}</p></div>
        <button type="button" className="min-h-10 rounded-xl px-3 font-semibold text-teal" onClick={() => ask('clear', { key: o.key, scope: o.scope, workspace: o.workspace, user_id: o.user_id, project_id: o.project_id }, `Retirer : ${label(o)}`)}>Retirer</button></li>)}</ul>}</Card></div>;
}

function TradeList({ trades, onChanged, onError }: { trades: AdminOverview['trades']; onChanged: (m: string) => Promise<void>; onError: (m: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null), [reason, setReason] = useState('');
  return <ul className="divide-y divide-black/5">{trades.map(t => <li key={t.id} className="py-2 text-sm"><div className="flex items-center justify-between gap-2"><span>{t.name}</span>
    <button type="button" className={`min-h-10 rounded-xl px-3 font-semibold ${t.active ? 'bg-teal/10 text-teal' : 'bg-black/5 text-black/60'}`} onClick={() => { setEditing(editing === t.id ? null : t.id); setReason(''); }}>{t.active ? 'Actif' : 'Inactif'}</button></div>
    {editing === t.id && <div className="mt-2 flex flex-wrap gap-2"><Input aria-label="Motif" placeholder="Motif (5 caractères minimum)" value={reason} onChange={e => setReason(e.target.value)} className="flex-1" />
      <Button type="button" disabled={reason.trim().length < 5} onClick={() => adminSetTradeActive(t.id, !t.active, reason).then(() => { setEditing(null); return onChanged(`Métier « ${t.name} » ${t.active ? 'désactivé' : 'activé'}.`); }).catch((e: any) => onError(e.message))}>{t.active ? 'Désactiver' : 'Activer'}</Button></div>}</li>)}</ul>;
}

function Preview() {
  const { targets, error } = useTargets();
  const [user, setUser] = useState(''), [ws, setWs] = useState('client'), [project, setProject] = useState(''), [result, setResult] = useState<EffectiveSettings | null>(null), [failure, setFailure] = useState('');
  const account = targets?.accounts.find(a => a.id === user);
  return <Card className="space-y-3"><h2 className="font-bold">Voir comme…</h2><p className="text-sm text-black/60">Affiche les options effectives d’un compte et leur origine, sans afficher ses données ni rien modifier.</p>
    {(error || failure) && <p role="alert" className="text-sm text-red-700">{error || failure}</p>}
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-sm font-semibold">Compte<select className="mt-1 w-full rounded-xl border border-black/10 p-3" value={user} onChange={e => { setUser(e.target.value); setResult(null); const a = targets?.accounts.find(x => x.id === e.target.value); if (a && !a.roles.includes(ws)) setWs(a.roles[0]); }}>
        <option value="">Choisir…</option>{targets?.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="text-sm font-semibold">Espace<select className="mt-1 w-full rounded-xl border border-black/10 p-3" value={ws} onChange={e => setWs(e.target.value)}>{(account?.roles ?? ['client', 'contractor']).map(r => <option key={r} value={r}>{workspaceLabels[r]}</option>)}</select></label>
      <label className="text-sm font-semibold">Chantier (facultatif)<select className="mt-1 w-full rounded-xl border border-black/10 p-3" value={project} onChange={e => setProject(e.target.value)}><option value="">Aucun</option>{targets?.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label></div>
    <Button type="button" disabled={!user} onClick={() => { setFailure(''); fetchAdminPreview(user, ws, project || null).then(setResult).catch((e: any) => setFailure(e.message)); }}>Simuler</Button>
    {result && <table className="w-full text-left text-sm"><thead><tr className="text-xs text-black/50"><th className="py-2">Option</th><th>Valeur</th><th>Origine</th></tr></thead><tbody>
      {Object.entries(result.settings).map(([key, e]) => <tr key={key} className="border-t border-black/5"><td className="py-2">{settingLabel(key)}</td>
        <td>{e.state === 'unavailable' ? <Badge tone="clay">Indisponible</Badge> : formatSettingValue(key, e.value)}{e.owner_choice !== undefined && <span className="ml-2 text-xs text-black/50">Choix de l’Artisan : {e.owner_choice ? 'oui' : 'non'}</span>}</td>
        <td className="text-xs text-black/60">{sourceLabels[e.source] ?? e.source}</td></tr>)}</tbody></table>}</Card>;
}

function History() {
  const [rows, setRows] = useState<SettingEvent[]>([]), [more, setMore] = useState(true), [error, setError] = useState('');
  const page = useCallback(async (before?: SettingEvent) => { try { const next = await fetchAdminHistory(null, before); setRows(r => before ? [...r, ...next] : next); setMore(next.length === 50); } catch (e: any) { setError(e.message); } }, []);
  useEffect(() => { void page(); }, [page]);
  const describe = (e: SettingEvent) => e.action === 'trade_active' ? `Métier ${e.target_ref} : ${e.new_value ? 'activé' : 'désactivé'}`
    : `${settingLabel(e.key)} · ${scopeLabels[e.scope]}${e.target_label ? ` ${e.target_label}` : ''}${e.workspace ? ` (${workspaceLabels[e.workspace]})` : ''} : ${e.action === 'clear' ? 'retour à l’héritage' : `${formatSettingValue(e.key, e.old_value)} → ${formatSettingValue(e.key, e.new_value)}${e.new_locked ? ' (verrouillée)' : ''}`}`;
  return <Card>{error && <p role="alert" className="text-sm text-red-700">{error}</p>}{!rows.length ? <p className="text-sm text-black/60">Aucune modification.</p> :
    <ol className="divide-y divide-black/5">{rows.map(e => <li key={e.id} className="py-3 text-sm"><p className="font-semibold">{describe(e)}</p>
      <p className="text-xs text-black/50">{new Date(e.created_at).toLocaleString('fr-FR')} · {e.actor ?? 'Équipe D.A.O.'}{e.mandate_id ? ' (mandat)' : ''} · v{e.version} · {e.reason}</p></li>)}</ol>}
    {more && rows.length > 0 && <button type="button" className="mt-3 min-h-10 rounded-xl px-3 text-sm font-semibold text-teal" onClick={() => void page(rows[rows.length - 1])}>Plus ancien</button>}</Card>;
}
