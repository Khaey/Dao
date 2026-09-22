import Link from 'next/link';
import RoleNav from './RoleNav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen">
    <header className="border-b border-black/5 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
        <Link href="/app/projects" className="shrink-0 text-xl font-bold">D.A.O<span className="text-clay">.</span></Link>
        <RoleNav />
      </div>
    </header>
    <main className="mx-auto max-w-6xl px-5 py-8">{children}</main>
  </div>;
}
