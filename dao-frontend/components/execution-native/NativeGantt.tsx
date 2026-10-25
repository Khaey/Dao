'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { NativeExecutionPlanDTO } from '../../../dao-backend/src/native-tracking/contract';
import { Badge } from '../ui';
import { buildGanttModel, toDay, type GanttRow } from './gantt-model';

type Zoom = 'week' | 'month' | 'quarter';
const zooms: { id: Zoom; label: string; px: number }[] = [
  { id: 'week', label: 'Semaines', px: 30 }, { id: 'month', label: 'Mois', px: 9 }, { id: 'quarter', label: 'Trimestres', px: 3.2 },
];
const ROW = 44;
const HEADER = 44;
const outline = 'inline-flex min-h-10 items-center justify-center rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal';
const wideQuery = '(min-width: 640px)';
const subscribeWide = (notify: () => void) => { const media = window.matchMedia(wideQuery); media.addEventListener('change', notify); return () => media.removeEventListener('change', notify); };
const useWide = () => useSyncExternalStore(subscribeWide, () => window.matchMedia(wideQuery).matches, () => true);

const pretty = (value: string) => new Date(value + 'T00:00:00Z').toLocaleDateString('fr-TN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const range = (value: { start: string; end: string } | null) => value ? `${pretty(value.start)} → ${pretty(value.end)}` : 'Non renseignées';
const milestoneStatus: Record<string, string> = { planned: 'prévu', in_progress: 'en cours (déclaré)', completed: 'atteint (déclaré)', cancelled: 'annulé' };
const kindLabel: Record<GanttRow['kind'], string> = { lot: 'Lot', sub_lot: 'Sous-lot de l’offre retenue', activity: 'Activité du suivi' };

function forecastNotice(state: ReturnType<typeof buildGanttModel>['forecastState'], truncated: boolean) {
  if (truncated) return { tone: 'clay' as const, text: 'Le chantier dépasse la limite de lecture : la prévision est partielle et aucun chemin critique n’est affiché.' };
  switch (state) {
    case 'ready': return null;
    case 'incomplete': return { tone: 'neutral' as const, text: 'Données insuffisantes : certains éléments n’ont pas de dates ou de durée, ou dépendent d’un lien non confirmé. La prévision est partielle et le chemin critique n’est pas calculé.' };
    case 'cycle': return { tone: 'red' as const, text: 'Des dépendances forment une boucle : la prévision native ne peut pas être calculée. Seules les dates enregistrées sont affichées.' };
    case 'unsupported': return { tone: 'clay' as const, text: 'Certaines dépendances ne sont pas prises en charge (seul « fin → début » sans décalage est calculé). Seules les dates enregistrées sont affichées.' };
    case 'none': return { tone: 'neutral' as const, text: 'Aucun élément planifiable pour le moment.' };
    default: return { tone: 'neutral' as const, text: 'Prévision native indisponible : seules les dates enregistrées sont affichées.' };
  }
}

/** Gantt natif en LECTURE SEULE, alimenté par `NativeExecutionPlanDTO` et son `forecast` natif (#413). Aucun appel OCE ; aucun glisser-déposer ne modifie le planning. */
export default function NativeGantt({ plan }: { plan: NativeExecutionPlanDTO }) {
  const model = useMemo(() => buildGanttModel(plan), [plan]);
  const [zoom, setZoom] = useState<Zoom>('month');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const wide = useWide();
  const label = wide ? 264 : 152;
  const [available, setAvailable] = useState(0);
  useEffect(() => {
    const node = scroller.current;
    if (!node || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => setAvailable(entries[0].contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, [model.range]);
  const span = model.range ? toDay(model.range.end) - toDay(model.range.start) + 11 : 1;
  // Un chantier court occupe toute la largeur disponible au lieu de laisser une zone vide.
  const px = Math.max(zooms.find(item => item.id === zoom)!.px, available > label ? (available - label) / span : 0);
  const today = toDay(new Date().toISOString().slice(0, 10));

  const scale = useMemo(() => {
    if (!model.range) return null;
    let first = toDay(model.range.start) - 3;
    if (zoom === 'week') first -= (new Date(first * 86_400_000).getUTCDay() + 6) % 7; // aligne sur un lundi
    const last = toDay(model.range.end) + 7;
    const months: { left: number; width: number; text: string }[] = [];
    const ticks: { left: number; text: string }[] = [];
    for (let day = first; day <= last;) {
      const date = new Date(day * 86_400_000);
      const next = Math.min(last + 1, toDay(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)).toISOString()));
      months.push({ left: (day - first) * px, width: (next - day) * px, text: (text => text.charAt(0).toUpperCase() + text.slice(1))(date.toLocaleDateString('fr-TN', { month: zoom === 'quarter' ? 'short' : 'long', year: 'numeric', timeZone: 'UTC' })) });
      day = next;
    }
    if (zoom === 'week') for (let day = first; day <= last; day += 7) ticks.push({ left: (day - first) * px, text: String(new Date(day * 86_400_000).getUTCDate()) });
    return { first, last, width: (last - first + 1) * px, months, ticks };
  }, [model.range, zoom, px]);

  const x = (date: string) => scale ? (toDay(date) - scale.first) * px : 0;
  const w = (start: string, end: string) => Math.max(px, (toDay(end) - toDay(start) + 1) * px);
  const indexOf = useMemo(() => new Map(model.rows.map((row, index) => [row.id, index])), [model.rows]);

  function scrollToDay(day: number) {
    if (!scroller.current || !scale) return;
    scroller.current.scrollTo({ left: Math.max(0, (day - scale.first) * px - 48), behavior: 'smooth' });
  }
  useEffect(() => {
    if (!scale) return;
    const target = today >= scale.first && today <= scale.last ? today : toDay(model.range!.start);
    if (scroller.current) scroller.current.scrollLeft = Math.max(0, (target - scale.first) * px - 48);
  }, [scale, today, px, model.range]);

  const notice = forecastNotice(model.forecastState, model.truncated);
  const selected = model.rows.find(row => row.id === selectedId) ?? null;
  const titleOf = (id: string) => model.rows.find(row => row.id === id)?.title ?? 'Élément';

  return <div className="space-y-4" aria-label="Gantt natif du chantier">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="Échelle de temps" className="inline-flex rounded-xl border border-black/10 bg-white p-1">
        {zooms.map(item => <button key={item.id} type="button" aria-pressed={zoom === item.id} onClick={() => setZoom(item.id)}
          className={'min-h-9 rounded-lg px-3 text-sm font-semibold ' + (zoom === item.id ? 'bg-ink text-white' : 'text-ink/70 hover:bg-sand')}>{item.label}</button>)}
      </div>
      <div className="flex flex-wrap gap-2">
        {scale && today >= scale.first && today <= scale.last && <button type="button" className={outline} onClick={() => scrollToDay(today)}>Aujourd’hui</button>}
        {model.range && <button type="button" className={outline} onClick={() => scrollToDay(toDay(model.range!.start))}>Début</button>}
      </div>
    </div>

    {model.forecastState === 'ready' && model.projectStart && model.projectEnd && <p role="status" className="rounded-xl border border-teal/20 bg-teal/[0.04] p-3 text-sm text-ink">
      Prévision native : du <strong>{pretty(model.projectStart)}</strong> au <strong>{pretty(model.projectEnd)}</strong> ({model.durationDays} jours calendaires). Le chemin critique est surligné.
    </p>}
    {notice && <p role="status" className={'rounded-xl border p-3 text-sm ' + (notice.tone === 'red' ? 'border-red-200 bg-red-50 text-red-800' : notice.tone === 'clay' ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-black/10 bg-sand text-ink/75')}>{notice.text}</p>}

    {model.rows.length === 0 ? <p role="status" className="rounded-xl bg-sand p-5 text-sm">Aucun lot accessible : rien à afficher dans le Gantt.</p>
      : !scale ? <p role="status" className="rounded-xl bg-sand p-5 text-sm">Aucune date n’est encore enregistrée pour ces lots. Le Gantt s’affichera dès que des dates réelles seront disponibles ; aucune date n’est inventée.</p>
      : <div ref={scroller} className="overflow-x-auto rounded-xl border border-black/10 bg-white" data-no-swipe>
        <div className="relative" style={{ width: label + scale.width }}>
          <div className="sticky top-0 z-20 flex border-b border-black/10 bg-white" style={{ height: HEADER }}>
            <div className="sticky left-0 z-30 flex shrink-0 items-end border-r border-black/10 bg-white px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-black/45" style={{ width: label }}>Élément</div>
            <div className="relative" style={{ width: scale.width }}>
              {scale.months.map(month => <span key={month.left} className="absolute top-0 truncate border-l border-black/10 px-1.5 pt-1 text-xs font-semibold text-ink/70" style={{ left: month.left, width: month.width }}>{month.text}</span>)}
              {scale.ticks.map(tick => <span key={tick.left} className="absolute bottom-1 text-[10px] tabular-nums text-black/45" style={{ left: tick.left + 2 }}>{tick.text}</span>)}
            </div>
          </div>
          <div className="relative">
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0" style={{ left: label, width: scale.width }}>
              {scale.months.map(month => <span key={month.left} className="absolute inset-y-0 border-l border-black/[0.05]" style={{ left: month.left }} />)}
              {today >= scale.first && today <= scale.last && <span className="absolute inset-y-0 w-0.5 bg-clay/70" style={{ left: (today - scale.first) * px }} title="Aujourd’hui" />}
            </div>
            <svg aria-hidden="true" className="pointer-events-none absolute top-0 z-10" style={{ left: label }} width={scale.width} height={model.rows.length * ROW}>
              <defs><marker id="gantt-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="currentColor" /></marker></defs>
              {model.dependencies.map(link => {
                const from = model.rows[indexOf.get(link.from)!]; const to = model.rows[indexOf.get(link.to)!];
                if (!from?.bar || !to?.bar) return null;
                const x1 = x(from.bar.end) + w(from.bar.end, from.bar.end); const y1 = indexOf.get(link.from)! * ROW + ROW / 2;
                const x2 = x(to.bar.start); const y2 = indexOf.get(link.to)! * ROW + ROW / 2;
                const mid = Math.max(x1 + 8, Math.min(x2 - 8, x1 + 14));
                const critical = from.critical && to.critical;
                return <path key={link.id} d={`M${x1},${y1} H${mid} V${y2} H${x2}`} fill="none" markerEnd="url(#gantt-arrow)"
                  className={critical ? 'text-red-600' : link.supported && link.state === 'effective' ? 'text-ink/50' : 'text-ink/30'} stroke="currentColor" strokeWidth={critical ? 2 : 1.25}
                  strokeDasharray={link.state === 'effective' && link.supported ? undefined : '4 3'} />;
              })}
            </svg>
            {model.rows.map(row => {
              const active = row.id === selectedId;
              const describe = `${kindLabel[row.kind]} ${row.title}. ${row.bar ? `${row.bar.sourceLabel} : ${range(row.bar)}` : 'Dates non renseignées'}. ${row.progress ? `Avancement déclaré ${row.progress.percent} %` : 'Avancement non renseigné'}.${row.critical ? ' Sur le chemin critique.' : ''}`;
              return <div key={row.id} className={'flex border-b border-black/[0.05] ' + (active ? 'bg-teal/[0.05]' : row.kind === 'lot' ? 'bg-sand/40' : '')} style={{ height: ROW }}>
                <button type="button" onClick={() => setSelectedId(active ? null : row.id)} aria-pressed={active} aria-label={describe}
                  className={'sticky left-0 z-10 flex shrink-0 items-center gap-1.5 border-r border-black/10 px-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-teal ' + (row.kind === 'lot' ? 'bg-sand' : 'bg-white') + (active ? ' shadow-[inset_3px_0_0_theme(colors.teal)]' : '')} style={{ width: label, paddingLeft: 12 + row.level * (wide ? 16 : 10) }}>
                  <span className={'min-w-0 truncate text-sm ' + (row.kind === 'lot' ? 'font-semibold text-ink' : 'text-ink/80')}>{row.kind !== 'lot' && '↳ '}{row.title}</span>
                  {row.critical && <span className="shrink-0 rounded bg-red-50 px-1 text-[10px] font-bold text-red-700" title="Chemin critique">Critique</span>}
                </button>
                <div className="relative" style={{ width: scale.width }}>
                  {row.baseline && <span aria-hidden="true" title={`Référence convenue : ${range(row.baseline)}`} className="absolute h-1 rounded-full bg-ink/25" style={{ left: x(row.baseline.start), width: w(row.baseline.start, row.baseline.end), top: ROW - 9 }} />}
                  {row.bar && <span aria-hidden="true" title={`${row.bar.sourceLabel} : ${range(row.bar)}`}
                    className={'absolute overflow-hidden rounded-md ' + (row.bar.source === 'projected' ? 'bg-teal/70' : 'border border-dashed border-teal bg-teal/15') + (row.critical ? ' ring-2 ring-red-500' : '') + (row.kind === 'lot' ? '' : ' opacity-90')}
                    style={{ left: x(row.bar.start), width: w(row.bar.start, row.bar.end), top: row.kind === 'lot' ? 10 : 13, height: row.kind === 'lot' ? 18 : 14 }}>
                    {row.progress && <span className={'absolute inset-y-0 left-0 ' + (row.bar.source === 'projected' ? 'bg-ink/60' : 'bg-teal/60')} style={{ width: `${Math.min(100, Math.max(0, row.progress.percent))}%` }} />}
                  </span>}
                  {row.observed && <span aria-hidden="true" title={`Observé : ${range(row.observed)}`} className="absolute h-1 rounded-full bg-ink" style={{ left: x(row.observed.start), width: w(row.observed.start, row.observed.end), top: 5 }} />}
                  {row.milestones.filter(item => item.date).map(item => <span key={item.key} aria-hidden="true" title={`Jalon : ${item.title} (${pretty(item.date!)}, ${milestoneStatus[item.status] ?? item.status})`}
                    className={'absolute size-3 rotate-45 border border-white ' + (item.status === 'completed' ? 'bg-teal' : item.status === 'cancelled' ? 'bg-black/30' : 'bg-clay')} style={{ left: x(item.date!) + px / 2 - 6, top: ROW / 2 - 6 }} />)}
                  {!row.bar && !row.observed && !row.milestones.some(item => item.date) && <span className="sticky inline-block pt-3 pl-2 text-xs italic text-black/45" style={{ left: label + 8 }}>{row.inCycle ? 'Dans une boucle de dépendances' : 'Dates non renseignées'}</span>}
                </div>
              </div>;
            })}
          </div>
        </div>
      </div>}

    <ul className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink/65" aria-label="Légende">
      <li className="flex items-center gap-1.5"><span className="h-3 w-6 rounded bg-teal/70" />Prévision native</li>
      <li className="flex items-center gap-1.5"><span className="h-3 w-6 rounded border border-dashed border-teal bg-teal/15" />Dates enregistrées (non recalculées)</li>
      <li className="flex items-center gap-1.5"><span className="h-3 w-6 rounded bg-ink/60" />Avancement déclaré</li>
      <li className="flex items-center gap-1.5"><span className="h-1 w-6 rounded bg-ink/25" />Référence convenue</li>
      <li className="flex items-center gap-1.5"><span className="h-1 w-6 rounded bg-ink" />Observé (carnet)</li>
      <li className="flex items-center gap-1.5"><span className="size-2.5 rotate-45 bg-clay" />Jalon</li>
      <li className="flex items-center gap-1.5"><span className="h-3 w-6 rounded ring-2 ring-red-500" />Chemin critique</li>
    </ul>
    {model.undatedCount > 0 && scale && <p className="text-xs text-ink/55">{model.undatedCount} élément(s) sans date enregistrée : ils restent listés sans barre.</p>}

    {selected && <div className="space-y-3 rounded-xl border border-black/10 bg-sand/30 p-4" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2"><Badge tone={selected.critical ? 'red' : 'neutral'}>{kindLabel[selected.kind]}</Badge><h3 className="min-w-0 break-words text-base font-bold text-ink">{selected.title}</h3>{selected.contractor && <span className="text-sm text-ink/65">· {selected.contractor}</span>}</div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <div><dt className="text-black/50">{selected.bar?.sourceLabel ?? 'Dates'}</dt><dd>{range(selected.bar)}</dd></div>
        <div><dt className="text-black/50">Référence convenue</dt><dd>{range(selected.baseline)}</dd></div>
        <div><dt className="text-black/50">Observé (carnet)</dt><dd>{range(selected.observed)}</dd></div>
        <div><dt className="text-black/50">Avancement déclaré</dt><dd>{selected.progress ? `${selected.progress.percent} % · déclaré le ${pretty(selected.progress.at.slice(0, 10))}` : 'Non renseigné'}</dd></div>
        <div><dt className="text-black/50">Marge totale</dt><dd>{selected.floatDays == null ? 'Non calculée' : `${selected.floatDays} jour(s)${selected.critical ? ' · chemin critique' : ''}`}</dd></div>
        <div><dt className="text-black/50">Écart de fin / référence</dt><dd>{selected.finishVarianceDays == null ? 'Non calculable' : selected.finishVarianceDays === 0 ? 'Aucun' : `${selected.finishVarianceDays > 0 ? '+' : ''}${selected.finishVarianceDays} jour(s)`}</dd></div>
      </dl>
      {selected.incomplete && <p className="text-xs text-amber-900">Données insuffisantes pour projeter cet élément (dates, durée ou prédécesseur manquants).</p>}
      {selected.milestones.length > 0 && <div><p className="text-sm font-semibold text-ink">Jalons</p><ul className="mt-1 space-y-1 text-sm text-ink/75">{selected.milestones.map(item => <li key={item.key}>{item.title} · {item.date ? pretty(item.date) : 'date non renseignée'} · {milestoneStatus[item.status] ?? item.status}</li>)}</ul></div>}
      {(() => {
        const before = model.dependencies.filter(link => link.to === selected.id); const after = model.dependencies.filter(link => link.from === selected.id);
        if (!before.length && !after.length) return null;
        const state = (value: string, supported: boolean) => !supported ? ' (non pris en charge)' : value === 'effective' ? '' : ' (en attente de confirmation)';
        return <div className="grid gap-2 text-sm sm:grid-cols-2">
          {before.length > 0 && <div><p className="font-semibold text-ink">Après la fin de</p><ul className="mt-1 text-ink/75">{before.map(link => <li key={link.id}>{titleOf(link.from)}{state(link.state, link.supported)}</li>)}</ul></div>}
          {after.length > 0 && <div><p className="font-semibold text-ink">Précède</p><ul className="mt-1 text-ink/75">{after.map(link => <li key={link.id}>{titleOf(link.to)}{state(link.state, link.supported)}</li>)}</ul></div>}
        </div>;
      })()}
    </div>}
    <p className="text-xs text-black/50">Gantt en lecture seule : aucun déplacement de barre ne modifie le planning. Les dates portent leur provenance ; rien n’est déduit sans donnée réelle.</p>
  </div>;
}

