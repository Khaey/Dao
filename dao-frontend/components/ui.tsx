import { cn } from '../lib/utils';

export function Button({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn('inline-flex min-h-10 items-center justify-center rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal focus:outline-none focus:ring-4 focus:ring-teal/20 disabled:cursor-not-allowed disabled:opacity-50', className)} {...props} />;
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn('w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm outline-none transition placeholder:text-black/35 focus:border-teal focus:ring-4 focus:ring-teal/10', className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-black/5 bg-white p-5 shadow-[0_8px_30px_rgba(23,32,42,0.04)]', className)} {...props} />;
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'teal' | 'clay' | 'red' }) {
  const tones = { neutral: 'bg-sand text-ink', teal: 'bg-teal/10 text-teal', clay: 'bg-clay/10 text-clay', red: 'bg-red-50 text-red-700' };
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold', tones[tone])}>{children}</span>;
}

export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="flex flex-wrap items-end justify-between gap-3"><div>{eyebrow && <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">{eyebrow}</p>}<h2 className="mt-1 text-xl font-bold tracking-tight text-ink">{title}</h2>{description && <p className="mt-1 max-w-2xl text-sm text-black/55">{description}</p>}</div>{action}</div>;
}
