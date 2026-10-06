begin;

-- Results are per offer line/lot, not a destructive edit of submitted content.
create table public.bid_item_results (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  bid_item_id uuid not null references public.bid_items,
  source_award_item_id uuid not null references public.award_items,
  status text not null check(status in ('selected','not_selected','available')),
  actor_id uuid references auth.users
);
create index on public.bid_item_results(bid_item_id,id desc);
create index on public.bid_item_results(source_award_item_id);
create table public.award_cancellations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  award_item_id uuid not null unique references public.award_items,
  batch_id uuid not null,
  actor_id uuid not null references auth.users,
  reason text not null check(reason in ('disagreement','withdrawal','financing','unavailable','award_error','mutual_agreement','deadline','other')),
  comment text,
  check(reason<>'other' or nullif(trim(comment),'') is not null)
);
create index on public.award_cancellations(batch_id);
alter table public.bid_item_results enable row level security;
alter table public.award_cancellations enable row level security;
revoke all on public.bid_item_results,public.award_cancellations from public,anon,authenticated;
-- Hide the source award and decision-maker from competing contractors.
grant select(id,created_at,bid_item_id,status) on public.bid_item_results to authenticated;
grant select on public.award_cancellations to authenticated;
grant all on public.bid_item_results,public.award_cancellations to service_role;
grant usage,select on sequence public.bid_item_results_id_seq to service_role;
create policy read_allowed on public.bid_item_results for select to authenticated
using (exists(select 1 from public.bid_items bi where bi.id=bid_item_id and dao_private.bid_version(bi.bid_version_id)));
create policy read_allowed on public.award_cancellations for select to authenticated
using (exists(select 1 from public.award_items ai where ai.id=award_item_id and dao_private.award(ai.award_id)));

create function dao_private.immutable_award_history() returns trigger
language plpgsql set search_path='' as $$
begin raise exception using errcode='23514',message='award history is immutable'; end;
$$;
create trigger immutable_bid_item_results before update or delete on public.bid_item_results
for each row execute function dao_private.immutable_award_history();
create trigger immutable_award_cancellations before update or delete on public.award_cancellations
for each row execute function dao_private.immutable_award_history();
create function dao_private.protect_award_item() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if TG_OP='DELETE' then raise exception using errcode='23514',message='award history is immutable'; end if;
  if (to_jsonb(NEW)-'active') is distinct from (to_jsonb(OLD)-'active') or (not OLD.active and NEW.active) then
    raise exception using errcode='23514',message='award history is immutable';
  end if;
  if OLD.active and not NEW.active and not exists(select 1 from public.award_cancellations where award_item_id=OLD.id) then
    raise exception using errcode='23514',message='audited cancellation required';
  end if;
  return NEW;
end;
$$;
create trigger protect_award_item before update or delete on public.award_items
for each row execute function dao_private.protect_award_item();
revoke all on function dao_private.immutable_award_history(),dao_private.protect_award_item() from public,anon,authenticated;

-- No commercial rewrite for already confirmed awards; append missing results.
insert into public.bid_item_results(bid_item_id,source_award_item_id,status)
select bi.id,ai.id,case when bi.id=ai.bid_item_id then 'selected' else 'not_selected' end
from public.award_items ai join public.bid_items bi on bi.request_id=ai.request_id
join public.bid_versions bv on bv.id=bi.bid_version_id
where ai.active and bv.submitted_at is not null and bv.status='submitted' and bv.validity='current';

-- Safe availability without exposing competing awards/prices. Publication access
-- (including targeted and invitation revocation) remains the authority.
create function dao_private.publication_lot_availability(p_publication_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not dao_private.publication(p_publication_id) then
    raise exception using errcode='42501',message='publication unavailable';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('publication_request_id',pr.id,'request_id',rv.request_id,
    'status',r.status,'accepts_offers',r.status in ('open','reserved') and not exists(select 1 from public.award_items ai where ai.request_id=r.id and ai.active)))
    from public.publication_requests pr join public.project_request_versions rv on rv.id=pr.request_version_id
    join public.project_requests r on r.id=rv.request_id where pr.publication_id=p_publication_id),'[]'::jsonb);
end;
$$;
create function public.publication_lot_availability(p_publication_id uuid) returns jsonb
language sql security definer set search_path='' as $$ select dao_private.publication_lot_availability($1); $$;
revoke all on function dao_private.publication_lot_availability(uuid) from public,anon,authenticated;
revoke all on function public.publication_lot_availability(uuid) from public,anon;
grant execute on function public.publication_lot_availability(uuid) to authenticated,service_role;

-- All product offer/award mutations serialize project first. A pre-award draft
-- cannot slip through submission after the winning transaction commits.
create or replace function dao_private.create_bid_draft(p_publication_id uuid)
returns public.bid_versions
language plpgsql
security definer
set search_path=''
as $$
declare
  v_publication public.publications;
  v_contractor uuid;
  v_bid public.bids;
  v_version public.bid_versions;
  v_next_version integer;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select cp.id into v_contractor
  from public.contractor_profiles cp
  where cp.user_id=auth.uid() and cp.verification_status='verified'
    and exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role='contractor');
  if v_contractor is null then raise exception using errcode='42501',message='verified contractor role required'; end if;
  select p.* into v_publication
  from public.publications p
  where p.id=p_publication_id and p.status='published'
    and (p.submission_deadline is null or p.submission_deadline>now())
    and dao_private.publication(p.id);
  if v_publication.id is null then raise exception using errcode='42501',message='publication unavailable'; end if;
  perform 1 from public.projects where id=v_publication.project_id for update;
  if not exists(select 1 from public.publication_requests pr
    join public.project_request_versions rv on rv.id=pr.request_version_id
    join public.project_requests r on r.id=rv.request_id
    where pr.publication_id=p_publication_id and r.status in ('open','reserved')
      and not exists(select 1 from public.award_items ai where ai.request_id=r.id and ai.active)) then
    raise exception using errcode='23514',message='aucun lot ouvert aux offres';
  end if;
  insert into public.bids(project_id,contractor_id)
  values(v_publication.project_id,v_contractor) on conflict(project_id,contractor_id) do nothing;
  -- Serialize retries for the same contractor/project before choosing the
  -- next version number, making duplicate clicks safe under concurrency.
  select b.* into v_bid from public.bids b
  where b.project_id=v_publication.project_id and b.contractor_id=v_contractor
  for update;
  select bv.* into v_version from public.bid_versions bv
  where bv.bid_id=v_bid.id and bv.status='draft' order by bv.version_no desc limit 1;
  if v_version.id is not null then return v_version; end if;
  select coalesce(max(bv.version_no),0)+1 into v_next_version from public.bid_versions bv where bv.bid_id=v_bid.id;
  insert into public.bid_versions(bid_id,project_id,version_no,contractor_id,expires_at)
  values(v_bid.id,v_publication.project_id,v_next_version,v_contractor,coalesce(v_publication.submission_deadline,now()+interval '30 days'))
  returning * into v_version;
  return v_version;
end;
$$;

create or replace function dao_private.upsert_bid_item(
  p_publication_id uuid,
  p_version_id uuid,
  p_publication_request_id uuid,
  p_price_millimes bigint,
  p_duration_days integer,
  p_inclusions text,
  p_exclusions text default null
)
returns public.bid_items
language plpgsql
security definer
set search_path=''
as $$
declare
  v_version public.bid_versions;
  v_publication public.publications;
  v_publication_request public.publication_requests;
  v_item public.bid_items;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='authentication required';
  end if;
  if p_price_millimes<0 or p_duration_days<=0 or nullif(trim(p_inclusions),'') is null then
    raise exception using errcode='23514', message='invalid bid item';
  end if;

  perform 1 from public.projects where id=(select project_id from public.bid_versions where id=p_version_id) for update;
  select bv.* into v_version
  from public.bid_versions bv
  where bv.id=p_version_id
    and bv.status='draft'
    and dao_private.pro(bv.contractor_id)
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id=auth.uid() and ur.role='contractor'
    );
  if v_version.id is null then
    raise exception using errcode='42501', message='owned draft required';
  end if;

  select p.* into v_publication
  from public.publications p
  where p.id=p_publication_id
    and p.project_id=v_version.project_id
    and p.status='published'
    and (p.submission_deadline is null or p.submission_deadline>now())
    and dao_private.publication(p.id);
  if v_publication.id is null then
    raise exception using errcode='42501', message='publication unavailable';
  end if;

  select pr.* into v_publication_request
  from public.publication_requests pr
  join public.project_request_versions rv on rv.id=pr.request_version_id
  where pr.publication_id=v_publication.id
    and pr.id=p_publication_request_id
    and rv.project_id=v_version.project_id;
  if v_publication_request.id is null then
    raise exception using errcode='42501', message='request is not published';
  end if;

  if not exists(select 1 from public.project_request_versions rv join public.project_requests r on r.id=rv.request_id
    where rv.id=v_publication_request.request_version_id and r.status in ('open','reserved')
      and not exists(select 1 from public.award_items ai where ai.request_id=r.id and ai.active)) then
    raise exception using errcode='23514',message='lot fermé aux nouvelles offres';
  end if;
  insert into public.bid_items(
    bid_version_id,project_id,request_version_id,price_millimes,
    duration_days,inclusions,exclusions,contractor_id,request_id
  )
  select
    v_version.id,v_version.project_id,v_publication_request.request_version_id,
    p_price_millimes,p_duration_days,p_inclusions,p_exclusions,
    v_version.contractor_id,(select rv.request_id from public.project_request_versions rv where rv.id=v_publication_request.request_version_id)
  on conflict(bid_version_id,request_version_id) do update set
    price_millimes=excluded.price_millimes,
    duration_days=excluded.duration_days,
    inclusions=excluded.inclusions,
    exclusions=excluded.exclusions
  returning * into v_item;
  return v_item;
end;
$$;

create or replace function dao_private.submit_bid_version(p_version_id uuid)
returns public.bid_versions
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.bid_versions;
  v_item_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='authentication required';
  end if;

  perform 1 from public.projects where id=(select project_id from public.bid_versions where id=p_version_id) for update;
  select bv.* into v
  from public.bid_versions bv
  where bv.id=p_version_id
    and bv.status='draft'
    and dao_private.pro(bv.contractor_id)
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id=auth.uid() and ur.role='contractor'
    );
  if v.id is null then
    raise exception using errcode='42501', message='bid is not an owned draft';
  end if;

  select count(*) into v_item_count
  from public.bid_items bi where bi.bid_version_id=v.id;
  if v_item_count=0 then
    raise exception using errcode='23514', message='at least one bid item required';
  end if;

  if not exists (
    select 1
    from public.publications p
    where p.project_id=v.project_id
      and p.status='published'
      and (p.submission_deadline is null or p.submission_deadline>now())
      and dao_private.publication(p.id)
      and not exists (
        select 1 from public.bid_items bi
        where bi.bid_version_id=v.id
          and not exists (
            select 1 from public.publication_requests pr
            where pr.publication_id=p.id
              and pr.request_version_id=bi.request_version_id
          )
      )
  ) then
    raise exception using errcode='42501', message='bid requests are not published';
  end if;

  if exists(select 1 from public.bid_items bi join public.project_requests r on r.id=bi.request_id
    where bi.bid_version_id=v.id and (r.status not in ('open','reserved')
      or exists(select 1 from public.award_items ai where ai.request_id=r.id and ai.active))) then
    raise exception using errcode='23514',message='lot fermé aux nouvelles offres';
  end if;
  update public.bid_versions
  set status='superseded', validity='obsolete'
  where bid_id=v.bid_id
    and id<>v.id
    and status='submitted'
    and submitted_at is not null;

  update public.bid_versions
  set status='submitted', submitted_at=now(), validity='current'
  where id=v.id and status='draft'
  returning * into v;
  if not found then
    raise exception using errcode='42501', message='bid is not an owned draft';
  end if;
  return v;
end;
$$;


-- One package for all lines of an owned draft. Submitted groups are immutable.
create function dao_private.configure_bid_package(p_version_id uuid,p_indivisible boolean,p_item_ids uuid[] default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.bid_versions; gid uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  perform 1 from public.projects where id=(select project_id from public.bid_versions where id=p_version_id) for update;
  select * into v from public.bid_versions where id=p_version_id and status='draft' and dao_private.pro(contractor_id);
  if v.id is null or not exists(select 1 from public.user_roles where user_id=auth.uid() and role='contractor') then raise exception using errcode='42501',message='owned draft required'; end if;
  if p_item_ids is not null and (cardinality(p_item_ids)=0 or array_position(p_item_ids,null) is not null or (select count(*) from public.bid_items where id=any(p_item_ids) and bid_version_id=v.id)<>cardinality(p_item_ids)) then raise exception using errcode='22023',message='invalid draft line selection'; end if;
  delete from public.bid_group_items where bid_version_id=v.id;
  delete from public.bid_groups where bid_version_id=v.id;
  if p_item_ids is not null then delete from public.bid_items where bid_version_id=v.id and not(id=any(p_item_ids)); end if;
  if p_indivisible then
    if (select count(*) from public.bid_items where bid_version_id=v.id)<2 then
      raise exception using errcode='23514',message='un package requiert au moins deux lots';
    end if;
    insert into public.bid_groups(bid_version_id,indivisible) values(v.id,true) returning id into gid;
    insert into public.bid_group_items(group_id,bid_version_id,bid_item_id) select gid,v.id,id from public.bid_items where bid_version_id=v.id;
  end if;
  return jsonb_build_object('group_id',gid);
end;
$$;
create function public.configure_bid_package(p_version_id uuid,p_indivisible boolean,p_item_ids uuid[] default null) returns jsonb
language sql security definer set search_path='' as $$ select dao_private.configure_bid_package($1,$2,$3); $$;
revoke all on function dao_private.configure_bid_package(uuid,boolean,uuid[]) from public,anon,authenticated;
revoke all on function public.configure_bid_package(uuid,boolean,uuid[]) from public,anon;
grant execute on function public.configure_bid_package(uuid,boolean,uuid[]) to authenticated,service_role;

-- Private implementation shared by single-lot and package commands. New award
-- identity per command avoids reusing a cancelled item's unique award/lot key.
create function dao_private.award_offer_atomic(p_key text,p_item_id uuid,p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb; item public.bid_items; ids uuid[]; v_command text;
  award_id uuid; ai_id uuid; winner record; group_offer public.bid_groups; total numeric; discount bigint:=0;
  left_discount bigint; allocated bigint; amount bigint; output jsonb:='[]';
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
  if item.id is null or not (dao_private.owner(item.project_id) or dao_private.staff()) then
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
  select sum(price_millimes) into total from public.bid_items where id=any(ids);
  if discount>total then raise exception using errcode='23514',message='invalid package discount'; end if;
  left_discount:=discount;
  insert into public.awards(project_id,contractor_id,status) values(item.project_id,item.contractor_id,'confirmed') returning id into award_id;
  for winner in select bi.*,sum(price_millimes) over(order by bi.id) as cumulative_price from public.bid_items bi where bi.id=any(ids) order by bi.id loop
    -- Legacy package discounts use cumulative proportional rounding in UUID
    -- order: no negative line, and the total is exactly sum(prices)-discount.
    allocated:=case when total=0 then 0 else (floor(discount::numeric*winner.cumulative_price/total)-floor(discount::numeric*(winner.cumulative_price-winner.price_millimes)/total))::bigint end;
    left_discount:=left_discount-allocated; amount:=winner.price_millimes-allocated;
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
$$;
create or replace function dao_private.award_bid_item_atomic(p_idempotency_key text,p_bid_item_id uuid) returns jsonb
language sql security definer set search_path='' as $$ select dao_private.award_offer_atomic($1,$2,null); $$;
create function public.award_bid_group_atomic(p_idempotency_key text,p_group_id uuid) returns jsonb
language sql security definer set search_path='' as $$ select dao_private.award_offer_atomic($1,null,$2); $$;
revoke all on function dao_private.award_offer_atomic(text,uuid,uuid) from public,anon,authenticated;
revoke all on function dao_private.award_bid_item_atomic(text,uuid) from public,anon,authenticated;
revoke all on function public.award_bid_group_atomic(text,uuid) from public,anon;
grant execute on function public.award_bid_group_atomic(text,uuid) to authenticated,service_role;

create function dao_private.cancel_award_item_atomic(p_key text,p_award_item_id uuid,p_reason text,p_comment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item public.award_items; ids uuid[]; result jsonb; batch uuid:=gen_random_uuid();
begin
  if actor is null then raise exception using errcode='42501',message='award authorization required'; end if;
  if p_key is null or length(trim(p_key))<8 then raise exception using errcode='22023',message='idempotency key required'; end if;
  if p_reason is null or p_reason not in ('disagreement','withdrawal','financing','unavailable','award_error','mutual_agreement','deadline','other')
    or (p_reason='other' and nullif(trim(p_comment),'') is null) then
    raise exception using errcode='22023',message='motif obligatoire ; autre requiert un commentaire';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=actor and cr.idempotency_key=p_key;
  if result is not null then
    if not exists(select 1 from public.command_receipts cr where cr.actor_id=actor and cr.idempotency_key=p_key and cr.command='cancel_award_item')
      or result->>'award_item_id' is distinct from p_award_item_id::text
      or result->>'reason' is distinct from p_reason or result->>'comment' is distinct from nullif(trim(p_comment),'') then
      raise exception using errcode='22023',message='idempotency key reused with different command';
    end if;
    return result;
  end if;
  select * into item from public.award_items where id=p_award_item_id;
  if item.id is null or not (dao_private.owner(item.project_id) or dao_private.staff()) then
    raise exception using errcode='42501',message='award authorization required';
  end if;
  perform 1 from public.projects where id=item.project_id for update;
  select * into item from public.award_items where id=p_award_item_id;
  if not item.active then raise exception using errcode='23514',message='attribution déjà annulée'; end if;
  -- A package cannot be left partially active, even when selected via one lot.
  select array_agg(ai.id order by ai.id) into ids from public.award_items ai
  where ai.award_id=item.award_id and ai.active and (ai.id=item.id or exists(
    select 1 from public.bid_group_items selected join public.bid_groups g on g.id=selected.group_id and g.indivisible
    join public.bid_group_items member on member.group_id=g.id
    where selected.bid_item_id=item.bid_item_id and member.bid_item_id=ai.bid_item_id));
  if exists(select 1 from public.contracts where award_id=item.award_id)
    or exists(select 1 from public.project_requests where id in(select request_id from public.award_items where id=any(ids)) and status='contracted') then
    raise exception using errcode='23514',message='annulation contractuelle hors périmètre';
  end if;
  insert into public.award_cancellations(award_item_id,batch_id,actor_id,reason,comment)
    select id,batch,actor,p_reason,nullif(trim(p_comment),'') from public.award_items where id=any(ids);
  update public.award_items set active=false where id=any(ids);
  update public.project_requests set status='open' where status='awarded' and id in(select request_id from public.award_items where id=any(ids));
  insert into public.bid_item_results(bid_item_id,source_award_item_id,status,actor_id)
    select bi.id,ai.id,'available',actor from public.award_items ai join public.bid_items bi on bi.request_id=ai.request_id
    join public.bid_versions bv on bv.id=bi.bid_version_id
    where ai.id=any(ids) and bv.status='submitted' and bv.validity='current' and bv.submitted_at is not null;
  update public.awards set status='cancelled' where id=item.award_id and not exists(select 1 from public.award_items where award_id=item.award_id and active);
  result:=jsonb_build_object('award_item_id',item.id,'cancelled_item_ids',ids,'batch_id',batch,'reason',p_reason,'comment',nullif(trim(p_comment),''),'status','cancelled');
  insert into public.command_receipts(actor_id,idempotency_key,command,result) values(actor,p_key,'cancel_award_item',result);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata) values(actor,'award_cancelled','project',item.project_id,result);
  return result;
end;
$$;
create function public.cancel_award_item_atomic(p_idempotency_key text,p_award_item_id uuid,p_reason text,p_comment text) returns jsonb
language sql security definer set search_path='' as $$ select dao_private.cancel_award_item_atomic($1,$2,$3,$4); $$;
revoke all on function dao_private.cancel_award_item_atomic(text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.cancel_award_item_atomic(text,uuid,text,text) from public,anon;
grant execute on function public.cancel_award_item_atomic(text,uuid,text,text) to authenticated,service_role;

commit;
