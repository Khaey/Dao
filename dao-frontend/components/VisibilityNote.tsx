import { Eye, EyeOff } from 'lucide-react';
import type { Visibility } from './publication-state';

const tones = { teal: 'border-teal/20 bg-teal/[0.06] text-teal', clay: 'border-clay/20 bg-clay/[0.06] text-clay', red: 'border-red-200 bg-red-50 text-red-700', neutral: 'border-black/10 bg-white text-black/60' };

/** One-line client visibility for an item of the professional dossier: state, reason, next action. */
export default function VisibilityNote({ state, audience = 'owner' }: { state: Visibility; audience?: 'owner' | 'staff' }) {
  const Icon = state.visible ? Eye : EyeOff;
  return <div className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm ${tones[state.tone]}`}>
    <Icon aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
    <p className="min-w-0 text-black/70">
      <span className="font-semibold text-ink">{audience === 'staff' ? 'Côté client' : 'Pour les clients'} — {state.visible ? 'visible' : 'non visible'}</span>
      <span className="text-black/50"> · {state.label}</span>
      <span className="block">{state.why}{audience === 'owner' && state.action ? ` ${state.action}` : ''}</span>
    </p>
  </div>;
}
