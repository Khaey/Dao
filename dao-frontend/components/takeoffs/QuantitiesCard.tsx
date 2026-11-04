'use client';

// #560 — Point d'entrée unique « Quantités & estimation » de la fiche chantier : métrés (#548)
// puis budget prévisionnel (#551). Visible du Client, du préparateur du chantier et du staff D.A.O. ;
// les droits réels restent vérifiés par l'API (un accès refusé affiche « Accès réservé »).
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Calculator, Ruler } from 'lucide-react';
import { supabaseBrowser } from '../../lib/supabase-browser';
import { Card } from '../ui';
import { cn } from '../../lib/utils';
import { primaryAction, secondaryAction } from '../../app/app/projects/_components/ProjectUi';

export default function QuantitiesCard({ projectId, participant }: { projectId: string; participant: boolean }) {
  const [staff, setStaff] = useState(false);
  useEffect(() => {
    if (participant) return;
    let live = true; const supabase = supabaseBrowser();
    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (!data.user) return;
      const rows = (await supabase.from('user_roles').select('role').eq('user_id', data.user.id)).data ?? [];
      if (live) setStaff(rows.some((r: { role: string }) => r.role === 'dao_admin' || r.role === 'dao_reviewer'));
    })().catch(() => undefined);
    return () => { live = false; };
  }, [participant]);
  if (!participant && !staff) return null;
  return <Card className="p-5 sm:p-6" data-testid="quantities-card">
    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink/65">Quantités &amp; estimation</p>
    <p className="mt-2 text-sm text-ink/70">Saisissez les dimensions réelles, faites valider les métrés, puis consultez le budget prévisionnel justifié. Non contractuel ; incomplet tant qu’il manque des données.</p>
    <div className="mt-4 flex flex-col gap-2">
      <Link href={`/app/projects/${projectId}/metres`} className={cn(primaryAction, 'w-full')}><Ruler size={15} aria-hidden="true" />Saisir les métrés</Link>
      <Link href={`/app/projects/${projectId}/estimate`} className={cn(secondaryAction, 'w-full')}><Calculator size={15} aria-hidden="true" />Ouvrir le budget prévisionnel</Link>
    </div>
  </Card>;
}
