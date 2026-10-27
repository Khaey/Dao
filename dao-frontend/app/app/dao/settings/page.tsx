'use client';
import { useEffect, useState } from 'react';
import AdminSettings from '../../../../components/settings/AdminSettings';
import ManagerSettings from '../../../../components/settings/ManagerSettings';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import SettingsTabs, { usePlatformTab } from '../../../../components/SettingsTabs';

// Admin: full configuration. Gestionnaire: only what an active mandate allows (A8).
export default function Page() {
  const [role, setRole] = useState<'admin' | 'manager' | null>(null);
  const platform = usePlatformTab();
  useEffect(() => {
    let live = true; const supabase = supabaseBrowser();
    void supabase.auth.getUser().then(async ({ data }) => {
      const rows = data.user ? (await supabase.from('user_roles').select('role').eq('user_id', data.user.id)).data ?? [] : [];
      if (live) setRole(rows.some((r: { role: string }) => r.role === 'dao_admin') ? 'admin' : 'manager');
    });
    return () => { live = false; };
  }, []);
  if (!role) return <p role="status">Chargement…</p>;
  return <><SettingsTabs platform={platform} current="/app/dao/settings" />{role === 'admin' ? <AdminSettings /> : <ManagerSettings />}</>;
}
