'use client';

import { useId } from 'react';
import { Star } from 'lucide-react';
import { formatRating } from '../../lib/reviews';

/** Read-only stars; the value is announced once as text for assistive technologies. */
export function Stars({ value, size = 16, className = '' }: { value: number; size?: number; className?: string }) {
  return <span className={`inline-flex items-center gap-0.5 ${className}`} role="img" aria-label={`Note ${formatRating(value)} sur 5`}>
    {[1, 2, 3, 4, 5].map((index) => {
      const fill = Math.max(0, Math.min(1, value - (index - 1)));
      return <span key={index} aria-hidden="true" className="relative inline-flex" style={{ width: size, height: size }}>
        <Star size={size} className="absolute inset-0 text-black/15" fill="currentColor" strokeWidth={0} />
        {fill > 0 && <span className="absolute inset-0 overflow-hidden" style={{ width: `${fill * 100}%` }}>
          <Star size={size} className="text-amber-500" fill="currentColor" strokeWidth={0} />
        </span>}
      </span>;
    })}
  </span>;
}

const words = ['', 'Très décevant', 'Décevant', 'Correct', 'Bien', 'Excellent'];

/** Accessible 1–5 star input (radio group); optional inputs can be cleared. */
export function StarInput({ label, value, onChange, required = false, size = 28 }: {
  label: string; value: number | null; onChange: (value: number | null) => void; required?: boolean; size?: number;
}) {
  const name = useId();
  return <fieldset className="min-w-0">
    <legend className="text-sm font-semibold text-ink">{label}{required ? <span className="text-clay"> *</span> : <span className="font-normal text-black/45"> (facultatif)</span>}</legend>
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div className="flex">
        {[1, 2, 3, 4, 5].map((score) => <label key={score} className="group relative inline-flex h-11 w-11 cursor-pointer items-center justify-center">
          <input type="radio" name={name} value={score} checked={value === score} onChange={() => onChange(score)} required={required && score === 1}
            className="peer sr-only" aria-label={`${score} sur 5${words[score] ? ` — ${words[score]}` : ''}`} />
          <Star aria-hidden="true" size={size} strokeWidth={1.5}
            className={`transition peer-focus-visible:drop-shadow-[0_0_0_2px_rgba(15,118,110,0.6)] ${value != null && score <= value ? 'fill-amber-500 text-amber-500' : 'fill-transparent text-black/25 group-hover:text-amber-400'}`} />
          <span aria-hidden="true" className="pointer-events-none absolute inset-1 rounded-full ring-teal/60 peer-focus-visible:ring-2" />
        </label>)}
      </div>
      <span className="text-sm text-black/55" aria-live="polite">{value ? words[value] : required ? 'Choisissez une note' : 'Non noté'}</span>
      {!required && value != null && <button type="button" onClick={() => onChange(null)}
        className="min-h-11 px-1 text-xs font-semibold text-black/50 underline-offset-4 hover:text-ink hover:underline">Effacer</button>}
    </div>
  </fieldset>;
}
