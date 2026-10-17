'use client';
import { FormEvent, useEffect, useState } from 'react';
import { AlertCircle, Check, Info } from 'lucide-react';
import { Card, SectionHeading } from './ui';
import { paymentLabels, projectApi, stageLabels } from '../lib/collaboration';
import { cn } from '../lib/utils';
import { fieldClass, primaryAction } from '../app/app/projects/_components/ProjectUi';

const stageOrder = ['not_started', 'started', 'in_progress', 'completed'];

export default function ProjectTracking({ project, canEdit, onChange }: { project: any; canEdit: boolean; onChange: (project: any) => void }) {
  const [stage, setStage] = useState(project.project_stage); const [payment, setPayment] = useState(project.payment_status);
  const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  useEffect(() => { setStage(project.project_stage); setPayment(project.payment_status); }, [project.project_stage, project.payment_status]);
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('');
    try { onChange(await projectApi('/api/projects/tracking', { project_id: project.id, project_stage: stage, payment_status: payment })); setSuccess('Suivi du chantier enregistré.'); }
    catch (exception: any) { setError(exception.message); } finally { setSaving(false); }
  }
  const selectClass = cn(fieldClass, 'mt-2 disabled:bg-sand disabled:text-ink/65');
  const savedIndex = stageOrder.indexOf(project.project_stage);
  return <Card className="p-5 sm:p-6"><SectionHeading title="Suivi du chantier" description="L’avancement des travaux et la situation du paiement sont indépendants du statut du DAO." />
    {savedIndex >= 0 && <ol className="mt-5 grid grid-cols-4 gap-2" aria-label="Avancement enregistré des travaux">{stageOrder.map((value, index) => <li key={value} aria-current={index === savedIndex ? 'step' : undefined} className="min-w-0"><span aria-hidden="true" className={`block h-1.5 rounded-full ${index <= savedIndex ? 'bg-teal' : 'bg-ink/10'}`} /><span className={`mt-2 block break-words text-xs font-semibold leading-tight ${index <= savedIndex ? 'text-ink' : 'text-ink/65'}`}>{stageLabels[value]}</span></li>)}</ol>}
    <form onSubmit={save} className="mt-6 grid gap-4 sm:grid-cols-2">
      <label className="block text-sm font-semibold text-ink">Avancement actuel du chantier<select aria-label="Avancement actuel du chantier" className={selectClass} value={stage} disabled={!canEdit || saving} onChange={event => setStage(event.target.value)}>{Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label className="block text-sm font-semibold text-ink">Situation du paiement — optionnel<select aria-label="Situation du paiement — optionnel" className={selectClass} value={payment} disabled={!canEdit || saving} onChange={event => setPayment(event.target.value)}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <p className="flex items-start gap-2 rounded-xl bg-sand px-3.5 py-3 text-sm text-ink/70 sm:col-span-2"><Info size={16} aria-hidden="true" className="mt-0.5 shrink-0" />Le paiement est une information déclarative. Aucun paiement, contrat, attribution ou publication n’est déclenché ici.</p>
      {canEdit && <div className="sm:col-span-2"><button type="submit" className={primaryAction} disabled={saving}>{saving ? 'Enregistrement…' : 'Enregistrer le suivi'}</button></div>}
    </form>
    {project.confirmed_at && <p className="mt-5 flex items-center gap-2 text-sm text-ink/70"><Check size={15} aria-hidden="true" className="text-teal" />Chantier confirmé par le client le {new Date(project.confirmed_at).toLocaleDateString('fr-TN')}.</p>}
    {error && <p role="alert" className="mt-4 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{error}</p>}
    {success && <p role="status" className="mt-4 flex items-start gap-2 rounded-xl border border-teal/20 bg-teal/[0.07] px-4 py-3 text-sm text-teal"><Check size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{success}</p>}
  </Card>;
}
