begin;

-- P9-A1 follow-up: the agreement belongs to the confirmed commercial parties.
-- A marketplace award does not create a project_members row for the awarded
-- contractor, so membership cannot be an additional access prerequisite here.
create or replace function dao_private.precontract_party_for_award(
  p_award_id uuid,p_actor_id uuid
) returns text
language sql stable security definer set search_path='' as $$
  select case
    when p.client_id=p_actor_id and cp.user_id<>p_actor_id
      and exists(select 1 from public.user_roles ur where ur.user_id=p_actor_id and ur.role='client')
      then 'client'
    when cp.user_id=p_actor_id and p.client_id<>p_actor_id
      and exists(select 1 from public.user_roles ur where ur.user_id=p_actor_id and ur.role='contractor')
      then 'contractor'
    else null
  end
  from public.awards a
  join public.projects p on p.id=a.project_id
  join public.contractor_profiles cp on cp.id=a.contractor_id
  where a.id=p_award_id;
$$;

revoke all on function dao_private.precontract_party_for_award(uuid,uuid)
  from public,anon,authenticated;

notify pgrst, 'reload schema';
commit;
