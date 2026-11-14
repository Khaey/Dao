'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import ProjectGlobalPlan from './ProjectGlobalPlan';
import OceLotPlanning from './OceLotPlanning';

let status: Promise<boolean> | null = null;
/** One request per browser session: is the optional OpenConstructionERP integration switched on? */
export function oceEnabled() {
  status ??= fetch('/api/oce/status', { cache: 'no-store' })
    .then(response => response.ok ? response.json() : null)
    .then(payload => payload?.data?.enabled === true)
    .catch(() => { status = null; return false; });
  return status;
}

/**
 * Optional global planning block of the project "Suivi" tab. Native D.A.O. tracking never depends on OCE:
 * - nothing is loaded until the section is opened (no request on every visit of the tab);
 * - the D.A.O. dependency graph stays available; OCE parts (critical path, per-lot OCE dates) only when the integration is on;
 * - per-lot plans are only requested after the project plan proved readable, so no refused-access request is repeated per lot.
 */
export default function OcePlanningSection({ projectId, lots, canEdit }: { projectId: string; lots: { id: string; title?: string }[]; canEdit: boolean }) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [access, setAccess] = useState<boolean | null>(null);
  useEffect(() => { let active = true; void oceEnabled().then(value => { if (active) setEnabled(value); }); return () => { active = false; }; }, []);
  const onAccess = useCallback((allowed: boolean) => setAccess(allowed), []);
  if (access === false) return null;
  return <details onToggle={event => { if ((event.currentTarget as HTMLDetailsElement).open) setOpen(true); }} className="group rounded-2xl border border-black/[0.06] bg-white [&_summary::-webkit-details-marker]:hidden">
    <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 rounded-2xl px-5 py-4 text-sm font-semibold text-ink transition hover:bg-sand/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal">{enabled ? 'Planning global et OpenConstructionERP (facultatif)' : 'Planning global (facultatif)'}<ChevronDown size={16} aria-hidden="true" className="ml-auto shrink-0 text-ink/55 transition group-open:rotate-180" /></summary>
    {open && <div className="space-y-4 border-t border-black/[0.06] p-4 sm:p-5">
      <ProjectGlobalPlan projectId={projectId} canDecide={canEdit} onAccess={onAccess} oce={enabled} />
      {enabled && access && <OceLotPlanning projectId={projectId} lots={lots} canEdit={canEdit} />}
    </div>}
  </details>;
}
