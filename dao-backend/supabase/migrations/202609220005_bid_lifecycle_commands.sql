begin;

-- Offer writes stay behind the same authenticated, SECURITY DEFINER boundary as
-- the rest of the MVP. The browser never receives a contractor id and the
-- public wrappers do not expose the private schema through PostgREST.
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
  if auth.uid() is null then
    raise exception using errcode='42501', message='authentication required';
  end if;

  select cp.id into v_contractor
  from public.contractor_profiles cp
  where cp.user_id=auth.uid()
    and cp.verification_status='verified'
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id=auth.uid() and ur.role='contractor'
    );
  if v_contractor is null then
    raise exception using errcode='42501', message='verified contractor role required';
  end if;

  select p.* into v_publication
  from public.publications p
  where p.id=p_publication_id
    and p.status='published'
    and (p.submission_deadline is null or p.submission_deadline>now())
    and dao_private.publication(p.id);
  if v_publication.id is null then
    raise exception using errcode='42501', message='publication unavailable';
  end if;

  insert into public.bids(project_id,contractor_id)
  values(v_publication.project_id,v_contractor)
  on conflict(project_id,contractor_id) do nothing;

  select b.* into v_bid
  from public.bids b
  where b.project_id=v_publication.project_id and b.contractor_id=v_contractor;

  -- A retry while a draft exists is idempotent. A new version is created only
  -- after a previous version has been submitted.
  select bv.* into v_version
  from public.bid_versions bv
  where bv.bid_id=v_bid.id and bv.status='draft'
  order by bv.version_no desc
  limit 1;
  if v_version.id is not null then return v_version; end if;

  select coalesce(max(bv.version_no),0)+1 into v_next_version
  from public.bid_versions bv where bv.bid_id=v_bid.id;

  insert into public.bid_versions(
    bid_id,project_id,version_no,contractor_id,expires_at
  )
  values(
    v_bid.id,v_publication.project_id,v_next_version,v_contractor,
    coalesce(v_publication.submission_deadline,now()+interval '30 days')
  )
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

  -- All lines must belong to one currently published, accessible publication;
  -- this prevents answering a hidden or unrelated lot by guessing UUIDs.
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
  set status='submitted',submitted_at=now()
  where id=v.id and status='draft'
  returning * into v;
  if not found then
    raise exception using errcode='42501', message='bid is not an owned draft';
  end if;
  return v;
end;
$$;

revoke all on function dao_private.create_bid_draft(uuid) from public,anon,authenticated;
revoke all on function dao_private.upsert_bid_item(uuid,uuid,uuid,bigint,integer,text,text) from public,anon,authenticated;
revoke all on function dao_private.submit_bid_version(uuid) from public,anon,authenticated;
grant execute on function dao_private.create_bid_draft(uuid) to authenticated,service_role;
grant execute on function dao_private.upsert_bid_item(uuid,uuid,uuid,bigint,integer,text,text) to authenticated,service_role;
grant execute on function dao_private.submit_bid_version(uuid) to authenticated,service_role;

create or replace function public.create_bid_draft(p_publication_id uuid)
returns public.bid_versions
language sql
security definer
set search_path=''
as $$ select dao_private.create_bid_draft($1); $$;

create or replace function public.upsert_bid_item(
  p_publication_id uuid,p_version_id uuid,p_publication_request_id uuid,
  p_price_millimes bigint,p_duration_days integer,p_inclusions text,
  p_exclusions text default null
)
returns public.bid_items
language sql
security definer
set search_path=''
as $$ select dao_private.upsert_bid_item($1,$2,$3,$4,$5,$6,$7); $$;

create or replace function public.submit_bid_version(p_version_id uuid)
returns public.bid_versions
language sql
security definer
set search_path=''
as $$ select dao_private.submit_bid_version($1); $$;

revoke all on function public.create_bid_draft(uuid) from public,anon;
revoke all on function public.upsert_bid_item(uuid,uuid,uuid,bigint,integer,text,text) from public,anon;
revoke all on function public.submit_bid_version(uuid) from public,anon;
grant execute on function public.create_bid_draft(uuid) to authenticated,service_role;
grant execute on function public.upsert_bid_item(uuid,uuid,uuid,bigint,integer,text,text) to authenticated,service_role;
grant execute on function public.submit_bid_version(uuid) to authenticated,service_role;

commit;
