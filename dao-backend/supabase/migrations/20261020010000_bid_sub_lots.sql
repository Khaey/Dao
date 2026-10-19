-- #325 tranche A : sous-lots PROPOSÉS par l'Artisan dans son offre + liens techniques proposés.
-- * Additif : rien d'existant n'est modifié ; une offre sans sous-lot reste valide telle quelle.
-- * Les sous-lots officiels D.A.O (request_sub_lots) restent intouchables : la proposition ne fait que les RÉFÉRENCER.
-- * Attribution commerciale uniquement PAR LOT : aucun sous-lot ni lien ne crée d'award, de contrat ou d'obligation.
-- * Contenu d'une offre soumise immuable (même trigger que les lignes de devis) ; une modification = nouvelle version.
-- * Tables fermées (RLS) ; écriture par RPC contrôlées ; lecture = mêmes droits que les lignes de devis de la version.
begin;

create table public.bid_sub_lots (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bid_version_id uuid not null references public.bid_versions,
  bid_item_id uuid not null,
  project_id uuid not null,
  request_id uuid not null,
  contractor_id uuid not null,
  -- Identité stable (réordonnancement et nouvelles versions de l'offre) : c'est elle que les liens référencent.
  node_key uuid not null,
  position integer not null check(position between 1 and 100),
  title text not null check(length(trim(title)) between 1 and 200),
  scope text check(scope is null or length(scope)<=4000),
  start_date date,
  end_date date,
  duration_days integer check(duration_days is null or duration_days between 1 and 3650),
  budget_millimes bigint check(budget_millimes is null or budget_millimes between 0 and 1000000000000),
  official_sub_lot_id uuid,
  foreign key(bid_item_id,project_id,contractor_id,request_id) references public.bid_items(id,project_id,contractor_id,request_id) on delete cascade,
  foreign key(official_sub_lot_id,request_id,project_id) references public.request_sub_lots(id,request_id,project_id),
  unique(bid_item_id,position),
  unique(bid_version_id,node_key),
  -- Aucune date inventée : début et fin vont ensemble, et une durée déclarée avec des dates doit leur correspondre.
  check((start_date is null)=(end_date is null)),
  check(end_date is null or end_date>=start_date),
  check(duration_days is null or start_date is null or duration_days=(end_date-start_date)+1)
);
create index on public.bid_sub_lots(bid_version_id);
create index on public.bid_sub_lots(bid_item_id);

create table public.bid_sub_lot_links (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bid_version_id uuid not null references public.bid_versions,
  project_id uuid not null,
  contractor_id uuid not null,
  pred_kind text not null check(pred_kind in ('proposal','official_sub_lot','lot')),
  pred_ref uuid not null,
  succ_kind text not null check(succ_kind in ('proposal','official_sub_lot','lot')),
  succ_ref uuid not null,
  -- Fin -> Début, latence 0 : seul type garanti de bout en bout (l'extension éventuelle vient d'une migration dédiée).
  relationship_type text not null default 'FS' check(relationship_type='FS'),
  lag_days integer not null default 0 check(lag_days=0),
  foreign key(bid_version_id,project_id,contractor_id) references public.bid_versions(id,project_id,contractor_id),
  unique(bid_version_id,pred_kind,pred_ref,succ_kind,succ_ref),
  check(not (pred_kind=succ_kind and pred_ref=succ_ref)),
  -- Un lien proposé implique au moins un nœud de l'Artisan : il ne propose rien entre deux référents officiels.
  check(pred_kind='proposal' or succ_kind='proposal')
);
create index on public.bid_sub_lot_links(bid_version_id);

alter table public.bid_sub_lots enable row level security;
alter table public.bid_sub_lot_links enable row level security;
revoke all on public.bid_sub_lots,public.bid_sub_lot_links from public,anon,authenticated;
grant select on public.bid_sub_lots,public.bid_sub_lot_links to authenticated;
grant all on public.bid_sub_lots,public.bid_sub_lot_links to service_role;
create policy read_allowed on public.bid_sub_lots for select to authenticated
using (dao_private.staff() or dao_private.bid_version(bid_version_id));
create policy read_allowed on public.bid_sub_lot_links for select to authenticated
using (dao_private.staff() or dao_private.bid_version(bid_version_id));

create trigger immutable_bid_sub_lots before insert or update or delete on public.bid_sub_lots
for each row execute function dao_private.lock_bid_children();
create trigger immutable_bid_sub_lot_links before insert or update or delete on public.bid_sub_lot_links
for each row execute function dao_private.lock_bid_children();

-- Détection de cycle générique (arêtes pred[i] -> succ[i]) : on retire les sources jusqu'à épuisement ; s'il reste des arêtes sans
-- source retirable, il y a un cycle. Réutilisée pour le graphe global de chantier (tranche B).
create or replace function dao_private.edges_have_cycle(p_from text[],p_to text[]) returns boolean
language plpgsql immutable set search_path='' as $$
declare f text[]:=coalesce(p_from,'{}'); t text[]:=coalesce(p_to,'{}'); nf text[]; nt text[];
begin
  if coalesce(array_length(f,1),0)<>coalesce(array_length(t,1),0) then raise exception using errcode='22023',message='edge arrays differ'; end if;
  while coalesce(array_length(f,1),0)>0 loop
    select array_agg(f[i] order by i),array_agg(t[i] order by i) into nf,nt
    from generate_subscripts(f,1) i where f[i] = any(t);
    if coalesce(array_length(nf,1),0)=array_length(f,1) then return true; end if;
    f:=coalesce(nf,'{}'); t:=coalesce(nt,'{}');
  end loop;
  return false;
end $$;

create or replace function dao_private.replace_bid_sub_lots(p_bid_item_id uuid,p_sub_lots jsonb)
returns setof public.bid_sub_lots
language plpgsql security definer set search_path='' as $$
declare v_item public.bid_items; entry jsonb; pos integer:=0; n integer; v_key uuid; v_start date; v_end date; v_days integer;
  v_budget bigint; v_official uuid; v_sum bigint:=0;
begin
  if jsonb_typeof(p_sub_lots)<>'array' then raise exception using errcode='22023',message='sub-lots must be an array'; end if;
  n:=jsonb_array_length(p_sub_lots);
  if n>100 then raise exception using errcode='22023',message='too many sub-lots'; end if;
  select bi.* into v_item from public.bid_items bi join public.bid_versions bv on bv.id=bi.bid_version_id
  where bi.id=p_bid_item_id and bv.status='draft' and bv.submitted_at is null and dao_private.pro(bv.contractor_id) for update of bv;
  if v_item.id is null then raise exception using errcode='42501',message='bid item is not an owned draft'; end if;
  delete from public.bid_sub_lots where bid_item_id=v_item.id;
  for entry in select value from jsonb_array_elements(p_sub_lots) loop
    pos:=pos+1;
    begin
      v_key:=coalesce(nullif(entry->>'node_key','')::uuid,gen_random_uuid());
      v_start:=nullif(entry->>'start_date','')::date; v_end:=nullif(entry->>'end_date','')::date;
      v_days:=nullif(entry->>'duration_days','')::integer; v_budget:=nullif(entry->>'budget_millimes','')::bigint;
      v_official:=nullif(entry->>'official_sub_lot_id','')::uuid;
    exception when others then raise exception using errcode='22023',message='invalid sub-lot field'; end;
    v_sum:=v_sum+coalesce(v_budget,0);
    insert into public.bid_sub_lots(bid_version_id,bid_item_id,project_id,request_id,contractor_id,node_key,position,title,scope,
      start_date,end_date,duration_days,budget_millimes,official_sub_lot_id)
    values(v_item.bid_version_id,v_item.id,v_item.project_id,v_item.request_id,v_item.contractor_id,v_key,pos,trim(entry->>'title'),
      nullif(trim(coalesce(entry->>'scope','')),''),v_start,v_end,v_days,v_budget,v_official);
  end loop;
  -- Réconciliation avec le prix déjà proposé : la somme des budgets déclarés ne peut pas le dépasser (le reste est « non réparti »).
  if v_sum>v_item.price_millimes then raise exception using errcode='23514',message='sub_lot_budget_exceeds_price'; end if;
  -- Un sous-lot supprimé emporte ses liens proposés (jamais de lien vers un nœud disparu).
  delete from public.bid_sub_lot_links l where l.bid_version_id=v_item.bid_version_id and (
    (l.pred_kind='proposal' and not exists(select 1 from public.bid_sub_lots s where s.bid_version_id=l.bid_version_id and s.node_key=l.pred_ref))
    or (l.succ_kind='proposal' and not exists(select 1 from public.bid_sub_lots s where s.bid_version_id=l.bid_version_id and s.node_key=l.succ_ref)));
  return query select * from public.bid_sub_lots where bid_item_id=v_item.id order by position;
end $$;

create or replace function dao_private.replace_bid_sub_lot_links(p_version_id uuid,p_links jsonb)
returns setof public.bid_sub_lot_links
language plpgsql security definer set search_path='' as $$
declare v public.bid_versions; entry jsonb; pk text; pr uuid; sk text; sr uuid; refs text[]:='{}'; refs2 text[]:='{}';
begin
  if jsonb_typeof(p_links)<>'array' then raise exception using errcode='22023',message='links must be an array'; end if;
  if jsonb_array_length(p_links)>300 then raise exception using errcode='22023',message='too many links'; end if;
  select * into v from public.bid_versions where id=p_version_id and status='draft' and submitted_at is null and dao_private.pro(contractor_id) for update;
  if v.id is null then raise exception using errcode='42501',message='bid is not an owned draft'; end if;
  delete from public.bid_sub_lot_links where bid_version_id=v.id;
  for entry in select value from jsonb_array_elements(p_links) loop
    begin
      pk:=entry->>'pred_kind'; pr:=(entry->>'pred_ref')::uuid; sk:=entry->>'succ_kind'; sr:=(entry->>'succ_ref')::uuid;
    exception when others then raise exception using errcode='22023',message='invalid link field'; end;
    -- Chaque extrémité doit exister dans CE chantier ; la proposition de l'Artisan ne cible que ses propres nœuds ou des référents officiels.
    if (pk='proposal' and not exists(select 1 from public.bid_sub_lots s where s.bid_version_id=v.id and s.node_key=pr))
      or (pk='official_sub_lot' and not exists(select 1 from public.request_sub_lots o where o.id=pr and o.project_id=v.project_id))
      or (pk='lot' and not exists(select 1 from public.project_requests r where r.id=pr and r.project_id=v.project_id and r.status<>'withdrawn'))
      or (sk='proposal' and not exists(select 1 from public.bid_sub_lots s where s.bid_version_id=v.id and s.node_key=sr))
      or (sk='official_sub_lot' and not exists(select 1 from public.request_sub_lots o where o.id=sr and o.project_id=v.project_id))
      or (sk='lot' and not exists(select 1 from public.project_requests r where r.id=sr and r.project_id=v.project_id and r.status<>'withdrawn'))
    then raise exception using errcode='22023',message='link_reference_not_found'; end if;
    insert into public.bid_sub_lot_links(bid_version_id,project_id,contractor_id,pred_kind,pred_ref,succ_kind,succ_ref)
    values(v.id,v.project_id,v.contractor_id,pk,pr,sk,sr);
    refs:=refs||(pk||':'||pr::text); refs2:=refs2||(sk||':'||sr::text);
  end loop;
  if dao_private.edges_have_cycle(refs,refs2) then raise exception using errcode='23514',message='dependency_cycle'; end if;
  return query select * from public.bid_sub_lot_links where bid_version_id=v.id order by created_at,id;
end $$;

create function public.replace_bid_sub_lots(p_bid_item_id uuid,p_sub_lots jsonb)
returns setof public.bid_sub_lots language sql security definer set search_path='' as $$select * from dao_private.replace_bid_sub_lots($1,$2)$$;
create function public.replace_bid_sub_lot_links(p_version_id uuid,p_links jsonb)
returns setof public.bid_sub_lot_links language sql security definer set search_path='' as $$select * from dao_private.replace_bid_sub_lot_links($1,$2)$$;

revoke all on function dao_private.edges_have_cycle(text[],text[]),dao_private.replace_bid_sub_lots(uuid,jsonb),dao_private.replace_bid_sub_lot_links(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.replace_bid_sub_lots(uuid,jsonb),public.replace_bid_sub_lot_links(uuid,jsonb) from public,anon;
grant execute on function public.replace_bid_sub_lots(uuid,jsonb),public.replace_bid_sub_lot_links(uuid,jsonb) to authenticated;

-- Référents officiels que l'Artisan peut viser dans ses liens : lots publiés et sous-lots officiels D.A.O de CE DAO uniquement
-- (aucune offre ni dépendance d'un concurrent). Lecture seule, conditionnée à la visibilité du DAO pour l'appelant.
create or replace function public.bid_link_referents(p_publication_id uuid)
returns table(kind text,ref uuid,label text,lot_ref uuid)
language sql stable security definer set search_path='' as $$
  select 'lot'::text,r.id,v.title,r.id
  from public.publication_requests pr
  join public.project_request_versions v on v.id=pr.request_version_id
  join public.project_requests r on r.id=v.request_id and r.project_id=v.project_id
  where pr.publication_id=p_publication_id and dao_private.publication(p_publication_id) and r.status<>'withdrawn'
  union all
  select 'official_sub_lot'::text,sl.sub_lot_id,sl.title,v.request_id
  from public.publication_requests pr
  join public.project_request_versions v on v.id=pr.request_version_id
  join public.project_requests r on r.id=v.request_id and r.project_id=v.project_id
  join public.request_sub_lot_versions sl on sl.request_version_id=pr.request_version_id
  where pr.publication_id=p_publication_id and dao_private.publication(p_publication_id) and r.status<>'withdrawn'
$$;
revoke all on function public.bid_link_referents(uuid) from public,anon;
grant execute on function public.bid_link_referents(uuid) to authenticated;

commit;
