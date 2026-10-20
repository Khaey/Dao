'use client';

import { ArrowDown, ArrowUp, Link2, Plus, Trash2 } from 'lucide-react';
import { Button, Input } from '../ui';
import { emptySubLot, inclusiveDays, tndToMillimes, type LinkDraft, type LinkEndpointKind, type Referent, type SubLotDraft } from '../../lib/bid-sub-lots';

const label = 'block text-xs font-semibold text-ink';
const area = 'mt-1.5 w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm outline-none transition placeholder:text-black/35 focus:border-teal focus:ring-4 focus:ring-teal/10 disabled:bg-sand/50';

type OfficialOption = { id: string; title: string };

/** Décomposition technique d'un lot, proposée par l'Artisan dans son offre (brouillon uniquement). */
export function SubLotsEditor({ lotTitle, items, onChange, editable, officialOptions, priceMillimes }: {
  lotTitle: string; items: SubLotDraft[]; onChange: (next: SubLotDraft[]) => void; editable: boolean; officialOptions: OfficialOption[]; priceMillimes: number | null;
}) {
  const update = (key: string, patch: Partial<SubLotDraft>) => onChange(items.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };
  const allocated = items.reduce((sum, item) => sum + (item.budget.trim() ? (tndToMillimes(item.budget) ?? 0) : 0), 0);
  return (
    <div className="mt-4 rounded-xl bg-sand/50 p-3 sm:p-4" data-testid="bid-sub-lots">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-bold text-ink">Décomposition technique proposée</h4>
          <p className="text-xs text-black/50">Facultatif. Vos sous-lots pour « {lotTitle} » : ils n’altèrent ni le lot officiel ni son attribution.</p>
        </div>
        {editable && (
          <Button className="min-h-10 bg-white text-ink ring-1 ring-inset ring-black/10 hover:bg-sand" onClick={() => onChange([...items, emptySubLot()])}>
            <Plus aria-hidden="true" size={15} />Ajouter un sous-lot
          </Button>
        )}
      </div>
      {items.length > 0 && (
        <ol className="mt-3 space-y-3">
          {items.map((item, index) => {
            const days = inclusiveDays(item.start, item.end);
            return (
              <li key={item.key} className="grid gap-2 rounded-xl bg-white p-3 md:grid-cols-12" data-testid="bid-sub-lot">
                <label className={`${label} md:col-span-5`}>Sous-lot {index + 1}
                  <Input className="mt-1.5" disabled={!editable} maxLength={200} value={item.title} onChange={(e) => update(item.key, { title: e.target.value })} placeholder="Ex. Rainures pour câblage" />
                </label>
                <label className={`${label} md:col-span-2`}>Début
                  <Input className="mt-1.5" type="date" disabled={!editable} value={item.start} onChange={(e) => update(item.key, { start: e.target.value })} />
                </label>
                <label className={`${label} md:col-span-2`}>Fin
                  <Input className="mt-1.5" type="date" disabled={!editable} value={item.end} min={item.start || undefined} onChange={(e) => update(item.key, { end: e.target.value })} />
                </label>
                <label className={`${label} md:col-span-2`}>Budget (TND)
                  <Input className="mt-1.5 tabular-nums" inputMode="decimal" disabled={!editable} value={item.budget} onChange={(e) => update(item.key, { budget: e.target.value })} placeholder="Optionnel" />
                </label>
                <div className="flex items-end justify-end gap-1 md:col-span-1">
                  {editable && (
                    <>
                      <button type="button" aria-label={`Monter le sous-lot ${index + 1}`} disabled={index === 0} className="rounded-lg p-2 hover:bg-sand disabled:opacity-30" onClick={() => move(index, -1)}><ArrowUp size={15} /></button>
                      <button type="button" aria-label={`Descendre le sous-lot ${index + 1}`} disabled={index === items.length - 1} className="rounded-lg p-2 hover:bg-sand disabled:opacity-30" onClick={() => move(index, 1)}><ArrowDown size={15} /></button>
                      <button type="button" aria-label={`Supprimer le sous-lot ${index + 1}`} className="rounded-lg p-2 text-red-700 hover:bg-red-50" onClick={() => onChange(items.filter((candidate) => candidate.key !== item.key))}><Trash2 size={15} /></button>
                    </>
                  )}
                </div>
                <label className={`${label} md:col-span-8`}>Périmètre
                  <textarea className={`${area} min-h-16`} disabled={!editable} maxLength={4000} value={item.scope} onChange={(e) => update(item.key, { scope: e.target.value })} placeholder="Travaux couverts, hors périmètre, hypothèses…" />
                </label>
                <label className={`${label} md:col-span-4`}>Correspond au sous-lot officiel
                  <select className={area} disabled={!editable || officialOptions.length === 0} value={item.officialId} onChange={(e) => update(item.key, { officialId: e.target.value })}>
                    <option value="">Aucun (sous-lot proposé)</option>
                    {officialOptions.map((option) => <option key={option.id} value={option.id}>{option.title}</option>)}
                  </select>
                </label>
                {days !== null && <p className="text-xs text-black/50 md:col-span-12">Durée : {days} jour{days > 1 ? 's' : ''} (calculée depuis vos dates).</p>}
              </li>
            );
          })}
        </ol>
      )}
      {items.length > 0 && priceMillimes !== null && (
        <p className="mt-2 text-xs text-black/55">Budgets déclarés : {new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(allocated / 1000)} sur {new Intl.NumberFormat('fr-TN', { style: 'currency', currency: 'TND', maximumFractionDigits: 3 }).format(priceMillimes / 1000)} · le reste n’est pas réparti.</p>
      )}
    </div>
  );
}

/** Liens techniques PROPOSÉS : ils ne deviennent des dépendances de planning qu'après attribution du lot et confirmation du Client. */
export function SubLotLinksEditor({ links, onChange, editable, ownNodes, referents }: {
  links: LinkDraft[]; onChange: (next: LinkDraft[]) => void; editable: boolean; ownNodes: { key: string; title: string; lotTitle: string }[]; referents: Referent[];
}) {
  const options: { id: string; kind: LinkEndpointKind; ref: string; text: string }[] = [
    ...ownNodes.map((node) => ({ id: `proposal:${node.key}`, kind: 'proposal' as const, ref: node.key, text: `Votre sous-lot · ${node.title || 'sans titre'} (${node.lotTitle})` })),
    ...referents.map((r) => ({ id: `${r.kind}:${r.ref}`, kind: r.kind, ref: r.ref, text: `${r.kind === 'lot' ? 'Lot' : 'Sous-lot officiel'} · ${r.label}` })),
  ];
  const find = (id: string) => options.find((option) => option.id === id);
  const setEnd = (index: number, side: 'pred' | 'succ', id: string) => {
    const option = find(id);
    onChange(links.map((link, i) => (i !== index ? link : side === 'pred' ? { ...link, predKind: option?.kind ?? 'proposal', predRef: option?.ref ?? '' } : { ...link, succKind: option?.kind ?? 'proposal', succRef: option?.ref ?? '' })));
  };
  return (
    <section className="mt-4 rounded-xl border border-black/[0.08] p-4 sm:p-5" aria-labelledby="sub-lot-links-title" data-testid="bid-sub-lot-links">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 id="sub-lot-links-title" className="flex items-center gap-2 font-bold text-ink"><Link2 aria-hidden="true" size={17} />Enchaînement des travaux</h3>
          <p className="mt-1 text-sm text-black/55">Proposez « B ne commence qu’après la fin de A ». Ces liens restent des propositions : le planning du chantier n’est établi qu’après attribution du lot et confirmation par le Client.</p>
        </div>
        {editable && ownNodes.length > 0 && (
          <Button className="min-h-10 bg-white text-ink ring-1 ring-inset ring-black/10 hover:bg-sand" onClick={() => onChange([...links, { predKind: 'proposal', predRef: ownNodes[0].key, succKind: 'proposal', succRef: '' }])}>
            <Plus aria-hidden="true" size={15} />Ajouter un lien
          </Button>
        )}
      </div>
      {ownNodes.length === 0 && <p className="mt-3 text-sm text-black/50">Ajoutez d’abord des sous-lots à vos lots pour proposer des enchaînements.</p>}
      {links.length > 0 && (
        <ul className="mt-3 space-y-2">
          {links.map((link, index) => (
            <li key={`${link.predKind}:${link.predRef}>${link.succKind}:${link.succRef}:${index}`} className="grid gap-2 rounded-xl bg-sand/40 p-3 md:grid-cols-[1fr_auto_1fr_auto] md:items-end">
              <label className={label}>Commence après la fin de
                <select className={area} disabled={!editable} value={link.predRef ? `${link.predKind}:${link.predRef}` : ''} onChange={(e) => setEnd(index, 'pred', e.target.value)}>
                  <option value="">Choisir…</option>
                  {options.map((option) => <option key={option.id} value={option.id}>{option.text}</option>)}
                </select>
              </label>
              <span aria-hidden="true" className="pb-3 text-center text-black/40">→</span>
              <label className={label}>Ce travail
                <select className={area} disabled={!editable} value={link.succRef ? `${link.succKind}:${link.succRef}` : ''} onChange={(e) => setEnd(index, 'succ', e.target.value)}>
                  <option value="">Choisir…</option>
                  {options.map((option) => <option key={option.id} value={option.id}>{option.text}</option>)}
                </select>
              </label>
              {editable && <button type="button" aria-label={`Supprimer le lien ${index + 1}`} className="mb-1 rounded-lg p-2 text-red-700 hover:bg-red-50" onClick={() => onChange(links.filter((_, i) => i !== index))}><Trash2 size={15} /></button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
