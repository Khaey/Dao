'use client';
import { useEffect, useState } from 'react';
import { readAllBackoffice } from '../../lib/backoffice';
import type { Target } from '../../lib/settings';

export function useTargets() {
  const [targets, setTargets] = useState<{ accounts: Array<Target & { roles: string[] }>; projects: Target[] } | null>(null), [error, setError] = useState('');
  useEffect(() => { let live = true; Promise.all([readAllBackoffice('clients'), readAllBackoffice('professionals'), readAllBackoffice('projects')]).then(([clients, pros, projects]) => {
    if (!live) return; const accounts = new Map<string, Target & { roles: string[] }>();
    for (const c of clients) accounts.set(c.user_id || c.id, { id: c.user_id || c.id, name: c.display_name, roles: ['client'] });
    for (const p of pros) { const id = p.user_id || p.id, prev = accounts.get(id); accounts.set(id, { id, name: prev?.name ?? p.business_name, roles: [...(prev?.roles ?? []), 'contractor'] }); }
    setTargets({ accounts: [...accounts.values()].sort((a, b) => a.name.localeCompare(b.name)), projects: projects.map((p: any) => ({ id: p.id, name: p.version?.title ?? p.id })) });
  }).catch(() => live && setError('Liste des comptes indisponible.')); return () => { live = false; }; }, []);
  return { targets, error };
}
