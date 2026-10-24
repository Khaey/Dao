'use client';

import { useState } from 'react';
import type { NativeExecutionPlanDTO } from '../../../dao-backend/src/native-tracking/contract';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { Card } from '../ui';
import type { ExecutionTableLot } from './native-plan-adapter';

const field = 'mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink';
const button = 'inline-flex min-h-10 items-center justify-center rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50';
type ActivityKind = 'sub_lot' | 'activity';
type Decision = 'accepted' | 'rejected';

/** Ecrit UNIQUEMENT via le backend JWT DEV 3 #413. Aucune règle métier ou signature simulée. */
async function postNativeActivity(body: Record<string, unknown>) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('Session expirée. Reconnectez-vous.');
  const response = await fetch('/api/projects/native-execution/activities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
    body: JSON.stringify(body), cache: 'no-store',
  });
  const dataJson: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const payload = dataJson && typeof dataJson === 'object' ? dataJson as { error?: string } : {};
    throw new Error(payload.error || 'Impossible de valider cette commande.');
  }
}

function date(raw: string | null) {
  return raw ? new Date(raw + 'T00:00:00Z').toLocaleDateString('fr-TN', { timeZone: 'UTC' }) : 'Non précisée';
}

export default function NativeActivityPanel({ plan, lot, onUpdated }: {
  plan: NativeExecutionPlanDTO; lot: ExecutionTableLot; onUpdated: () => void;
}) {
  const [kind, setKind] = useState<ActivityKind>('sub_lot');
  const [title, setTitle] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; decision: Decision } | null>(null);

  const activities = plan.activities?.items?.filter(item =>
    item.active && item.requestId === lot.requestId && item.awardItemId === lot.awardItemId) ?? [];
  const pending = plan.changeProposals?.filter(row =>
    row.requestId === lot.requestId && row.awardItemId === lot.awardItemId && row.state === 'pending_acceptance') ?? [];
  const isManager = plan.viewer.workspace === 'dao_manager';
  const canWrite = Boolean(lot.awardItemId && (isManager ? lot.canPrepareChange : lot.canEditActivities));
  const actionLabel = isManager ? 'Proposer aux parties' : 'Ajouter au suivi';
  const canRespond = lot.canAcceptEngagingChange && plan.viewer.workspace !== 'dao_manager';

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canWrite || busy || !lot.awardItemId || !title.trim() || title.trim().length > 180
      || (start && end && end < start)) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await postNativeActivity({
        mode: isManager ? 'prepare' : 'write', action: 'create',
        awardItemId: lot.awardItemId, activityId: null, parentActivityId: null,
        kind, title: title.trim(), scope: null, position: activities.length,
        plannedStart: start || null, plannedEnd: end || null,
        durationDays: null, expectedRevision: null,
        idempotencyKey: crypto.randomUUID(),
      });
      setOpen(false); setTitle(''); setStart(''); setEnd('');
      setNotice(isManager ? 'Proposition transmise. Elle reste en attente des deux parties.' : 'Élément enregistré dans le suivi.');
      onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Enregistrement impossible.'); }
    finally { setBusy(false); }
  }

  async function respond() {
    if (!confirm || busy || !canRespond) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await postNativeActivity({ mode: 'respond', proposalId: confirm.id, decision: confirm.decision,
        idempotencyKey: crypto.randomUUID() });
      setConfirm(null);
      setNotice('Votre décision est enregistrée. Les engagements des autres parties ne sont pas acceptés automatiquement.');
      onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Décision impossible.'); }
    finally { setBusy(false); }
  }

  return <Card className="space-y-4 border border-black/5 bg-sand/30">
    <div>
      <h3 className="text-base font-bold text-ink">Activités et sous-lots après attribution</h3>
      <p className="mt-1 text-xs text-black/60">Ces éléments complètent le suivi opérationnel. Le devis gagnant reste inchangé ; les propositions du Gestionnaire nécessitent l’accord du Client et de l’Artisan.</p>
    </div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-teal/20 bg-white p-3 text-sm text-teal">{notice}</p>}
    {!plan.activities?.supported && <p className="text-sm text-black/60">Les activités natives ne sont pas encore disponibles sur ce chantier.</p>}
    {plan.activities?.supported && <>
      <div className="space-y-2">
        {activities.length ? activities.map(item => <div key={item.id} className="rounded-xl border border-black/10 bg-white p-3">
          <div className="flex flex-wrap justify-between gap-2"><span className="font-semibold text-sm">{item.title}</span><span className="text-xs text-black/50">{item.kind === 'sub_lot' ? 'Sous-lot opérationnel' : 'Activité'} · révision {item.revision}</span></div>
          <p className="mt-1 text-xs text-black/60">Dates : {date(item.plannedDates.start)} → {date(item.plannedDates.end)} · {item.history.length} événement(s) d’historique</p>
        </div>) : <p className="text-sm text-black/55">Aucune activité supplémentaire. Le suivi du lot fonctionne sans cette option.</p>}
      </div>
      {plan.activities.truncated && <p role="status" className="text-xs text-amber-800">Liste partielle : certains éléments ne sont pas affichés.</p>}
      {canWrite && !open && <button type="button" className={button} onClick={() => setOpen(true)}>
        {isManager ? 'Proposer un sous-lot ou une activité' : 'Ajouter un sous-lot ou une activité'}
      </button>}
      {canWrite && open && <form onSubmit={submit} className="space-y-3 rounded-xl border border-teal/20 bg-white p-4">
        <label className="block text-sm font-semibold">Type
          <select className={field} value={kind} onChange={event => setKind(event.target.value as ActivityKind)} disabled={busy}>
            <option value="sub_lot">Sous-lot opérationnel</option><option value="activity">Activité</option>
          </select>
        </label>
        <label className="block text-sm font-semibold">Intitulé
          <input className={field} required maxLength={180} value={title} disabled={busy} onChange={event => setTitle(event.target.value)} placeholder="Décrire les travaux"/>
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block text-sm font-semibold">Début (facultatif)
            <input className={field} type="date" value={start} disabled={busy} onChange={event => setStart(event.target.value)} />
          </label>
          <label className="block text-sm font-semibold">Fin (facultative)
            <input className={field} type="date" value={end} disabled={busy} min={start || undefined} onChange={event => setEnd(event.target.value)} />
          </label>
        </div>
        <p className="text-xs text-black/55">Les dates sont facultatives. Elles ne déclenchent ni contrat, ni paiement ni planning obligatoire.</p>
        <div className="flex flex-wrap gap-2"><button className={button + ' bg-teal text-white'} type="submit" disabled={busy || !title.trim() || Boolean(start && end && end < start)}>{busy ? 'Enregistrement…' : actionLabel}</button>
          <button className={button} type="button" disabled={busy} onClick={() => setOpen(false)}>Annuler</button></div>
      </form>}
      {pending.length > 0 && <div className="space-y-3 border-t border-black/10 pt-3">
        <h4 className="text-sm font-bold text-ink">Modifications proposées</h4>
        {pending.map(proposal => {
          const viewerParty = plan.viewer.workspace === 'client' ? 'client' : plan.viewer.workspace === 'contractor' ? 'contractor' : null;
          const alreadyAccepted = viewerParty != null && proposal.acceptedBy.includes(viewerParty);
          return <div key={proposal.proposalId} className="space-y-2 rounded-xl border border-black/10 bg-white p-3">
            <p className="text-sm font-semibold">{proposal.title || 'Modification d’activité'} · {proposal.action === 'create' ? 'Création' : proposal.action === 'update' ? 'Modification' : 'Retrait'}</p>
            <p className="text-xs text-black/60">Accords enregistrés : {proposal.acceptedBy.length}/2. Aucune validation juridique automatique.</p>
            {canRespond && !alreadyAccepted && <div className="flex flex-wrap gap-2">
              <button type="button" className={button} disabled={busy} onClick={() => setConfirm({ id: proposal.proposalId, decision: 'accepted' })}>Accepter cette proposition</button>
              <button type="button" className={button} disabled={busy} onClick={() => setConfirm({ id: proposal.proposalId, decision: 'rejected' })}>Refuser</button>
            </div>}
            {alreadyAccepted && <p className="text-xs text-teal">Votre accord est déjà enregistré ; l’autre partie reste indépendante.</p>}
            {confirm?.id === proposal.proposalId && <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
              <p className="text-sm text-ink">Confirmer votre décision : {confirm.decision === 'accepted' ? 'accepter' : 'refuser'} cette version ?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button className={button + ' bg-teal text-white'} disabled={busy} type="button" onClick={() => void respond()}>Confirmer</button>
                <button className={button} disabled={busy} type="button" onClick={() => setConfirm(null)}>Annuler</button>
              </div>
            </div>}
          </div>;
        })}
      </div>}
    </>}
  </Card>;
}
