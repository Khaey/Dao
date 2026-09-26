'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabaseBrowser } from '../../../../../lib/supabase-browser';
import { Button, Card, Input } from '../../../../../components/ui';

function NewPublication() {
  const params = useSearchParams();
  const router = useRouter();
  const projectId = params.get('project_id') || '';
  const [rows, setRows] = useState<any[]>([]);
  const [contractors, setContractors] = useState<any[]>([]);
  const [visibility, setVisibility] = useState('public');
  const [selected, setSelected] = useState<string[]>([]);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!projectId) return;
    void (async () => {
      const supabase = supabaseBrowser();
      const [projectVersionResult, requestResult, contractorResult] = await Promise.all([
        supabase.from('project_versions').select('id').eq('project_id', projectId).eq('status', 'approved').order('version_no', { ascending: false }).limit(1),
        supabase.from('project_requests').select('id').eq('project_id', projectId).eq('status', 'open'),
        supabase.from('contractor_profiles').select('id,business_name,public_trade_name,contractor_type,verification_status').eq('verification_status', 'verified').order('business_name'),
      ]);
      const approvedVersion = projectVersionResult.data?.[0];
      if (projectVersionResult.error || requestResult.error || !approvedVersion) {
        setRows([]); setSelected([]); setContractors(contractorResult.data ?? []); setError('Impossible de charger les lots de la version approuvée.');
        return;
      }
      const { data: links, error: linksError } = await supabase.from('project_version_requests').select('request_version_id').eq('project_version_id', approvedVersion.id);
      const requestVersionIds = [...new Set((links ?? []).map(link => link.request_version_id))];
      const { data: snapshots, error: snapshotsError } = requestVersionIds.length
        ? await supabase.from('project_request_versions').select('id,request_id,title,scope,trade_id,version_no').in('id', requestVersionIds)
        : { data: [], error: null };
      if (linksError || snapshotsError) {
        setRows([]); setSelected([]); setContractors(contractorResult.data ?? []); setError('Impossible de charger les lots de la version approuvée.');
        return;
      }
      const activeRequestIds = new Set((requestResult.data ?? []).map(request => request.id));
      const lots = (snapshots ?? []).filter(snapshot => activeRequestIds.has(snapshot.request_id)).map(snapshot => ({ ...snapshot, id: snapshot.request_id }));
      setRows(lots); setSelected(lots.map(item => item.id)); setContractors(contractorResult.data ?? []);
    })();
  }, [projectId]);

  async function submit() {
    setSaving(true); setError('');
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) { setError('Session expirée.'); setSaving(false); return; }
    const response = await fetch('/api/publications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
      body: JSON.stringify({ project_id: projectId, visibility, request_ids: selected, contractor_ids: visibility === 'public' ? null : recipients, submission_deadline: deadline ? new Date(deadline).toISOString() : null }),
    });
    const body = await response.json();
    if (!response.ok) setError(body.error || 'Publication refusée.');
    else router.push('/app/publications/' + body.data.id);
    setSaving(false);
  }

  return <section className="mx-auto max-w-3xl space-y-6">
    <div><p className="text-sm font-semibold text-teal">Publication DAO</p><h1 className="mt-1 text-3xl font-bold">Revoir et publier</h1><p className="mt-2 text-black/60">Choisissez les lots et les professionnels qui pourront répondre.</p></div>
    <Card><label className="block text-sm font-semibold">Visibilité<select aria-label="Visibilité" className="mt-2 w-full rounded-xl border border-black/10 bg-white p-3" value={visibility} onChange={event => setVisibility(event.target.value)}><option value="public">Public — tous les artisans compatibles</option><option value="targeted">Ciblée — professionnels sélectionnés</option><option value="invite_only">Sur invitation — accès privé</option></select></label><label className="mt-4 block text-sm font-semibold">Date limite des offres (optionnelle)<Input type="datetime-local" value={deadline} onChange={event => setDeadline(event.target.value)} /></label><div className="mt-6 space-y-2"><p className="text-sm font-semibold">Lots publiés</p>{rows.length === 0 && <p className="text-sm text-black/50">Aucun lot ouvert lié à la version approuvée.</p>}{rows.map((row, index) => <label key={row.id} className="flex items-start gap-3 rounded-xl bg-sand/70 p-3 text-sm"><input className="mt-1" type="checkbox" checked={selected.includes(row.id)} onChange={event => setSelected(value => event.target.checked ? [...value, row.id] : value.filter(item => item !== row.id))} /><span><span className="block font-semibold">{row.title || 'Lot ' + (index + 1)}</span><span className="mt-1 block text-xs text-black/55">{row.scope || 'Périmètre à consulter'}</span></span></label>)}</div>{rows.length > 0 && selected.length === 0 && <p className="mt-3 text-sm text-amber-800">Sélectionnez au moins un lot pour publier.</p>}{visibility !== 'public' && <div className="mt-6 space-y-2"><p className="text-sm font-semibold">Destinataires autorisés</p>{contractors.length === 0 && <p className="text-sm text-black/50">Aucun professionnel vérifié disponible.</p>}{contractors.map(contractor => <label key={contractor.id} className="flex items-center gap-3 rounded-xl bg-sand/70 p-3 text-sm"><input type="checkbox" checked={recipients.includes(contractor.id)} onChange={event => setRecipients(value => event.target.checked ? [...value, contractor.id] : value.filter(item => item !== contractor.id))} /><span><span className="block font-semibold">{contractor.public_trade_name || contractor.business_name}</span><span className="text-xs text-black/55">{contractor.contractor_type === 'company' || contractor.contractor_type === 'general_contractor' ? 'Entreprise' : 'Artisan vérifié'}</span></span></label>)}</div>}{error && <p role="alert" className="mt-5 text-sm text-red-600">{error}</p>}<Button className="mt-6" disabled={saving || selected.length === 0 || (visibility !== 'public' && recipients.length === 0)} onClick={() => void submit()}>{saving ? 'Publication…' : 'Publier le DAO'}</Button></Card>
  </section>;
}

export default function PublicationPage() {
  return <Suspense fallback={<p>Chargement…</p>}><NewPublication /></Suspense>;
}
