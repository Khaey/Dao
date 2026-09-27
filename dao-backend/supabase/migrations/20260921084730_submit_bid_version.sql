begin;
create or replace function dao_private.submit_bid_version(p_version_id uuid, p_contractor_id uuid)
returns public.bid_versions
language plpgsql security definer set search_path=''
as $$
declare v public.bid_versions;
begin
  if auth.uid() is null or not dao_private.pro(p_contractor_id) then
    raise exception using errcode='42501', message='bid submission authorization required';
  end if;
  update public.bid_versions
     set status='submitted', submitted_at=now()
   where id=p_version_id and contractor_id=p_contractor_id and status='draft'
   returning * into v;
  if not found then raise exception using errcode='42501', message='bid is not an owned draft'; end if;
  return v;
end; $$;
revoke all on function dao_private.submit_bid_version(uuid,uuid) from public, anon, authenticated;
grant execute on function dao_private.submit_bid_version(uuid,uuid) to authenticated, service_role;
commit;
