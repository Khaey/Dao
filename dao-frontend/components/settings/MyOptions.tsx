'use client';
import { Card, SectionHeading } from '../ui';
import { definitionOf, formatSettingValue, settingLabel, type EffectiveSettings } from '../../lib/settings';

// Read-only (A10): no switch, no source, no internal reason.
export default function MyOptions({ settings }: { settings: EffectiveSettings | null }) {
  if (!settings) return null;
  const rows = Object.entries(settings.settings).filter(([key]) => {
    const def = definitionOf(key);
    return def && (def.family === 'capability' || (def.family === 'value' && def.effect !== 'live'));
  });
  if (!rows.length) return null;
  return <Card>
    <SectionHeading title="Mes options" description="Fonctions et délais appliqués à votre espace actuel. Pour toute question, contactez l’assistance." />
    <dl className="mt-4 divide-y divide-black/5">
      {rows.map(([key, entry]) => <div key={key} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
        <dt className="min-w-0 text-ink">{settingLabel(key)}</dt>
        <dd className={entry.state === 'unavailable' ? 'font-semibold text-black/50' : 'font-semibold text-teal'}>
          {definitionOf(key)?.family === 'value' ? formatSettingValue(key, entry.value) : entry.state === 'unavailable' ? 'Non disponible' : 'Disponible'}
        </dd>
      </div>)}
    </dl>
  </Card>;
}
