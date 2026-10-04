begin;

-- Only the latest submitted version of an offer remains awardable. Historical
-- versions stay readable and immutable, but are explicitly superseded.
with ranked as (
  select id,
         row_number() over (
           partition by bid_id
           order by submitted_at desc nulls last, version_no desc
         ) as position
  from public.bid_versions
  where submitted_at is not null and status='submitted'
)
update public.bid_versions version
set status='superseded', validity='obsolete'
from ranked
where version.id=ranked.id
  and ranked.position>1
  and version.status='submitted';

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

-- Public clients select one immutable bid item. Project, contractor, lot and
-- agreed amount are all derived server-side, so a forged payload cannot move
-- an award or alter its commercial value.
create or replace function dao_private.award_bid_item_atomic(
  p_idempotency_key text,
  p_bid_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid := auth.uid();
  v_receipt jsonb;
  v_item public.bid_items;
  v_award_id uuid;
  v_award_item_id uuid;
  v_request_status text;
begin
  if v_actor is null then
    raise exception using errcode='42501', message='award authorization required';
  end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key))<8 then
    raise exception using errcode='22023', message='idempotency key required';
  end if;

  select cr.result into v_receipt
  from public.command_receipts cr
  where cr.actor_id=v_actor
    and cr.idempotency_key=p_idempotency_key
    and cr.command='award_bid_item';
  if v_receipt is not null then return v_receipt; end if;

  select bi.* into v_item
  from public.bid_items bi
  join public.bid_versions bv on bv.id=bi.bid_version_id
  where bi.id=p_bid_item_id
    and bv.status='submitted'
    and bv.submitted_at is not null
    and bv.validity='current'
    and bv.expires_at>now();
  if v_item.id is null
     or not (dao_private.owner(v_item.project_id) or dao_private.staff()) then
    raise exception using errcode='42501', message='award authorization required';
  end if;

  select pr.status into v_request_status
  from public.project_requests pr
  where pr.id=v_item.request_id and pr.project_id=v_item.project_id
  for update;
  if not found then
    raise exception using errcode='23503', message='unknown project request';
  end if;
  if v_request_status not in ('open','reserved') then
    raise exception using errcode='23514', message='project request is not awardable';
  end if;

  if exists (
    select 1
    from public.bid_group_items selected
    join public.bid_groups group_offer on group_offer.id=selected.group_id
    where selected.bid_item_id=v_item.id
      and group_offer.indivisible
      and (select count(*) from public.bid_group_items member where member.group_id=group_offer.id)>1
  ) then
    raise exception using errcode='23514', message='indivisible offer requires grouped award';
  end if;

  select award.id into v_award_id
  from public.awards award
  where award.project_id=v_item.project_id
    and award.contractor_id=v_item.contractor_id
    and award.status in ('confirmed','contracting')
  order by award.created_at, award.id
  limit 1
  for update;

  if v_award_id is null then
    insert into public.awards(project_id,contractor_id,status)
    values(v_item.project_id,v_item.contractor_id,'confirmed')
    returning id into v_award_id;
  end if;

  insert into public.award_items(
    award_id,project_id,contractor_id,request_id,bid_item_id,agreed_millimes
  ) values(
    v_award_id,v_item.project_id,v_item.contractor_id,v_item.request_id,
    v_item.id,v_item.price_millimes
  ) returning id into v_award_item_id;

  update public.project_requests
  set status='awarded'
  where id=v_item.request_id and project_id=v_item.project_id;

  v_receipt := jsonb_build_object(
    'award_id',v_award_id,
    'award_item_id',v_award_item_id,
    'request_id',v_item.request_id,
    'status','awarded'
  );
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
  values(v_actor,p_idempotency_key,'award_bid_item',v_receipt);
  return v_receipt;
exception when unique_violation then
  select cr.result into v_receipt
  from public.command_receipts cr
  where cr.actor_id=v_actor
    and cr.idempotency_key=p_idempotency_key
    and cr.command='award_bid_item';
  if v_receipt is not null then return v_receipt; end if;
  raise;
end;
$$;

revoke all on function dao_private.award_bid_item_atomic(text,uuid) from public,anon,authenticated;
grant execute on function dao_private.award_bid_item_atomic(text,uuid) to authenticated,service_role;

create or replace function public.award_bid_item_atomic(
  p_idempotency_key text,
  p_bid_item_id uuid
)
returns jsonb
language sql
security definer
set search_path=''
as $$ select dao_private.award_bid_item_atomic($1,$2); $$;

revoke all on function public.award_bid_item_atomic(text,uuid) from public,anon;
grant execute on function public.award_bid_item_atomic(text,uuid) to authenticated,service_role;

-- The legacy seven-argument command remains available to service-role
-- maintenance only. Browser/API callers use the derived-input command above.
revoke execute on function public.award_request_atomic(text,uuid,uuid,uuid,uuid,uuid,bigint) from authenticated;
revoke execute on function dao_private.award_request_atomic(text,uuid,uuid,uuid,uuid,uuid,bigint) from authenticated;

commit;
