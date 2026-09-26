'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabaseBrowser } from '../../../../../lib/supabase-browser';
import { Badge, Button, Card } from '../../../../../components/ui';
import { statusLabel } from '../../../../../lib/utils';

type LotSnapshot = {
  id: string;
  request_id: string;
  title: string;
  scope: string;
  budget_millimes: number | null;
  version_no: number;
  trade_name?: string;
};

const typeLabels: Record<string, string> = { construction: 'Construction', renovation: 'Rénovation', repair: 'Réparation', extension: 'Extension', other: 'Autre' };
const formatTnd = (value?: number | null) => value == null ? 'Non renseigné' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000);
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat('fr-TN', { dateStyle: 'medium' }).format(new Date(value)) : 'Non renseignée';

export default function ProjectReview() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [project, setProject] = useState<any>();
  const [version, setVersion] = useState<any>();
  const [requests, setRequests] = useState<LotSnapshot[]>([]);
  const [location, setLocation] = useState('');
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const supabase = supabaseBrowser();
      const [projectResult, versionResult, projectRequestsResult, docsResult] = await Promise.all([
        supabase.from('projects').select('*').eq('id', id).single(),
        supabase.from('project_versions').select('*').eq('project_id', id).order('version_no', { ascending: false }).limit(1),
        supabase.from('project_requests').select('id,status').eq('project_id', id).neq('status', 'withdrawn'),
        supabase.from('documents').select('id,original_name,status').eq('project_id', id),
      ]);
      const current = versionResult.data?.[0];
      if (projectResult.error || versionResult.error || projectRequestsResult.error || docsResult.error || !current) {
        setError('Impossible de charger la revue du projet.');
        setLoading(false);
        return;
      }

      const linksResult = await supabase.from('project_version_requests').select('request_version_id').eq('project_version_id', current.id);
      if (linksResult.error) {
        setError('Impossible de charger les lots liés à cette version du projet.');
        setLoading(false);
        return;
      }
      const versionIds = new Set((linksResult.data ?? []).map(link => link.request_version_id));
      const [{ data: snapshots, error: snapshotsError }, { data: trades, error: tradesError }] = versionIds.size ? await Promise.all([
        supabase.from('project_request_versions').select('id,request_id,project_id,trade_id,title,scope,budget_millimes,version_no').in('id', [...versionIds]),
        supabase.from('trades').select('id,name_fr'),
      ]) : [{ data: [], error: null }, { data: [], error: null }];
      if (snapshotsError || tradesError) {
        setError('Impossible de charger les lots liés à cette version du projet.');
        setLoading(false);
        return;
      }

      const requestById = new Map((projectRequestsResult.data ?? []).map(request => [request.id, request]));
      const snapshotById = new Map((snapshots ?? []).map(snapshot => [snapshot.id, snapshot]));
      const tradeById = new Map((trades ?? []).map(trade => [trade.id, trade.name_fr]));
      const linkedLots = (linksResult.data ?? []).flatMap(link => {
        const snapshot = snapshotById.get(link.request_version_id);
        const request = snapshot ? requestById.get(snapshot.request_id) : undefined;
        if (!snapshot || !request) return [];
        return [{ ...snapshot, trade_name: tradeById.get(snapshot.trade_id) ?? 'Métier' }];
      });

      setProject(projectResult.data);
      setVersion(current);
      setDocuments(docsResult.data ?? []);
      setRequests(linkedLots);
      const names: string[] = [];
      if (current.governorate_id) { const result = await supabase.from('governorates').select('name_fr').eq('id', current.governorate_id).maybeSingle(); if (result.data?.name_fr) names.push(result.data.name_fr); }
      if (current.delegation_id) { const result = await supabase.from('delegations').select('name_fr').eq('id', current.delegation_id).maybeSingle(); if (result.data?.name_fr) names.push(result.data.name_fr); }
      if (current.locality_id) { const result = await supabase.from('localities').select('name_fr').eq('id', current.locality_id).maybeSingle(); if (result.data?.name_fr) names.push(result.data.name_fr); }
      setLocation(names.join(' · '));
      setLoading(false);
    })();
  }, [id]);

  async function submit() {
    setSaving(true); setError('');
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) { setError('Session expirée.'); setSaving(false); return; }
    const response = await fetch('/api/projects/review', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify({ project_id: id }) });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? 'Soumission refusée.');
    else router.push('/app/projects/' + id);
    setSaving(false);
  }

  async function correct() {
    setSaving(true); setError('');
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) { setError('Session expirée.'); setSaving(false); return; }
    const response = await fetch('/api/projects/correction', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token }, body: JSON.stringify({ project_id: id }) });
    const body = await response.json();
    if (!response.ok) setError(body.error ?? 'Correction impossible.'); else router.push('/app/projects/' + id);
    setSaving(false);
  }

  const total = useMemo(() => requests.reduce((sum, request) => sum + Number(request.budget_millimes || 0), 0), [requests]);
  if (loading) return <p>Chargement de la revue…</p>;
  if (!project || !version) return <p role="alert">{error || 'Projet introuvable.'}</p>;
  const rejected = version.status === 'rejected';
  return <section className="mx-auto max-w-4xl space-y-6">
    <div><p className="text-sm font-semibold text-teal">Revue du DAO</p><div className="mt-1 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold">{version.title}</h1><Badge>{statusLabel[version.status] ?? version.status}</Badge></div><p className="mt-2 whitespace-pre-wrap text-black/60">{version.description || 'Sans description'}</p></div>
    {rejected && <Card className="border-red-200 bg-red-50"><h2 className="font-semibold text-red-800">Des corrections sont demandées</h2><p className="mt-2 text-sm text-red-700">Consultez le commentaire de revue sur la page du projet, corrigez les lots concernés puis soumettez une nouvelle version.</p></Card>}
    <Card><h2 className="font-semibold">Checklist avant soumission</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-sand/70 p-3 text-sm"><span className="font-medium">Titre et description</span><span className="ml-2 text-teal">{version.title && version.title !== 'Nouveau projet' && version.description && version.description !== 'Brouillon' ? '✓' : 'À compléter'}</span></div><div className="rounded-xl bg-sand/70 p-3 text-sm"><span className="font-medium">Localisation</span><span className="ml-2 text-teal">{location || 'À compléter'}</span></div><div className="rounded-xl bg-sand/70 p-3 text-sm"><span className="font-medium">Lots actifs</span><span className="ml-2 text-teal">{requests.length > 0 ? '✓ ' + requests.length : 'À compléter'}</span></div><div className="rounded-xl bg-sand/70 p-3 text-sm"><span className="font-medium">Documents</span><span className="ml-2 text-teal">{documents.length ? documents.length + ' fichier(s)' : 'Aucun'}</span></div></div></Card>
    <Card><h2 className="font-semibold">Résumé du chantier</h2><div className="mt-4 grid gap-4 sm:grid-cols-3"><div><p className="text-xs text-black/45">Type</p><p className="font-semibold">{typeLabels[version.project_type] ?? version.project_type}</p></div><div><p className="text-xs text-black/45">Surface</p><p className="font-semibold">{version.surface_m2 ?? '—'} m²</p></div><div><p className="text-xs text-black/45">Localisation</p><p className="font-semibold">{location || 'Non renseignée'}</p></div><div><p className="text-xs text-black/45">Début souhaité</p><p className="font-semibold">{formatDate(version.desired_start_date)}</p></div><div><p className="text-xs text-black/45">Fin souhaitée</p><p className="font-semibold">{formatDate(version.desired_end_date)}</p></div><div><p className="text-xs text-black/45">Budget projet</p><p className="font-semibold">{formatTnd(version.indicative_budget_millimes)}</p></div></div></Card>
    <Card><div className="flex items-center justify-between"><h2 className="font-semibold">Lots inclus</h2><Badge>{requests.length} lot{requests.length > 1 ? 's' : ''}</Badge></div>{requests.length === 0 ? <p className="mt-4 text-sm text-black/55">Aucun lot n’est lié à cette version du projet.</p> : <div className="mt-4 space-y-3">{requests.map(request => <article key={request.id} className="rounded-xl bg-sand/70 p-4"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-semibold text-teal">{request.trade_name}</p><h3 className="mt-1 font-semibold">{request.title}</h3></div><span className="text-sm">{formatTnd(request.budget_millimes)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm text-black/60">{request.scope}</p><p className="mt-2 text-xs text-black/40">Version {request.version_no}</p></article>)}</div>}<div className="mt-4 border-t border-black/5 pt-3 text-right text-sm font-semibold">Total lots : {formatTnd(total)}</div></Card>
    {requests.length === 0 && version.status === 'draft' && <Card className="border-amber-200 bg-amber-50"><h2 className="font-semibold text-amber-900">Un lot actif est nécessaire avant la soumission.</h2><p className="mt-2 text-sm text-amber-800">Créez le lot principal depuis la fiche projet. Aucun lot ne sera créé avant votre validation.</p><Button className="mt-4" onClick={() => router.push('/app/projects/' + id + '?tab=lots')}>Créer le lot principal</Button></Card>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    <div className="flex flex-wrap gap-3">{rejected ? <Button onClick={() => void correct()} disabled={saving}>{saving ? 'Préparation…' : 'Créer une version de correction'}</Button> : <Button onClick={() => void submit()} disabled={saving || requests.length === 0 || version.status !== 'draft'}>{saving ? 'Soumission…' : 'Soumettre pour revue DAO'}</Button>}<Button type="button" className="bg-white text-ink" onClick={() => router.push('/app/projects/' + id)}>Retour au projet</Button></div>
  </section>;
}
