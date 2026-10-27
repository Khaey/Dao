import Link from 'next/link';

// Shared chrome of the staff pages: the eyebrow names the menu group, so the page says where it lives.
export function StaffHeader({ group, title, crumb, description, action }: { group: string; title: string; crumb?: string; description?: React.ReactNode; action?: React.ReactNode }) {
  return <>
    <nav aria-label="Fil d’Ariane" className="text-sm text-black/50"><Link href="/app/dao" className="font-semibold hover:text-teal">Tableau de bord</Link><span aria-hidden="true" className="mx-2">/</span><span aria-current="page">{crumb ?? title}</span></nav>
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal">{group}</p>
        <h1 className="text-3xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-black/55">{description}</p>}
      </div>
      {action}
    </header>
  </>;
}

// Sibling views of one domain (e.g. accounts vs. public profiles) shown as tabs instead of a stray link.
export function StaffTabs({ label, tabs, current }: { label: string; tabs: Array<{ href: string; label: string }>; current: string }) {
  return <nav aria-label={label} className="flex gap-2 overflow-x-auto border-b border-black/5">
    {tabs.map(tab => <Link key={tab.href} href={tab.href} aria-current={tab.href === current ? 'page' : undefined}
      className={['-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-semibold transition', tab.href === current ? 'border-teal text-teal' : 'border-transparent text-black/55 hover:text-ink'].join(' ')}>{tab.label}</Link>)}
  </nav>;
}

export const professionalTabs = [
  { href: '/app/dao/professionals', label: 'Comptes et vérification' },
  { href: '/app/dao/professionals/dossiers', label: 'Fiches et médias' },
];

// The email outbox is admin-only in the RPC, so these tabs are shown to the Admin only.
export const historyTabs = [
  { href: '/app/dao/history', label: 'Journal des actions' },
  { href: '/app/dao/history/emails', label: 'Emails de suivi' },
];
