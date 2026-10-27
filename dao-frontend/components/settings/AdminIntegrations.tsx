'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { History as HistoryIcon, KeyRound, Plug, Search } from 'lucide-react';
import { Badge, Button, Card, Input } from '../ui';
import {
  INTEGRATIONS_CONTRACT, STATE_LABEL, STATE_TONE, connectorMatches, eligibleForDefault, integrationErrorMessage, integrationsApi, IntegrationsError,
  type CatalogFilter, type IntegrationCommand, type IntegrationConnection, type IntegrationEnvironment, type IntegrationEvent,
  type IntegrationManifest, type IntegrationsApi, type IntegrationsOverview,
} from '../../lib/integrations';

// #515 — centre « Intégrations & API » (Admin uniquement). Tous les états viennent du serveur ;
// un candidat n'est jamais présenté comme connecté et aucun secret n'est relu.
type Pending = { cmd: IntegrationCommand; summary: string; key: string; secrets?: Record<string, string> } | null;
type Form = { manifest: IntegrationManifest; connection: IntegrationConnection | null } | null;
const filters: Array<[CatalogFilter, string]> = [['all', 'Tous'], ['active', 'Actifs'], ['sandbox', 'Test'], ['error', 'En erreur'], ['not_installed', 'Non installés']];
const envLabel: Record<IntegrationEnvironment, string> = { sandbox: 'Test (sandbox)', live: 'Réel (live)' };
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export default function AdminIntegrations({ api = integrationsApi, onStatus }: { api?: IntegrationsApi; onStatus?: (s: string) => void }) {
  const [data, setData] = useState<IntegrationsOverview | null>(null), [error, setError] = useState(''), [unavailable, setUnavailable] = useState(false);
  const [category, setCategory] = useState(''), [market, setMarket] = useState(''), [entity, setEntity] = useState(''), [env, setEnv] = useState<IntegrationEnvironment>('sandbox');
  const [filter, setFilter] = useState<CatalogFilter>('all'), [query, setQuery] = useState('');
  const [pending, setPending] = useState<Pending>(null), [reason, setReason] = useState(''), [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Form>(null), [history, setHistory] = useState<{ id: string | null; events: IntegrationEvent[] } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      const o = await api.overview();
      if (o.contract_version !== INTEGRATIONS_CONTRACT) { setError(`Version de contrat inattendue (${o.contract_version}) : affichage suspendu.`); return; }
      setData(o); setUnavailable(false);
      setCategory(c => c || o.categories[0]?.key || ''); setMarket(m => m || o.markets[0] || ''); setEntity(e => e || o.legal_entities[0]?.id || '');
    } catch (e) { if (e instanceof IntegrationsError && e.unavailable) setUnavailable(true); else setError(integrationErrorMessage(e)); }
  }, [api]);
  useEffect(() => { void load(); }, [load]);

  async function confirm() {
    if (!pending) return; setSaving(true); setError('');
    try {
      const res = await api.command(pending.cmd, reason.trim(), pending.key);
      const id = 'connection_id' in pending.cmd ? pending.cmd.connection_id : res.connection_id;
      for (const [key, value] of Object.entries(pending.secrets ?? {})) if (value && id) await api.setSecret(id, key, value, reason.trim());
      onStatus?.('Modification enregistrée et historisée.'); setPending(null); setForm(null); await load();
    } catch (e) { setError(integrationErrorMessage(e)); } finally { setSaving(false); }
  }
  // Une clé d'idempotence par action confirmée : un nouvel essai après erreur réseau ne rejoue pas la commande.
  const ask = (cmd: IntegrationCommand, summary: string, secrets?: Record<string, string>) => { setPending({ cmd, summary, secrets, key: crypto.randomUUID() }); setReason(''); };
  async function openHistory(id: string | null) {
    try { setHistory({ id, events: await api.events(id) }); } catch (e) { setError(integrationErrorMessage(e)); }
  }

  const cat = data?.categories.find(c => c.key === category);
  const connectors = useMemo(() => (data?.connectors ?? []).filter(m => m.category === category && (!market || m.countries.includes(market))
    && connectorMatches(m, data!.connections, filter, query)), [data, category, market, filter, query]);
  const connections = (data?.connections ?? []).filter(c => c.category === category && (!market || c.country === market) && (!entity || c.legal_entity_id === entity) && c.environment === env);

  if (unavailable) return <Card className="space-y-2 border-dashed"><h2 className="font-bold">Intégrations & API</h2>
    <p className="text-sm text-black/60">Le service des intégrations n’est pas encore disponible sur cet environnement. Aucun prestataire n’est connecté : signature, séquestre et paiements réels restent désactivés.</p></Card>;
  if (!data) return error ? <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p> : <p role="status">Chargement des intégrations…</p>;

  return <div className="space-y-4">
    <Card className="space-y-3">
      <div><h2 className="font-bold">Intégrations & API</h2>
        <p className="text-sm text-black/60">Prestataires tiers par catégorie. Un changement s’applique aux nouvelles opérations uniquement ; les opérations en cours restent liées à leur prestataire. Les secrets ne sont jamais réaffichés.</p></div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="text-sm font-semibold">Marché<select value={market} onChange={e => setMarket(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm">
          {data.markets.map(m => <option key={m} value={m}>{m}</option>)}</select></label>
        <label className="text-sm font-semibold">Entité<select value={entity} onChange={e => setEntity(e.target.value)} className="mt-1 min-h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm">
          {data.legal_entities.length ? data.legal_entities.map(l => <option key={l.id} value={l.id}>{l.label}</option>) : <option value="">Aucune entité enregistrée</option>}</select></label>
        <label className="text-sm font-semibold">Environnement<select value={env} onChange={e => setEnv(e.target.value as IntegrationEnvironment)} className="mt-1 min-h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm">
          {(['sandbox', 'live'] as const).map(v => <option key={v} value={v}>{envLabel[v]}</option>)}</select></label>
      </div>
      <nav aria-label="Catégories d’intégration" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {data.categories.map(c => <button key={c.key} type="button" aria-current={c.key === category ? 'page' : undefined} onClick={() => setCategory(c.key)}
          className={`min-h-10 shrink-0 rounded-xl px-3 text-sm font-semibold ${c.key === category ? 'bg-teal/10 text-teal' : 'text-black/60 hover:bg-sand'}`}>{c.label}</button>)}
      </nav>
    </Card>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

    {cat && <Card className="space-y-3"><h3 className="font-bold">Prestataire par défaut — {cat.label}</h3>
      <p className="text-xs text-black/55">Un seul défaut par capacité, marché, entité et environnement. Seules les connexions installées, configurées et non suspendues sont proposées.</p>
      {env === 'live' && cat.sensitive && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">Mode réel verrouillé pour cette catégorie : aucun effet juridique ou financier sans décision dédiée.</p>}
      <ul className="divide-y divide-black/5">{cat.capabilities.map(cap => {
        const policy = data.policies.find(p => p.category === cat.key && p.capability === cap.key && p.country === market && p.legal_entity_id === entity && p.environment === env);
        const options = eligibleForDefault({ category: cat.key, capability: cap.key, country: market, legal_entity_id: entity, environment: env }, data);
        const locked = (env === 'live' && cat.sensitive) || !entity;
        return <li key={cap.key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm font-semibold">{cap.label}</span>
          <select aria-label={`Défaut pour ${cap.label}`} disabled={locked || (!options.length && !policy?.connection_id)} value={policy?.connection_id ?? ''}
            className="min-h-10 rounded-xl border border-black/10 bg-white px-3 text-sm disabled:opacity-60 sm:w-72"
            onChange={e => ask({ action: 'set_default', category: cat.key, capability: cap.key, country: market, legal_entity_id: entity, environment: env, connection_id: e.target.value || null, expected_version: policy?.version ?? null },
              `${cap.label} : ${e.target.value ? `défaut « ${options.find(o => o.id === e.target.value)?.alias} »` : 'aucun défaut'}`)}>
            <option value="">{options.length ? 'Aucun défaut' : 'Aucune connexion éligible'}</option>
            {options.map(o => <option key={o.id} value={o.id}>{o.alias}</option>)}
          </select></li>;
      })}</ul></Card>}

    <Card className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">Connexions ({connections.length})</h3>
      <button type="button" className="inline-flex min-h-9 items-center gap-1 text-sm font-semibold text-teal hover:underline" onClick={() => void openHistory(null)}><HistoryIcon size={15} aria-hidden="true" />Historique</button></div>
      {!connections.length ? <p className="text-sm text-black/55">Aucune connexion pour ce marché, cette entité et cet environnement.</p>
        : <ul className="divide-y divide-black/5">{connections.map(c => {
          const m = data.connectors.find(x => x.provider_id === c.provider_id);
          return <li key={c.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0"><p className="font-semibold">{c.alias} <span className="font-normal text-black/50">· {m?.label ?? c.provider_id}</span></p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs"><span className={`rounded-full px-2 py-0.5 font-semibold ${STATE_TONE[c.state]}`}>{STATE_LABEL[c.state]}</span>
                <span className="text-black/50">Dernier test : {c.last_check?.at ? `${when(c.last_check.at)}${c.last_check.status === 'simulated' ? ' · simulé, non vérifié' : ''}${c.last_check.reason ? ` · ${c.last_check.reason}` : ''}` : 'jamais'}</span>
                {c.secrets.map(s => <span key={s.key} className="inline-flex items-center gap-1 text-black/50"><KeyRound size={12} aria-hidden="true" />{s.key} : {s.present ? `enregistré (${when(s.rotated_at)})` : 'manquant'}</span>)}</div></div>
            <div className="flex shrink-0 flex-wrap gap-1">
              {m?.connection_check_supported ? <button type="button" className="min-h-9 rounded-lg px-2 text-sm font-semibold text-teal ring-1 ring-teal/30 hover:bg-teal/5" disabled={c.state === 'suspended'} onClick={() => ask({ action: 'test_connection', connection_id: c.id }, `${c.alias} : tester la connexion`)}>Tester</button>
                : <span className="self-center px-2 text-xs text-black/45">Test réel non disponible</span>}
              {m && m.status === 'installed' && <button type="button" className="min-h-9 rounded-lg px-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-sand" onClick={() => setForm({ manifest: m, connection: c })}>Paramétrer</button>}
              <button type="button" className="min-h-9 rounded-lg px-2 text-sm font-semibold ring-1 ring-black/10 hover:bg-sand"
                onClick={() => ask({ action: c.state === 'suspended' ? 'resume' : 'suspend', connection_id: c.id, expected_version: c.version }, `${c.alias} : ${c.state === 'suspended' ? 'reprendre' : 'suspendre les nouvelles opérations'}`)}>{c.state === 'suspended' ? 'Reprendre' : 'Suspendre'}</button>
              <button type="button" className="min-h-9 rounded-lg px-2 text-sm font-semibold text-black/60 hover:underline" onClick={() => void openHistory(c.id)}>Historique</button>
            </div></li>;
        })}</ul>}
    </Card>

    <Card className="space-y-3"><h3 className="font-bold">Connecteurs disponibles</h3>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><label className="relative flex-1"><span className="sr-only">Rechercher un connecteur</span><Search size={16} aria-hidden="true" className="absolute left-3 top-3 text-black/40" />
        <Input value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un connecteur" className="pl-9" /></label>
        <div role="group" aria-label="Filtrer" className="flex flex-wrap gap-1">{filters.map(([f, label]) => <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}
          className={`min-h-9 rounded-full px-3 text-xs font-semibold ${filter === f ? 'bg-ink text-white' : 'bg-black/5 text-black/60'}`}>{label}</button>)}</div></div>
      {!connectors.length ? <p className="text-sm text-black/55">Aucun connecteur ne correspond.</p>
        : <ul className="grid gap-2 sm:grid-cols-2">{connectors.map(m => <li key={m.provider_id} className="rounded-xl border border-black/10 p-3">
          <div className="flex items-start justify-between gap-2"><p className="font-semibold"><Plug size={14} className="mr-1 inline text-teal" aria-hidden="true" />{m.label}</p>
            {m.status === 'candidate' ? <Badge>Candidat · non installé</Badge> : <Badge tone="teal">Installé{m.adapter_version ? ` · v${m.adapter_version}` : ''}</Badge>}</div>
          <p className="mt-1 text-xs text-black/55">{m.capabilities.map(k => cat?.capabilities.find(x => x.key === k)?.label ?? k).join(' · ') || 'Capacités non vérifiées'} · {m.environments.map(e => envLabel[e]).join(', ') || 'aucun environnement'}{m.live_locked ? ' · réel verrouillé' : ''}</p>
          {m.status === 'installed' && m.environments.includes(env) && !(env === 'live' && (m.live_locked || cat?.sensitive)) && entity
            ? <button type="button" className="mt-2 min-h-9 text-sm font-semibold text-teal hover:underline" onClick={() => setForm({ manifest: m, connection: null })}>Ajouter une connexion</button>
            : <p className="mt-2 text-xs text-black/45">{m.status === 'candidate' ? 'Adaptateur à développer et publier avant toute connexion.' : !entity ? 'Aucune entité juridique enregistrée : connexion impossible pour l’instant.' : `Non disponible en ${envLabel[env].toLowerCase()}.`}</p>}
        </li>)}</ul>}
    </Card>

    {form && <ConnectionForm form={form} market={market} entity={entity} env={env} onCancel={() => setForm(null)} onSubmit={(cmd, summary, secrets) => ask(cmd, summary, secrets)} />}
    {history && <Card className="space-y-2"><div className="flex items-center justify-between"><h3 className="font-bold">Historique{history.id ? ` — ${data.connections.find(c => c.id === history.id)?.alias ?? ''}` : ''}</h3>
      <button type="button" className="text-sm font-semibold text-black/60 hover:underline" onClick={() => setHistory(null)}>Fermer</button></div>
      {!history.events.length ? <p className="text-sm text-black/55">Aucun événement.</p> : <ul className="space-y-2 text-sm">{history.events.map(ev => <li key={ev.id}>
        <p className="font-semibold">{ev.summary}</p><p className="text-xs text-black/50">{when(ev.at)} · {ev.actor ?? 'système'} · {ev.reason}</p></li>)}</ul>}</Card>}

    {pending && <div className="fixed inset-0 z-[60] flex items-end justify-center bg-ink/40 p-4 sm:items-center">
      <Card role="dialog" aria-modal="true" aria-labelledby="integration-pending" className="w-full max-w-lg space-y-3"><h2 id="integration-pending" className="font-bold">Confirmer : {pending.summary}</h2>
        <p className="text-sm text-black/60">Effet sur les nouvelles opérations uniquement. Action historisée.</p>
        <label className="block text-sm font-semibold">Motif (obligatoire)<textarea autoFocus value={reason} onChange={e => setReason(e.target.value)} maxLength={500} rows={2} className="mt-1 w-full rounded-xl border border-black/10 p-3 text-sm" /></label>
        <div className="flex flex-wrap gap-2"><Button type="button" disabled={saving || reason.trim().length < 5} onClick={() => void confirm()}>{saving ? 'Enregistrement…' : 'Confirmer'}</Button>
          <button type="button" className="min-h-10 rounded-xl px-4 text-sm font-semibold ring-1 ring-black/10 hover:bg-sand" onClick={() => setPending(null)}>Annuler</button></div></Card></div>}
  </div>;
}

// Formulaire généré depuis le manifeste : seuls les champs déclarés existent, pas d'URL libre.
function ConnectionForm({ form, market, entity, env, onCancel, onSubmit }: { form: NonNullable<Form>; market: string; entity: string; env: IntegrationEnvironment; onCancel: () => void;
  onSubmit: (cmd: IntegrationCommand, summary: string, secrets: Record<string, string>) => void }) {
  const { manifest: m, connection: c } = form;
  const [alias, setAlias] = useState(c?.alias ?? `${m.label} ${env === 'sandbox' ? 'test' : 'réel'}`);
  const [params, setParams] = useState<Record<string, string | number | boolean>>(() => Object.fromEntries(m.fields.filter(f => !f.secret).map(f => [f.key, c?.params[f.key] ?? (f.type === 'boolean' ? false : '')])));
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const missing = m.fields.some(f => f.required && !f.secret && (params[f.key] === '' || params[f.key] === undefined));
  function submit(e: React.FormEvent) {
    e.preventDefault(); if (missing || !alias.trim()) return;
    const cmd: IntegrationCommand = c ? { action: 'update_connection', connection_id: c.id, expected_version: c.version, alias: alias.trim(), params }
      : { action: 'create_connection', provider_id: m.provider_id, alias: alias.trim(), country: market, legal_entity_id: entity, environment: env, params };
    onSubmit(cmd, c ? `${alias} : enregistrer les paramètres` : `ajouter la connexion « ${alias} » (${m.label})`, secrets);
  }
  return <Card><form onSubmit={submit} className="space-y-3"><h3 className="font-bold">{c ? `Paramétrer ${c.alias}` : `Nouvelle connexion ${m.label}`} · {envLabel[env]}</h3>
    <label className="block text-sm font-semibold">Nom de la connexion<Input value={alias} onChange={e => setAlias(e.target.value)} maxLength={80} required className="mt-1" /></label>
    {m.fields.map(f => <label key={f.key} className="block text-sm font-semibold">{f.label}{f.required && !f.secret ? ' *' : ''}
      {f.secret ? <><Input type="password" autoComplete="off" value={secrets[f.key] ?? ''} onChange={e => setSecrets(s => ({ ...s, [f.key]: e.target.value }))} className="mt-1"
          placeholder={c?.secrets.find(s => s.key === f.key)?.present ? 'Enregistré · laisser vide pour conserver' : 'Non enregistré'} />
        <span className="mt-1 block text-xs font-normal text-black/50">Envoyé directement au coffre serveur, jamais réaffiché.</span></>
        : f.type === 'enum' ? <select value={String(params[f.key] ?? '')} onChange={e => setParams(p => ({ ...p, [f.key]: e.target.value }))} className="mt-1 min-h-10 w-full rounded-xl border border-black/10 bg-white px-3 text-sm">
          <option value="">Choisir…</option>{(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}</select>
        : f.type === 'boolean' ? <input type="checkbox" className="ml-2 h-4 w-4 accent-teal" checked={params[f.key] === true} onChange={e => setParams(p => ({ ...p, [f.key]: e.target.checked }))} />
        : <Input type={f.type === 'number' ? 'number' : 'text'} value={String(params[f.key] ?? '')} onChange={e => setParams(p => ({ ...p, [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value }))} className="mt-1" />}
      {f.help && <span className="mt-1 block text-xs font-normal text-black/50">{f.help}</span>}</label>)}
    <div className="flex flex-wrap gap-2"><Button type="submit" disabled={missing || !alias.trim()}>Continuer</Button>
      <button type="button" className="min-h-10 rounded-xl px-4 text-sm font-semibold ring-1 ring-black/10 hover:bg-sand" onClick={onCancel}>Annuler</button></div>
  </form></Card>;
}
