'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, CheckCircle2, RefreshCw } from 'lucide-react';
import { Badge, Button, Card } from '../ui';
import { formatTnd } from '../../lib/contracts';
import {
  InstallmentUnavailable, readInstallments, recordInstallmentEvent,
  type InstallmentEventType, type InstallmentSnapshot,
} from '../../lib/precontract-installments';

const statuses = {
  pending: 'À déclarer', declared: 'Déclarée par l’Artisan',
  verified: 'Vérifiée par le Client', contested: 'Contestée par le Client',
  authorized: 'Autorisation enregistrée (sans paiement)',
};
const actionLabels: Record<InstallmentEventType, string> = {
  declared: 'Déclarer', verified: 'Vérifier', contested: 'Contester', authorized: 'Enregistrer une autorisation',
};
const date = (value?: string | null) => value ? new Date(value + (value.length === 10 ? 'T00:00:00' : '')).toLocaleDateString('fr-TN') : 'Non précisée';

export default function InstallmentPanel({ awardId }: { awardId: string }) {
  const [snapshot, setSnapshot] = useState<InstallmentSnapshot | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'unavailable' | 'error'>('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<{ no: number; type: InstallmentEventType } | null>(null);
  const [reason, setReason] = useState('');
  const load = useCallback(async () => {
    try { setSnapshot(await readInstallments(awardId)); setPhase('ready'); }
    catch (cause) {
      if (cause instanceof InstallmentUnavailable) setPhase('unavailable');
      else { setPhase('error'); setError((cause as Error).message); }
    }
  }, [awardId]);
  useEffect(() => { setPhase('loading'); void load(); }, [load]);

  async function submit() {
    if (!confirm || !snapshot?.agreement_version_id || busy) return;
    if (confirm.type === 'contested' && !reason.trim()) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await recordInstallmentEvent(awardId, snapshot.agreement_id, snapshot.agreement_version_id, confirm.no, confirm.type, reason);
      setConfirm(null); setReason('');
      await load();
      setNotice('Événement informatif enregistré. Aucun paiement n’a été effectué.');
    } catch (cause) { setError((cause as Error).message); await load(); }
    finally { setBusy(false); }
  }

  if (phase === 'loading') return <Card aria-busy="true" className="p-5"><p className="text-sm text-black/55">Chargement du suivi informatif des échéances…</p></Card>;
  if (phase === 'unavailable') return <Card className="space-y-3 p-5"><h2 className="text-lg font-bold text-ink">Suivi des échéances indisponible</h2><p className="text-sm text-black/60">Le suivi informatif n’est pas encore activé. Les conditions convenues restent consultables ; aucun paiement ou contrat signé n’est créé.</p><Button type="button" onClick={() => { setPhase('loading'); void load(); }} className="gap-2 bg-white text-ink ring-1 ring-black/10"><RefreshCw size={16} />Réessayer</Button></Card>;
  if (phase === 'error' || !snapshot) return <Card className="space-y-3 p-5"><h2 className="text-lg font-bold text-ink">Suivi des échéances indisponible</h2><p role="alert" className="text-sm text-red-700">{error || 'Lecture impossible.'}</p><Button type="button" onClick={() => { setPhase('loading'); void load(); }} className="bg-white text-ink ring-1 ring-black/10">Réessayer</Button></Card>;
  if (!snapshot.agreement_version_id || snapshot.installments.length === 0) return null;

  const validFlags = snapshot.informational_only === true && snapshot.money_moved === false && snapshot.payment_recorded === false && snapshot.debt_created === false;
  if (!validFlags) return <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">Réponse du service des échéances incohérente. Aucune action disponible.</p>;
  return <section role="region" aria-labelledby="installments-title" className="space-y-4">
    <Card className="space-y-3 p-5 sm:p-6">
      <div><p className="text-xs font-bold uppercase tracking-wider text-teal">Sans transfert financier</p><h2 id="installments-title" className="mt-1 text-xl font-bold text-ink">Suivi informatif des échéances</h2><p className="mt-1 text-sm text-black/60">Version commune {snapshot.version_no} · {snapshot.installments.length} échéance(s). Déclaration, vérification ou autorisation ne signifient ni paiement, ni facture, ni dette.</p></div>
      <p className="rounded-xl bg-sand/70 px-3 py-2.5 text-sm text-ink/75">Aucun montant n’est transféré, aucun contrat n’est signé et aucun paiement n’est enregistré par cet écran.</p>
      {notice && <p role="status" className="flex items-start gap-2 text-sm font-semibold text-teal"><CheckCircle2 size={16} />{notice}</p>}
      {error && <p role="alert" className="flex items-start gap-2 text-sm text-red-700"><AlertTriangle size={16} />{error}</p>}
      <ol className="space-y-3">{snapshot.installments.map(item => {
        const buttons = ([
          ['declared', item.can_declare], ['verified', item.can_verify],
          ['contested', item.can_contest], ['authorized', item.can_authorize],
        ] as [InstallmentEventType, boolean][]).filter(([, allowed]) => allowed);
        const open = confirm?.no === item.installment_no ? confirm : null;
        return <li key={item.installment_no} className="rounded-xl border border-black/[0.08] px-4 py-3.5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 className="font-semibold text-ink">{item.installment_no}. {item.label}</h3><p className="mt-1 flex items-center gap-1 text-xs text-black/55"><CalendarClock size={13} />Date indicative : {date(item.due_date)}</p></div><p className="font-bold tabular-nums text-ink">{formatTnd(item.amount_millimes)}</p></div>
          <div className="mt-2"><Badge tone={item.status === 'authorized' || item.status === 'verified' ? 'teal' : item.status === 'contested' ? 'red' : 'neutral'}>{statuses[item.status] ?? 'À préciser'}</Badge></div>
          {item.last_event?.reason && <p className="mt-2 text-sm text-black/65">Motif : {item.last_event.reason}</p>}
          {buttons.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{buttons.map(([type]) => <Button type="button" key={type} disabled={busy} className="min-h-10 bg-white text-ink ring-1 ring-black/10 hover:bg-sand" onClick={() => { setConfirm({ no: item.installment_no, type }); setReason(''); }}>{actionLabels[type]}</Button>)}</div>}
          {open && <div role="group" aria-label={'Confirmer l’échéance ' + item.installment_no} className="mt-3 space-y-2 rounded-xl bg-sand/60 p-3"><p className="text-sm text-ink">Confirmer : {actionLabels[open.type].toLowerCase()} l’échéance {item.installment_no} ? Cette action sera historisée sans mouvement financier.</p>{open.type === 'contested' && <label className="block text-sm font-semibold text-ink">Motif de contestation<textarea aria-label="Motif de contestation" rows={2} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} className="mt-1 w-full rounded-lg border border-black/10 bg-white p-2.5" /></label>}<div className="flex flex-wrap gap-2"><Button type="button" disabled={busy || (open.type === 'contested' && !reason.trim())} onClick={() => void submit()}>{busy ? 'Enregistrement…' : 'Confirmer cette action'}</Button><Button type="button" disabled={busy} className="bg-white text-ink ring-1 ring-black/10" onClick={() => { setConfirm(null); setReason(''); }}>Annuler</Button></div></div>}
        </li>;
      })}</ol>
      {(snapshot.events ?? []).length > 0 && <details className="rounded-xl bg-sand/50 px-4 py-3"><summary className="cursor-pointer font-semibold text-ink">Historique des échéances ({snapshot.events?.length})</summary><ol className="mt-2 space-y-1 text-sm text-black/65">{(snapshot.events ?? []).map(event => <li key={event.id}>Échéance {event.installment_no} · {actionLabels[event.event_type]} · {date(event.created_at)}{event.reason ? ' · ' + event.reason : ''}</li>)}</ol></details>}
    </Card>
  </section>;
}
