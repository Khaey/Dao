'use client';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { Badge, Button, Card, Input } from '../../../../components/ui';
import { statusLabel } from '../../../../lib/utils';

type Trade = { id: string; name_fr: string };
type RequestView = {
  id: string;
  status: string;
  created_at?: string;
  trade_id?: string;
  trade_name?: string;
  title?: string;
  scope?: string;
  budget_millimes?: number | null;
  version_no?: number;
};

function formatTnd(millimes?: number | null) {
  if (millimes === null || millimes === undefined) return 'Non renseigné';
  return new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(millimes) / 1000);
}
function formatDate(value?: string | null) {
  if (!value) return 'Non renseignée';
  return new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(value));
}
function projectTypeLabel(value?: string) {
  return ({ construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' } as Record<string,string>)[value ?? ''] ?? value ?? 'Projet';
}

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const [project, setProject] = useState<any>();
  const [projectVersion, setProjectVersion] = useState<any>();
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [location, setLocation] = useState('');
  const [trade, setTrade] = useState('');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [budget, setBudget] = useState('');
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const formRef = useRef<HTMLDivElement>(null);

  async function load() {
    setLoading(true);
    setError('');
    const supabase = supabaseBrowser();
    const [projectResult, projectVersionsResult, requestsResult, requestVersionsResult, tradesResult] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('project_versions').select('*').eq('project_id', id).order('version_no', { ascending: false }).limit(1),
      supabase.from('project_requests').select('id,status,created_at').eq('project_id', id).neq('status', 'withdrawn').order('created_at', { ascending: true }),
      supabase.from('project_request_versions').select('id,request_id,version_no,trade_id,title,scope,budget_millimes').eq('project_id', id).order('version_no', { ascending: false }),
      supabase.from('trades').select('id,name_fr').eq('active', true).order('name_fr'),
    ]);

    if (projectResult.error || projectVersionsResult.error || requestsResult.error || requestVersionsResult.error) {
      setError('Projet inaccessible ou incomplet.');
    }

    const latestProjectVersion = projectVersionsResult.data?.[0];
    setProject(projectResult.data);
    setProjectVersion(latestProjectVersion);
    setTrades(tradesResult.data ?? []);

    const tradeMap = new Map((tradesResult.data ?? []).map((item: Trade) => [item.id, item.name_fr]));
    const latestByRequest = new Map<string, any>();
    for (const version of requestVersionsResult.data ?? []) {
      if (!latestByRequest.has(version.request_id)) latestByRequest.set(version.request_id, version);
    }
    setRequests((requestsResult.data ?? []).map((request: any) => {
      const version = latestByRequest.get(request.id);
      return {
        ...request,
        trade_id: version?.trade_id,
        trade_name: version?.trade_id ? tradeMap.get(version.trade_id) : undefined,
        title: version?.title,
        scope: version?.scope,
        budget_millimes: version?.budget_millimes,
        version_no: version?.version_no,
      };
    }));

    if (latestProjectVersion) {
      const names: string[] = [];
      if (latestProjectVersion.governorate_id) {
        const { data } = await supabase.from('governorates').select('name_fr').eq('id', latestProjectVersion.governorate_id).maybeSingle();
        if (data?.name_fr) names.push(data.name_fr);
      }
      if (latestProjectVersion.delegation_id) {
        const { data } = await supabase.from('delegations').select('name_fr').eq('id', latestProjectVersion.delegation_id).maybeSingle();
        if (data?.name_fr) names.push(data.name_fr);
      }
      if (latestProjectVersion.locality_id) {
        const { data } = await supabase.from('localities').select('name_fr').eq('id', latestProjectVersion.locality_id).maybeSingle();
        if (data?.name_fr) names.push(data.name_fr);
      }
      setLocation(names.join(' · '));
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [id]);

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError(''); setSuccess('');
    const { data: sessionData } = await supabaseBrowser().auth.getSession();
    const session = sessionData.session;
    if (!session) { setError('Session expirée.'); setSaving(false); return; }
    const editing = Boolean(editingRequestId);
    const response = await fetch('/api/projects/requests', {
      method: editing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(editing
        ? { request_id: editingRequestId, trade_id: trade, title, scope, budget_millimes: budget ? Math.round(Number(budget) * 1000) : null }
        : { project_id: id, trade_id: trade, title, scope, budget_millimes: budget ? Math.round(Number(budget) * 1000) : null }),
    });
    const { data, error: responseError } = await response.json();
    if (!response.ok || !data) { setError(responseError || (editing ? 'Modification refusée.' : 'Ajout refusé.')); setSaving(false); return; }
    setTrade(''); setTitle(''); setScope(''); setBudget(''); setEditingRequestId(null);
    setSuccess(editing ? 'Demande modifiée.' : 'Demande ajoutée.');
    await load();
    setSaving(false);
  }

  function editRequest(request: RequestView) {
    setEditingRequestId(request.id);
    setTrade(request.trade_id ?? '');
    setTitle(request.title ?? '');
    setScope(request.scope ?? '');
    setBudget(request.budget_millimes == null ? '' : String(Number(request.budget_millimes) / 1000));
    setSuccess('');
    setError('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function cancelEdit() {
    setEditingRequestId(null);
    setTrade('');
    setTitle('');
    setScope('');
    setBudget('');
    setError('');
    setSuccess('');
  }

  async function deleteRequest(request: RequestView) {
    if (!window.confirm(`Supprimer la demande « ${request.title ?? 'sans titre'} » ?`)) return;
    setDeletingRequestId(request.id); setError(''); setSuccess('');
    const { data: sessionData } = await supabaseBrowser().auth.getSession();
    const session = sessionData.session;
    if (!session) { setError('Session expirée.'); setDeletingRequestId(null); return; }
    const response = await fetch('/api/projects/requests', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ request_id: request.id }),
    });
    const { data, error: responseError } = await response.json();
    if (!response.ok || !data) { setError(responseError || 'Suppression refusée.'); setDeletingRequestId(null); return; }
    if (editingRequestId === request.id) cancelEdit();
    setSuccess('Demande supprimée.');
    await load();
    setDeletingRequestId(null);
  }

  function reuseRequest(request: RequestView) {
    setTrade(request.trade_id ?? '');
    setTitle(request.title ? `${request.title} - copie` : '');
    setScope(request.scope ?? '');
    setBudget(request.budget_millimes == null ? '' : String(Number(request.budget_millimes) / 1000));
    setSuccess('');
    setError('');
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const projectTitle = projectVersion?.title && projectVersion.title !== 'Nouveau projet'
    ? projectVersion.title
    : projectTypeLabel(project?.project_type);
  const description = projectVersion?.description && projectVersion.description !== 'Brouillon' ? projectVersion.description : null;
  const requestCountLabel = useMemo(() => `${requests.length} demande${requests.length > 1 ? 's' : ''}`, [requests.length]);

  if (loading) return <p>Chargement…</p>;
  if (!project) return <p role="alert">Projet inaccessible ou introuvable.</p>;

  return <section className="space-y-6">
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        <p className="text-sm font-semibold text-teal">Préparation du projet</p>
        <h1 className="mt-1 text-3xl font-bold">{projectTitle}</h1>
        {description && <p className="mt-2 max-w-3xl text-sm text-black/60">{description}</p>}
      </div>
      <div className="flex items-center gap-2"><Badge>{requestCountLabel}</Badge><Badge>{statusLabel[project.status] ?? project.status}</Badge></div>
    </div>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      <Card className="p-4"><p className="text-xs text-black/45">Type</p><p className="mt-1 font-semibold">{projectTypeLabel(project.project_type)}</p></Card>
      <Card className="p-4"><p className="text-xs text-black/45">Surface</p><p className="mt-1 font-semibold">{project.surface_m2 ?? '—'} m²</p></Card>
      <Card className="p-4"><p className="text-xs text-black/45">Localisation</p><p className="mt-1 font-semibold">{location || 'Non renseignée'}</p></Card>
      <Card className="p-4"><p className="text-xs text-black/45">Début souhaité</p><p className="mt-1 font-semibold">{formatDate(project.desired_start_date)}</p></Card>
      <Card className="p-4"><p className="text-xs text-black/45">Budget indicatif</p><p className="mt-1 font-semibold">{formatTnd(project.indicative_budget_millimes)}</p></Card>
    </div>

    <div className="grid gap-6 lg:grid-cols-[1.25fr_.75fr]">
      <Card>
        <div className="flex items-center justify-between"><div><h2 className="font-semibold">Demandes de travaux</h2><p className="mt-1 text-xs text-black/45">Détail des lots à intégrer au DAO</p></div><Badge>{requestCountLabel}</Badge></div>
        {requests.length === 0 ? <p className="mt-5 text-sm text-black/50">Aucune demande enregistrée.</p> :
          <div className="mt-4 space-y-4">
            {requests.map((request, index) => <article key={request.id} className="rounded-2xl border border-black/5 bg-sand/70 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-teal">{request.trade_name ?? `Demande ${index + 1}`}</span>
                    {request.version_no && request.version_no > 1 && <span className="text-xs text-black/40">v{request.version_no}</span>}
                  </div>
                  <h3 className="mt-1 text-base font-semibold">{request.title || `Demande ${index + 1}`}</h3>
                </div>
                <Badge>{statusLabel[request.status] ?? request.status}</Badge>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-black/65">{request.scope || 'Périmètre non renseigné.'}</p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/5 pt-3">
                <div className="flex flex-wrap gap-4 text-xs text-black/45">
                  <span>Budget lot : <strong className="font-medium text-ink">{formatTnd(request.budget_millimes)}</strong></span>
                  {request.created_at && <span>Ajoutée le {formatDate(request.created_at)}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {project.status === 'draft' && request.status === 'open' && <button type="button" onClick={() => editRequest(request)} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-semibold hover:border-teal hover:text-teal">Modifier</button>}
                  <button type="button" onClick={() => reuseRequest(request)} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-semibold hover:border-teal hover:text-teal">Dupliquer</button>
                  {project.status === 'draft' && request.status === 'open' && <button type="button" disabled={deletingRequestId === request.id} onClick={() => void deleteRequest(request)} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">{deletingRequestId === request.id ? 'Suppression…' : 'Supprimer'}</button>}
                </div>
              </div>
            </article>)}
          </div>}
      </Card>

      <div ref={formRef}>
        <Card>
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="font-semibold">{editingRequestId ? 'Modifier la demande' : 'Ajouter une demande'}</h2><p className="mt-1 text-xs text-black/45">{editingRequestId ? 'Les modifications créent une nouvelle version du lot.' : 'Décris un lot précis : métier, intitulé et périmètre.'}</p></div>
            {editingRequestId && <button type="button" onClick={cancelEdit} className="text-xs font-semibold text-black/45 hover:text-ink">Annuler</button>}
          </div>
          <form onSubmit={submitRequest} className="mt-4 space-y-3">
            <label className="block"><span className="mb-1.5 block text-xs font-medium">Métier</span><select aria-label="Métier" className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm outline-none ring-teal/20 focus:ring-4" value={trade} onChange={(event) => setTrade(event.target.value)} required><option value="">Choisir un métier</option>{trades.map((item) => <option key={item.id} value={item.id}>{item.name_fr}</option>)}</select></label>
            <label className="block"><span className="mb-1.5 block text-xs font-medium">Intitulé</span><Input placeholder="Ex. Plomberie complète de la salle de bain" value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-medium">Budget indicatif du lot (TND)</span><Input type="number" min="0" step="0.001" placeholder="Ex. 25000" value={budget} onChange={(event) => setBudget(event.target.value)} /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-medium">Périmètre des travaux</span><textarea className="min-h-32 w-full resize-y rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm outline-none ring-teal/20 focus:ring-4" placeholder="Ex. Dépose de l'existant, alimentation EF/EC, évacuations, pose des sanitaires, essais et remise en état…" value={scope} onChange={(event) => setScope(event.target.value)} required /></label>
            {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
            {success && <p className="text-xs text-teal" role="status">{success}</p>}
            <Button className="w-full" disabled={saving}>{saving ? (editingRequestId ? 'Enregistrement…' : 'Ajout…') : (editingRequestId ? 'Enregistrer les modifications' : 'Ajouter la demande')}</Button>
          </form>
        </Card>
        <Card className="mt-4">
          <h3 className="text-sm font-semibold">Options à venir</h3>
          <p className="mt-2 text-xs leading-5 text-black/50">Les prochaines options seront le budget par lot, les pièces jointes/photos et la génération assistée du cahier des charges.</p>
        </Card>
      </div>
    </div>
  </section>;
}
