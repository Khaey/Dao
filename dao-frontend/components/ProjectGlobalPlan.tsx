'use client';

import { useCallback, useEffect, useState } from 'react';
import { GitBranch, RefreshCw } from 'lucide-react';
import { supabaseBrowser } from '../lib/supabase-browser';
import { Badge, Card, SectionHeading } from './ui';
import { primaryAction, secondaryAction } from '../app/app/projects/_components/ProjectUi';

type LinkState = 'effective' | 'awaiting_confirmation' | 'unresolved' | 'rejected';
type PlanLot = { id: string; title: string | null; planned_start: string | null; planned_end: string | null; ready: boolean; awarded: boolean; contractor: string | null };
type PlanNode = { id: string; request_id: string; title: string; start_date: string | null; end_date: string | null };
type PlanLink = { id: string; manual?: boolean; pred_target: string | null; succ_target: string | null; pred_label: string | null; succ_label: string | null; state: LinkState };
type GlobalPlan = {
  /** Vrai seulement quand les retraits OCE sont réellement déployés : modifier / retirer / ajouter un lien est alors possible. */
  link_editing?: boolean;
  revision: number; lots: PlanLot[]; nodes: PlanNode[]; links: PlanLink[];
  sync: { state: 'none' | 'pending' | 'synced' | 'failed'; duration_days?: number | null; critical_codes: string[]; error_code?: string | null };
};

// Mêmes codes que dao-backend/src/oce/projectPlanSync.ts (identifiant complet, 32 caractères hexadécimaux).
const hex = (id: string) => id.replace(/-/g, '').toLowerCase();
const lotCode = (id: string) => `LA-${hex(id)}`;
const nodeCode = (id: string) => `SL-${hex(id)}`;

const linkText: Record<LinkState, { text: string; tone: 'neutral' | 'teal' | 'clay' | 'red' }> = {
  effective: { text: 'Effectif', tone: 'teal' },
  awaiting_confirmation: { text: 'À confirmer', tone: 'clay' },
  unresolved: { text: 'En attente d’attribution ou de dates', tone: 'neutral' },
  rejected: { text: 'Rejeté', tone: 'red' },
};
const syncText = {
  none: { text: 'Rien à calculer', tone: 'neutral' as const },
  pending: { text: 'Mise à jour du planning…', tone: 'clay' as const },
  synced: { text: 'À jour', tone: 'teal' as const },
  failed: { text: 'À réessayer', tone: 'red' as const },
};

async function api(method: 'GET' | 'POST', body?: Record<string, unknown>, projectId?: string) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('Session expirée. Reconnectez-vous.');
  const response = await fetch(`/api/oce/project-plan${method === 'GET' ? `?project_id=${projectId}` : ''}`, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json().catch(() => ({}));
  return { status: response.status, data: payload.data as GlobalPlan | undefined, code: payload.code as string | undefined };
}

const day = (value: string | null) => (value ? new Date(`${value}T00:00:00Z`).toLocaleDateString('fr-FR', { timeZone: 'UTC' }) : '—');

/**
 * Planning global du projet : tous les lots dans UN graphe (dépendances intra- et inter-lots), chemin critique calculé par OCE.
 * Les liens proposés par les Artisans ne deviennent effectifs qu'après attribution du lot et confirmation ici.
 */
export default function ProjectGlobalPlan({ projectId, canDecide }: { projectId: string; canDecide: boolean }) {
  const [plan, setPlan] = useState<GlobalPlan | null>(null);
  const [hidden, setHidden] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Une seule action métier à la fois : ajouter un lien, modifier un lien (remplacement) ou confirmer un retrait.
  const [editor, setEditor] = useState<{ mode: 'add' | 'replace'; linkId?: string; pred: string; succ: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const load = useCallback(async () => {
    const result = await api('GET', undefined, projectId);
    if (result.status === 401 || result.status === 403) { setHidden(true); return; }
    if (result.status === 200 && result.data) setPlan(result.data);
  }, [projectId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (plan?.sync.state !== 'pending') return;
    const timer = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(timer);
  }, [plan?.sync.state, load]);

  if (hidden || !plan || plan.lots.length === 0) return null;

  const names = new Map<string, string>();
  for (const lot of plan.lots) names.set(`lot:${lot.id}`, lot.title || 'Lot');
  for (const node of plan.nodes) names.set(`node:${node.id}`, node.title);
  const critical = new Set(plan.sync.critical_codes);
  const effective = plan.links.filter(link => link.state === 'effective' && link.pred_target && link.succ_target);
  const before = (target: string) => effective.filter(link => link.succ_target === target).map(link => names.get(link.pred_target!) ?? '').filter(Boolean);
  const after = (target: string) => effective.filter(link => link.pred_target === target).map(link => names.get(link.succ_target!) ?? '').filter(Boolean);
  const hasAwarded = plan.lots.some(lot => lot.awarded);

  async function decide(linkId: string, decision: 'confirmed' | 'rejected') {
    setBusy(true); setMessage('');
    const result = await api('POST', { project_id: projectId, link_id: linkId, decision });
    setBusy(false);
    if (result.status === 200 && result.data) { setPlan(result.data); setMessage(decision === 'confirmed' ? 'Lien confirmé. Le planning est recalculé.' : 'Lien rejeté.'); return; }
    setMessage(result.code === 'DEPENDENCY_CYCLE' ? 'Ce lien créerait une boucle : un travail ne peut pas dépendre, même indirectement, de lui-même.'
      : result.code === 'LINK_CONFIRMED_FINAL' ? 'Un lien confirmé ne peut plus être retiré : le planning calculé en dépend.'
      : result.status === 403 ? 'Décision réservée au Client du projet et à la gestion D.A.O.' : 'Décision impossible pour le moment.');
  }
  const errorText = (result: { status: number; code?: string }) =>
    result.code === 'DEPENDENCY_CYCLE' ? 'Ce lien créerait une boucle : un travail ne peut pas dépendre, même indirectement, de lui-même.'
    : result.code === 'LINK_DUPLICATE' ? 'Ce lien existe déjà dans le planning.'
    : result.code === 'LINK_CONFIRMED_FINAL' || result.code === 'LINK_EDITING_UNAVAILABLE' ? 'La modification des liens n’est pas encore disponible.'
    : result.status === 403 ? 'Action réservée au Client du projet et à la gestion D.A.O.' : 'Action impossible pour le moment.';
  async function change(body: Record<string, unknown>, success: string) {
    setBusy(true); setMessage('');
    const result = await api('POST', { project_id: projectId, ...body });
    setBusy(false);
    if (result.status === 200 && result.data) { setPlan(result.data); setEditor(null); setRemoving(null); setMessage(success); return; }
    setMessage(errorText(result));
  }
  async function relaunch() {
    setBusy(true); setMessage('');
    const result = await api('POST', { project_id: projectId });
    setBusy(false); setMessage(result.status === 202 ? 'Nouveau calcul demandé.' : 'Relance impossible.'); await load();
  }

  const canEdit = canDecide && plan.link_editing === true;
  const options = [
    ...plan.lots.filter(lot => lot.ready).map(lot => ({ value: `lot:${lot.id}`, label: `Lot · ${lot.title || 'Lot'}` })),
    ...plan.nodes.filter(node => node.start_date).map(node => ({ value: `node:${node.id}`, label: node.title })),
  ];
  const picker = (label: string, value: string, onChange: (next: string) => void) => <label className="flex min-w-0 flex-col gap-1 text-xs text-ink/70">{label}
    <select className="rounded-lg border border-black/15 bg-white px-2 py-2 text-sm text-ink" value={value} onChange={event => onChange(event.target.value)}>
      <option value="">Choisir…</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select></label>;

  return <Card data-testid="project-global-plan">
    <SectionHeading eyebrow="Planning global" title="Enchaînement de tous les lots"
      description="Un seul planning pour le chantier : les dépendances entre travaux d’un même lot ou de lots différents sont prises en compte, et le chemin critique est calculé sur l’ensemble."
      action={<span className="flex items-center gap-2"><GitBranch size={20} aria-hidden="true" className="text-teal" /><Badge tone={syncText[plan.sync.state].tone}>{syncText[plan.sync.state].text}</Badge></span>} />
    {plan.sync.state === 'synced' && <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3" data-testid="plan-summary">
      <div><dt className="text-xs text-ink/60">Durée totale</dt><dd className="font-semibold text-ink" data-testid="plan-duration">{plan.sync.duration_days} j</dd></div>
      <div><dt className="text-xs text-ink/60">Travaux sur le chemin critique</dt><dd className="font-semibold text-ink" data-testid="plan-critical-count">{plan.sync.critical_codes.length}</dd></div>
    </dl>}
    {plan.sync.state === 'failed' && <p role="status" className="mt-3 text-sm text-ink/70">Le calcul du chemin critique est momentanément indisponible{plan.sync.error_code === 'dependency_cycle' ? ' : les liens confirmés forment une boucle' : ''}.</p>}
    {!hasAwarded && <p className="mt-3 text-sm text-ink/70">Les liens proposés par les Artisans apparaîtront ici dès l’attribution des lots concernés.</p>}

    <div className="mt-4 space-y-3">
      {plan.lots.map(lot => {
        const nodes = plan.nodes.filter(node => node.request_id === lot.id);
        const isCritical = critical.has(lotCode(lot.id));
        return <section key={lot.id} className="rounded-xl border border-black/[0.08] p-4" data-testid="plan-lot" aria-label={lot.title || 'Lot'}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-ink">{lot.title || 'Lot'}</h3>
            <span className="flex flex-wrap items-center gap-1.5">
              {isCritical && <Badge tone="red">Chemin critique</Badge>}
              <Badge tone={lot.awarded ? 'teal' : 'neutral'}>{lot.awarded ? `Attribué${lot.contractor ? ` · ${lot.contractor}` : ''}` : 'Non attribué'}</Badge>
            </span>
          </div>
          <p className="mt-1 text-sm text-ink/70">{lot.ready ? `Du ${day(lot.planned_start)} au ${day(lot.planned_end)}` : 'Dates du lot non renseignées.'}</p>
          {(before(`lot:${lot.id}`).length > 0 || after(`lot:${lot.id}`).length > 0) && <p className="mt-1 text-xs text-ink/60">
            {before(`lot:${lot.id}`).length > 0 && <>Après : {before(`lot:${lot.id}`).join(', ')}. </>}{after(`lot:${lot.id}`).length > 0 && <>Avant : {after(`lot:${lot.id}`).join(', ')}.</>}</p>}
          {nodes.length > 0 && <ul className="mt-3 space-y-2">
            {nodes.map(node => <li key={node.id} className="rounded-lg bg-sand/50 p-3 text-sm" data-testid="plan-node">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink">{node.title}</span>
                <span className="flex items-center gap-1.5">{critical.has(nodeCode(node.id)) && <span data-testid="plan-critical"><Badge tone="red">Chemin critique</Badge></span>}<span className="text-xs text-ink/65">{node.start_date ? `${day(node.start_date)} → ${day(node.end_date)}` : 'Sans dates'}</span></span>
              </div>
              {(before(`node:${node.id}`).length > 0 || after(`node:${node.id}`).length > 0) && <p className="mt-1 text-xs text-ink/60">
                {before(`node:${node.id}`).length > 0 && <>Commence après : {before(`node:${node.id}`).join(', ')}. </>}{after(`node:${node.id}`).length > 0 && <>Précède : {after(`node:${node.id}`).join(', ')}.</>}</p>}
            </li>)}
          </ul>}
        </section>;
      })}
    </div>

    {(plan.links.length > 0 || canEdit) && <div className="mt-5" data-testid="plan-links">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">Liens du planning</h3>
        {canEdit && <button type="button" disabled={busy} className={secondaryAction} onClick={() => { setRemoving(null); setEditor({ mode: 'add', pred: '', succ: '' }); }}>Ajouter un lien</button>}
      </div>
      {editor && <div className="mt-2 rounded-xl border border-teal/30 bg-teal/5 p-3" data-testid="plan-link-editor">
        <p className="text-sm font-medium text-ink">{editor.mode === 'add' ? 'Ajouter un lien' : 'Modifier le lien'}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {picker('Doit être terminé', editor.pred, pred => setEditor({ ...editor, pred }))}
          {picker('Avant que commence', editor.succ, succ => setEditor({ ...editor, succ }))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy || !editor.pred || !editor.succ || editor.pred === editor.succ} className={primaryAction}
            onClick={() => void change(editor.mode === 'add'
              ? { action: 'add', pred_target: editor.pred, succ_target: editor.succ }
              : { action: 'replace', link_id: editor.linkId, pred_target: editor.pred, succ_target: editor.succ },
              editor.mode === 'add' ? 'Lien ajouté. Le planning est mis à jour.' : 'Lien modifié. Le planning est mis à jour.')}>Enregistrer</button>
          <button type="button" disabled={busy} className={secondaryAction} onClick={() => setEditor(null)}>Annuler</button>
        </div>
      </div>}
      <ul className="mt-2 space-y-2">
        {plan.links.filter(link => !(link.manual && link.state === 'rejected')).map(link => <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/[0.08] p-3 text-sm" data-testid="plan-link">
          <span className="min-w-0 text-ink"><span className="font-medium">{link.succ_label || 'Travail'}</span> commence après la fin de <span className="font-medium">{link.pred_label || 'travail'}</span>{link.manual && <span className="ml-1 text-xs text-ink/60">(ajouté par le Client)</span>}</span>
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={linkText[link.state].tone}>{linkText[link.state].text}</Badge>
            {canDecide && link.state === 'awaiting_confirmation' && <>
              <button type="button" disabled={busy} className={primaryAction} onClick={() => void decide(link.id, 'confirmed')}>Confirmer</button>
              <button type="button" disabled={busy} className={secondaryAction} onClick={() => void decide(link.id, 'rejected')}>Rejeter</button></>}
            {canDecide && link.state === 'rejected' && !link.manual && <button type="button" disabled={busy} className={secondaryAction} onClick={() => void decide(link.id, 'confirmed')}>Reconsidérer</button>}
            {canEdit && link.state === 'effective' && removing !== link.id && <>
              <button type="button" disabled={busy} className={secondaryAction} onClick={() => { setRemoving(null); setEditor({ mode: 'replace', linkId: link.id, pred: link.pred_target ?? '', succ: link.succ_target ?? '' }); }}>Modifier le lien</button>
              <button type="button" disabled={busy} className={secondaryAction} onClick={() => { setEditor(null); setRemoving(link.id); }}>Retirer le lien</button></>}
          </span>
          {canEdit && removing === link.id && <div className="flex w-full flex-wrap items-center gap-2 rounded-lg bg-sand/60 p-2" role="group" aria-label="Retirer ce lien" data-testid="plan-link-remove">
            <span className="text-sm text-ink">Retirer ce lien ? Le planning sera recalculé.</span>
            <button type="button" disabled={busy} className={primaryAction} onClick={() => void change({ action: 'remove', link_id: link.id }, 'Lien retiré. Le planning est mis à jour.')}>Retirer</button>
            <button type="button" disabled={busy} className={secondaryAction} onClick={() => setRemoving(null)}>Garder</button>
          </div>}
        </li>)}
      </ul>
    </div>}
    {message && <p role="status" className="mt-3 text-sm text-ink/70" data-testid="plan-message">{message}</p>}
    {plan.sync.state === 'failed' && <button type="button" onClick={relaunch} disabled={busy} className={`${secondaryAction} mt-3`}><RefreshCw size={14} aria-hidden="true" className="mr-1.5" />Relancer le calcul</button>}
  </Card>;
}
