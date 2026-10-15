'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { FileText, ShieldCheck } from 'lucide-react';
import { Badge, Card, SectionHeading } from '../../../components/ui';
import { contractStatus, formatDate, formatTnd, listContracts, roleLabel, type ContractSummary } from '../../../lib/contracts';

export default function ContractsPage() {
  const [rows, setRows] = useState<ContractSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { listContracts().then(setRows).catch(error => setError(error.message)).finally(() => setLoading(false)); }, []);
  return <section className="space-y-6">
    <SectionHeading eyebrow="Dossiers privés" title="Mes contrats" description="Consultez les dossiers contractuels auxquels vous êtes partie. Cette consultation ne permet aucune modification ni signature." />
    <div className="rounded-2xl border border-clay/20 bg-clay/[0.06] p-4 text-sm text-ink" role="note"><div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 shrink-0 text-clay" size={20}/><div><p className="font-bold">Non signé — aucun effet juridique</p><p className="mt-1 text-black/60">Les accords et contrôles affichés sont des preuves techniques de préparation. Ils ne rendent pas le contrat exécutoire.</p></div></div></div>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    {loading ? <div aria-label="Chargement des contrats" className="h-40 animate-pulse rounded-2xl bg-black/5"/> : rows.length === 0 ?
      <Card className="border-dashed py-14 text-center"><FileText className="mx-auto text-black/25"/><h2 className="mt-3 font-bold">Aucun dossier contractuel</h2><p className="mt-2 text-sm text-black/55">Un contrat préparé après une attribution apparaîtra ici pour ses parties autorisées.</p></Card> :
      <div className="grid gap-4 lg:grid-cols-2">{rows.map(row => <Link href={`/app/contracts/${row.id}`} key={row.id} className="block"><Card className="h-full transition hover:-translate-y-0.5 hover:border-teal/30"><div className="flex flex-wrap items-center gap-2"><Badge tone={row.status === 'ready' ? 'teal' : row.status === 'cancelled' ? 'red' : 'clay'}>{contractStatus[row.status] ?? row.status}</Badge><Badge>Non signé</Badge></div><h2 className="mt-4 text-lg font-bold">Dossier contractuel — en préparation</h2><p className="mt-2 text-2xl font-bold text-teal">{formatTnd(row.total_millimes)}</p><p className="mt-1 text-xs text-black/45">Montant contractuel de référence · créé le {formatDate(row.created_at)}</p><div className="mt-4 flex flex-wrap gap-2 text-sm text-black/60">{row.parties.map(party => <span key={party.role} className="rounded-lg bg-sand px-2.5 py-1.5"><b>{roleLabel[party.role] ?? party.role} :</b> {party.legal_name}</span>)}</div><p className="mt-4 text-sm text-black/50">{row.item_count} lot{row.item_count > 1 ? 's' : ''} · {row.amendment_count} proposition{row.amendment_count > 1 ? 's' : ''} d’avenant</p><span className="mt-5 inline-flex font-semibold text-teal">Consulter le dossier</span></Card></Link>)}</div>}
  </section>;
}
