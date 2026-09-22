'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { Badge, Button, Card, Input } from '../../../../components/ui';
import { statusLabel } from '../../../../lib/utils';

type Trade = { id: string; name_fr: string };
type RequestView = { id: string; status: string; created_at?: string; trade_id?: string; trade_name?: string; title?: string; scope?: string; budget_millimes?: number | null; version_no?: number; history: any[] };

const typeLabels: Record<string, string> = { construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' };
const formatTnd = (millimes?: number | null) => millimes == null ? 'Non renseigné' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(millimes) / 1000);
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(value)) : 'Non renseignée';
const moneyToMillimes = (value: string) => value === '' ? null : Math.round(Number(value) * 1000);

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const formRef = useRef<HTMLDivElement>(null);
  const [project, setProject] = useState<any>();
  const [projectVersions, setProjectVersions] = useState<any[]>([]);
  const [projectVersion, setProjectVersion] = useState<any>();
  const [requests, setRequests] = useState<RequestView[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [reviews, setReviews] = useState<any[]>([]);
  const [privateDetails, setPrivateDetails] = useState<any>();
  const [documents, setDocuments] = useState<any[]>([]);
  const [aiProposals, setAiProposals] = useState<any[]>([]);
  const [location, setLocation] = useState('');
  const [trade, setTrade] = useState('');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [budget, setBudget] = useState('');
  const [editingRequestId, setEditingRequestId] = useState<string | null>(null);
  const [historyRequestId, setHistoryRequestId] = useState<string | null>(null);
  const [deletingRequestId, setDeletingRequestId] = useState<string | null>(null);
  const [projectEdit, setProjectEdit] = useState(false);
  const [projectForm, setProjectForm] = useState<any>({});
  const [privateForm, setPrivateForm] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [uploading, setUploading] = useState(false);

  async function load() {
    setLoading(true); setError('');
    const supabase = supabaseBrowser();
    const [projectResult, versionsResult, requestsResult, requestVersionsResult, tradesResult, reviewsResult, privateResult, documentResult, runsResult] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('project_versions').select('*').eq('project_id', id).order('version_no', { ascending: false }),
      supabase.from('project_requests').select('id,status,created_at').eq('project_id', id).order('created_at', { ascending: true }),
      supabase.from('project_request_versions').select('id,request_id,version_no,trade_id,title,scope,budget_millimes,created_at').eq('project_id', id).order('version_no', { ascending: false }),
      supabase.from('trades').select('id,name_fr').eq('active', true).order('name_fr'),
      supabase.from('project_reviews').select('id,project_version_id,actor_role,decision,reason,created_at').order('created_at', { ascending: false }),
      supabase.from('project_private_details').select('exact_address,access_instructions,contact_phone,contact_email').eq('project_id', id).maybeSingle(),
      supabase.from('documents').select('id,original_name,mime_type,size_bytes,status,created_at').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('ai_runs').select('id').eq('project_id', id),
    ]);
    if (projectResult.error || versionsResult.error || requestsResult.error || requestVersionsResult.error) {
      setError('Projet inaccessible ou incomplet.'); setLoading(false); return;
    }
    const versions = versionsResult.data ?? [];
    const latestProjectVersion = versions[0];
    const latestByRequest = new Map<string, any>();
    const historyByRequest = new Map<string, any[]>();
    for (const version of requestVersionsResult.data ?? []) {
      if (!latestByRequest.has(version.request_id)) latestByRequest.set(version.request_id, version);
      historyByRequest.set(version.request_id, [...(historyByRequest.get(version.request_id) ?? []), version]);
    }
    const tradeMap = new Map((tradesResult.data ?? []).map(item => [item.id, item.name_fr]));
    setProject(projectResult.data); setProjectVersions(versions); setProjectVersion(latestProjectVersion); setTrades(tradesResult.data ?? []);
    setReviews((reviewsResult.data ?? []).filter(review => versions.some(version => version.id === review.project_version_id)));
    setPrivateDetails(privateResult.data);
    setPrivateForm(privateResult.data ?? {});
    setDocuments(documentResult.data ?? []);
    setRequests((requestsResult.data ?? []).map(request => {
      const latest = latestByRequest.get(request.id);
      return { ...request, trade_id: latest?.trade_id, trade_name: latest?.trade_id ? tradeMap.get(latest.trade_id) : undefined, title: latest?.title, scope: latest?.scope, budget_millimes: latest?.budget_millimes, version_no: latest?.version_no, history: historyByRequest.get(request.id) ?? [] };
    }));
    const names: string[] = [];
    if (latestProjectVersion?.governorate_id) { const result = await supabase.from('governorates').select('name_fr').eq('id', latestProjectVersion.governorate_id).maybeSingle(); if (result.data?.name_fr) names.push(result.data.name_fr); }
    if (latestProjectVersion?.delegation_id) { const result = await supabase.from('delegations').select('name_fr').eq('id', latestProjectVersion.delegation_id).maybeSingle(); if (result.data?.name_fr) names.push(result.data.name_fr); }
    if (latestProjectVersion?.locality_id) { const result = await supabase.from('localities').select('name_fr').eq('id', latestProjectVersion.locality_id).maybeSingle(); if (result.data?.name_fr) names.push(result.data.name_fr); }
    setLocation(names.join(' · '));
    const runIds = (runsResult.data ?? []).map(run => run.id);
    if (runIds.length) {
      const proposals = await supabase.from('ai_proposals').select('id,run_id,request_id,trade_id,proposed_scope,status,created_at').in('run_id', runIds).order('created_at', { ascending: false });
      setAiProposals(proposals.data ?? []);
    } else setAiProposals([]);
    setProjectForm({ title: latestProjectVersion?.title === 'Nouveau projet' ? '' : latestProjectVersion?.title ?? '', description: latestProjectVersion?.description === 'Brouillon' ? '' : latestProjectVersion?.description ?? '', project_type: latestProjectVersion?.project_type ?? projectResult.data?.project_type ?? 'other', surface_m2: latestProjectVersion?.surface_m2 ?? projectResult.data?.surface_m2 ?? '', desired_start_date: latestProjectVersion?.desired_start_date ?? projectResult.data?.desired_start_date ?? '', desired_end_date: latestProjectVersion?.desired_end_date ?? projectResult.data?.desired_end_date ?? '', indicative_budget_millimes: latestProjectVersion?.indicative_budget_millimes ?? projectResult.data?.indicative_budget_millimes ?? null, governorate_id: latestProjectVersion?.governorate_id ?? '', delegation_id: latestProjectVersion?.delegation_id ?? null, locality_id: latestProjectVersion?.locality_id ?? null });
    setLoading(false);
  }

  useEffect(() => { void load(); }, [id]);

  async function call(path: string, method: string, body: Record<string, unknown>) {
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) throw new Error('Session expirée.');
    const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify(body) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'Opération refusée.');
    return payload.data;
  }

  async function saveProject(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('');
    if (projectForm.desired_start_date && projectForm.desired_end_date && projectForm.desired_end_date < projectForm.desired_start_date) { setError('La date de fin doit être postérieure ou égale à la date de début.'); setSaving(false); return; }
    try {
      await call('/api/projects', 'PATCH', { project_id: id, title: projectForm.title, description: projectForm.description, project_type: projectForm.project_type, surface_m2: projectForm.surface_m2 ? Number(projectForm.surface_m2) : null, desired_start_date: projectForm.desired_start_date || null, desired_end_date: projectForm.desired_end_date || null, indicative_budget_millimes: projectForm.indicative_budget_millimes == null || projectForm.indicative_budget_millimes === '' ? null : Number(projectForm.indicative_budget_millimes), governorate_id: projectForm.governorate_id, delegation_id: projectForm.delegation_id || null, locality_id: projectForm.locality_id || null });
      setProjectEdit(false); setSuccess('Projet mis à jour.'); await load();
    } catch (exception: any) { setError(exception.message); } finally { setSaving(false); }
  }

  async function savePrivateDetails(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('');
    try { await call('/api/projects/private-details', 'POST', { project_id: id, ...privateForm }); setSuccess('Coordonnées privées enregistrées.'); await load(); } catch (exception: any) { setError(exception.message); } finally { setSaving(false); }
  }

  async function submitRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('');
    try {
      await call('/api/projects/requests', editingRequestId ? 'PATCH' : 'POST', editingRequestId ? { request_id: editingRequestId, trade_id: trade, title, scope, budget_millimes: moneyToMillimes(budget) } : { project_id: id, trade_id: trade, title, scope, budget_millimes: moneyToMillimes(budget) });
      setTrade(''); setTitle(''); setScope(''); setBudget(''); setEditingRequestId(null); setSuccess(editingRequestId ? 'Demande modifiée : une nouvelle version est conservée.' : 'Demande ajoutée.'); await load();
    } catch (exception: any) { setError(exception.message); } finally { setSaving(false); }
  }

  function editRequest(request: RequestView) {
    setEditingRequestId(request.id); setTrade(request.trade_id ?? ''); setTitle(request.title ?? ''); setScope(request.scope ?? ''); setBudget(request.budget_millimes == null ? '' : String(Number(request.budget_millimes) / 1000)); setSuccess(''); setError(''); formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function cancelEdit() { setEditingRequestId(null); setTrade(''); setTitle(''); setScope(''); setBudget(''); }
  function duplicateRequest(request: RequestView) { setEditingRequestId(null); setTrade(request.trade_id ?? ''); setTitle(request.title ? request.title + ' - copie' : ''); setScope(request.scope ?? ''); setBudget(request.budget_millimes == null ? '' : String(Number(request.budget_millimes) / 1000)); formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  async function withdrawRequest(request: RequestView) { if (!window.confirm('Retirer cette demande ? Son historique sera conservé.')) return; setDeletingRequestId(request.id); try { await call('/api/projects/requests', 'DELETE', { request_id: request.id }); setSuccess('Demande retirée.'); await load(); } catch (exception: any) { setError(exception.message); } finally { setDeletingRequestId(null); } }
  async function archive() { if (!window.confirm('Archiver ce projet ? Il restera conservé dans votre historique.')) return; try { await call('/api/projects/archive', 'POST', { project_id: id }); setSuccess('Projet archivé.'); await load(); } catch (exception: any) { setError(exception.message); } }
  async function correctProject() { try { await call('/api/projects/correction', 'POST', { project_id: id }); setSuccess('Une nouvelle version brouillon est prête.'); await load(); } catch (exception: any) { setError(exception.message); } }

  async function generateAi(request: RequestView) { try { await call('/api/projects/ai', 'POST', { project_id: id, request_id: request.id, source_description: request.scope }); setSuccess('Proposition assistée générée.'); await load(); } catch (exception: any) { setError(exception.message); } }
  async function acceptAi(proposalId: string) { try { await call('/api/projects/ai/accept', 'POST', { proposal_id: proposalId }); setSuccess('La proposition a créé une nouvelle version du lot.'); await load(); } catch (exception: any) { setError(exception.message); } }
  async function rejectAi(proposalId: string) { try { await call('/api/projects/ai/reject', 'POST', { proposal_id: proposalId }); await load(); } catch (exception: any) { setError(exception.message); } }

  async function uploadDocument(file: File) {
    setUploading(true); setError(''); setSuccess('');
    try {
      const data = await call('/api/documents/project', 'POST', { project_id: id, original_name: file.name, mime_type: file.type, size_bytes: file.size });
      const upload = await supabaseBrowser().storage.from('dao-private').uploadToSignedUrl(data.path, data.token, file);
      if (upload.error) throw upload.error;
      setSuccess('Document envoyé pour contrôle.'); await load();
    } catch (exception: any) { setError(exception.message ?? 'Upload refusé.'); } finally { setUploading(false); }
  }
  async function downloadDocument(documentId: string) {
    try { const data = await call('/api/documents/project/download', 'POST', { document_id: documentId }); window.open(data, '_blank', 'noopener,noreferrer'); } catch (exception: any) { setError(exception.message); }
  }
  async function deleteDocument(documentId: string) {
    if (!window.confirm('Supprimer ce document ?')) return;
    try { await call('/api/documents/project/delete', 'POST', { document_id: documentId }); setSuccess('Document supprimé.'); await load(); } catch (exception: any) { setError(exception.message); }
  }

  const activeRequests = requests.filter(request => request.status !== 'withdrawn');
  const totalLotBudget = activeRequests.reduce((sum, request) => sum + Number(request.budget_millimes ?? 0), 0);
  const projectBudget = Number(project?.indicative_budget_millimes ?? 0);
  const budgetWarning = projectBudget > 0 && totalLotBudget > 0 && Math.abs(totalLotBudget - projectBudget) / projectBudget > 0.1;
  const currentReviews = reviews.filter(review => review.project_version_id === projectVersion?.id);
  const rejectedReason = [...currentReviews].find(review => review.decision === 'rejected')?.reason;
  const requestCountLabel = activeRequests.length + ' lot' + (activeRequests.length > 1 ? 's' : '');

  if (loading) return <p>Chargement du projet…</p>;
  if (!project) return <p role="alert">Projet inaccessible ou introuvable.</p>;

  return <section className="space-y-6">
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div><p className="text-sm font-semibold text-teal">Préparation du DAO</p><h1 className="mt-1 text-3xl font-bold">{projectVersion?.title && projectVersion.title !== 'Nouveau projet' ? projectVersion.title : typeLabels[project.project_type] ?? 'Nouveau projet'}</h1><p className="mt-2 max-w-3xl whitespace-pre-wrap text-sm text-black/60">{projectVersion?.description && projectVersion.description !== 'Brouillon' ? projectVersion.description : 'Décrivez votre chantier pour préparer les lots.'}</p></div>
      <div className="flex flex-wrap items-center gap-2"><Badge>{requestCountLabel}</Badge><Badge>{statusLabel[project.status] ?? project.status}</Badge>{projectVersion?.status && <Badge>{statusLabel[projectVersion.status] ?? projectVersion.status}</Badge>}{projectVersion?.status === 'draft' && activeRequests.length > 0 && <Link href={'/app/projects/' + id + '/review'} className="rounded-lg bg-ink px-3 py-2 text-xs font-semibold text-white">Revoir le DAO</Link>}{projectVersion?.status === 'rejected' && <Button onClick={() => void correctProject()} className="bg-clay">Corriger le DAO</Button>}</div>
    </div>
    {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">{error}</p>}{success && <p className="rounded-xl bg-teal/10 px-4 py-3 text-sm text-teal" role="status">{success}</p>}{rejectedReason && <Card className="border-red-200 bg-red-50"><p className="text-xs font-semibold uppercase tracking-wide text-red-700">Retour DAO</p><p className="mt-2 text-sm text-red-800">{rejectedReason}</p></Card>}
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6"><Card className="p-4"><p className="text-xs text-black/45">Type</p><p className="mt-1 font-semibold">{typeLabels[project.project_type] ?? project.project_type}</p></Card><Card className="p-4"><p className="text-xs text-black/45">Surface</p><p className="mt-1 font-semibold">{project.surface_m2 ?? '—'} m²</p></Card><Card className="p-4"><p className="text-xs text-black/45">Localisation</p><p className="mt-1 font-semibold">{location || 'À préciser'}</p></Card><Card className="p-4"><p className="text-xs text-black/45">Début souhaité</p><p className="mt-1 font-semibold">{formatDate(project.desired_start_date)}</p></Card><Card className="p-4"><p className="text-xs text-black/45">Fin souhaitée</p><p className="mt-1 font-semibold">{formatDate(project.desired_end_date)}</p></Card><Card className="p-4"><p className="text-xs text-black/45">Budget projet</p><p className="mt-1 font-semibold">{formatTnd(project.indicative_budget_millimes)}</p></Card></div>

    {project.status === 'draft' && <Card><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Fiche projet</h2><p className="mt-1 text-xs text-black/45">Modifiez les informations générales tant que le DAO n’est pas publié.</p></div><Button className="bg-white text-ink" onClick={() => setProjectEdit(value => !value)}>{projectEdit ? 'Fermer' : 'Modifier le projet'}</Button></div>{projectEdit && <form onSubmit={saveProject} className="mt-5 grid gap-4 sm:grid-cols-2"><label className="block text-sm font-semibold sm:col-span-2">Titre<Input value={projectForm.title ?? ''} onChange={event => setProjectForm((value: any) => ({ ...value, title: event.target.value }))} required /></label><label className="block text-sm font-semibold sm:col-span-2">Description<textarea className="mt-2 min-h-28 w-full rounded-xl border border-black/10 px-3.5 py-3 text-sm" value={projectForm.description ?? ''} onChange={event => setProjectForm((value: any) => ({ ...value, description: event.target.value }))} /></label><label className="block text-sm font-semibold">Type<select className="mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm" value={projectForm.project_type} onChange={event => setProjectForm((value: any) => ({ ...value, project_type: event.target.value }))}>{Object.entries(typeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label><label className="block text-sm font-semibold">Surface (m²)<Input type="number" min="1" value={projectForm.surface_m2 ?? ''} onChange={event => setProjectForm((value: any) => ({ ...value, surface_m2: event.target.value }))} /></label><label className="block text-sm font-semibold">Budget indicatif (millimes)<Input type="number" min="0" value={projectForm.indicative_budget_millimes ?? ''} onChange={event => setProjectForm((value: any) => ({ ...value, indicative_budget_millimes: event.target.value }))} /></label><label className="block text-sm font-semibold">Début souhaité<Input type="date" value={projectForm.desired_start_date ?? ''} onChange={event => setProjectForm((value: any) => ({ ...value, desired_start_date: event.target.value }))} /></label><label className="block text-sm font-semibold">Fin souhaitée<Input type="date" min={projectForm.desired_start_date || undefined} value={projectForm.desired_end_date ?? ''} onChange={event => setProjectForm((value: any) => ({ ...value, desired_end_date: event.target.value }))} /></label><div className="sm:col-span-2"><Button disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer la fiche'}</Button></div></form>}</Card>}

    <Card><div className="flex items-center justify-between"><div><h2 className="font-semibold">Demandes de travaux</h2><p className="mt-1 text-xs text-black/45">Chaque lot est versionné. Un retrait conserve l’historique.</p></div><Badge>{requestCountLabel}</Badge></div>{budgetWarning && <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">Le total des budgets de lots ({formatTnd(totalLotBudget)}) s’écarte du budget projet ({formatTnd(project.indicative_budget_millimes)}). Vérifiez vos estimations.</p>}{activeRequests.length === 0 ? <p className="mt-5 text-sm text-black/50">Aucun lot actif pour le moment.</p> : <div className="mt-4 space-y-4">{activeRequests.map((request, index) => <article key={request.id} className="rounded-2xl border border-black/5 bg-sand/70 p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-wide text-teal">{request.trade_name ?? 'Métier à préciser'}</span><span className="text-xs text-black/40">Version {request.version_no ?? 1}</span></div><h3 className="mt-1 text-base font-semibold">{request.title || 'Lot ' + (index + 1)}</h3></div><Badge>{statusLabel[request.status] ?? request.status}</Badge></div><p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-black/65">{request.scope || 'Périmètre non renseigné.'}</p><div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-black/5 pt-3"><div className="flex flex-wrap gap-4 text-xs text-black/45"><span>Budget : <strong className="font-medium text-ink">{formatTnd(request.budget_millimes)}</strong></span><button type="button" onClick={() => setHistoryRequestId(historyRequestId === request.id ? null : request.id)} className="font-semibold text-teal">Historique ({request.history.length})</button></div>{project.status === 'draft' && request.status === 'open' && <div className="flex flex-wrap gap-2"><button type="button" onClick={() => editRequest(request)} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-semibold">Modifier</button><button type="button" onClick={() => duplicateRequest(request)} className="rounded-lg border border-black/10 bg-white px-3 py-2 text-xs font-semibold">Dupliquer</button><button type="button" disabled={deletingRequestId === request.id} onClick={() => void withdrawRequest(request)} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-semibold text-red-600">{deletingRequestId === request.id ? 'Retrait…' : 'Retirer'}</button></div>}</div>{historyRequestId === request.id && <div className="mt-3 space-y-2 border-t border-black/5 pt-3">{request.history.map(version => <div key={version.id} className="rounded-lg bg-white px-3 py-2 text-xs"><span className="font-semibold">Version {version.version_no}</span><span className="ml-2 text-black/50">{version.title}</span><span className="ml-2 text-black/40">{formatDate(version.created_at)}</span></div>)}</div>}{project.status === 'draft' && <div className="mt-3 border-t border-black/5 pt-3">{(() => { const proposal = aiProposals.find(item => item.request_id === request.id && item.status === 'proposed'); return proposal ? <div className="rounded-xl bg-white p-3 text-sm"><p className="font-semibold">Proposition assistée</p><p className="mt-2 whitespace-pre-wrap text-black/65">{proposal.proposed_scope}</p><div className="mt-3 flex flex-wrap gap-2"><Button onClick={() => void acceptAi(proposal.id)}>Accepter</Button><Button className="bg-white text-ink" onClick={() => void rejectAi(proposal.id)}>Refuser</Button></div></div> : <button type="button" onClick={() => void generateAi(request)} className="text-xs font-semibold text-teal">Générer une proposition assistée</button>; })()}</div>}</article>)}</div>}</Card>

    <div ref={formRef}><Card><div className="flex items-start justify-between gap-3"><div><h2 className="font-semibold">{editingRequestId ? 'Modifier le lot' : 'Ajouter un lot'}</h2><p className="mt-1 text-xs text-black/45">{editingRequestId ? 'Cette action crée une nouvelle version du lot.' : 'Décrivez un périmètre précis pour obtenir des offres comparables.'}</p></div>{editingRequestId && <button type="button" onClick={cancelEdit} className="text-xs font-semibold text-black/45">Annuler</button>}</div>{(project.status === 'draft') && <form onSubmit={submitRequest} className="mt-4 space-y-3"><label className="block"><span className="mb-1.5 block text-xs font-medium">Métier</span><select aria-label="Métier" className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm" value={trade} onChange={event => setTrade(event.target.value)} required><option value="">Choisir un métier</option>{trades.map(item => <option key={item.id} value={item.id}>{item.name_fr}</option>)}</select></label><label className="block"><span className="mb-1.5 block text-xs font-medium">Intitulé du lot</span><Input placeholder="Ex. Plomberie complète" value={title} onChange={event => setTitle(event.target.value)} required /></label><label className="block"><span className="mb-1.5 block text-xs font-medium">Budget indicatif du lot (TND)</span><Input type="number" min="0" step="0.001" value={budget} onChange={event => setBudget(event.target.value)} /></label><label className="block"><span className="mb-1.5 block text-xs font-medium">Périmètre des travaux</span><textarea aria-label="Périmètre des travaux" className="min-h-32 w-full resize-y rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm" value={scope} onChange={event => setScope(event.target.value)} required /></label><Button className="w-full" disabled={saving}>{saving ? 'Enregistrement…' : editingRequestId ? 'Enregistrer les modifications' : 'Ajouter la demande'}</Button></form>}</Card>

      <Card className="mt-4"><h2 className="font-semibold">Documents et plans</h2><p className="mt-1 text-xs text-black/45">PDF, JPG, PNG ou WebP, 20 Mo maximum. Les fichiers restent privés pendant le contrôle.</p><label className="mt-4 inline-flex cursor-pointer rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm font-semibold hover:border-teal"><span>{uploading ? 'Envoi…' : 'Ajouter un document'}</span><input className="sr-only" type="file" accept=".pdf,image/jpeg,image/png,image/webp" disabled={uploading} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadDocument(file); event.currentTarget.value = ''; }} /></label>{documents.length > 0 && <div className="mt-4 space-y-2">{documents.map(document => <div key={document.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sand/70 px-3 py-2 text-sm"><div><p className="font-medium">{document.original_name}</p><p className="text-xs text-black/45">{document.status === 'approved' ? 'Validé' : document.status === 'rejected' ? 'Refusé' : 'En attente de contrôle'}</p></div><div className="flex gap-2">{document.status === 'approved' && <button type="button" onClick={() => void downloadDocument(document.id)} className="text-xs font-semibold text-teal">Ouvrir</button>}{project.status === 'draft' && <button type="button" onClick={() => void deleteDocument(document.id)} className="text-xs font-semibold text-red-600">Supprimer</button>}</div></div>)}</div>}</Card>

      <Card className="mt-4"><h2 className="font-semibold">Coordonnées privées du chantier</h2><p className="mt-1 text-xs text-black/45">Ces informations ne sont jamais publiées aux artisans.</p><form onSubmit={savePrivateDetails} className="mt-4 grid gap-3 sm:grid-cols-2"><label className="block text-sm font-semibold sm:col-span-2">Adresse exacte<textarea className="mt-2 min-h-20 w-full rounded-xl border border-black/10 px-3.5 py-3 text-sm" value={privateForm.exact_address ?? ''} onChange={event => setPrivateForm((value: any) => ({ ...value, exact_address: event.target.value }))} /></label><label className="block text-sm font-semibold sm:col-span-2">Instructions d’accès<textarea className="mt-2 min-h-20 w-full rounded-xl border border-black/10 px-3.5 py-3 text-sm" value={privateForm.access_instructions ?? ''} onChange={event => setPrivateForm((value: any) => ({ ...value, access_instructions: event.target.value }))} /></label><label className="block text-sm font-semibold">Téléphone<Input value={privateForm.contact_phone ?? ''} placeholder="+216XXXXXXXX" onChange={event => setPrivateForm((value: any) => ({ ...value, contact_phone: event.target.value }))} pattern="\\+216[0-9]{8}" /></label><label className="block text-sm font-semibold">Email<Input type="email" value={privateForm.contact_email ?? ''} onChange={event => setPrivateForm((value: any) => ({ ...value, contact_email: event.target.value }))} /></label><div className="sm:col-span-2"><Button disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer les coordonnées privées'}</Button></div></form></Card></div>

    <Card><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-semibold">Historique du projet</h2><p className="mt-1 text-xs text-black/45">Les versions rejetées et leurs commentaires restent consultables.</p></div><Badge>{projectVersions.length} version{projectVersions.length > 1 ? 's' : ''}</Badge></div><div className="mt-4 space-y-2">{projectVersions.map(version => <div key={version.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sand/70 px-3 py-3 text-sm"><div><span className="font-semibold">Version {version.version_no}</span><span className="ml-3">{statusLabel[version.status] ?? version.status}</span></div><span className="text-xs text-black/45">{formatDate(version.created_at)}</span></div>)}</div></Card>

    {project.status === 'draft' && <div className="flex justify-end"><button type="button" onClick={() => void archive()} className="text-sm font-semibold text-red-600">Abandonner le projet</button></div>}
  </section>;
}
