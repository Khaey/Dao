'use client';
import ReviewHistory from '../../../../components/backoffice/ReviewHistory';

import Link from 'next/link';
import { FormEvent, TouchEvent as ReactTouchEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Activity, AlertCircle, Archive, ArrowRight, Building2, CalendarDays, Check, ChevronDown, ChevronLeft, Eye, FileText, History, Layers, LayoutDashboard, Lock, MapPin, MessageCircle, Pencil, Plus, RotateCcw, ShieldCheck, Sparkles, Trash2, Upload, Users } from 'lucide-react';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { Badge, Card, Input, SectionHeading } from '../../../../components/ui';
import ProjectTeam from '../../../../components/ProjectTeam';
import ProjectTracking from '../../../../components/ProjectTracking';
import SiteExecutionJournal from '../../../../components/SiteExecutionJournal';
import OceLotPlanning from '../../../../components/OceLotPlanning';
import ProjectGlobalPlan from '../../../../components/ProjectGlobalPlan';
import ReviewOpportunities from '../../../../components/reviews/ReviewOpportunities';
import { emptyTeam, projectApi, stageLabels, Team } from '../../../../lib/collaboration';
import { cn, effectiveProjectStatus, displayProjectStatus, approvedVersionLabel, statusLabel } from '../../../../lib/utils';
import { DossierSteps, ErrorPanel, fieldClass, Pill, primaryAction, ProgressBar, readableStatus, secondaryAction, StatusPill } from '../_components/ProjectUi';
import { CommercialPanel, commercialLabel, isReady, useCommercialProgress } from '../../../../components/client/CommercialProgress';

type Trade = { id: string; name_fr: string };
type RequestView = { contractor_member_id?: string | null; id: string; status: string; created_at?: string; trade_id?: string; trade_name?: string; title?: string; scope?: string; budget_millimes?: number | null; version_no?: number; history: any[] };
type Tab = 'overview' | 'lots' | 'team' | 'documents' | 'tracking' | 'dao' | 'history';
const typeLabels: Record<string, string> = { construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' };
const formatTnd = (millimes?: number | null) => millimes == null ? 'Non renseigné' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(millimes) / 1000);
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(value)) : 'Non renseignée';
const moneyToMillimes = (value: string) => value === '' ? null : Math.round(Number(value) * 1000);
const tabs: { id: Tab; label: string; icon: typeof FileText }[] = [{ id: 'overview', label: 'Vue d’ensemble', icon: LayoutDashboard }, { id: 'lots', label: 'Lots', icon: Layers }, { id: 'team', label: 'Équipe', icon: Users }, { id: 'tracking', label: 'Suivi', icon: Activity }, { id: 'documents', label: 'Documents', icon: FileText }, { id: 'dao', label: 'DAO', icon: ShieldCheck }, { id: 'history', label: 'Historique', icon: History }];
const mimeLabels: Record<string, string> = { 'application/pdf': 'PDF', 'image/jpeg': 'Image JPG', 'image/png': 'Image PNG', 'image/webp': 'Image WebP' };
const labelClass = 'block text-sm font-semibold text-ink';
const lotLabels: Record<string, string> = { open: 'Ouvert', reserved: 'Réservé', awarded: 'Attribué', contracted: 'Sous contrat', withdrawn: 'Retiré' };
const iconButton = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-black/10 bg-white text-ink/65 transition hover:border-teal/40 hover:text-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal disabled:opacity-50';
const dangerIconButton = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-red-100 bg-white text-red-600 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 disabled:opacity-50';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const formRef = useRef<HTMLDivElement>(null); const loadGeneration = useRef(0);
  const [team, setTeam] = useState<Team>(emptyTeam); const [userId, setUserId] = useState(''); const [shareScope, setShareScope] = useState('owner_only');
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [invitationLotId, setInvitationLotId] = useState<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'team') {
      setActiveTab('team');
      const lotId = params.get('request_id');
      if (lotId && /^[0-9a-f-]{36}$/i.test(lotId)) setInvitationLotId(lotId);
    }
    if (params.get('tab') === 'overview' && params.get('edit') === 'project') {
      setActiveTab('overview');
      setProjectEdit(true);
    }
  }, []);
  const [project, setProject] = useState<any>(); const [projectVersions, setProjectVersions] = useState<any[]>([]); const [projectVersion, setProjectVersion] = useState<any>(); const [requests, setRequests] = useState<RequestView[]>([]); const [trades, setTrades] = useState<Trade[]>([]); const [reviews, setReviews] = useState<any[]>([]); const [documents, setDocuments] = useState<any[]>([]); const [aiProposals, setAiProposals] = useState<any[]>([]); const [location, setLocation] = useState(''); const [privateForm, setPrivateForm] = useState<any>({}); const [projectForm, setProjectForm] = useState<any>({});
  const [showLotForm, setShowLotForm] = useState(false); const [trade, setTrade] = useState(''); const [title, setTitle] = useState(''); const [scope, setScope] = useState(''); const [budget, setBudget] = useState(''); const [editingRequestId, setEditingRequestId] = useState<string | null>(null); const [historyRequestId, setHistoryRequestId] = useState<string | null>(null); const [deletingRequestId, setDeletingRequestId] = useState<string | null>(null); const [projectEdit, setProjectEdit] = useState(false); const [loading, setLoading] = useState(true); const [saving, setSaving] = useState(false); const [uploading, setUploading] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [mainLotForm, setMainLotForm] = useState({ trade: '', title: '', scope: '', budget: '' });
  const [mainLotTouched, setMainLotTouched] = useState(false);
  const mainLotPrefillVersion = useRef<string | null>(null);
  const tabNav = useRef<HTMLElement>(null); const projectEditRef = useRef<HTMLDivElement>(null);
  // Keep the active section visible in the horizontally scrollable tab bar (mobile).
  useEffect(() => { const nav = tabNav.current; const active = nav?.querySelector<HTMLElement>('[aria-current="true"]'); if (nav && active) nav.scrollLeft = Math.max(0, active.offsetLeft - 16); }, [activeTab, loading]);
  // When the project form opens (button or ?edit=project), bring it into view on small screens.
  useEffect(() => { if (projectEdit && !loading) projectEditRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [projectEdit, loading]);
  // Touch screens: a horizontal swipe on the section content moves to the next / previous tab.
  // Ignored for screen-edge gestures (browser back), form fields, horizontally scrollable areas,
  // mostly-vertical moves and text selection, so scrolling and editing keep working as before.
  const tabPanel = useRef<HTMLDivElement>(null); const swipeStart = useRef<{ x: number; y: number; t: number } | null>(null); const swipeDirection = useRef(0);
  function onSwipeStart(event: ReactTouchEvent<HTMLDivElement>) {
    swipeStart.current = null;
    if (event.touches.length !== 1) return;
    const touch = event.touches[0]; const target = event.target as HTMLElement;
    if (touch.clientX < 24 || touch.clientX > window.innerWidth - 24) return;
    if (target.closest('input, textarea, select, [contenteditable="true"], [data-no-swipe]')) return;
    for (let node: HTMLElement | null = target; node && node !== event.currentTarget; node = node.parentElement) { const overflowX = getComputedStyle(node).overflowX; if ((overflowX === 'auto' || overflowX === 'scroll') && node.scrollWidth > node.clientWidth) return; }
    swipeStart.current = { x: touch.clientX, y: touch.clientY, t: Date.now() };
  }
  function onSwipeEnd(event: ReactTouchEvent<HTMLDivElement>) {
    const start = swipeStart.current; swipeStart.current = null;
    if (!start || event.changedTouches.length !== 1) return;
    const touch = event.changedTouches[0]; const dx = touch.clientX - start.x; const dy = touch.clientY - start.y;
    if (Date.now() - start.t > 700 || Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
    if (window.getSelection()?.toString()) return;
    const next = tabs[tabs.findIndex(tab => tab.id === activeTab) + (dx < 0 ? 1 : -1)];
    if (!next) return;
    swipeDirection.current = dx < 0 ? 1 : -1; setActiveTab(next.id);
  }
  useEffect(() => {
    const direction = swipeDirection.current; swipeDirection.current = 0;
    if (!direction) return;
    const navTop = tabNav.current?.getBoundingClientRect().top;
    if (navTop !== undefined && navTop < 64) window.scrollBy({ top: navTop - 72, behavior: 'smooth' });
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) tabPanel.current?.animate([{ transform: `translateX(${direction * 28}px)`, opacity: 0.4 }, { transform: 'translateX(0)', opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.2,.7,.2,1)' });
  }, [activeTab]);

  async function openConversation(memberId:string){
    setError('');
    try { const conversationId=await projectApi<string>('/api/messages/conversations',{project_id:id,member_id:memberId}); router.push(`/app/messages/${conversationId}`); }
    catch(exception:any){ setError(exception.message); }
  }

  function prefillMainLot(version: any, projectBudgetMillimes: number | string | null | undefined) {
    const currentDescription = typeof version?.description === 'string' ? version.description.trim() : '';
    setMainLotForm({
      trade: '',
      title: version?.title ?? '',
      scope: currentDescription && currentDescription !== 'Brouillon' ? currentDescription : '',
      budget: projectBudgetMillimes == null ? '' : String(Number(projectBudgetMillimes) / 1000),
    });
    setMainLotTouched(false);
    mainLotPrefillVersion.current = version?.id ?? null;
  }

  async function load() {
    const generation = ++loadGeneration.current;
    const isCurrentLoad = () => generation === loadGeneration.current;
    setLoading(true);
    setError('');
    const supabase = supabaseBrowser();
    const [projectResult, versionsResult, requestsResult, requestVersionsResult, tradesResult, reviewsResult, privateResult, documentResult, runsResult, teamResult, sessionResult] = await Promise.all([
      supabase.from('projects').select('*').eq('id', id).single(),
      supabase.from('project_versions').select('*').eq('project_id', id).order('version_no', { ascending: false }),
      supabase.from('project_requests').select('id,status,created_at,contractor_member_id').eq('project_id', id).order('created_at', { ascending: true }),
      supabase.from('project_request_versions').select('id,request_id,version_no,trade_id,title,scope,budget_millimes,created_at').eq('project_id', id).order('version_no', { ascending: false }),
      supabase.from('trades').select('id,name_fr').eq('active', true).order('name_fr'),
      supabase.from('project_reviews').select('id,project_version_id,actor_role,decision,reason,created_at').order('created_at', { ascending: false }),
      supabase.from('project_private_details').select('exact_address,access_instructions,contact_phone,contact_email').eq('project_id', id).maybeSingle(),
      supabase.from('documents').select('id,owner_id,share_scope,original_name,mime_type,size_bytes,status,created_at').eq('project_id', id).order('created_at', { ascending: false }),
      supabase.from('ai_runs').select('id').eq('project_id', id),
      projectApi<Team>(`/api/projects/team?project_id=${id}`).catch(() => null),
      supabase.auth.getSession(),
    ]);
    if (!isCurrentLoad()) return;
    if (!teamResult || projectResult.error || versionsResult.error || requestsResult.error || requestVersionsResult.error) {
      setError('Projet inaccessible ou incomplet.');
      setLoading(false);
      return;
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
    const nextRequests = (requestsResult.data ?? []).map(request => {
      const latest = latestByRequest.get(request.id);
      return {
        ...request,
        trade_id: latest?.trade_id,
        trade_name: latest?.trade_id ? tradeMap.get(latest.trade_id) : undefined,
        title: latest?.title,
        scope: latest?.scope,
        budget_millimes: latest?.budget_millimes,
        version_no: latest?.version_no,
        history: historyByRequest.get(request.id) ?? [],
      };
    });
    if (!nextRequests.some(request => request.status !== 'withdrawn')) {
      const currentVersionKey = latestProjectVersion?.id ?? id;
      if (mainLotPrefillVersion.current !== currentVersionKey) {
        prefillMainLot(latestProjectVersion, projectResult.data?.indicative_budget_millimes);
        mainLotPrefillVersion.current = currentVersionKey;
      }
    }

    const names: string[] = [];
    if (latestProjectVersion?.governorate_id) {
      const result = await supabase.from('governorates').select('name_fr').eq('id', latestProjectVersion.governorate_id).maybeSingle();
      if (!isCurrentLoad()) return;
      if (result.data?.name_fr) names.push(result.data.name_fr);
    }
    if (latestProjectVersion?.delegation_id) {
      const result = await supabase.from('delegations').select('name_fr').eq('id', latestProjectVersion.delegation_id).maybeSingle();
      if (!isCurrentLoad()) return;
      if (result.data?.name_fr) names.push(result.data.name_fr);
    }
    if (latestProjectVersion?.locality_id) {
      const result = await supabase.from('localities').select('name_fr').eq('id', latestProjectVersion.locality_id).maybeSingle();
      if (!isCurrentLoad()) return;
      if (result.data?.name_fr) names.push(result.data.name_fr);
    }

    const runIds = (runsResult.data ?? []).map(run => run.id);
    let nextAiProposals: any[] = [];
    if (runIds.length) {
      const proposals = await supabase.from('ai_proposals').select('id,run_id,request_id,trade_id,proposed_scope,status,created_at').in('run_id', runIds).order('created_at', { ascending: false });
      if (!isCurrentLoad()) return;
      nextAiProposals = proposals.data ?? [];
    }
    if (!isCurrentLoad()) return;

    setTeam(teamResult);
    setUserId(sessionResult.data.session?.user.id ?? '');
    setProject(projectResult.data);
    setProjectVersions(versions);
    setProjectVersion(latestProjectVersion);
    setTrades(tradesResult.data ?? []);
    setReviews((reviewsResult.data ?? []).filter(review => versions.some(version => version.id === review.project_version_id)));
    setPrivateForm(privateResult.data ?? {});
    setDocuments(documentResult.data ?? []);
    setRequests(nextRequests);
    setAiProposals(nextAiProposals);
    setLocation(names.join(' · '));
    setProjectForm({
      title: latestProjectVersion?.title === 'Nouveau projet' ? '' : latestProjectVersion?.title ?? '',
      description: latestProjectVersion?.description === 'Brouillon' ? '' : latestProjectVersion?.description ?? '',
      project_type: latestProjectVersion?.project_type ?? projectResult.data?.project_type ?? 'other',
      surface_m2: latestProjectVersion?.surface_m2 ?? projectResult.data?.surface_m2 ?? '',
      desired_start_date: latestProjectVersion?.desired_start_date ?? projectResult.data?.desired_start_date ?? '',
      desired_end_date: latestProjectVersion?.desired_end_date ?? projectResult.data?.desired_end_date ?? '',
      indicative_budget_tnd: latestProjectVersion?.indicative_budget_millimes == null ? '' : String(Number(latestProjectVersion.indicative_budget_millimes) / 1000),
    });
    setLoading(false);
  }
  async function refreshDocuments() { const { data } = await supabaseBrowser().from('documents').select('id,owner_id,share_scope,original_name,mime_type,size_bytes,status,created_at').eq('project_id', id).order('created_at', { ascending: false }); setDocuments(data ?? []); }
  useEffect(() => { const tab = new URLSearchParams(window.location.search).get('tab'); if (tabs.some(item => item.id === tab)) setActiveTab(tab as Tab); void load(); return () => { loadGeneration.current += 1; }; }, [id]);

  // #346: commercial progress (chosen Artisan per lot) for the Client owner of a published chantier.
  const publishedLike = Boolean(project && ['open', 'published', 'closed'].includes(project.status));
  const commercial = useCommercialProgress(id, requests.filter(request => request.status !== 'withdrawn').map(request => request.id), publishedLike && team.is_client);
  async function call(path: string, method: string, body: Record<string, unknown>) { const { data } = await supabaseBrowser().auth.getSession(); if (!data.session) throw new Error('Session expirée.'); const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify(body) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error ?? 'Opération refusée.'); return payload.data; }
  async function saveProject(event: FormEvent) { event.preventDefault(); setSaving(true); setError(''); setSuccess(''); if (projectForm.desired_start_date && projectForm.desired_end_date && projectForm.desired_end_date < projectForm.desired_start_date) { setError('La date de fin doit être postérieure ou égale à la date de début.'); setSaving(false); return; } try { const updatedVersion = await call('/api/projects', 'PATCH', { project_id: id, title: projectForm.title, description: projectForm.description, project_type: projectForm.project_type, surface_m2: projectForm.surface_m2 ? Number(projectForm.surface_m2) : null, desired_start_date: projectForm.desired_start_date || null, desired_end_date: projectForm.desired_end_date || null, indicative_budget_millimes: projectForm.indicative_budget_tnd == null || projectForm.indicative_budget_tnd === '' ? null : moneyToMillimes(String(projectForm.indicative_budget_tnd)) });
      // The command returns the authoritative version. Apply it immediately
      // so a slightly delayed RLS read cannot overwrite the screen with an
      // older replica result just after a successful save.
      if (updatedVersion?.id) { setProjectVersion(updatedVersion); setProjectVersions(previous => previous.some(version => version.id === updatedVersion.id) ? previous.map(version => version.id === updatedVersion.id ? updatedVersion : version) : [updatedVersion, ...previous]); }
      setProject((previous: any) => previous ? { ...previous, project_type: updatedVersion?.project_type ?? projectForm.project_type, surface_m2: updatedVersion?.surface_m2 ?? (projectForm.surface_m2 ? Number(projectForm.surface_m2) : null), desired_start_date: updatedVersion?.desired_start_date ?? (projectForm.desired_start_date || null), desired_end_date: updatedVersion?.desired_end_date ?? (projectForm.desired_end_date || null), indicative_budget_millimes: updatedVersion?.indicative_budget_millimes ?? (projectForm.indicative_budget_tnd === '' ? null : moneyToMillimes(String(projectForm.indicative_budget_tnd))) } : previous);
      setProjectForm((previous: any) => ({ ...previous, title: updatedVersion?.title ?? previous.title, description: updatedVersion?.description ?? previous.description, project_type: updatedVersion?.project_type ?? previous.project_type, surface_m2: updatedVersion?.surface_m2 ?? previous.surface_m2, desired_start_date: updatedVersion?.desired_start_date ?? previous.desired_start_date, desired_end_date: updatedVersion?.desired_end_date ?? previous.desired_end_date, indicative_budget_tnd: updatedVersion?.indicative_budget_millimes == null ? '' : String(Number(updatedVersion.indicative_budget_millimes) / 1000) }));
      if (!requests.some(request => request.status !== 'withdrawn')) {
        if (!mainLotTouched) prefillMainLot(updatedVersion, updatedVersion?.indicative_budget_millimes);
        else mainLotPrefillVersion.current = updatedVersion?.id ?? null;
      }
      setProjectEdit(false); setSuccess('Projet mis à jour.');
    } catch (exception: any) { setError(exception.message); } finally { setSaving(false); } }
  async function savePrivateDetails(event: FormEvent) { event.preventDefault(); setSaving(true); setError(''); setSuccess(''); try { await call('/api/projects/private-details', 'POST', { project_id: id, ...privateForm }); setSuccess('Coordonnées privées enregistrées.'); await load(); } catch (exception: any) { setError(exception.message); } finally { setSaving(false); } }
  async function submitRequest(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(''); setSuccess(''); try { const editing = Boolean(editingRequestId); await call('/api/projects/requests', editing ? 'PATCH' : 'POST', editing ? { request_id: editingRequestId, trade_id: trade, title, scope, budget_millimes: moneyToMillimes(budget) } : { project_id: id, trade_id: trade, title, scope, budget_millimes: moneyToMillimes(budget) }); setTrade(''); setTitle(''); setScope(''); setBudget(''); setEditingRequestId(null); setSuccess(editing ? 'Lot modifié : une nouvelle version est conservée.' : 'Lot ajouté.'); await load(); } catch (exception: any) { setError(exception.message); } finally { setSaving(false); } }
  async function submitMainLot(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSaving(true); setError(''); setSuccess(''); try { await call('/api/projects/requests', 'POST', { project_id: id, trade_id: mainLotForm.trade, title: mainLotForm.title, scope: mainLotForm.scope, budget_millimes: moneyToMillimes(mainLotForm.budget) }); setMainLotTouched(false); setSuccess('Lot principal créé.'); await load(); } catch (exception: any) { setError(exception.message); } finally { setSaving(false); } }
  function editRequest(request: RequestView) { setActiveTab('lots'); setShowLotForm(true); setEditingRequestId(request.id); setTrade(request.trade_id ?? ''); setTitle(request.title ?? ''); setScope(request.scope ?? ''); setBudget(request.budget_millimes == null ? '' : String(Number(request.budget_millimes) / 1000)); setSuccess(''); setError(''); formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  function cancelEdit() { setEditingRequestId(null); setShowLotForm(false); setTrade(''); setTitle(''); setScope(''); setBudget(''); }
  function duplicateRequest(request: RequestView) { setActiveTab('lots'); setEditingRequestId(null); setShowLotForm(true); setTrade(request.trade_id ?? ''); setTitle(request.title ? request.title + ' - copie' : ''); setScope(request.scope ?? ''); setBudget(request.budget_millimes == null ? '' : String(Number(request.budget_millimes) / 1000)); formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  async function withdrawRequest(request: RequestView) { if (!window.confirm('Retirer ce lot ? Son historique sera conservé.')) return; setDeletingRequestId(request.id); try { await call('/api/projects/requests', 'DELETE', { request_id: request.id }); if (activeRequests.length === 1) { mainLotPrefillVersion.current = null; setMainLotTouched(false); } setSuccess('Lot retiré.'); await load(); } catch (exception: any) { setError(exception.message); } finally { setDeletingRequestId(null); } }
  async function archive() { if (!window.confirm('Archiver ce projet ? Il restera conservé dans votre historique.')) return; try { await call('/api/projects/archive', 'POST', { project_id: id }); setSuccess('Projet archivé.'); await load(); } catch (exception: any) { setError(exception.message); } }
  async function correctProject() { try { await call('/api/projects/correction', 'POST', { project_id: id }); setSuccess('Une nouvelle version brouillon est prête.'); setActiveTab('dao'); await load(); } catch (exception: any) { setError(exception.message); } }
  async function generateAi(request: RequestView) { try { await call('/api/projects/ai', 'POST', { project_id: id, request_id: request.id, source_description: request.scope }); setSuccess('Proposition assistée générée.'); await load(); } catch (exception: any) { setError(exception.message); } }
  async function acceptAi(proposalId: string) { try { await call('/api/projects/ai/accept', 'POST', { proposal_id: proposalId }); setSuccess('La proposition a créé une nouvelle version du lot.'); await load(); } catch (exception: any) { setError(exception.message); } }
  async function rejectAi(proposalId: string) { try { await call('/api/projects/ai/reject', 'POST', { proposal_id: proposalId }); await load(); } catch (exception: any) { setError(exception.message); } }
  async function uploadDocument(file: File) { setUploading(true); setError(''); setSuccess(''); try { const data = await call('/api/documents/project', 'POST', { project_id: id, original_name: file.name, mime_type: file.type, size_bytes: file.size, share_scope: shareScope }); const upload = await supabaseBrowser().storage.from('dao-private').uploadToSignedUrl(data.path, data.token, file); if (upload.error) throw upload.error; await refreshDocuments(); setSuccess('Document envoyé pour contrôle.'); } catch (exception: any) { setError(exception.message ?? 'Upload refusé.'); } finally { setUploading(false); } }
  async function downloadDocument(documentId: string) { try { const data = await call('/api/documents/project/download', 'POST', { document_id: documentId }); window.open(data, '_blank', 'noopener,noreferrer'); } catch (exception: any) { setError(exception.message); } }
  async function deleteDocument(documentId: string) { if (!window.confirm('Retirer ce document ?')) return; try { await call('/api/documents/project/delete', 'POST', { document_id: documentId }); setDocuments(previous => previous.filter(document => document.id !== documentId)); setSuccess('Document retiré.'); } catch (exception: any) { setError(exception.message); } }

  const backLink = <Link href="/app/projects" className="-ml-2 inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-teal transition hover:bg-teal/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"><ChevronLeft size={16} aria-hidden="true" />Mes chantiers</Link>;
  if (loading) return <div aria-busy="true" className="space-y-6"><span className="sr-only">Chargement du chantier…</span><div className="h-5 w-28 animate-pulse rounded bg-ink/[0.07]" /><div className="rounded-2xl border border-black/[0.06] bg-white p-5 sm:p-7"><div className="h-6 w-28 animate-pulse rounded-full bg-ink/[0.06]" /><div className="mt-4 h-8 w-2/3 animate-pulse rounded bg-ink/[0.08]" /><div className="mt-3 h-4 w-1/2 animate-pulse rounded bg-ink/[0.05]" /><div className="mt-7 grid grid-cols-4 gap-2">{[0, 1, 2, 3].map(item => <div key={item} className="h-1.5 animate-pulse rounded-full bg-ink/[0.08]" />)}</div></div><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map(item => <div key={item} className="h-24 animate-pulse rounded-2xl border border-black/[0.04] bg-white" />)}</div></div>;
  if (!project) return <div className="space-y-4">{backLink}<ErrorPanel title="Chantier indisponible" message="Projet inaccessible ou introuvable. Vérifiez le lien reçu ou votre accès à ce chantier." onRetry={() => void load()} backHref="/app/projects" /></div>;
  const effectiveStatus = effectiveProjectStatus(project.status, projectVersion?.status); const canEdit = team.can_prepare && project.status !== 'archived'; const isClient = team.is_client; const canUpload = project.status !== 'archived' && team.members.some(member => member.user_id === userId && member.status === 'accepted'); const contractors = team.members.filter(member => member.participation_role === 'contractor' && member.status === 'accepted'); const myContractorMember = contractors.find(member => member.user_id === userId); const activeRequests = requests.filter(request => request.status !== 'withdrawn'); const canEditLots = canEdit && project.status === 'draft' && projectVersion?.status === 'draft'; const totalLotBudget = activeRequests.reduce((sum, request) => sum + Number(request.budget_millimes ?? 0), 0); const projectBudget = Number(project?.indicative_budget_millimes ?? 0); const datesReady = Boolean(projectVersion?.desired_start_date && projectVersion?.desired_end_date) && projectVersion.desired_end_date >= projectVersion.desired_start_date; const budgetWarning = projectBudget > 0 && totalLotBudget > 0 && Math.abs(totalLotBudget - projectBudget) / projectBudget > 0.1; const currentReviews = reviews.filter(review => review.project_version_id === projectVersion?.id); const rejectedReason = [...currentReviews].find(review => review.decision === 'rejected')?.reason; const projectTitle = projectVersion?.title && projectVersion.title !== 'Nouveau projet' ? projectVersion.title : typeLabels[project?.project_type] ?? 'Nouveau projet'; const description = projectVersion?.description && projectVersion.description !== 'Brouillon' ? projectVersion.description : 'Décrivez votre chantier pour préparer les lots.'; const completionItems = [Boolean(projectForm.title), Boolean(location), activeRequests.length > 0, Boolean(project?.indicative_budget_millimes), documents.length > 0]; const completion = Math.round(completionItems.filter(Boolean).length / completionItems.length * 100); const requestCountLabel = `${activeRequests.length} lot${activeRequests.length > 1 ? 's' : ''}`;

  const professionalName = (memberId?: string | null) => contractors.find(member => member.id === memberId)?.name;
  const commercialReady = isReady(commercial);
  // Lot label: commercial state once published (from real awards/offers), otherwise the lot's own status.
  const lotStatus = (request: RequestView): { label: string; tone: 'teal' | 'clay' | 'neutral' } => {
    if (commercialReady && commercial.publications.length) {
      if (commercial.byLot[request.id]) return { label: 'Attribué', tone: 'teal' };
      if (commercial.offerLots?.includes(request.id)) return { label: 'Offres à comparer', tone: 'clay' };
      if (commercial.offerLots) return { label: 'En attente d’offres', tone: 'neutral' };
    }
    return { label: lotLabels[request.status] ?? readableStatus(request.status), tone: request.status === 'open' ? 'teal' : 'neutral' };
  };
  const lotList = <Card className="p-5 sm:p-6">
    <SectionHeading title="Lots de travaux" description="Chaque lot reste autonome et versionné pour obtenir des offres comparables." action={canEditLots && activeRequests.length > 0 ? <button type="button" className={primaryAction} onClick={() => { setEditingRequestId(null); setShowLotForm(true); setActiveTab('lots'); setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth' }), 50); }}><Plus size={16} aria-hidden="true" />Ajouter un lot</button> : undefined} />
    {budgetWarning && <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900"><AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" /><span>Le total des budgets de lots ({formatTnd(totalLotBudget)}) s’écarte du budget projet ({formatTnd(project.indicative_budget_millimes)}).</span></p>}
    {activeRequests.length === 0 ? <div className="mt-6 border-t border-black/[0.06] pt-6">
      <SectionHeading title="Travaux du projet" description="Définissez le lot principal à partir des informations du projet. Vous pouvez ajuster ces valeurs avant de le créer." />
      {canEditLots ? <form onSubmit={submitMainLot} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className={labelClass}>Métier<select aria-label="Métier" className={cn(fieldClass, 'mt-2')} value={mainLotForm.trade} onChange={event => { setMainLotTouched(true); setMainLotForm(value => ({ ...value, trade: event.target.value })); }} required><option value="">Choisir un métier</option>{trades.map(item => <option key={item.id} value={item.id}>{item.name_fr}</option>)}</select></label>
        <label className={labelClass}>Intitulé du lot<Input aria-label="Intitulé du lot" className="mt-2 min-h-11" value={mainLotForm.title} onChange={event => { setMainLotTouched(true); setMainLotForm(value => ({ ...value, title: event.target.value })); }} required /></label>
        <label className={labelClass}>Budget indicatif du lot (TND)<Input aria-label="Budget indicatif du lot (TND)" className="mt-2 min-h-11" type="number" min="0" step="0.001" value={mainLotForm.budget} onChange={event => { setMainLotTouched(true); setMainLotForm(value => ({ ...value, budget: event.target.value })); }} /></label>
        <label className={cn(labelClass, 'sm:col-span-2')}>Périmètre des travaux<textarea aria-label="Périmètre des travaux" className={cn(fieldClass, 'mt-2 min-h-28 resize-y')} value={mainLotForm.scope} onChange={event => { setMainLotTouched(true); setMainLotForm(value => ({ ...value, scope: event.target.value })); }} required /></label>
        <div className="sm:col-span-2"><button type="submit" className={primaryAction} disabled={saving}>{saving ? 'Création…' : 'Créer le lot principal'}</button></div>
      </form> : <p className="mt-4 rounded-xl bg-sand px-4 py-3 text-sm text-ink/70">Aucun lot actif. Le lot principal peut être créé pendant la préparation du brouillon.</p>}
    </div> : <div role="region" aria-label="Tableau des lots" tabIndex={0} className="mt-5 rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal">
      {/* #360: one dense card per lot at every width (no wide, half-empty columns). Explicit table roles keep the
          row semantics. The commercial result (Artisan retenu, from the active award) comes before the optional
          internal team designation, which is a different thing. */}
      <table role="table" className="block w-full text-left text-sm">
        <thead role="rowgroup" className="sr-only"><tr role="row"><th role="columnheader" scope="col">Métier / lot</th><th role="columnheader" scope="col">Budget et version</th><th role="columnheader" scope="col">Attribution et actions</th></tr></thead>
        <tbody role="rowgroup" className="block space-y-3">{activeRequests.map((request, index) => { const won = commercialReady ? commercial.byLot[request.id] : undefined; const status = lotStatus(request); return <tr key={request.id} role="row" className="grid gap-x-5 gap-y-3 rounded-2xl border border-black/[0.08] bg-white p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
          <td role="cell" className="block min-w-0">
            <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-teal">{request.trade_name ?? 'Métier à préciser'}</span><Pill tone={status.tone}>{status.label}</Pill></div>
            <p className="mt-1.5 break-words font-semibold text-ink">{request.title || `Lot ${index + 1}`}</p>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink/65">{request.scope || 'Périmètre non renseigné.'}</p>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/65"><span>Budget indicatif : <span className="font-semibold tabular-nums text-ink">{formatTnd(request.budget_millimes)}</span></span><span>Version <span className="font-semibold tabular-nums text-ink/80">v{request.version_no ?? 1}</span></span></p>
          </td>
          <td role="cell" className="block min-w-0 space-y-3 border-t border-black/[0.06] pt-3 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
            {won ? <div className="rounded-xl border border-teal/20 bg-teal/[0.04] p-3"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-teal">Artisan retenu</p><p className="mt-1 break-words font-semibold text-ink">{won.name ? <Link href={`/app/professionals/${won.contractorId}`} className="hover:underline">{won.name}</Link> : 'Artisan retenu (identité publique non disponible)'}</p><p className="mt-0.5 text-xs text-ink/65">Offre retenue : <span className="font-semibold tabular-nums text-ink">{formatTnd(won.agreedMillimes)}</span> · non signée</p>
              <div className="mt-2 flex flex-wrap gap-2">{won.publicationId && <Link href={`/app/publications/${won.publicationId}#offres`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-black/10 bg-white px-3 text-sm font-semibold text-ink hover:border-teal"><FileText size={15} aria-hidden="true" />Voir l’offre retenue</Link>}{commercialReady && commercial.agreements[won.awardId] && commercial.agreements[won.awardId] !== 'unavailable' && <Link href={`/app/awards/${won.awardId}/conditions`} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-teal/25 bg-white px-3 text-sm font-semibold text-teal hover:border-teal"><CalendarDays size={15} aria-hidden="true" />Conditions et calendrier</Link>}</div>
            </div> : publishedLike && isClient && commercial?.state === 'error' ? <p className="text-xs text-red-700">Attribution indisponible pour le moment (voir l’encadré « Après publication »).</p> : null}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end lg:flex-col lg:items-stretch">
              <div className="min-w-0 flex-1">{isClient ? <label className="block text-xs font-medium text-ink/65">Participant de l’équipe affecté au lot (optionnel)<select aria-label={`Professionnel de ${request.title}`} disabled={!canEdit || project.status === 'archived'} value={request.contractor_member_id || ''} className={cn(fieldClass, 'mt-1 disabled:bg-sand disabled:text-ink/65')} onChange={async event => { try { await projectApi('/api/projects/requests/member', { request_id: request.id, member_id: event.target.value || null }); await load(); } catch (exception: any) { setError(exception.message); } }}><option value="">Aucun participant affecté</option>{contractors.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label> : <p className="text-xs text-ink/65">Participant de l’équipe affecté : <span className="font-semibold text-ink">{professionalName(request.contractor_member_id) || 'Aucun (géré par le Client)'}</span></p>}{isClient && !request.contractor_member_id && !won && project.status !== 'archived' && <Link href={`/app/professionals?project_id=${encodeURIComponent(id)}&request_id=${encodeURIComponent(request.id)}`} className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-semibold text-teal hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">Trouver un professionnel<ArrowRight size={14} aria-hidden="true" /></Link>}</div>
              {canEditLots && <div className="flex shrink-0 items-center gap-2 lg:justify-end"><button type="button" onClick={() => editRequest(request)} aria-label="Modifier le lot" className={iconButton} title="Modifier"><Pencil size={16} aria-hidden="true" /></button><button type="button" onClick={() => duplicateRequest(request)} aria-label="Dupliquer le lot" className={iconButton} title="Dupliquer"><RotateCcw size={16} aria-hidden="true" /></button><button type="button" disabled={deletingRequestId === request.id} onClick={() => void withdrawRequest(request)} aria-label="Retirer le lot" className={dangerIconButton} title="Retirer"><Trash2 size={16} aria-hidden="true" /></button></div>}
            </div>
          </td>
        </tr>; })}</tbody>
      </table>
    </div>}
  </Card>;
  const lotForm = canEditLots && activeRequests.length > 0 && (showLotForm || Boolean(editingRequestId)) ? <div ref={formRef}><Card className="mt-4 p-5 sm:p-6"><SectionHeading title={editingRequestId ? 'Modifier le lot' : 'Ajouter un lot'} description={editingRequestId ? 'Enregistrer crée une nouvelle version ; l’historique reste disponible.' : 'Décrivez un périmètre précis pour obtenir des offres comparables.'} action={editingRequestId ? <button type="button" onClick={cancelEdit} className="inline-flex min-h-11 items-center rounded-xl px-3 text-sm font-semibold text-ink/70 transition hover:bg-sand focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">Annuler</button> : undefined} /><form onSubmit={submitRequest} className="mt-5 grid gap-4 sm:grid-cols-2"><label className={labelClass}>Métier<select aria-label="Métier" className={cn(fieldClass, 'mt-2')} value={trade} onChange={event => setTrade(event.target.value)} required><option value="">Choisir un métier</option>{trades.map(item => <option key={item.id} value={item.id}>{item.name_fr}</option>)}</select></label><label className={labelClass}>Intitulé du lot<Input aria-label="Intitulé du lot" className="mt-2 min-h-11" placeholder="Ex. Plomberie complète" value={title} onChange={event => setTitle(event.target.value)} required /></label><label className={labelClass}>Budget indicatif du lot (TND)<Input aria-label="Budget indicatif du lot (TND)" className="mt-2 min-h-11" type="number" min="0" step="0.001" value={budget} onChange={event => setBudget(event.target.value)} /></label><label className={cn(labelClass, 'sm:col-span-2')}>Périmètre des travaux<textarea aria-label="Périmètre des travaux" className={cn(fieldClass, 'mt-2 min-h-28 resize-y')} value={scope} onChange={event => setScope(event.target.value)} required /></label><div className="sm:col-span-2"><button type="submit" className={primaryAction} disabled={saving}>{saving ? 'Enregistrement…' : editingRequestId ? 'Enregistrer les modifications' : 'Ajouter la demande'}</button></div></form></Card></div> : null;

  const datesLabel = project.desired_start_date || project.desired_end_date ? `${project.desired_start_date ? formatDate(project.desired_start_date) : 'Début à préciser'} → ${project.desired_end_date ? formatDate(project.desired_end_date) : 'fin à préciser'}` : 'Calendrier à préciser';
  const nextStepText = effectiveStatus === 'draft' ? 'Prochaine étape : finaliser vos lots et demander la revue.' : effectiveStatus === 'rejected' ? 'Prochaine étape : consulter les corrections demandées.' : effectiveStatus === 'approved' ? 'Prochaine étape : préparer la publication.' : effectiveStatus === 'dao_review' ? 'En attente du contrôle D.A.O.' : 'Consultez l’onglet DAO pour les prochaines étapes.';
  const preparationItems: [string, boolean][] = [['Informations générales', Boolean(projectForm.title)], ['Localisation', Boolean(location)], ['Au moins un lot', activeRequests.length > 0], ['Budget projet', Boolean(project.indicative_budget_millimes)], ['Documents facultatifs', documents.length > 0]];
  const messageableContractors = isClient ? contractors.filter(member => member.user_id !== userId) : [];
  const canContactClient = !isClient && Boolean(project.client_id && project.confirmed_at && myContractorMember && project.client_id !== userId);
  // One header action, never one per professional: with several, the team tab offers a message icon on each row.
  const messagingActions = isClient ? (messageableContractors.length === 1 ? <button type="button" className={secondaryAction} onClick={() => void openConversation(messageableContractors[0].id)}><MessageCircle size={16} aria-hidden="true" />Écrire à {messageableContractors[0].name}</button> : messageableContractors.length > 1 ? <button type="button" className={secondaryAction} onClick={() => setActiveTab('team')}><MessageCircle size={16} aria-hidden="true" />Contacter l’équipe ({messageableContractors.length})</button> : null) : (canContactClient ? <button type="button" className={secondaryAction} onClick={() => void openConversation(myContractorMember!.id)}><MessageCircle size={16} aria-hidden="true" />Contacter le client</button> : null);
  const messageTarget = (member: { id: string; user_id: string | null; participation_role: string }) => member.user_id === userId ? null : isClient ? (member.participation_role === 'contractor' && messageableContractors.some(row => row.id === member.id) ? member.id : null) : (canContactClient && member.participation_role === 'client' ? myContractorMember!.id : null);
  const dossierAction = <>{isClient && effectiveStatus === 'draft' && activeRequests.length > 0 && (datesReady ? <Link href={`/app/projects/${id}/review`} className={primaryAction}>Revoir le DAO<ArrowRight size={16} aria-hidden="true" /></Link> : <button type="button" className={primaryAction} onClick={() => { setActiveTab('overview'); setProjectEdit(true); }}>Compléter les dates</button>)}{isClient && effectiveStatus === 'rejected' && <button type="button" className={primaryAction} onClick={() => void correctProject()}>Corriger le DAO</button>}</>;
  const tile = 'min-w-0 rounded-2xl border border-black/[0.06] bg-white p-4 sm:p-5';

  return <section className="space-y-6" aria-labelledby="project-title">
    {backLink}
    <header className="rounded-2xl border border-black/[0.06] bg-white p-5 shadow-[0_1px_2px_rgba(23,32,42,0.04)] sm:p-7">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">{commercialLabel(commercial) ? <><Pill tone={commercialLabel(commercial)!.tone}>{commercialLabel(commercial)!.text}</Pill><Pill tone="neutral">{project.status === 'closed' ? 'Publication clôturée' : 'Publication en ligne'}</Pill></> : <StatusPill status={displayProjectStatus(effectiveStatus)} />}{['open', 'published', 'closed'].includes(project.status) && approvedVersionLabel(projectVersion?.status, projectVersion?.version_no) && <Pill tone="neutral">{approvedVersionLabel(projectVersion?.status, projectVersion?.version_no)}</Pill>}{!project.client_id && <Pill tone="clay">Client à confirmer</Pill>}</div>
          <h1 id="project-title" className="mt-3 break-words text-[1.75rem] font-bold leading-tight tracking-tight text-ink sm:text-3xl">{projectTitle}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-ink/70">{description}</p>
          <ul className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink/70" aria-label="Informations du chantier">
            <li className="flex min-w-0 items-center gap-1.5"><MapPin size={15} aria-hidden="true" className="shrink-0 text-ink/45" /><span data-testid="project-location" className="min-w-0 break-words">{location || 'Localisation à préciser'}</span></li>
            <li className="flex items-center gap-1.5"><Building2 size={15} aria-hidden="true" className="shrink-0 text-ink/45" />{typeLabels[project.project_type] ?? 'Projet'}{project.surface_m2 ? ` · ${project.surface_m2} m²` : ''}</li>
            <li className="flex items-center gap-1.5"><CalendarDays size={15} aria-hidden="true" className="shrink-0 text-ink/45" />{datesLabel}</li>
          </ul>
        </div>
        <div className="flex w-full flex-col-reverse gap-2 sm:w-auto sm:flex-row sm:flex-wrap lg:max-w-md lg:justify-end">{messagingActions}{dossierAction}</div>
      </div>
      <div className="mt-6 border-t border-black/[0.06] pt-5">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">Préparation et publication</p>
        <div className="mt-3"><DossierSteps status={effectiveStatus} /></div>
        {isClient && commercial && <CommercialPanel progress={commercial} stage={project.project_stage} stageLabel={stageLabels[project.project_stage] ?? 'Travaux non commencés'} />}
      </div>
    </header>
    {error && <p className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert"><AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{error}</p>}
    {success && <p className="flex items-start gap-2 rounded-xl border border-teal/20 bg-teal/[0.07] px-4 py-3 text-sm text-teal" role="status"><Check size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{success}</p>}
    {rejectedReason && <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-5"><AlertCircle size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-red-600" /><div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wide text-red-700">Corrections demandées</p><p className="mt-1.5 text-sm text-red-800">{rejectedReason}</p></div></div>}
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <div className={tile}><dt className="text-xs font-medium text-ink/65">Budget projet</dt><dd className="mt-1.5 break-words text-lg font-bold tabular-nums tracking-tight text-ink">{formatTnd(project.indicative_budget_millimes)}</dd></div>
      <div className={tile}><dt className="text-xs font-medium text-ink/65">Lots</dt><dd className="mt-1.5 text-lg font-bold tabular-nums tracking-tight text-ink">{requestCountLabel}</dd><dd className="mt-0.5 break-words text-xs text-ink/65">Total : {formatTnd(totalLotBudget)}</dd></div>
      <div className={tile}><dt className="text-xs font-medium text-ink/65">Avancement des travaux</dt><dd className="mt-1.5 text-base font-bold leading-snug text-ink">{stageLabels[project.project_stage] ?? 'À préciser'}</dd></div>
      <div className={tile}><dt className="text-xs font-medium text-ink/65">Complétude du dossier</dt><dd className="mt-1.5 text-lg font-bold tabular-nums tracking-tight text-teal">{completion}%</dd><dd className="mt-2"><ProgressBar value={completion} label="Complétude du dossier" /></dd></div>
    </dl>
    <div className="relative -mx-4 sm:mx-0">
      <nav ref={tabNav} aria-label="Sections du projet" className="overflow-x-auto border-b border-black/10 px-4 [scrollbar-width:none] sm:px-0 [&::-webkit-scrollbar]:hidden"><div className="flex min-w-max gap-1">{tabs.map(tab => { const Icon = tab.icon; const active = activeTab === tab.id; return <button key={tab.id} type="button" aria-current={active ? 'true' : undefined} onClick={() => setActiveTab(tab.id)} className={`relative inline-flex min-h-12 items-center gap-2 rounded-t-lg px-3.5 text-sm font-semibold transition after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal ${active ? 'text-ink after:bg-teal' : 'text-ink/65 after:bg-transparent hover:text-ink'}`}><Icon size={16} aria-hidden="true" className={active ? 'text-teal' : ''} />{tab.label}{tab.id === 'lots' && <span className={`rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums leading-none ${active ? 'bg-teal/10 text-teal' : 'bg-ink/[0.06] text-ink/70'}`}>{activeRequests.length}</span>}</button>; })}</div></nav>
      <span aria-hidden="true" className="pointer-events-none absolute right-0 top-0 h-12 w-10 bg-gradient-to-l from-sand to-transparent sm:hidden" />
      <div aria-hidden="true" className="mt-2.5 flex items-center justify-center gap-1.5 md:hidden">{tabs.map(tab => <span key={tab.id} className={`h-1.5 rounded-full transition-all ${activeTab === tab.id ? 'w-5 bg-teal' : 'w-1.5 bg-ink/20'}`} />)}</div>
    </div>
    <div ref={tabPanel} className="space-y-6" onTouchStart={onSwipeStart} onTouchEnd={onSwipeEnd} onTouchCancel={() => { swipeStart.current = null; }}>
    {activeTab === 'overview' && <div className="grid gap-5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-5">
        <Card className="p-5 sm:p-6"><SectionHeading eyebrow="Résumé" title="Votre dossier en un coup d’œil" description="Suivez séparément l’avancement administratif DAO et celui des travaux." />
          <div className="mt-5 flex items-start gap-3 rounded-xl bg-teal/[0.06] p-4 ring-1 ring-inset ring-teal/15"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-teal ring-1 ring-teal/15"><ArrowRight size={16} aria-hidden="true" /></span><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-teal">Dossier DAO</p><p className="mt-1 text-sm font-semibold text-ink">{nextStepText}</p></div></div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-sand p-4"><dt className="flex items-center gap-1.5 text-xs font-medium text-ink/65"><MapPin size={13} aria-hidden="true" />Localisation</dt><dd className="mt-1 break-words font-semibold text-ink">{location || 'À préciser'}</dd><dd className="mt-1.5 flex items-center gap-1 text-xs text-ink/65"><Lock size={12} aria-hidden="true" />L’adresse exacte reste privée.</dd></div>
            <div className="rounded-xl bg-sand p-4"><dt className="flex items-center gap-1.5 text-xs font-medium text-ink/65"><CalendarDays size={13} aria-hidden="true" />Calendrier souhaité</dt><dd className="mt-1 font-semibold text-ink">Début : {formatDate(project.desired_start_date)}</dd><dd className="mt-0.5 font-semibold text-ink">Fin : {formatDate(project.desired_end_date)}</dd></div>
          </dl>
        </Card>
        <details className="group rounded-2xl border border-black/[0.06] bg-white [&_summary::-webkit-details-marker]:hidden">
          <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl px-5 py-4 text-sm font-semibold text-ink transition hover:bg-sand/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"><span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sand text-ink/70"><Lock size={15} /></span>Coordonnées privées / Accès chantier — ouvrir<ChevronDown size={16} aria-hidden="true" className="ml-auto shrink-0 text-ink/55 transition group-open:rotate-180" /></summary>
          <div className="border-t border-black/[0.06] p-5 sm:p-6"><SectionHeading title="Informations privées et confidentielles" description="Réservées aux participants disposant d’une autorisation explicite. Jamais visibles sur le marketplace." />{team.can_view_private_details ? <form onSubmit={savePrivateDetails} className="mt-5 grid gap-4 sm:grid-cols-2"><label className={cn(labelClass, 'sm:col-span-2')}>Adresse exacte<textarea aria-label="Adresse exacte" className={cn(fieldClass, 'mt-2 min-h-20 read-only:bg-sand/60')} readOnly={!canEdit} value={privateForm.exact_address ?? ''} onChange={event => setPrivateForm((value: any) => ({ ...value, exact_address: event.target.value }))} /></label><label className={cn(labelClass, 'sm:col-span-2')}>Instructions d’accès<textarea aria-label="Instructions d’accès" className={cn(fieldClass, 'mt-2 min-h-20 read-only:bg-sand/60')} readOnly={!canEdit} value={privateForm.access_instructions ?? ''} onChange={event => setPrivateForm((value: any) => ({ ...value, access_instructions: event.target.value }))} /></label><label className={labelClass}>Téléphone<Input aria-label="Téléphone privé" className="mt-2 min-h-11 read-only:bg-sand/60" readOnly={!canEdit} value={privateForm.contact_phone ?? ''} placeholder="+216XXXXXXXX" onChange={event => setPrivateForm((value: any) => ({ ...value, contact_phone: event.target.value }))} /></label><label className={labelClass}>Email<Input aria-label="Email privé" className="mt-2 min-h-11 read-only:bg-sand/60" type="email" readOnly={!canEdit} value={privateForm.contact_email ?? ''} onChange={event => setPrivateForm((value: any) => ({ ...value, contact_email: event.target.value }))} /></label>{canEdit && <div className="sm:col-span-2"><button type="submit" className={primaryAction} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button></div>}</form> : <p className="mt-4 flex items-center gap-2 rounded-xl bg-sand px-4 py-3 text-sm text-ink/70"><Lock size={14} aria-hidden="true" />Vous n’avez pas accès aux coordonnées privées de ce chantier.</p>}</div>
        </details>
        <Card className="p-5 sm:p-6"><SectionHeading title="Préparation du dossier" description="Les prochaines étapes réellement utiles pour ce dossier." action={<span className="rounded-full bg-ink/[0.06] px-2.5 py-1 text-xs font-semibold tabular-nums text-ink/80">{preparationItems.filter(([, done]) => done).length}/{preparationItems.length}</span>} /><ul className="mt-5 space-y-3">{preparationItems.map(([label, done]) => <li key={label} className="flex items-center gap-3 text-sm"><span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${done ? 'bg-teal text-white' : 'border border-dashed border-ink/30'}`}>{done && <Check size={13} />}</span><span className={done ? 'text-ink/65' : 'font-semibold text-ink'}>{label}</span><span className="sr-only">{done ? ' — fait' : ' — à faire'}</span></li>)}</ul></Card>
      </div>
      <div className="min-w-0 space-y-5">
        {isClient && project.project_stage !== 'not_started' && <ReviewOpportunities projectId={id} />}
        <Card className="p-5 sm:p-6"><p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">Budget des lots</p><p className="mt-2 break-words text-2xl font-bold tabular-nums tracking-tight text-ink">{formatTnd(totalLotBudget)}</p><p className="mt-1 text-xs text-ink/65">Total des budgets indicatifs · Budget projet : {formatTnd(project.indicative_budget_millimes)}</p>{canEditLots && <button type="button" className={cn(secondaryAction, 'mt-5 w-full')} onClick={() => setProjectEdit(value => !value)}><Pencil size={15} aria-hidden="true" />{projectEdit ? 'Fermer' : 'Modifier le projet'}</button>}</Card>
        {projectEdit && <div ref={projectEditRef} className="scroll-mt-24"><Card className="p-5 sm:p-6"><p className="text-sm font-bold text-ink">Informations du projet</p><form onSubmit={saveProject} className="mt-4 space-y-4"><label className={labelClass}>Titre<Input aria-label="Titre du projet" className="mt-2 min-h-11" value={projectForm.title ?? ''} onChange={event => setProjectForm((value: any) => ({ ...value, title: event.target.value }))} required /></label><label className={labelClass}>Description<textarea aria-label="Description du projet" className={cn(fieldClass, 'mt-2 min-h-24')} value={projectForm.description ?? ''} onChange={event => setProjectForm((value: any) => ({ ...value, description: event.target.value }))} /></label><label className={labelClass}>Budget indicatif (TND)<Input aria-label="Budget indicatif du projet (TND)" className="mt-2 min-h-11" type="number" min="0" step="0.001" value={projectForm.indicative_budget_tnd ?? ''} onChange={event => setProjectForm((value: any) => ({ ...value, indicative_budget_tnd: event.target.value }))} /></label><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2"><label className={labelClass}>Début souhaité<Input aria-label="Début souhaité du projet" className="mt-2 min-h-11" type="date" value={projectForm.desired_start_date ?? ''} onChange={event => setProjectForm((value: any) => ({ ...value, desired_start_date: event.target.value }))} /></label><label className={labelClass}>Fin souhaitée<Input aria-label="Fin souhaitée du projet" className="mt-2 min-h-11" type="date" min={projectForm.desired_start_date || undefined} value={projectForm.desired_end_date ?? ''} onChange={event => setProjectForm((value: any) => ({ ...value, desired_end_date: event.target.value }))} /></label></div><button type="submit" className={cn(primaryAction, 'w-full sm:w-auto')} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button></form></Card></div>}
      </div>
    </div>}
    {activeTab === 'lots' && <>{lotList}{lotForm}{activeRequests.map(request => { const proposal = aiProposals.find(item => item.request_id === request.id && item.status === 'proposed'); return proposal ? <Card key={proposal.id} className="mt-4 border-teal/20 bg-teal/[0.03] p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-teal ring-1 ring-teal/15"><Sparkles size={17} aria-hidden="true" /></span><div className="min-w-0"><p className="font-bold text-ink">Proposition assistée pour {request.title}</p><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-ink/70">{proposal.proposed_scope}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" className={primaryAction} onClick={() => void acceptAi(proposal.id)}>Accepter</button><button type="button" className={secondaryAction} onClick={() => void rejectAi(proposal.id)}>Refuser</button></div></div></div></Card> : null; })}</>}
    {activeTab === 'team' && <ProjectTeam projectId={id} team={team} needsClient={!project.client_id} archived={project.status === 'archived'} lots={activeRequests.filter(request => !request.contractor_member_id).map(request => ({ id: request.id, title: request.title || 'Lot sans titre' }))} initialLotId={invitationLotId || undefined} messageTarget={messageTarget} onMessage={memberId => void openConversation(memberId)} onChange={setTeam} />}
    {activeTab === 'tracking' && <div className="space-y-4"><ProjectTracking project={project} canEdit={canEdit} onChange={setProject} /><ProjectGlobalPlan projectId={id} canDecide={canEdit} /><OceLotPlanning projectId={id} lots={requests.filter(request => request.status !== 'withdrawn').map(request => ({ id: request.id, title: request.title }))} canEdit={canEdit} /><SiteExecutionJournal projectId={id} userId={userId} documents={documents} /></div>}
    {activeTab === 'documents' && <Card className="p-5 sm:p-6"><SectionHeading title="Documents et plans" description="PDF, JPG, PNG ou WebP, 20 Mo maximum. Les fichiers restent privés pendant le contrôle." action={canUpload ? <label className={cn(primaryAction, 'cursor-pointer focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-teal')}><Upload size={16} aria-hidden="true" />{uploading ? 'Envoi…' : 'Ajouter'}<input aria-label="Ajouter un document" className="sr-only" type="file" accept=".pdf,image/jpeg,image/png,image/webp" disabled={uploading} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadDocument(file); event.currentTarget.value = ''; }} /></label> : undefined} />
      {canUpload && <label className={cn(labelClass, 'mt-5 max-w-sm')}>Partage du nouveau document<select aria-label="Partage du nouveau document" className={cn(fieldClass, 'mt-2')} value={shareScope} onChange={event => setShareScope(event.target.value)}><option value="owner_only">Moi uniquement</option><option value="project_members">Membres du chantier après contrôle</option></select></label>}
      {documents.length === 0 ? <div className="mt-6 rounded-xl border border-dashed border-black/15 px-6 py-10 text-center"><span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-sand text-ink/55"><FileText size={20} aria-hidden="true" /></span><p className="mt-3 font-semibold text-ink">Aucun document ajouté.</p><p className="mx-auto mt-1 max-w-sm text-sm text-ink/65">{canUpload ? 'Ajoutez vos plans, photos ou devis : ils restent privés pendant le contrôle.' : 'Les documents partagés avec vous apparaîtront ici.'}</p></div>
        : <ul className="mt-5 divide-y divide-black/[0.06]">{documents.map(document => <li key={document.id} data-testid="project-document-row" className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sand text-ink/60"><FileText size={18} aria-hidden="true" /></span><div className="min-w-0"><p className="break-all font-semibold text-ink">{document.original_name}</p><p className="mt-1 text-xs text-ink/65">{document.share_scope === 'project_members' ? 'Membres du chantier' : 'Moi uniquement'} · {mimeLabels[document.mime_type] ?? 'Fichier'}</p><Pill tone={document.status === 'approved' ? 'teal' : document.status === 'rejected' ? 'red' : 'clay'} className="mt-2">{document.status === 'approved' ? 'Validé' : document.status === 'rejected' ? 'Refusé' : 'En attente de contrôle'}</Pill></div></div>
          <div className="flex flex-wrap items-center gap-2 pl-[3.25rem] sm:shrink-0 sm:pl-0">{document.owner_id === userId && <select aria-label={`Partage de ${document.original_name}`} className={cn(fieldClass, 'w-auto py-2 text-xs')} value={document.share_scope} onChange={async event => { try { await projectApi('/api/documents/project/sharing', { document_id: document.id, share_scope: event.target.value }); await refreshDocuments(); } catch (exception: any) { setError(exception.message); } }}><option value="owner_only">Moi uniquement</option><option value="project_members">Membres du chantier</option></select>}<button type="button" aria-label="Consulter" title="Consulter" onClick={() => void downloadDocument(document.id)} className={cn(iconButton, 'text-teal')}><Eye size={16} aria-hidden="true" /></button>{document.owner_id === userId && <button type="button" aria-label="Retirer" title="Retirer" onClick={() => void deleteDocument(document.id)} className={dangerIconButton}><Trash2 size={16} aria-hidden="true" /></button>}</div>
        </li>)}</ul>}
    </Card>}
    {activeTab === 'dao' && <Card className="p-5 sm:p-6">{!isClient && <p className="mb-5 rounded-xl bg-sand p-3.5 text-sm text-ink/70">Le client décide de la recherche de professionnels et de la soumission du DAO. Rejoindre le chantier ne donne pas accès aux offres concurrentes.</p>}<SectionHeading eyebrow="Préparation du DAO" title="Votre dossier est-il prêt ?" description="Vérifiez les éléments essentiels avant de demander la revue DAO." /><ul className="mt-6 grid gap-3 sm:grid-cols-2">{[['Projet renseigné', Boolean(projectForm.title)], ['Localisation', Boolean(location)], ['Dates souhaitées', datesReady], [`${activeRequests.length} lot${activeRequests.length > 1 ? 's' : ''}`, activeRequests.length > 0], ['Budgets', totalLotBudget > 0 || projectBudget > 0], ['Documents facultatifs', documents.length > 0]].map(([label, done]) => <li key={String(label)} className="flex items-center gap-3 rounded-xl bg-sand p-3.5 text-sm"><span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${done ? 'bg-teal text-white' : 'border border-dashed border-ink/30 bg-white'}`}>{done && <Check size={13} />}</span><span className={done ? 'text-ink/80' : 'font-semibold text-ink'}>{label}</span><span className="sr-only">{done ? ' — prêt' : ' — à compléter'}</span></li>)}</ul>{rejectedReason && <div className="mt-5 rounded-xl border border-red-200 bg-red-50 p-4"><p className="font-bold text-red-700">Corrections demandées</p><p className="mt-2 text-sm text-red-800">{rejectedReason}</p>{isClient && effectiveStatus === 'rejected' && <button type="button" className={cn(primaryAction, 'mt-3')} onClick={() => void correctProject()}>Corriger le DAO</button>}</div>}{isClient && effectiveStatus === 'draft' && activeRequests.length > 0 && (datesReady ? <Link href={`/app/projects/${id}/review`} className={cn(primaryAction, 'mt-6')}>Revoir le DAO</Link> : <div className="mt-5 space-y-3"><p className="text-sm text-amber-800" role="status">Indiquez les dates de début et de fin souhaitées avant de demander la revue DAO.</p><button type="button" className={primaryAction} onClick={() => { setActiveTab('overview'); setProjectEdit(true); }}>Compléter les dates</button></div>)}{effectiveStatus !== 'draft' && <p className="mt-6 text-sm text-ink/70">Statut actuel : <strong>{statusLabel[effectiveStatus] ?? effectiveStatus}</strong></p>}</Card>}
    {activeTab === 'history' && <Card className="p-5 sm:p-6"><ReviewHistory projectId={id} /><SectionHeading title="Historique du projet" description="Les versions et retours réellement enregistrés restent consultables." action={<Badge>{projectVersions.length} version{projectVersions.length > 1 ? 's' : ''}</Badge>} /><ul className="mt-5 space-y-2">{team.events.map(event => <li key={event.id} className="flex flex-wrap gap-x-2 rounded-xl bg-sand px-3.5 py-3 text-sm"><span className="tabular-nums text-ink/65">{formatDate(event.created_at)}</span><span className="text-ink">{({ project_created: 'Chantier créé', client_confirmed: 'Chantier confirmé par le client', member_joined: 'Participant ajouté', member_revoked: 'Participant retiré', invitation_created: 'Invitation créée', invitation_declined: 'Invitation refusée', invitation_revoked: 'Invitation révoquée', tracking_updated: 'Suivi mis à jour', lot_participant_updated: 'Professionnel du lot mis à jour', private_permission_updated: 'Permission privée mise à jour' } as Record<string, string>)[event.action] || 'Équipe ou suivi mis à jour'}</span></li>)}</ul><div className="relative mt-6 space-y-5 border-l border-black/10 pl-6">{projectVersions.map(version => <div key={version.id} className="relative"><span className="absolute -left-[31px] top-1.5 h-2.5 w-2.5 rounded-full bg-teal ring-4 ring-white" /><p className="text-xs text-ink/65">{formatDate(version.created_at)}</p><p className="mt-1 font-bold text-ink">Version {version.version_no} · {statusLabel[version.status] ?? version.status}</p>{version.title && <p className="mt-1 text-sm text-ink/70">{version.title}</p>}{reviews.filter(review => review.project_version_id === version.id).map(review => <div key={review.id} className="mt-2 rounded-xl bg-sand p-3 text-sm"><p className="font-semibold">{review.decision === 'rejected' ? 'Corrections demandées' : 'Revue DAO'}</p>{review.reason && <p className="mt-1 text-ink/70">{review.reason}</p>}</div>)}</div>)}</div><div className="mt-8 space-y-3">{requests.map(request => <div key={request.id} className="rounded-xl bg-sand p-1"><button type="button" aria-expanded={historyRequestId === request.id} onClick={() => setHistoryRequestId(historyRequestId === request.id ? null : request.id)} className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2.5 text-left text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"><span className="min-w-0 break-words">{request.title || 'Lot sans titre'}</span><span className="shrink-0 text-teal">{request.history.length} version{request.history.length > 1 ? 's' : ''}</span></button>{historyRequestId === request.id && <div className="mx-2.5 mb-2.5 mt-1 space-y-2 border-t border-black/5 pt-3">{request.history.map(version => <p key={version.id} className="text-xs text-ink/70"><strong>v{version.version_no}</strong> · {version.title} · {formatDate(version.created_at)}</p>)}</div>}</div>)}</div></Card>}
    </div>
    {isClient && project.status !== 'archived' && <div className="flex flex-col gap-3 border-t border-black/[0.08] pt-6 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm text-ink/65">Abandonner archive le projet ; il reste consultable dans votre historique.</p><button type="button" onClick={() => void archive()} className="inline-flex min-h-11 items-center gap-2 self-start rounded-xl bg-white px-4 text-sm font-semibold text-red-700 ring-1 ring-inset ring-red-200 transition hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600 sm:self-auto"><Archive size={16} aria-hidden="true" />Abandonner le projet</button></div>}
  </section>;
}
