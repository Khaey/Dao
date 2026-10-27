'use client';

import { useState, type FormEvent } from 'react';
import type { NativeExecutionPlanDTO } from '../../../dao-backend/src/native-tracking/contract';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { millimesToTnd } from './OfficialSubLotsPanel';

type Plan = NativeExecutionPlanDTO;
type Lot = Plan['lots'][number];
type Installment = Plan['agreementsByAward'][number]['installments'][number];
type ScopeType = 'lot' | 'sub_lot' | 'milestone' | 'period' | 'project_end';
type Scope = NonNullable<Installment['scopeRef']>;

const field = 'mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2.5 text-sm text-ink';
const button = 'inline-flex min-h-10 items-center justify-center rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink disabled:cursor-not-allowed disabled:opacity-50';
const typeLabels: Record<ScopeType, string> = { lot: 'Ce lot', sub_lot: 'Un sous-lot de l’offre', milestone: 'Un jalon', period: 'Une période', project_end: 'La fin du chantier' };
const pretty = (raw: string) => new Date(raw.slice(0, 10) + 'T00:00:00Z').toLocaleDateString('fr-TN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** Liaison INFORMATIVE d'une échéance à un périmètre via l'API JWT #415 : proposition puis acceptation explicite Client + Artisan. */
async function postScope(body: Record<string, unknown>) {
  const { data } = await supabaseBrowser().auth.getSession();
  if (!data.session) throw new Error('Session expirée. Reconnectez-vous.');
  const response = await fetch('/api/projects/native-execution/installment-scopes', {
    method: 'POST', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error || 'Commande refusée.');
}

export default function NativeInstallmentScopes({ plan, lot, onUpdated }: { plan: Plan; lot: Lot; onUpdated: () => void }) {
  const agreement = plan.agreementsByAward.find(row => row.awardId === lot.award?.awardId) ?? null;
  const workspace = plan.viewer.workspace;
  const party = workspace === 'client' || workspace === 'contractor' ? workspace : null;
  const [editing, setEditing] = useState<number | null>(null);
  const [type, setType] = useState<ScopeType>('lot');
  const [target, setTarget] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [confirm, setConfirm] = useState<{ id: string; decision: 'accepted' | 'rejected' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!agreement || !lot.award) return null;
  const awardItemId = lot.award.awardItemId;
  const describe = (scope: Pick<Scope, 'type' | 'awardItemId' | 'subLotId' | 'milestoneKey' | 'periodStart' | 'periodEnd'>) => {
    if (scope.type === 'lot') return scope.awardItemId === awardItemId ? `Lot « ${lot.title ?? 'sans intitulé'} »` : 'Un autre lot de l’attribution';
    if (scope.type === 'sub_lot') return `Sous-lot « ${lot.executionSubLots.find(item => item.id === scope.subLotId)?.title ?? 'non visible'} »`;
    if (scope.type === 'milestone') return `Jalon « ${lot.milestones.find(item => item.key === scope.milestoneKey)?.title ?? 'non visible'} »`;
    if (scope.type === 'period') return scope.periodStart && scope.periodEnd ? `Période du ${pretty(scope.periodStart)} au ${pretty(scope.periodEnd)}` : 'Période';
    return 'Fin du chantier';
  };
  const options: ScopeType[] = ['lot', ...(lot.executionSubLots.length ? ['sub_lot' as const] : []), ...(lot.milestones.length ? ['milestone' as const] : []), 'period', 'project_end'];
  const formInvalid = (type === 'sub_lot' || type === 'milestone') && !target || type === 'period' && (!periodStart || !periodEnd || periodEnd < periodStart);

  async function prepare(event: FormEvent<HTMLFormElement>, installment: Installment) {
    event.preventDefault();
    if (busy || formInvalid) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await postScope({
        mode: 'prepare', agreementVersionId: agreement!.agreementVersionId, installmentNo: installment.number, scopeType: type,
        awardItemId: ['lot', 'sub_lot', 'milestone'].includes(type) ? awardItemId : null,
        subLotId: type === 'sub_lot' ? target : null, milestoneKey: type === 'milestone' ? target : null,
        periodStart: type === 'period' ? periodStart : null, periodEnd: type === 'period' ? periodEnd : null,
        idempotencyKey: crypto.randomUUID(),
      });
      setEditing(null);
      setNotice('Rattachement proposé. Il ne s’applique qu’après l’accord du Client et de l’Artisan.');
      onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Proposition impossible.'); }
    finally { setBusy(false); }
  }
  async function respond() {
    if (!confirm || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await postScope({ mode: 'respond', proposalId: confirm.id, decision: confirm.decision, idempotencyKey: crypto.randomUUID() });
      setConfirm(null);
      setNotice('Votre décision est enregistrée. L’autre partie décide séparément.');
      onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Décision impossible.'); }
    finally { setBusy(false); }
  }

  return <div className="space-y-3 rounded-xl border border-black/10 bg-white p-4">
    <div><h3 className="text-sm font-bold text-ink">Échéances des conditions (facultatif)</h3>
      <p className="mt-1 text-xs text-black/60">Rattacher une échéance à un lot, un sous-lot, un jalon ou une période est purement informatif : aucun paiement, aucune facture ni signature n’est déclenché.</p></div>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    {notice && <p role="status" className="rounded-xl border border-teal/20 bg-teal/[0.04] p-3 text-sm text-teal">{notice}</p>}
    {agreement.installments.length === 0 ? <p className="text-sm text-black/55">Aucune échéance dans la version de conditions de ce lot.</p>
      : <ul className="space-y-2">{agreement.installments.map(installment => {
        const proposal = installment.scopeProposal;
        const alreadyAccepted = party != null && Boolean(proposal?.acceptedBy.includes(party));
        return <li key={installment.number} className="space-y-2 rounded-xl border border-black/10 p-3 text-sm">
          <p className="flex flex-wrap justify-between gap-2"><span className="font-semibold">Échéance {installment.number}{installment.label ? ` · ${installment.label}` : ''}</span>
            <span className="tabular-nums text-ink/70">{millimesToTnd(installment.amountMillimes) || '0'} TND{installment.dueDate ? ` · ${pretty(installment.dueDate)}` : ''}</span></p>
          <p className="text-xs text-black/60">{installment.scopeRef ? `Rattachée à : ${describe(installment.scopeRef)}` : 'Non rattachée à un périmètre.'}</p>
          {proposal && <div className="rounded-lg bg-sand/60 p-2.5 text-xs">
            <p>Proposition en attente : {describe(proposal)} · accords {proposal.acceptedBy.length}/2</p>
            {party && !alreadyAccepted && confirm?.id !== proposal.id && <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" className={button} disabled={busy} onClick={() => setConfirm({ id: proposal.id, decision: 'accepted' })}>Accepter</button>
              <button type="button" className={button} disabled={busy} onClick={() => setConfirm({ id: proposal.id, decision: 'rejected' })}>Refuser</button></div>}
            {alreadyAccepted && <p className="mt-1 text-teal">Votre accord est enregistré ; l’autre partie reste libre.</p>}
            {confirm?.id === proposal.id && <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5">
              <p>Confirmer : {confirm.decision === 'accepted' ? 'accepter' : 'refuser'} ce rattachement ?</p>
              <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={button + ' bg-teal text-white'} disabled={busy} onClick={() => void respond()}>Confirmer</button>
                <button type="button" className={button} disabled={busy} onClick={() => setConfirm(null)}>Annuler</button></div></div>}
          </div>}
          {!proposal && editing !== installment.number && <button type="button" className={button} disabled={busy} onClick={() => { setEditing(installment.number); setType('lot'); setTarget(''); setPeriodStart(''); setPeriodEnd(''); }}>
            {workspace === 'dao_manager' ? 'Proposer un rattachement aux parties' : installment.scopeRef ? 'Proposer un autre rattachement' : 'Proposer un rattachement'}</button>}
          {editing === installment.number && <form onSubmit={event => void prepare(event, installment)} className="space-y-2">
            <label className="block text-xs font-semibold">Périmètre<select className={field} value={type} disabled={busy} onChange={event => { setType(event.target.value as ScopeType); setTarget(''); }}>
              {options.map(option => <option key={option} value={option}>{typeLabels[option]}</option>)}</select></label>
            {type === 'sub_lot' && <label className="block text-xs font-semibold">Sous-lot<select className={field} required value={target} disabled={busy} onChange={event => setTarget(event.target.value)}>
              <option value="">Choisir</option>{lot.executionSubLots.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
            {type === 'milestone' && <label className="block text-xs font-semibold">Jalon<select className={field} required value={target} disabled={busy} onChange={event => setTarget(event.target.value)}>
              <option value="">Choisir</option>{lot.milestones.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}</select></label>}
            {type === 'period' && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block text-xs font-semibold">Du<input className={field} type="date" required value={periodStart} disabled={busy} onChange={event => setPeriodStart(event.target.value)} /></label>
              <label className="block text-xs font-semibold">Au<input className={field} type="date" required min={periodStart || undefined} value={periodEnd} disabled={busy} onChange={event => setPeriodEnd(event.target.value)} /></label></div>}
            <div className="flex flex-wrap gap-2"><button type="submit" className={button + ' bg-teal text-white'} disabled={busy || formInvalid}>{busy ? 'Envoi…' : 'Proposer'}</button>
              <button type="button" className={button} disabled={busy} onClick={() => setEditing(null)}>Annuler</button></div>
          </form>}
        </li>;
      })}</ul>}
  </div>;
}
