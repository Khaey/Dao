'use client';

import { useState } from 'react';
import { Badge, Card, SectionHeading } from '../ui';
import { scenarios, type Role, type Lot, type Node, type Option, type WorkStatus } from './mock-data';

/** #410 — prototype de lecture FICTIF, sans API/Auth/persistance.
 * Ne pas brancher sur une page réelle avant réception du DTO DEV 3 (#409).
 */
const stateText: Record<WorkStatus, string> = {
  to_assign: 'À attribuer',
  conditions: 'Conditions à convenir',
  ready: 'Prêt à démarrer',
  in_progress: 'Travaux déclarés en cours',
  complete: 'Terminé (déclaratif)',
};
const optionText: Record<Option, string> = {
  sub_lots: 'Ajouter un sous-lot',
  dates: 'Ajouter des dates',
  dependencies: 'Ajouter une dépendance',
  milestones: 'Ajouter un jalon',
  installments: 'Ajouter un échéancier',
};
const featureText: Record<Option, string> = {
  sub_lots: 'Sous-lots', dates: 'Dates', dependencies: 'Dépendances',
  milestones: 'Jalons', installments: 'Échéancier',
};
const optionKeys = Object.keys(optionText) as Option[];
const outline = 'rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-ink';
const date = (value: string | null) => value
  ? new Date(value + 'T00:00:00Z').toLocaleDateString('fr-TN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  })
  : null;
function dates(node: Node) {
  if (node.start && node.end) return date(node.start) + ' – ' + date(node.end);
  if (node.start) return 'Début : ' + date(node.start);
  if (node.end) return 'Fin : ' + date(node.end);
  return 'Dates non renseignées';
}
function Progress({ value }: { value: number | null }) {
  // Une donnée absente n'est pas une progression à 0 %.
  return <span>{value === null ? 'Non renseigné' : String(value) + ' % déclaré'}</span>;
}
function WorkRow({ node, lot, role, isChild, expanded, onExpand, onSelect }: {
  node: Node; lot: Lot; role: Role; isChild?: boolean;
  expanded?: boolean; onExpand?: () => void; onSelect?: () => void;
}) {
  const hasChildren = !isChild && Boolean(node.subLots?.length);
  return <div className={isChild
    ? 'ml-3 rounded-xl border border-l-4 border-black/10 border-l-teal/35 bg-white lg:ml-8'
    : 'rounded-xl border border-black/10 bg-white'}>
    <div className="grid gap-3 p-3.5 text-sm lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_auto] lg:items-center lg:gap-2 lg:px-4">
      <div className="min-w-0">
        {hasChildren && <button type="button" onClick={onExpand} aria-expanded={expanded}
          aria-label={(expanded ? 'Masquer' : 'Afficher') + ' les sous-lots de ' + node.title}
          className="mr-2 inline-flex size-7 items-center justify-center rounded-lg border border-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">{expanded ? '−' : '+'}</button>}
        <span className="font-semibold text-ink">{isChild ? '↳ ' : ''}{node.title}</span>
        <p className="mt-1 text-xs text-black/50">{isChild ? 'Sous-lot du devis retenu · fictif'
          : hasChildren ? 'Sous-lots consultables' : 'Suivi au niveau du lot'}</p>
      </div>
      <div className="min-w-0 text-ink/70"><span className="block text-xs text-black/45 lg:hidden">Titulaire</span>{isChild ? '— même titulaire —' : lot.contractor ?? 'Non attribué'}</div>
      <div className="text-ink/70"><span className="block text-xs text-black/45 lg:hidden">Dates</span>{dates(node)}</div>
      <div className="text-ink/70"><span className="block text-xs text-black/45 lg:hidden">Progression déclarée</span><Progress value={node.progress} /></div>
      <div><span className="block text-xs text-black/45 lg:hidden">Statut</span>
        <Badge tone={node.status === 'in_progress' || node.status === 'complete' ? 'teal' : node.status === 'conditions' ? 'clay' : 'neutral'}>{stateText[node.status]}</Badge>
      </div>
      <div>{!isChild && <button type="button" onClick={onSelect} className={outline + ' w-full hover:bg-sand lg:w-auto'}>Options du lot</button>}</div>
    </div>
    {hasChildren && expanded && <div className="space-y-2 border-t border-black/5 bg-sand/30 p-2 lg:p-3">
      {node.subLots!.map(child => <WorkRow key={child.id} node={child} lot={lot} role={role} isChild />)}
    </div>}
  </div>;
}

/** Sélecteurs et expansion = interaction de maquette uniquement. */
export default function NativeExecutionTablePrototype() {
  const [role, setRole] = useState<Role>('client');
  const [scenarioId, setScenarioId] = useState('multi');
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [selectedLotId, setSelectedLotId] = useState<string | null>(null);
  const scenario = scenarios.find(item => item.id === scenarioId) ?? scenarios[0];
  // Filtrage fictif, NON sécurisé : le DTO DEV 3 devra déjà être filtré côté serveur.
  const shownLots = role === 'artisan'
    ? scenario.lots.filter(lot => lot.awardActive && lot.contractorId === 'fake-artisan-a')
    : scenario.lots;
  const selected = shownLots.find(lot => lot.id === selectedLotId) ?? null;
  const roleNote = role === 'artisan'
    ? 'Artisan : uniquement les lots réellement attribués et actifs, même sans adhésion à l’équipe.'
    : role === 'gestionnaire'
      ? 'Gestionnaire : préparer/proposer si habilité ; jamais accepter à la place des parties.'
      : 'Client : vision de son chantier et validation de ses propres conditions, selon droits.';
  return <section className="mx-auto w-full max-w-7xl space-y-5" aria-label="Maquette fictive du Tableau natif">
    <Card className="space-y-4 border border-amber-300 bg-amber-50/50">
      <p className="text-xs font-bold uppercase tracking-wider text-amber-900">#410 · Maquette avec données fictives · Aucune opération enregistrée</p>
      <SectionHeading title="Tableau de suivi du chantier" description="Un seul parcours. Les informations supplémentaires restent toujours facultatives et indépendantes." />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-semibold text-ink">Vue simulée
          <select aria-label="Vue simulée" value={role} onChange={e => { setRole(e.target.value as Role); setSelectedLotId(null); }}
            className="mt-1 block w-full rounded-xl border border-black/15 bg-white p-2.5">
            <option value="client">Client</option><option value="artisan">Artisan</option><option value="gestionnaire">Gestionnaire</option>
          </select>
        </label>
        <label className="text-sm font-semibold text-ink">Scénario fictif
          <select aria-label="Scénario fictif" value={scenarioId}
            onChange={e => { setScenarioId(e.target.value); setExpandedIds([]); setSelectedLotId(null); }}
            className="mt-1 block w-full rounded-xl border border-black/15 bg-white p-2.5">
            {scenarios.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
      </div>
      <p className="text-sm text-amber-950">{scenario.description} Aucun calcul OCE, transfert financier ou acte juridique.</p>
    </Card>
    <Card className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wider text-teal">Exécution native</p>
          <h2 className="mt-1 text-lg font-bold text-ink">{scenario.project}</h2>
          <p className="mt-1 text-sm text-black/55">{roleNote}</p>
        </div>
        <div className="flex items-center gap-2"><Badge tone="teal">Tableau</Badge>
          <button type="button" disabled title="Gantt à venir, mêmes données ; pas de CPM natif"
            className={outline + ' cursor-not-allowed opacity-50'}>Gantt (à venir)</button>
        </div>
      </div>
      {scenario.phase === 'loading' ? <div role="status" aria-busy="true" className="rounded-xl bg-sand p-5 text-sm">Chargement du tableau…</div>
        : scenario.phase === 'error' ? <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">Lecture impossible. Ne pas montrer un faux tableau vide. Réessai disponible après intégration du DTO DEV 3.</div>
        : shownLots.length === 0 ? <div role="status" className="rounded-xl bg-sand p-5 text-sm">{role === 'artisan' ? 'Aucun lot attribué actif dans cet exemple.' : 'Aucun lot à afficher.'} Aucune progression n’est déduite.</div>
        : <div className="space-y-2">
          <div className="hidden gap-2 px-4 text-xs font-semibold uppercase tracking-wide text-black/45 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_auto]">
            <span>Intitulé</span><span>Titulaire</span><span>Dates</span><span>Progression</span><span>Statut</span><span>Action</span>
          </div>
          {shownLots.map(lot => <WorkRow key={lot.id} lot={lot} node={lot} role={role}
            expanded={expandedIds.includes(lot.id)}
            onExpand={() => setExpandedIds(ids => ids.includes(lot.id) ? ids.filter(id => id !== lot.id) : [...ids, lot.id])}
            onSelect={() => setSelectedLotId(lot.id)} />)}
        </div>}
    </Card>
    {selected && <Card className="space-y-3">
      <SectionHeading title={'Options du lot : ' + selected.title}
        description="Sous-lots, dates, dépendances, jalons et échéancier : aucune condition préalable entre eux." />
      <p className="text-sm text-black/55">Présentes : {selected.options.length
        ? selected.options.map(key => featureText[key]).join(' · ') : 'aucune option renseignée'}.
        {selected.installmentNote ? ' ' + selected.installmentNote + '.' : ''}
        {selected.agreementVersion ? ' Conditions v' + selected.agreementVersion + ' (non signées).' : ''}
      </p>
      <p className="text-xs font-medium text-amber-800">Actions désactivées jusqu’au DTO DEV 3 et aux permissions can_* du serveur.</p>
      <div className="flex flex-wrap gap-2">{optionKeys.map(key => <button key={key} type="button" disabled
        title="Maquette : aucune sauvegarde, proposition ni validation"
        className={outline + ' cursor-not-allowed opacity-60'}>{optionText[key]}</button>)}</div>
      <p className="text-xs text-black/55">Un sous-lot ajouté APRÈS attribution exigera une révision versionnée ; le devis gagnant reste immuable. Contrat OFF/ON indépendant.</p>
    </Card>}
    <p className="text-xs leading-relaxed text-black/60">Les noms, dates et pourcentages sont fictifs. Les écrans existants Conditions (#346), Suivi du lot, Mes lots attribués (#356) et planning OCE restent les références. Pas de nouveaux droits, de Gantt/CPM, de signature ou de paiement.</p>
  </section>;
}
