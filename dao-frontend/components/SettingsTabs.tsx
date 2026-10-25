'use client';
import { useEffect, useState } from 'react';
import { StaffTabs } from './backoffice/PageChrome';
import { supabaseBrowser } from '../lib/supabase-browser';

// One « Paramètres » entry in the menu: personal account first, then the platform (Admin)
// or the Gestionnaire's delegations when an active mandate exists. URLs stay unchanged.
export type PlatformTab = 'admin' | 'delegated' | null;

export function usePlatformTab(): PlatformTab | undefined {
  const [tab, setTab] = useState<PlatformTab | undefined>(undefined);
  useEffect(() => {
    let live = true; const supabase = supabaseBrowser();
    void (async () => {
      const { data } = await supabase.auth.getUser();
      const rows = data.user ? (await supabase.from('user_roles').select('role').eq('user_id', data.user.id)).data ?? [] : [];
      const roles = rows.map((r: { role: string }) => r.role);
      if (roles.includes('dao_admin')) { if (live) setTab('admin'); return; }
      if (!roles.includes('dao_reviewer')) { if (live) setTab(null); return; }
      const { fetchMyDelegation } = await import('../lib/settings');
      const delegation = await fetchMyDelegation().catch(() => null);
      if (live) setTab(delegation && delegation.mandates.length > 0 ? 'delegated' : null);
    })().catch(() => { if (live) setTab(null); });
    return () => { live = false; };
  }, []);
  return tab;
}

export default function SettingsTabs({ platform, current }: { platform: PlatformTab | undefined; current: '/app/settings' | '/app/dao/settings' }) {
  if (!platform) return null;
  return <div className="mx-auto mb-5 max-w-5xl"><StaffTabs label="Sections des paramètres" current={current} tabs={[
    { href: '/app/settings', label: 'Mon compte' },
    { href: '/app/dao/settings', label: platform === 'admin' ? 'Plateforme D.A.O.' : 'Mes délégations' },
  ]} /></div>;
}
