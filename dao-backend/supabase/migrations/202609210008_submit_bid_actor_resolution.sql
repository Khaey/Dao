begin;
create or replace function dao_private.submit_bid_version(p_version_id uuid)
returns public.bid_versions language plpgsql security definer set search_path='' as $$
declare v public.bid_versions; v_contractor uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select b.contractor_id into v_contractor from public.bid_versions x join public.bids b on b.id=x.bid_id where x.id=p_version_id and b.contractor_id in (select cp.id from public.contractor_profiles cp where cp.user_id=auth.uid());
  if v_contractor is null then raise exception using errcode='42501',message='bid ownership required'; end if;
  update public.bid_versions set status='submitted',submitted_at=now() where id=p_version_id and contractor_id=v_contractor and status='draft' returning * into v;
  if not found then raise exception using errcode='42501',message='bid is not an owned draft'; end if; return v;
end; $$;
revoke all on function dao_private.submit_bid_version(uuid) from public,anon,authenticated; grant execute on function dao_private.submit_bid_version(uuid) to authenticated,service_role;
create or replace function public.submit_bid_version(p_version_id uuid) returns public.bid_versions language sql security definer set search_path='' as $$ select dao_private.submit_bid_version($1); $$;
revoke all on function public.submit_bid_version(uuid) from public,anon; grant execute on function public.submit_bid_version(uuid) to authenticated,service_role;
commit;
