import Link from 'next/link';
import RoleNav from './RoleNav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-sand"><div className="flex min-h-screen"><RoleNav /><div className="min-w-0 flex-1"><header className="sticky top-0 z-30 border-b border-black/5 bg-sand/90 backdrop-blur lg:hidden"><div className="flex h-16 items-center justify-center px-4"><Link href="/app" className="text-xl font-bold tracking-tight">D.A.O<span className="text-clay">.</span></Link></div></header><main className="mx-auto w-full max-w-[1500px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8">{children}</main></div></div></div>;
}
