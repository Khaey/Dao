'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '../../lib/supabase-browser';

const labels: Record<string, string> = {
  client: 'Client',
  contractor: 'Artisan',
  dao_reviewer: 'Revue DAO',
  dao_admin: 'Administration',
};

export default function RoleNav() {
  const router = useRouter();
  const pathname = usePathname();
  const [roles, setRoles] = useState<string[]>([]);
  const [email, setEmail] = useState('');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let active = true;
    const load = async () => {
      const { data } = await supabase.auth.getSession();
      if (!active) return;
      if (!data.session) {
        router.replace('/auth/login');
        return;
      }
      setEmail(data.session.user.email ?? '');
      await fetch('/api/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
        body: JSON.stringify({}),
      });
      const { data: roleRows } = await supabase.from('user_roles').select('role').eq('user_id', data.session.user.id);
      if (!active) return;
      setRoles((roleRows ?? []).map((row: { role: string }) => row.role));
      setReady(true);
    };
    void load();
    const { data: subscription } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') router.replace('/auth/login');
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [router]);

  async function signOut() {
    await supabaseBrowser().auth.signOut();
    router.replace('/auth/login');
  }

  const hasClient = roles.includes('client');
  const hasContractor = roles.includes('contractor');
  const hasStaff = roles.includes('dao_reviewer') || roles.includes('dao_admin');
  const linkClass = (href: string) => pathname.startsWith(href) ? 'font-semibold text-ink' : 'hover:text-ink';

  return (
    <div className="flex items-center gap-4">
      {ready && <nav className="flex flex-wrap justify-end gap-4 text-sm text-black/60">
        {hasClient && <Link href="/app/projects" className={linkClass('/app/projects')}>Mes projets</Link>}
        {hasContractor && <Link href="/app/artisan" className={linkClass('/app/artisan')}>Espace artisan</Link>}
        {hasStaff && <Link href="/app/dao/review" className={linkClass('/app/dao')}>Revue DAO</Link>}
        <Link href="/app/profile" className={linkClass('/app/profile')}>Mon espace</Link>
      </nav>}
      <button type="button" onClick={() => void signOut()} className="hidden rounded-lg border border-black/10 px-3 py-2 text-xs font-semibold text-black/60 hover:border-teal hover:text-teal sm:inline-flex">
        Déconnexion
      </button>
      <span className="sr-only">{email} {roles.map(role => labels[role] ?? role).join(', ')}</span>
    </div>
  );
}
