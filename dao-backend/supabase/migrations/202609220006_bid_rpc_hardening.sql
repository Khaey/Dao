begin;

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

-- The public wrappers are the only PostgREST entry points. Keep the private
-- implementation out of authenticated's EXECUTE privileges as well.
revoke all on function dao_private.create_bid_draft(uuid) from public,anon,authenticated;
revoke all on function dao_private.upsert_bid_item(uuid,uuid,uuid,bigint,integer,text,text) from public,anon,authenticated;
revoke all on function dao_private.submit_bid_version(uuid) from public,anon,authenticated;
revoke all on function dao_private.submit_bid_version(uuid,uuid) from public,anon,authenticated;
grant execute on function dao_private.create_bid_draft(uuid) to service_role;
grant execute on function dao_private.upsert_bid_item(uuid,uuid,uuid,bigint,integer,text,text) to service_role;
grant execute on function dao_private.submit_bid_version(uuid) to service_role;
grant execute on function dao_private.submit_bid_version(uuid,uuid) to service_role;

-- Preserve the legacy overload without allowing it to bypass the actor,
-- publication and deadline checks of the canonical command.
create or replace function dao_private.submit_bid_version(p_version_id uuid, p_contractor_id uuid)
returns public.bid_versions
language plpgsql
security definer
set search_path=''
as $$
begin
  return dao_private.submit_bid_version(p_version_id);
end;
$$;

create or replace function public.submit_bid_version(p_version_id uuid, p_contractor_id uuid)
returns public.bid_versions
language sql
security definer
set search_path=''
as $$ select dao_private.submit_bid_version($1); $$;

revoke all on function public.submit_bid_version(uuid,uuid) from public,anon;
grant execute on function public.submit_bid_version(uuid,uuid) to authenticated,service_role;

commit;
