// One status palette for every list and header: the tone carries the meaning, the label stays in the caller's words.
export type StatusTone = 'neutral' | 'action' | 'waiting' | 'success' | 'danger';

const TONES: Record<StatusTone, string> = {
  neutral: 'bg-black/5 text-black/65 ring-black/10',
  action: 'bg-teal/10 text-teal ring-teal/25',
  waiting: 'bg-amber-50 text-amber-800 ring-amber-200',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  danger: 'bg-red-50 text-red-800 ring-red-200',
};

export function StatusBadge({ tone = 'neutral', children }: { tone?: StatusTone; children: React.ReactNode }) {
  return <span className={['inline-flex items-center whitespace-nowrap rounded-control px-2 py-0.5 text-xs font-semibold ring-1 ring-inset', TONES[tone]].join(' ')}>{children}</span>;
}
