-- OCE Engine V1 (#58 / #301) : planning technique minimal d'un lot, saisi explicitement dans D.A.O.
-- * D.A.O reste la source de vérité : dates de début et de fin renseignées par le Client propriétaire ou la gestion
--   D.A.O du projet. Aucune date, aucune dépendance n'est inventée ; sans les deux dates le plan ne peut pas être « prêt ».
-- * Un plan « prêt » déclenche côté serveur la synchronisation automatique vers la passerelle OCE privée.
-- * Table fermée (RLS, aucun droit direct) ; lecture/écriture par RPC contrôlées. Additive : rien d'existant n'est modifié.
begin;

create table public.oce_lot_plans (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project_id uuid not null,
  request_id uuid not null,
  planned_start date,
  planned_end date,
  status text not null default 'draft' check (status in ('draft','ready')),
  revision integer not null default 1 check (revision>0),
  updated_by uuid references auth.users,
  unique (project_id, request_id),
  foreign key (request_id, project_id) references public.project_requests(id, project_id),
  check (planned_end is null or planned_start is null or planned_end>=planned_start),
  check (status<>'ready' or (planned_start is not null and planned_end is not null))
);
alter table public.oce_lot_plans enable row level security;
revoke all on public.oce_lot_plans from public,anon,authenticated;

-- Who may edit/read the plan of a lot: owner or D.A.O management of the project; lot not withdrawn, project not archived.
create function dao_private.oce_plan_access(p_project_id uuid,p_request_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and dao_private.account_active(auth.uid())
    and (dao_private.owner(p_project_id) or dao_private.manages_project(p_project_id))
    and exists(select 1 from public.project_requests r join public.projects p on p.id=r.project_id
      where r.id=p_request_id and r.project_id=p_project_id and p.status<>'archived' and r.status<>'withdrawn');
$$;

-- Supervision / relaunch is reserved to D.A.O management (admin or assigned reviewer), not to the Client.
create function dao_private.oce_resync_access(p_project_id uuid,p_request_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select dao_private.oce_plan_access(p_project_id,p_request_id) and dao_private.manages_project(p_project_id);
$$;

create function dao_private.oce_save_lot_plan(p_project_id uuid,p_request_id uuid,p_start date,p_end date,p_ready boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v public.oce_lot_plans;
begin
  if not dao_private.oce_plan_access(p_project_id,p_request_id) then raise exception using errcode='42501',message='Accès au planning du lot refusé'; end if;
  if p_start is null and p_end is not null or p_start is not null and p_end is null then raise exception using errcode='22023',message='Dates de début et de fin requises ensemble'; end if;
  if p_end<p_start then raise exception using errcode='22023',message='La fin précède le début'; end if;
  if p_ready and p_start is null then raise exception using errcode='22023',message='Un planning prêt exige des dates explicites'; end if;
  insert into public.oce_lot_plans(project_id,request_id,planned_start,planned_end,status,updated_by)
    values(p_project_id,p_request_id,p_start,p_end,case when p_ready then 'ready' else 'draft' end,auth.uid())
  on conflict(project_id,request_id) do update set planned_start=excluded.planned_start,planned_end=excluded.planned_end,
    status=excluded.status,updated_by=auth.uid(),updated_at=now(),
    revision=case when (public.oce_lot_plans.planned_start,public.oce_lot_plans.planned_end,public.oce_lot_plans.status)
      is distinct from (excluded.planned_start,excluded.planned_end,excluded.status) then public.oce_lot_plans.revision+1 else public.oce_lot_plans.revision end
  returning * into v;
  return jsonb_build_object('status',v.status,'revision',v.revision,'planned_start',v.planned_start,'planned_end',v.planned_end);
end;
$$;

-- Plan + synchronisation state of a lot. Sync state is derived from the durable mapping; no OCE identifier is exposed.
create function dao_private.oce_get_lot_plan(p_project_id uuid,p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare v public.oce_lot_plans; m public.oce_sync_mappings; s text;
begin
  if not dao_private.oce_plan_access(p_project_id,p_request_id) then raise exception using errcode='42501',message='Accès au planning du lot refusé'; end if;
  select * into v from public.oce_lot_plans where project_id=p_project_id and request_id=p_request_id;
  if v.id is null then return jsonb_build_object('status','none','sync',jsonb_build_object('state','not_requested')); end if;
  select * into m from public.oce_sync_mappings where project_id=p_project_id and request_id=p_request_id;
  s:=case when v.status<>'ready' then 'not_requested'
    when m.id is null then 'pending'
    when m.last_error_at is not null and m.last_error_at>=v.updated_at then 'failed'
    when m.last_success_at is not null and m.last_success_at>=v.updated_at then 'synced'
    else 'pending' end;
  return jsonb_build_object('status',v.status,'revision',v.revision,'planned_start',v.planned_start,'planned_end',v.planned_end,
    'sync',jsonb_build_object('state',s,'last_success_at',m.last_success_at,
      'error_kind',case when s='failed' then m.last_error_kind end,'error_code',case when s='failed' then m.last_error_code end));
end;
$$;

-- Server only (service_role): what the synchroniser needs. Returns null unless the plan is ready.
create function dao_private.oce_lot_plan_for_sync(p_project_id uuid,p_request_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('lot_title',rv.title,'region',g.name_fr,'planned_start',pl.planned_start,'planned_end',pl.planned_end)
  from public.oce_lot_plans pl
  join public.project_requests r on r.id=pl.request_id and r.project_id=pl.project_id and r.status<>'withdrawn'
  join public.projects p on p.id=pl.project_id and p.status<>'archived'
  join lateral (select title from public.project_request_versions v where v.request_id=r.id order by version_no desc limit 1) rv on true
  join lateral (select governorate_id from public.project_versions pv where pv.project_id=p.id order by version_no desc limit 1) pvv on true
  join public.governorates g on g.id=pvv.governorate_id
  where pl.project_id=p_project_id and pl.request_id=p_request_id and pl.status='ready';
$$;

create function public.oce_save_lot_plan(p_project_id uuid,p_request_id uuid,p_start date,p_end date,p_ready boolean) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.oce_save_lot_plan($1,$2,$3,$4,$5); $$;
create function public.oce_get_lot_plan(p_project_id uuid,p_request_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.oce_get_lot_plan($1,$2); $$;
create function public.oce_resync_access(p_project_id uuid,p_request_id uuid) returns boolean
language sql stable security invoker set search_path='' as $$ select dao_private.oce_resync_access($1,$2); $$;
create function public.oce_lot_plan_for_sync(p_project_id uuid,p_request_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.oce_lot_plan_for_sync($1,$2); $$;

revoke all on function dao_private.oce_plan_access(uuid,uuid),dao_private.oce_resync_access(uuid,uuid),
  dao_private.oce_save_lot_plan(uuid,uuid,date,date,boolean),dao_private.oce_get_lot_plan(uuid,uuid),dao_private.oce_lot_plan_for_sync(uuid,uuid),
  public.oce_save_lot_plan(uuid,uuid,date,date,boolean),public.oce_get_lot_plan(uuid,uuid),public.oce_resync_access(uuid,uuid),public.oce_lot_plan_for_sync(uuid,uuid)
  from public,anon,authenticated;
grant execute on function dao_private.oce_plan_access(uuid,uuid),dao_private.oce_resync_access(uuid,uuid),
  dao_private.oce_save_lot_plan(uuid,uuid,date,date,boolean),dao_private.oce_get_lot_plan(uuid,uuid),
  public.oce_save_lot_plan(uuid,uuid,date,date,boolean),public.oce_get_lot_plan(uuid,uuid),public.oce_resync_access(uuid,uuid) to authenticated,service_role;
grant execute on function dao_private.oce_lot_plan_for_sync(uuid,uuid),public.oce_lot_plan_for_sync(uuid,uuid) to service_role;

commit;
