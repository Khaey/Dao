-- BUG #10: opt-in contractor counter-offers on an individual submitted lot.
-- Client proposals are separate records; immutable bid_items are never updated.
begin;
alter table public.contractor_profiles add column if not exists allow_counter_offers boolean not null default false;

create table dao_private.bid_counter_proposals (
 id uuid primary key default gen_random_uuid(),
 project_id uuid not null references public.projects(id),
 bid_item_id uuid not null references public.bid_items(id),
 client_id uuid not null references auth.users(id),
 contractor_user_id uuid not null references auth.users(id),
 amount_millimes bigint not null check(amount_millimes between 1 and 1000000000000),
 client_note text check(client_note is null or char_length(client_note)<=2000),
 status text not null default 'pending' check(status in ('pending','accepted','declined')),
 request_key uuid not null,
 response_key uuid,
 created_at timestamptz not null default now(),
 responded_at timestamptz,
 unique(client_id,request_key)
);
create unique index bid_counter_one_open_per_item
 on dao_private.bid_counter_proposals(bid_item_id) where status in ('pending','accepted');
create index bid_counter_contractors on dao_private.bid_counter_proposals(contractor_user_id,created_at desc);
alter table dao_private.bid_counter_proposals enable row level security;
revoke all on dao_private.bid_counter_proposals from public,anon,authenticated;

create or replace function public.my_bid_counter_preference() returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select p.allow_counter_offers from public.contractor_profiles p where p.user_id=auth.uid() and dao_private.account_active(auth.uid())),false);
$$;
create or replace function public.set_my_bid_counter_preference(p_allowed boolean) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or p_allowed is null or not dao_private.account_active(auth.uid()) then
   raise exception using errcode='42501', message='Compte artisan actif requis';
 end if;
 update public.contractor_profiles set allow_counter_offers=p_allowed where user_id=auth.uid();
 if not found then raise exception using errcode='42501', message='Compte artisan requis'; end if;
 return p_allowed;
end;
$$;

create or replace function public.client_bid_counter_options(p_publication_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v_project uuid; result jsonb;
begin
 select project_id into v_project from public.publications where id=p_publication_id;
 if auth.uid() is null or v_project is null or not dao_private.account_active(auth.uid())
    or not dao_private.owner(v_project) then
   raise exception using errcode='42501',message='Chantier client inaccessible';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
  'bid_item_id',bi.id,'allowed',cp.allow_counter_offers,
  'status',latest.status,'amount_millimes',latest.amount_millimes
 ) order by bi.id),'[]'::jsonb) into result
 from public.bid_items bi
 join public.bid_versions bv on bv.id=bi.bid_version_id
 join public.contractor_profiles cp on cp.id=bi.contractor_id
 left join lateral (
   select offer.status,offer.amount_millimes from dao_private.bid_counter_proposals offer
   where offer.bid_item_id=bi.id order by offer.created_at desc limit 1
 ) latest on true
 where bv.publication_id=p_publication_id and bv.status='submitted' and bv.validity='current';
 return result;
end;
$$;

create or replace function public.propose_bid_counter(
 p_bid_item_id uuid,p_amount_millimes bigint,p_message text,p_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); v_item public.bid_items; v_version public.bid_versions;
 v_user uuid; v_allowed boolean; v_status text; existing dao_private.bid_counter_proposals;
 new_id uuid;
begin
 if actor is null or not dao_private.account_active(actor) or p_bid_item_id is null
   or p_key is null or p_amount_millimes is null or p_amount_millimes not between 1 and 1000000000000
   or char_length(coalesce(p_message,''))>2000 then
   raise exception using errcode='22023',message='Contre-proposition invalide';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key::text,0));
 select * into existing from dao_private.bid_counter_proposals where client_id=actor and request_key=p_key;
 if found then
   if existing.bid_item_id<>p_bid_item_id or existing.amount_millimes<>p_amount_millimes then
     raise exception using errcode='23505',message='Clé déjà utilisée';
   end if;
   return jsonb_build_object('id',existing.id,'status',existing.status);
 end if;
 select * into v_item from public.bid_items where id=p_bid_item_id;
 if not found or not dao_private.owner(v_item.project_id) then
   raise exception using errcode='42501',message='Lot inaccessible';
 end if;
 perform 1 from public.project_requests where id=v_item.request_id for update;
 select * into v_version from public.bid_versions where id=v_item.bid_version_id;
 select p.user_id,p.allow_counter_offers into v_user,v_allowed
 from public.contractor_profiles p where p.id=v_item.contractor_id and p.verification_status='verified';
 select status into v_status from public.project_requests where id=v_item.request_id;
 if not coalesce(v_allowed,false) or v_user is null or v_version.status<>'submitted'
   or v_version.validity<>'current' or v_version.expires_at<=now()
   or v_status not in ('open','reserved')
   or exists(select 1 from public.award_items where request_id=v_item.request_id and active)
   or exists(
      select 1 from public.bid_group_items gi join public.bid_groups bg on bg.id=gi.group_id
      where gi.bid_item_id=p_bid_item_id and bg.indivisible
        and (select count(*) from public.bid_group_items where group_id=bg.id)>1
   ) then
   raise exception using errcode='23514',message='Contre-proposition indisponible pour ce lot';
 end if;
 insert into dao_private.bid_counter_proposals(project_id,bid_item_id,client_id,contractor_user_id,amount_millimes,client_note,request_key)
 values(v_item.project_id,p_bid_item_id,actor,v_user,p_amount_millimes,nullif(btrim(coalesce(p_message,'')),''),p_key)
 returning id into new_id;
 return jsonb_build_object('id',new_id,'status','pending');
end;
$$;

create or replace function public.my_artisan_counter_proposals() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if auth.uid() is null or not dao_private.account_active(auth.uid()) then
   raise exception using errcode='42501',message='Compte actif requis';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',offer.id,'project_title',coalesce(pub.safe_title,'Chantier'),
   'lot_title',coalesce(rv.title,'Lot'),
   'original_amount',bi.price_millimes,'amount_millimes',offer.amount_millimes,
   'status',offer.status,'client_note',offer.client_note,'created_at',offer.created_at
 ) order by offer.created_at desc),'[]'::jsonb) into result
 from dao_private.bid_counter_proposals offer
 join public.bid_items bi on bi.id=offer.bid_item_id
 join public.bid_versions bv on bv.id=bi.bid_version_id
 left join public.publications pub on pub.id=bv.publication_id
 left join public.project_request_versions rv on rv.id=bi.request_version_id
 where offer.contractor_user_id=auth.uid();
 return result;
end;
$$;

create or replace function public.respond_bid_counter(
 p_id uuid,p_accept boolean,p_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v dao_private.bid_counter_proposals; s text;
begin
 if auth.uid() is null or not dao_private.account_active(auth.uid()) or p_id is null
   or p_accept is null or p_key is null then
   raise exception using errcode='42501',message='Artisan actif requis';
 end if;
 select * into v from dao_private.bid_counter_proposals where id=p_id for update;
 if not found or v.contractor_user_id<>auth.uid() then
   raise exception using errcode='42501',message='Contre-proposition inaccessible';
 end if;
 s:=case when p_accept then 'accepted' else 'declined' end;
 if v.status<>'pending' then
   if v.status=s and v.response_key=p_key then
     return jsonb_build_object('id',v.id,'status',v.status);
   end if;
   raise exception using errcode='23514',message='Proposition déjà traitée';
 end if;
 -- Serialize responses with concurrent award commands on the exact request.
 perform 1 from public.project_requests pr
 join public.bid_items bi on bi.request_id=pr.id where bi.id=v.bid_item_id
 for update of pr;
 if not found then raise exception using errcode='23514',message='Lot introuvable'; end if;
 if p_accept and (
   exists(select 1 from public.bid_items bi join public.bid_versions bv on bv.id=bi.bid_version_id
          where bi.id=v.bid_item_id
            and (bv.status<>'submitted' or bv.validity<>'current' or bv.expires_at<=now()))
   or exists(select 1 from public.award_items ai join public.bid_items bi on bi.request_id=ai.request_id
          where bi.id=v.bid_item_id and ai.active)
   or exists(select 1 from public.bid_items bi join public.project_requests pr on pr.id=bi.request_id
            where bi.id=v.bid_item_id and pr.status not in ('open','reserved'))
 ) then raise exception using errcode='23514',message='Lot déjà attribué'; end if;
 update dao_private.bid_counter_proposals set status=s,response_key=p_key,responded_at=now() where id=p_id;
 return jsonb_build_object('id',p_id,'status',s);
end;
$$;

-- Only the agreed award amount can reflect an accepted proposal; original submitted bid is unchanged.
CREATE OR REPLACE FUNCTION dao_private.award_offer_atomic(p_key text, p_item_id uuid, p_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor uuid:=auth.uid(); result jsonb; item public.bid_items; ids uuid[]; v_command text;
  award_id uuid; ai_id uuid; winner record; group_offer public.bid_groups; total numeric; discount bigint:=0;
  left_discount bigint; allocated bigint; amount bigint; counter_amount bigint; output jsonb:='[]';
begin
  if actor is null then raise exception using errcode='42501',message='award authorization required'; end if;
  if p_key is null or length(trim(p_key))<8 then raise exception using errcode='22023',message='idempotency key required'; end if;
  v_command:=case when p_group_id is null then 'award_bid_item' else 'award_bid_group' end;
  -- Actor/key serialization makes concurrent retries and conflicting reuse safe.
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=actor and cr.idempotency_key=p_key;
  if result is not null then
    if not exists(select 1 from public.command_receipts cr where cr.actor_id=actor and cr.idempotency_key=p_key and cr.command=v_command)
      or (p_group_id is null and coalesce(result->>'bid_item_id',(select bid_item_id::text from public.award_items where id=(result->>'award_item_id')::uuid)) is distinct from p_item_id::text)
      or (p_group_id is not null and result->>'group_id' is distinct from p_group_id::text) then
      raise exception using errcode='22023',message='idempotency key reused with different command';
    end if;
    return result;
  end if;
  if p_group_id is null then ids:=array[p_item_id]; else
    select * into group_offer from public.bid_groups where id=p_group_id and indivisible;
    select array_agg(bid_item_id order by bid_item_id) into ids from public.bid_group_items where group_id=p_group_id;
    if group_offer.id is null or coalesce(cardinality(ids),0)<2 then raise exception using errcode='23514',message='package indivisible invalide'; end if;
    discount:=group_offer.discount_millimes;
  end if;
  select * into item from public.bid_items where id=ids[1];
  if item.id is null or not (dao_private.owner(item.project_id) or dao_private.manages_project(item.project_id)) then
    raise exception using errcode='42501',message='award authorization required';
  end if;
  perform 1 from public.projects where id=item.project_id for update;
  if exists(select 1 from public.projects where id=item.project_id and status='archived') then
    raise exception using errcode='23514',message='chantier archivé';
  end if;
  if (select count(*) from public.bid_items bi join public.bid_versions bv on bv.id=bi.bid_version_id
    where bi.id=any(ids) and bi.project_id=item.project_id and bi.contractor_id=item.contractor_id
      and bv.status='submitted' and bv.validity='current' and bv.submitted_at is not null and bv.expires_at>now())<>cardinality(ids) then
    raise exception using errcode='23514',message='offer is not awardable';
  end if;
  if p_group_id is null and exists(select 1 from public.bid_group_items gi join public.bid_groups g on g.id=gi.group_id
    where gi.bid_item_id=item.id and g.indivisible and (select count(*) from public.bid_group_items where group_id=g.id)>1) then
    raise exception using errcode='23514',message='indivisible offer requires grouped award';
  end if;
  perform 1 from public.project_requests r where r.id in (select request_id from public.bid_items where id=any(ids)) order by r.id for update;
  if exists(select 1 from public.bid_items bi join public.project_requests r on r.id=bi.request_id where bi.id=any(ids)
    and (r.status not in ('open','reserved') or exists(select 1 from public.award_items ai where ai.request_id=r.id and ai.active))) then
    raise exception using errcode='23514',message='project request is not awardable';
  end if;
  if exists(select 1 from public.bid_items bi join public.bid_versions bv on bv.id=bi.bid_version_id where bi.id=any(ids) and exists(select 1 from public.publication_requests pr join public.publication_lot_withdrawals w on w.publication_request_id=pr.id where pr.request_version_id=bi.request_version_id and (bv.publication_id is null or pr.publication_id=bv.publication_id))) then raise exception using errcode='23514',message='Lot retiré de la publication'; end if;
  if p_group_id is null then
    select proposal.amount_millimes into counter_amount
    from dao_private.bid_counter_proposals proposal
    where proposal.bid_item_id=p_item_id and proposal.status='accepted'
    order by proposal.created_at desc limit 1;
  end if;
  select sum(price_millimes) into total from public.bid_items where id=any(ids);
  if discount>total then raise exception using errcode='23514',message='invalid package discount'; end if;
  left_discount:=discount;
  insert into public.awards(project_id,contractor_id,status) values(item.project_id,item.contractor_id,'confirmed') returning id into award_id;
  for winner in select bi.*,sum(price_millimes) over(order by bi.id) as cumulative_price from public.bid_items bi where bi.id=any(ids) order by bi.id loop
    -- Legacy package discounts use cumulative proportional rounding in UUID
    -- order: no negative line, and the total is exactly sum(prices)-discount.
    allocated:=case when total=0 then 0 else (floor(discount::numeric*winner.cumulative_price/total)-floor(discount::numeric*(winner.cumulative_price-winner.price_millimes)/total))::bigint end;
    left_discount:=left_discount-allocated; amount:=(case when p_group_id is null then coalesce(counter_amount,winner.price_millimes) else winner.price_millimes end)-allocated;
    insert into public.award_items(award_id,project_id,contractor_id,request_id,bid_item_id,agreed_millimes)
    values(award_id,item.project_id,item.contractor_id,winner.request_id,winner.id,amount) returning id into ai_id;
    update public.project_requests set status='awarded' where id=winner.request_id;
    insert into public.bid_item_results(bid_item_id,source_award_item_id,status,actor_id)
    select bi.id,ai_id,case when bi.id=winner.id then 'selected' else 'not_selected' end,actor
    from public.bid_items bi join public.bid_versions bv on bv.id=bi.bid_version_id
    where bi.request_id=winner.request_id and bv.status='submitted' and bv.validity='current' and bv.submitted_at is not null;
    output:=output||jsonb_build_array(jsonb_build_object('award_item_id',ai_id,'request_id',winner.request_id,'bid_item_id',winner.id,'agreed_millimes',amount));
  end loop;
  result:=jsonb_build_object('award_id',award_id,'items',output,'group_id',p_group_id,'bid_item_id',p_item_id,'status','awarded');
  if p_group_id is null then result:=result||jsonb_build_object('award_item_id',ai_id,'request_id',item.request_id); end if;
  insert into public.command_receipts(actor_id,idempotency_key,command,result) values(actor,p_key,v_command,result);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata) values(actor,'award_confirmed','project',item.project_id,result);
  return result;
end;
$function$
;
revoke all on function public.my_bid_counter_preference(),public.set_my_bid_counter_preference(boolean),
 public.client_bid_counter_options(uuid),public.propose_bid_counter(uuid,bigint,text,uuid),
 public.my_artisan_counter_proposals(),public.respond_bid_counter(uuid,boolean,uuid) from public,anon,authenticated;
grant execute on function public.my_bid_counter_preference(),public.set_my_bid_counter_preference(boolean),
 public.client_bid_counter_options(uuid),public.propose_bid_counter(uuid,bigint,text,uuid),
 public.my_artisan_counter_proposals(),public.respond_bid_counter(uuid,boolean,uuid) to authenticated,service_role;
notify pgrst, 'reload schema';
commit;
