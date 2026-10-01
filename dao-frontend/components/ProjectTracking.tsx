'use client';
import { FormEvent, useEffect, useState } from 'react';
import { Button, Card, SectionHeading } from './ui';
import { paymentLabels, projectApi, stageLabels } from '../lib/collaboration';

export default function ProjectTracking({ project, canEdit, onChange }: { project: any; canEdit: boolean; onChange: (project: any) => void }) {
  const [stage, setStage] = useState(project.project_stage); const [payment, setPayment] = useState(project.payment_status);
  const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  useEffect(() => { setStage(project.project_stage); setPayment(project.payment_status); }, [project.project_stage, project.payment_status]);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('');
    try { onChange(await projectApi('/api/projects/tracking', { project_id: project.id, project_stage: stage, payment_status: payment })); setSuccess('Suivi du chantier enregistré.'); }
    catch (exception: any) { setError(exception.message); } finally { setSaving(false); }
  }
  const selectClass = 'mt-2 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm focus:ring-4 focus:ring-teal/10 disabled:bg-sand';
  return <Card><SectionHeading title="Suivi du chantier" description="L’avancement des travaux et la situation du paiement sont indépendants du statut du DAO." /><form onSubmit={save} className="mt-5 space-y-5"><label className="block text-sm font-semibold">Avancement actuel du chantier<select aria-label="Avancement actuel du chantier" className={selectClass} value={stage} disabled={!canEdit || saving} onChange={event => setStage(event.target.value)}>{Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="block text-sm font-semibold">Situation du paiement — optionnel<select aria-label="Situation du paiement — optionnel" className={selectClass} value={payment} disabled={!canEdit || saving} onChange={event => setPayment(event.target.value)}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p className="text-sm text-black/55">Le paiement est une information déclarative. Aucun paiement, contrat, attribution ou publication n’est déclenché ici.</p>{canEdit && <Button disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer le suivi'}</Button>}</form>{project.confirmed_at && <p className="mt-5 text-sm text-black/55">Chantier confirmé par le client le {new Date(project.confirmed_at).toLocaleDateString('fr-TN')}.</p>}{error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}{success && <p role="status" className="mt-4 text-sm text-teal">{success}</p>}</Card>;
}
