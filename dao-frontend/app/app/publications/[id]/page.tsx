'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { Layers, ShieldCheck } from 'lucide-react';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { Badge, Card } from '../../../../components/ui';
import { publicationStatusLabel, publicationVisibilityLabel } from '../../../../lib/utils';
import { readBackoffice } from '../../../../lib/backoffice';
import WithdrawLot from '../../../../components/backoffice/WithdrawLot';
import PublicationOffersPanel from './PublicationOffersPanel';

type Publication = { id: string; project_id: string; safe_title: string; safe_description: string; visibility: string; status: string };
type PublicationLot = { id: string; request_version_id: string; safe_title: string; safe_scope: string; trade_id: string; technical_scope: any[] };

export default function PublicationDetail() {
  const { id } = useParams<{ id: string }>();
  const [publication, setPublication] = useState<Publication | null>(null);
  const [lots, setLots] = useState<PublicationLot[]>([]);
  const [staffScope,setStaffScope]=useState<{staff:boolean;manage:boolean}>({staff:false,manage:false});
  const [availability,setAvailability]=useState<Record<string,boolean>>({});
  const [revision,setRevision]=useState(0);
  const [isClientOwner, setIsClientOwner] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      const supabase = supabaseBrowser();
      const [publicationResult, lotResult, userResult] = await Promise.all([
        supabase.from('publications').select('id,project_id,safe_title,safe_description,visibility,status').eq('id', id).single(),
        supabase.from('publication_requests').select('id,request_version_id,safe_title,safe_scope,trade_id,technical_scope').eq('publication_id', id),
        supabase.auth.getUser(),
      ]);
      if (publicationResult.error || !publicationResult.data) {
        setError('DAO indisponible ou non accessible.');
        return;
      }
      const nextPublication = publicationResult.data as Publication;
      setPublication(nextPublication);
      setLots((lotResult.data ?? []) as PublicationLot[]);
      if (userResult.data.user) {
        const projectResult = await supabase.from('projects').select('client_id').eq('id', nextPublication.project_id).maybeSingle();
        setIsClientOwner(projectResult.data?.client_id === userResult.data.user.id);
        const roles=await supabase.from('user_roles').select('role').eq('user_id',userResult.data.user.id);
        if(roles.data?.some(r=>['dao_admin','dao_reviewer'].includes(r.role))){const scope=await readBackoffice('project',{project_id:nextPublication.project_id});setStaffScope({staff:true,manage:scope.rows.can_manage});}
        const state=await supabase.rpc('publication_lot_availability',{p_publication_id:id});
        if(!state.error)setAvailability(Object.fromEntries((state.data||[]).map((row:any)=>[row.publication_request_id,row.status==='withdrawn'])));
      }
    })();
  }, [id,revision]);

  if (error) return <section className="mx-auto max-w-5xl"><p role="alert" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p></section>;
  if (!publication) return <section aria-busy="true" className="mx-auto max-w-5xl space-y-4"><span className="sr-only">Chargement…</span><div className="h-24 animate-pulse rounded-2xl bg-black/5" /><div className="h-48 animate-pulse rounded-2xl bg-black/5" /></section>;
  return <section className="mx-auto max-w-5xl space-y-6">
    <header className="rounded-3xl border border-teal/10 bg-gradient-to-br from-white via-teal/[0.055] to-sand/70 px-6 py-8 shadow-sm sm:px-10 sm:py-10">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-teal"><ShieldCheck aria-hidden="true" size={16} /> Dossier d’appel d’offres</p>
      <h1 className="mt-4 break-words text-3xl font-bold tracking-tight text-ink sm:text-4xl">{publication.safe_title}</h1>
      {publication.safe_description && <p className="mt-3 max-w-3xl whitespace-pre-wrap leading-relaxed text-black/65">{publication.safe_description}</p>}
      <div className="mt-5 flex flex-wrap items-center gap-2"><Badge tone="teal">{publicationStatusLabel[publication.status] ?? publication.status}</Badge><Badge>{publicationVisibilityLabel[publication.visibility] ?? publication.visibility}</Badge><span className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-semibold text-ink"><Layers aria-hidden="true" size={14}/>{lots.length} lot{lots.length > 1 ? 's' : ''}</span></div>
    </header>
    <Card className="p-5 sm:p-7">
      <h2 className="text-xl font-bold tracking-tight text-ink">Périmètre des travaux</h2><p className="mt-1 text-sm text-black/55">Consultez chaque lot avant de comparer les offres et de choisir les professionnels.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">{lots.map((lot) => <article key={lot.id} className="rounded-2xl border border-black/[0.06] bg-sand/50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="min-w-0 break-words font-bold text-ink">{lot.safe_title}</h3>{availability[lot.id]&&<Badge tone="red">Retiré de la publication</Badge>}</div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-black/60">{lot.safe_scope}</p>
        {lot.technical_scope?.length>0&&<div className="mt-4"><h4 className="text-xs font-bold uppercase tracking-wide text-black/45">Sous-lots techniques</h4>{lot.technical_scope.map((sub:any)=><div key={sub.id} className="mt-2 border-l-2 border-teal/25 pl-3"><p className="font-semibold text-ink">{sub.title}</p><p className="text-sm text-black/65">{sub.scope}</p>{sub.budget_millimes!=null&&<p className="text-sm font-medium tabular-nums">{Number(sub.budget_millimes)/1000} TND</p>}</div>)}</div>}
        {staffScope.manage&&!availability[lot.id]&&['published','suspended'].includes(publication.status)&&<WithdrawLot lot={lot} onWithdraw={()=>setRevision(r=>r+1)} />}
      </article>)}</div>
    </Card>
    {(isClientOwner||staffScope.staff) && <PublicationOffersPanel canManage={staffScope.staff?staffScope.manage:isClientOwner} assisted={staffScope.staff} key={revision} publicationId={publication.id} projectId={publication.project_id} lots={lots} />}
  </section>;
}
