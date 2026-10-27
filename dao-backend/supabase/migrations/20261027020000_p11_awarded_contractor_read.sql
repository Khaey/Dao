-- #516: the active awardee reads the technical inspections and reserves of its
-- own lot without a project_members row, like the native tracking
-- (site_contractor_award_item). Marketplace awards do not create contractor
-- membership, so every real Artisan received 403 on reads while P11 commands
-- (site_technical_actor_role) already accepted them. The accepted-member
-- branch is kept so no existing read access is withdrawn; a revoked
-- participation still denies through site_contractor_award_item.
create or replace function dao_private.site_technical_can_read_award_item(p_award_item_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and dao_private.account_active(auth.uid())
    and exists(select 1 from public.award_items ai
      join public.projects p on p.id=ai.project_id and p.status<>'archived'
      join public.contractor_profiles cp on cp.id=ai.contractor_id
      where ai.id=p_award_item_id and (
        dao_private.site_client_project(ai.project_id)
        or dao_private.manages_project(ai.project_id)
        or dao_private.site_contractor_award_item(ai.id)
        or (dao_private.site_actor_workspace('contractor') and cp.user_id=auth.uid()
          and cp.verification_status<>'suspended'
          and exists(select 1 from public.project_members m where m.project_id=ai.project_id
            and m.user_id=auth.uid() and m.participation_role='contractor' and m.status='accepted'))
      ));
$$;

revoke all on function dao_private.site_technical_can_read_award_item(uuid) from public,anon,authenticated;
grant execute on function dao_private.site_technical_can_read_award_item(uuid) to authenticated,service_role;
