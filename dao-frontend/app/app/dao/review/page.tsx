'use client';

import { useEffect, useState } from 'react';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { Badge, Button, Card } from '../../../../components/ui';

type ReviewLot = { id: string; title: string; scope: string; budget_millimes: number | null; version_no: number; trade_name: string };
type ReviewRow = { id: string; project_id: string; title: string; description: string; status: string; version_no: number; lots: ReviewLot[] };
const formatTnd = (value?: number | null) => value == null ? 'Non renseigné' : new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(Number(value) / 1000);

export default function DaoReview() {
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  async function load() {
    setMessage('');
    const supabase = supabaseBrowser();
    const { data: versions, error: versionsError } = await supabase.from('project_versions').select('id,project_id,title,description,status,version_no').in('status', ['client_review', 'dao_review']).order('created_at', { ascending: true });
    if (versionsError) { setMessage('Impossible de charger les versions à examiner.'); setLoading(false); return; }
    const reviewVersions = versions ?? [];
    if (reviewVersions.length === 0) { setRows([]); setLoading(false); return; }

    const { data: links, error: linksError } = await supabase.from('project_version_requests').select('project_version_id,request_version_id').in('project_version_id', reviewVersions.map(row => row.id));
    const requestVersionIds = [...new Set((links ?? []).map(link => link.request_version_id))];
    const [{ data: snapshots, error: snapshotsError }, { data: trades, error: tradesError }] = requestVersionIds.length ? await Promise.all([
      supabase.from('project_request_versions').select('id,title,scope,budget_millimes,version_no,trade_id').in('id', requestVersionIds),
      supabase.from('trades').select('id,name_fr'),
    ]) : [{ data: [], error: null }, { data: [], error: null }];
    if (linksError || snapshotsError || tradesError) { setMessage('Impossible de charger les lots liés aux versions à examiner.'); setLoading(false); return; }

    const snapshotById = new Map((snapshots ?? []).map(snapshot => [snapshot.id, snapshot]));
    const tradeById = new Map((trades ?? []).map(trade => [trade.id, trade.name_fr]));
    const lotsByVersion = new Map<string, ReviewLot[]>();
    for (const link of links ?? []) {
      const snapshot = snapshotById.get(link.request_version_id);
      if (!snapshot) continue;
      const lots = lotsByVersion.get(link.project_version_id) ?? [];
      lots.push({ ...snapshot, trade_name: tradeById.get(snapshot.trade_id) ?? 'Métier' });
      lotsByVersion.set(link.project_version_id, lots);
    }
    setRows(reviewVersions.map(row => ({ ...row, lots: lotsByVersion.get(row.id) ?? [] })));
    setLoading(false);
  }

  useEffect(() => { void load(); }, []);

  async function decide(row: ReviewRow, approve: boolean) {
    setMessage('');
    const { data } = await supabaseBrowser().auth.getSession();
    if (!data.session) { setMessage('Session expirée.'); return; }
    const response = await fetch('/api/dao/review/decision', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, body: JSON.stringify({ project_id: row.project_id, approve, comment: comment || (approve ? 'Validé par DAO' : 'À corriger par le client') }) });
    const body = await response.json();
    if (!response.ok) { setMessage(body.error || 'Action refusée.'); return; }
    setMessage(approve ? 'Étape de revue validée.' : 'Projet refusé.');
    await load();
  }

  if (loading) return <p>Chargement…</p>;
  return <section className="mx-auto max-w-4xl space-y-6">
    <div><p className="text-sm font-semibold text-teal">Espace DAO</p><h1 className="mt-1 text-3xl font-bold">Revues en attente</h1></div>
    {message && <p role="status" className="text-sm text-teal">{message}</p>}
    {rows.length === 0 ? <Card>Aucune revue en attente.</Card> : rows.map(row => <Card key={row.id}>
      <div className="flex flex-wrap items-start justify-between gap-4"><div><h2 className="font-semibold">{row.title}</h2><p className="mt-1 whitespace-pre-wrap text-sm text-black/55">{row.description}</p></div><Badge>{row.status}</Badge></div>
      <div className="mt-5 rounded-xl bg-sand/70 p-4" aria-label="Lots examinés">
        <h3 className="font-semibold">Lots de cette version</h3>
        {row.lots.length === 0 ? <p className="mt-2 text-sm text-black/55">Aucun lot n’est lié à cette version du projet.</p> : <div className="mt-3 space-y-3">{row.lots.map(lot => <article key={lot.id} className="border-t border-black/5 pt-3"><div className="flex flex-wrap justify-between gap-3"><div><p className="text-xs font-semibold text-teal">{lot.trade_name}</p><h4 className="mt-1 font-semibold">{lot.title}</h4></div><span className="text-sm">{formatTnd(lot.budget_millimes)}</span></div><p className="mt-2 whitespace-pre-wrap text-sm text-black/60">{lot.scope}</p><p className="mt-2 text-xs text-black/40">Version du lot {lot.version_no}</p></article>)}</div>}
      </div>
      <textarea aria-label="Commentaire de revue" className="mt-4 w-full rounded-xl border p-3 text-sm" placeholder="Commentaire pour le client" value={comment} onChange={event => setComment(event.target.value)} />
      <div className="mt-4 flex gap-2"><Button onClick={() => void decide(row, true)}>{row.status === 'client_review' ? 'Passer en revue DAO' : 'Approuver'}</Button><Button className="bg-white text-red-600" onClick={() => void decide(row, false)}>Refuser</Button></div>
    </Card>)}
  </section>;
}
