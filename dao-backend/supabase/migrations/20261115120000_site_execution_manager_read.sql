-- Carnet de chantier : lecture seule du Gestionnaire affecté (fil « Corriger le
-- carnet de chantier indisponible », 15/11/2026).
--
-- Le Gestionnaire affecté (staff actif + review_assignments, même règle que le
-- suivi natif P13) lit le carnet des lots attribués actifs d'un chantier
-- confirmé : avancement, interventions, jalons, observations du Client.
-- Il n'écrit rien : can_write et can_observe restent faux, les RPC d'écriture
-- (site_client_project / site_contractor_award_item) sont inchangées, et les
-- justificatifs restent filtrés par site_can_read_document (membres du
-- chantier seulement). Staff non affecté, Admin non affecté, concurrent et
-- tiers restent refusés.
begin;

create or replace function dao_private.site_manager_reads_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and dao_private.native_execution_manager_access(p_project_id)
    and exists(select 1 from public.projects p where p.id=p_project_id
      and p.confirmed_at is not null and p.status<>'archived');
$$;

create or replace function dao_private.site_manager_reads_award_item(p_award_item_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.award_items ai
    join public.awards a on a.id=ai.award_id and a.project_id=ai.project_id
    join public.project_requests r on r.id=ai.request_id and r.project_id=ai.project_id
    where ai.id=p_award_item_id and ai.active and a.status<>'cancelled'
      and r.status in ('awarded','contracted')
      and dao_private.site_manager_reads_project(ai.project_id)
  );
$$;

revoke all on function dao_private.site_manager_reads_project(uuid),
  dao_private.site_manager_reads_award_item(uuid) from public,anon,authenticated;
grant execute on function dao_private.site_manager_reads_project(uuid),
  dao_private.site_manager_reads_award_item(uuid) to authenticated,service_role;

create or replace function dao_private.site_execution_snapshot(
  p_project_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare page_size integer:=least(greatest(coalesce(p_limit,30),1),50);
  manager boolean:=dao_private.site_manager_reads_project(p_project_id);
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then
    raise exception using errcode='42501',message='active account required';
  end if;
  if not manager and not dao_private.site_client_project(p_project_id) and not exists(
    select 1 from public.award_items ai where ai.project_id=p_project_id
      and dao_private.site_contractor_award_item(ai.id)) then
    raise exception using errcode='42501',message='site execution access denied';
  end if;
  if (p_before_created_at is null)<>(p_before_id is null) then
    raise exception using errcode='22023',message='complete execution cursor required';
  end if;
  return jsonb_build_object(
    'project_id',p_project_id,
    'can_observe',dao_private.site_client_project(p_project_id),
    'lots',coalesce((
      select jsonb_agg(jsonb_build_object(
        'award_item_id',ai.id,'request_id',ai.request_id,'contractor_id',ai.contractor_id,
        'title',coalesce(rv.title,'Lot attribué'),'trade_id',rv.trade_id,
        'can_write',dao_private.site_contractor_award_item(ai.id),
        'latest_progress',(select jsonb_build_object('id',e.id,'created_at',e.created_at,
          'status',e.declared_status,'percent',e.progress_percent,'reason',e.note,'actor_id',e.actor_id)
          from public.site_log_events e where e.award_item_id=ai.id and e.event_kind='progress'
          order by e.created_at desc,e.id desc limit 1)
      ) order by ai.created_at,ai.id)
      from public.award_items ai
      join public.awards a on a.id=ai.award_id and a.status<>'cancelled'
      join public.project_requests r on r.id=ai.request_id and r.status in ('awarded','contracted')
      left join lateral (select v.title,v.trade_id from public.project_request_versions v
        where v.request_id=ai.request_id order by v.version_no desc limit 1) rv on true
      where ai.project_id=p_project_id and ai.active
        and (manager or dao_private.site_can_read_award_item(ai.id))
    ),'[]'::jsonb),
    'events',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',e.id,'created_at',e.created_at,'award_item_id',e.award_item_id,
        'request_id',e.request_id,'actor_id',e.actor_id,'kind',e.event_kind,
        'milestone_key',e.milestone_key,'status',e.declared_status,
        'percent',e.progress_percent,'work_date',e.work_date,'title',e.title,
        'target_date',e.target_date,'note',e.note,
        'evidence',coalesce((select jsonb_agg(jsonb_build_object('document_id',d.id,
          'name',d.original_name,'mime_type',d.mime_type,'created_at',x.created_at) order by x.created_at,x.id)
          from public.site_log_evidence x join public.documents d on d.id=x.document_id
          where x.event_id=e.id and dao_private.site_can_read_document(d.id,e.project_id)),'[]'::jsonb),
        'observations',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,
          'created_at',o.created_at,'actor_id',o.actor_id,'outcome',o.outcome,'reason',o.reason)
          order by o.created_at,o.id) from public.site_client_observations o where o.event_id=e.id),'[]'::jsonb)
      ) order by e.created_at desc,e.id desc)
      from (select x.* from public.site_log_events x where x.project_id=p_project_id
        and (p_before_created_at is null or (x.created_at,x.id)<(p_before_created_at,p_before_id))
        and (dao_private.site_can_read_award_item(x.award_item_id)
          or (manager and dao_private.site_manager_reads_award_item(x.award_item_id)))
        order by x.created_at desc,x.id desc limit page_size) e
    ),'[]'::jsonb)
  );
end;
$$;

notify pgrst, 'reload schema';
commit;
