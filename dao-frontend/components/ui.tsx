import { cn } from '../lib/utils';
export function Button({className,...p}:React.ButtonHTMLAttributes<HTMLButtonElement>){return <button className={cn('rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-teal disabled:opacity-50',className)} {...p}/>}
export function Input(p:React.InputHTMLAttributes<HTMLInputElement>){return <input className="w-full rounded-xl border border-black/10 bg-white px-3.5 py-3 text-sm outline-none ring-teal/20 focus:ring-4" {...p}/>}
export function Card({className,...p}:React.HTMLAttributes<HTMLDivElement>){return <div className={cn('rounded-2xl border border-black/5 bg-white p-5 shadow-sm',className)} {...p}/>}
export function Badge({children}:{children:React.ReactNode}){return <span className="inline-flex rounded-full bg-sand px-2.5 py-1 text-xs font-medium text-ink">{children}</span>}
