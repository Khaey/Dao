'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { NativeExecutionPlanDTO } from '../../../dao-backend/src/native-tracking/contract';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { Badge, Card, SectionHeading } from '../ui';
import { adaptNativeExecutionPlan, workspaceLabels, type ExecutionTableNode, type ExecutionTableLot } from './native-plan-adapter';
import { readNativeExecutionPlan, NativePlanReadError } from './read-native-plan';
import NativeActivityPanel from './NativeActivityPanel';
import NativeGantt from './NativeGantt';
import NativeLotDatesForm from './NativeLotDatesForm';

const outline = 'inline-flex min-h-10 items-center justify-center rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal';
const optionNames = [
  'Ajouter une dépendance',
  'Ajouter un jalon',
  'Ajouter un échéancier',
];

function prettyDate(raw: string) {
  const value = new Date(raw.slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(value.getTime())
    ? value.toLocaleDateString('fr-TN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : 'Non renseignée';
}
function displayDates(node: ExecutionTableNode) {
  const { dates, dateSource } = node;
  if (!dates || (!dates.start && !dates.end)) return <span>Non renseignées</span>;
  const text = dates.start && dates.end ? prettyDate(dates.start) + ' – ' + prettyDate(dates.end)
    : dates.start ? 'À partir du ' + prettyDate(dates.start)
      : 'Jusqu’au ' + prettyDate(dates.end!);
  return <span>{text}<span className="block text-xs text-black/45">{dateSource}</span></span>;
}
function Progress({ node }: { node: ExecutionTableNode }) {
  return <span>{node.progress === null ? 'Non renseignée' : node.progress + ' % déclaré'}
    {node.progressAt && <span className="block text-xs text-black/45">Déclaration du {prettyDate(node.progressAt)}</span>}
  </span>;
}
function stateLabel(lot: ExecutionTableLot) {
  if (!lot.awardId) return { tone: 'neutral' as const, text: 'Sans attribution active' };
  if (lot.progressStatus === 'completed') return { tone: 'teal' as const, text: 'Terminé (déclaré)' };
  if (lot.progressStatus === 'in_progress') return { tone: 'teal' as const, text: 'En cours (déclaré)' };
  return { tone: 'neutral' as const, text: 'Lot attribué' };
}
function Row({ node, lot, expanded, onToggle, onOptions, subLot = false }: {
  node: ExecutionTableNode;
  lot: ExecutionTableLot;
  expanded?: boolean;
  onToggle?: () => void;
  onOptions?: () => void;
  subLot?: boolean;
}) {
  const badge = stateLabel(lot);
  const hasChildren = !subLot && lot.subLots.length > 0;
  return <div className={(subLot ? 'ml-3 border-l-4 border-l-teal/20 lg:ml-7 ' : '') + 'rounded-xl border border-black/10 bg-white'}>
    <div className="grid gap-3 p-4 text-sm lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_auto] lg:items-center">
      <div className="min-w-0">
        {hasChildren && <button className="mr-2 inline-flex size-8 items-center justify-center rounded-lg border border-black/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal"
          type="button" onClick={onToggle} aria-expanded={Boolean(expanded)} aria-label={(expanded ? 'Masquer' : 'Afficher') + ' les sous-lots de ' + lot.title}>
          {expanded ? '−' : '+'}
        </button>}
        <span className="font-semibold text-ink">{subLot ? '↳ ' : ''}{node.title}</span>
        <span className="block text-xs text-black/50">{subLot ? 'Sous-lot de l’offre retenue' : hasChildren ? 'Détaillé en sous-lots' : 'Suivi au niveau du lot'}</span>
      </div>
      <div className="text-ink/75"><span className="block text-xs text-black/45 lg:hidden">Titulaire</span>{subLot ? 'Même attributaire' : lot.awardId ? lot.contractor || 'Attributaire (nom non communiqué)' : 'Non attribué'}</div>
      <div className="text-ink/75"><span className="block text-xs text-black/45 lg:hidden">Dates</span>{displayDates(node)}</div>
      <div className="text-ink/75"><span className="block text-xs text-black/45 lg:hidden">Avancement déclaré</span><Progress node={node} /></div>
      <div><span className="block text-xs text-black/45 lg:hidden">Statut</span>{subLot
        ? <span className="text-xs text-black/65">Détail d’exécution</span>
        : <Badge tone={badge.tone}>{badge.text}</Badge>}</div>
      <div>{!subLot && <button type="button" onClick={onOptions} className={outline + ' w-full lg:w-auto'}>Détails / options</button>}</div>
    </div>
    {hasChildren && expanded && <div className="space-y-2 border-t border-black/5 bg-sand/30 p-2">
      {lot.subLots.map(sub => <Row key={sub.id} node={sub} lot={lot} subLot />)}
    </div>}
  </div>;
}

/** Vraie lecture N1 du backend DEV 3, sans modifier les pages #346/#356. */
export default function NativeExecutionLiveTable({ projectId }: { projectId: string }) {
  const [state, setState] = useState<{ phase: 'loading' | 'ready' | 'error'; dto: NativeExecutionPlanDTO | null; message: string }>({
    phase: 'loading', dto: null, message: '',
  });
  const [revision, setRevision] = useState(0);
  const [expanded, setExpanded] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Tableau par défaut ; le Gantt est une vue alternative du même DTO (?view=gantt), jamais une étape obligatoire.
  const [view, setView] = useState<'table' | 'gantt'>('table');
  useEffect(() => { if (new URLSearchParams(window.location.search).get('view') === 'gantt') setView('gantt'); }, []);
  const changeView = (next: 'table' | 'gantt') => {
    setView(next);
    try { const url = new URL(window.location.href); if (next === 'gantt') url.searchParams.set('view', 'gantt'); else url.searchParams.delete('view'); window.history.replaceState(window.history.state, '', url.pathname + url.search); } catch { /* history indisponible */ }
  };
  const reload = useCallback(() => { setRevision(value => value + 1); }, []);
  useEffect(() => {
    // A↔B : supprimer l'ancien chantier affiché immédiatement au changement d'identité.
    const { data: { subscription } } = supabaseBrowser().auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setState({ phase: 'loading', dto: null, message: '' });
        setSelectedId(null);
        setRevision(value => value + 1);
      }
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => { setSelectedId(null); }, [projectId]);
  useEffect(() => {
    const ctrl = new AbortController();
    // Actualisation du même chantier : garder le panneau ouvert ; tout autre chantier repart de zéro.
    setState(previous => ({ phase: 'loading', dto: previous.dto?.projectId === projectId ? previous.dto : null, message: '' }));
    void readNativeExecutionPlan(projectId, ctrl.signal)
      .then(dto => { if (!ctrl.signal.aborted) setState({ phase: 'ready', dto, message: '' }); })
      .catch(error => {
        if (ctrl.signal.aborted) return;
        const message = error instanceof NativePlanReadError ? error.message : 'Lecture temporairement impossible.';
        setState({ phase: 'error', dto: null, message });
      });
    return () => ctrl.abort();
  }, [projectId, revision]);

  const dto = state.dto;
  const lots = dto ? adaptNativeExecutionPlan(dto) : [];
  const selected = lots.find(lot => lot.id === selectedId) ?? null;
  const role = dto?.viewer.workspace ?? null;
  return <section className="mx-auto w-full max-w-7xl space-y-5" aria-label="Suivi natif du chantier">
    <Card className="space-y-3">
      <SectionHeading title="Tableau de suivi du chantier" description="Un seul parcours. Dates, sous-lots, dépendances, jalons et échéancier restent facultatifs." />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-black/60">{role && <>Vue <strong>{workspaceLabels[role]}</strong> · </>}Lecture de vos lots autorisés</div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Vue du suivi" className="inline-flex rounded-xl border border-black/10 bg-white p-1">
            {(['table', 'gantt'] as const).map(item => <button key={item} type="button" aria-pressed={view === item} onClick={() => changeView(item)}
              className={'min-h-9 rounded-lg px-3 text-sm font-semibold ' + (view === item ? 'bg-ink text-white' : 'text-ink/70 hover:bg-sand')}>{item === 'table' ? 'Tableau' : 'Gantt'}</button>)}
          </div>
          <button type="button" className={outline} onClick={reload}>Actualiser</button>
        </div>
      </div>
    </Card>
    <Card className="space-y-3">
      {state.phase === 'loading' && <div aria-busy="true" role="status" className="rounded-xl bg-sand p-5 text-sm">Chargement des lots autorisés…</div>}
      {state.phase === 'error' && <div role="alert" className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">
        <p>{state.message}</p><button className={outline} onClick={reload} type="button">Réessayer</button>
      </div>}
      {state.phase === 'ready' && lots.length === 0 && <p role="status" className="rounded-xl bg-sand p-5 text-sm">Aucun lot accessible dans ce chantier. Aucun avancement n’a été inventé.</p>}
      {state.phase === 'ready' && view === 'gantt' && dto && lots.length > 0 && <NativeGantt plan={dto} />}
      {state.phase === 'ready' && view === 'table' && lots.length > 0 && <>
        <div className="hidden px-4 text-xs font-semibold uppercase tracking-wide text-black/45 lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.2fr)_auto]">
          <span>Intitulé</span><span>Titulaire</span><span>Dates</span><span>Progression</span><span>Statut</span><span>Action</span>
        </div>
        <div className="space-y-2">{lots.map(lot => <Row key={lot.id} node={lot} lot={lot}
          expanded={expanded.includes(lot.id)}
          onToggle={() => setExpanded(ids => ids.includes(lot.id) ? ids.filter(id => id !== lot.id) : [...ids, lot.id])}
          onOptions={() => setSelectedId(lot.id)} />)}</div>
      </>}
    </Card>
    {view === 'table' && selected && dto && <Card className="space-y-4">
      <SectionHeading title={'Détails et options : ' + selected.title} description="Ces ajouts resteront facultatifs. Aucune validation ou écriture implicite." />
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-black/50">Sous-lots du devis retenu</dt><dd>{selected.subLotCount}</dd></div>
        <div><dt className="text-black/50">Jalons déclarés</dt><dd>{selected.milestoneCount}</dd></div>
        <div><dt className="text-black/50">Dépendances visibles</dt><dd>{selected.dependencyCount}</dd></div>
        <div><dt className="text-black/50">Échéances informatives</dt><dd>{selected.installmentInformational ? selected.installmentCount : 'Non disponibles'}</dd></div>
      </dl>
      <div className="flex flex-wrap gap-2">
        {selected.awardId && (selected.canDeclareProgress || selected.canReviewProgress) && <Link className={outline + ' hover:bg-sand'} href={'/app/execution/' + encodeURIComponent(projectId)}>Suivre les travaux</Link>}
        {selected.awardId && role !== 'dao_manager' && selected.canRead && <Link className={outline + ' hover:bg-sand'} href={'/app/awards/' + encodeURIComponent(selected.awardId) + '/conditions'}>Voir les conditions du lot</Link>}
      </div>
      {(role === 'client' || role === 'dao_manager') && <NativeLotDatesForm key={selected.requestId} projectId={projectId} lotId={selected.requestId} onSaved={reload} />}
      {selected.awardItemId && <NativeActivityPanel key={selected.awardItemId} plan={dto} lot={selected} onUpdated={reload} />}
      <p className="text-xs text-black/55">Les activités et sous-lots opérationnels sont gérés ci-dessus lorsque DEV 3 l’autorise. Dépendances, jalons et échéancier sont indépendants et requièrent chacun une API et des droits spécifiques.</p>
      <div className="flex flex-wrap gap-2">{optionNames.map(name => <button key={name} type="button" disabled
        title="Commande indépendante non activée tant que son API et ses permissions dédiées ne sont pas disponibles"
        className={outline + ' cursor-not-allowed opacity-50'}>{name}</button>)}</div>
      <p className="text-xs text-black/55">Le contrat n’est pas signé ici ; aucune échéance ne déclenche un paiement. Le Gestionnaire ne consent jamais au nom des parties.</p>
    </Card>}
    <p className="text-xs text-black/50">Suivi natif D.A.O. sans OCE · les dates portent leur provenance · aucune progression calculée ni date inventée.</p>
  </section>;
}
