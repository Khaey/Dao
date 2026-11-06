// #577 — Ouvrages figés dans la version publiée d'un lot (`publication_requests.works_scope`).
// Aucune dimension, aucun métré ni prix : seulement l'intitulé, l'unité prévue et le sous-lot.
import { UNIT_SYMBOLS } from '../../../dao-backend/src/btp-takeoff-ui/presentation';

type PublishedWork = { id: string; label: string; unitCode: string | null; custom: boolean; toConfirm: boolean; subLotId: string | null };

export default function PublishedWorks({ works, subLots }: { works?: PublishedWork[] | null; subLots?: Array<{ id: string; title: string }> | null }) {
  if (!works?.length) return null;
  const titles = new Map((subLots ?? []).map(s => [s.id, s.title]));
  const groups = new Map<string, PublishedWork[]>();
  for (const w of works) { const key = w.subLotId && titles.has(w.subLotId) ? w.subLotId : ''; groups.set(key, [...(groups.get(key) ?? []), w]); }
  const ordered = [...groups.entries()].sort(([a], [b]) => (a ? 1 : 0) - (b ? 1 : 0));
  return <div className="mt-4" data-testid="published-works">
    <h4 className="text-xs font-bold uppercase tracking-wide text-black/45">Ouvrages demandés</h4>
    {ordered.map(([key, list]) => <div key={key || 'direct'} className="mt-2">
      {key && <p className="text-xs font-semibold text-ink/70">{titles.get(key)}</p>}
      <ul className="mt-1 space-y-1 text-sm text-ink/80">{list.map(w => <li key={w.id} className="flex flex-wrap gap-x-2">
        <span>{w.label}</span>
        {w.unitCode && <span className="text-xs text-black/50">unité {UNIT_SYMBOLS[w.unitCode] ?? w.unitCode}</span>}
        {w.toConfirm && <span className="text-xs text-amber-800">à confirmer</span>}
        {w.custom && <span className="text-xs text-black/50">hors référentiel</span>}
      </li>)}</ul>
    </div>)}
  </div>;
}
