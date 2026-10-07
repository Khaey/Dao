'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabaseBrowser } from '../../../../lib/supabase-browser';
import { Badge, Card } from '../../../../components/ui';
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

  if (error) return <p role="alert">{error}</p>;
  if (!publication) return <p>Chargement…</p>;
  return <section className="mx-auto max-w-5xl space-y-6">
    <div>
      <p className="text-sm font-semibold text-teal">DAO publié</p>
      <h1 className="mt-1 text-3xl font-bold">{publication.safe_title}</h1>
      <p className="mt-2 text-black/60">{publication.safe_description}</p>
      <div className="mt-3 flex gap-2"><Badge>{publication.visibility}</Badge><Badge>{publication.status}</Badge></div>
    </div>
    <Card>
      <h2 className="font-semibold">Lots proposés</h2>
      <div className="mt-4 space-y-3">{lots.map((lot) => <article key={lot.id} className="rounded-xl bg-sand/70 p-4">
        <h3 className="font-semibold">{lot.safe_title}</h3>
        <p className="mt-2 text-sm text-black/60">{lot.safe_scope}</p>
        {availability[lot.id]&&<Badge tone="red">Retiré de la publication</Badge>}
        {lot.technical_scope?.length>0&&<div className="mt-4"><h4 className="font-semibold">Sous-lots techniques</h4>{lot.technical_scope.map((sub:any)=><div key={sub.id} className="mt-2 border-l-2 border-teal/20 pl-3"><p className="font-semibold">{sub.title}</p><p className="text-sm">{sub.scope}</p>{sub.budget_millimes!=null&&<p className="text-sm">{Number(sub.budget_millimes)/1000} TND</p>}</div>)}</div>}
        {staffScope.manage&&!availability[lot.id]&&['published','suspended'].includes(publication.status)&&<WithdrawLot lot={lot} onWithdraw={()=>setRevision(r=>r+1)} />}
      </article>)}</div>
    </Card>
    {(isClientOwner||staffScope.staff) && <PublicationOffersPanel canManage={staffScope.staff?staffScope.manage:isClientOwner} assisted={staffScope.staff} key={revision} publicationId={publication.id} projectId={publication.project_id} lots={lots} />}
  </section>;
}
