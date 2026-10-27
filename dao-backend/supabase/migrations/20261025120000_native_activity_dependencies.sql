-- Native activity endpoints for the existing DAO manual dependency graph.
-- This keeps links in DAO-owned planning data and never enqueues OCE synchronization.
begin;

do $$
declare constraint_name text;
begin
  for constraint_name in
    select conname from pg_constraint
    where conrelid='public.project_plan_manual_links'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%pred_target%'
  loop
    execute format('alter table public.project_plan_manual_links drop constraint %I',constraint_name);
  end loop;
end; $$;
alter table public.project_plan_manual_links
  add constraint project_plan_manual_links_pred_target_check
    check (pred_target ~ '^(lot|node|activity):[0-9a-f-]{36}$'),
  add constraint project_plan_manual_links_succ_target_check
    check (succ_target ~ '^(lot|node|activity):[0-9a-f-]{36}$'),
  add constraint project_plan_manual_links_check check (succ_target<>pred_target);

create or replace function dao_private.plan_target_ok(d jsonb,p_target text) returns boolean
language sql stable security definer set search_path='' as $$
  select p_target is not null and (
    exists(select 1 from jsonb_array_elements(d->'lots') x
      where 'lot:'||(x.value->>'id')=p_target and (x.value->>'awarded')::boolean)
    or exists(select 1 from jsonb_array_elements(d->'nodes') x where 'node:'||(x.value->>'id')=p_target)
    or (p_target ~* '^activity:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists(select 1 from public.native_execution_activities a
        join public.award_items ai on ai.id=a.award_item_id and ai.active
        join public.awards aw on aw.id=ai.award_id and aw.status<>'cancelled'
        where 'activity:'||a.id::text=lower(p_target) and a.active
          and exists(select 1 from public.project_requests r,jsonb_array_elements(d->'lots') x
            where r.id=(x.value->>'id')::uuid and r.project_id=ai.project_id))))
$$;

create or replace function dao_private.plan_would_cycle(d jsonb,p_exclude uuid,p_pred text,p_succ text) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare f text[]:='{}'; t text[]:='{}'; e jsonb;
begin
  for e in select value from jsonb_array_elements(d->'links')
    where value->>'state'='effective' and (p_exclude is null or value->>'id'<>p_exclude::text) loop
    f:=f||(e->>'pred_target'); t:=t||(e->>'succ_target');
  end loop;
  -- project_plan_data predates native activities, so include their persisted manual edges directly.
  for e in select jsonb_build_object('pred',m.pred_target,'succ',m.succ_target)
    from public.project_plan_manual_links m
    where (m.pred_target like 'activity:%' or m.succ_target like 'activity:%')
      and (p_exclude is null or m.id<>p_exclude)
      and not exists(select 1 from public.project_plan_manual_link_removals x where x.link_id=m.id)
      and exists(select 1 from public.project_requests r,jsonb_array_elements(d->'lots') x
        where r.id=(x.value->>'id')::uuid and r.project_id=m.project_id) loop
    f:=f||(e->>'pred'); t:=t||(e->>'succ');
  end loop;
  f:=f||p_pred; t:=t||p_succ;
  return dao_private.edges_have_cycle(f,t);
end;
$$;

create or replace function dao_private.add_plan_link(p_project_id uuid,p_pred text,p_succ text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb;
begin
  if not dao_private.project_plan_access(p_project_id) then
    raise exception using errcode='42501',message='Accès au planning du projet refusé';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dao-plan-dependency:'||p_project_id::text,0));
  d:=dao_private.project_plan_data(p_project_id);
  if p_pred=p_succ or p_pred is null or p_succ is null then
    raise exception using errcode='22023',message='Lien invalide';
  end if;
  if not dao_private.plan_target_ok(d,p_pred) or not dao_private.plan_target_ok(d,p_succ) then
    raise exception using errcode='22023',message='Extrémité non planifiée ou non attribuée';
  end if;
  if exists(select 1 from jsonb_array_elements(d->'links') x
       where x.value->>'state'='effective' and x.value->>'pred_target'=p_pred and x.value->>'succ_target'=p_succ)
     or exists(select 1 from public.project_plan_manual_links m
       where m.project_id=p_project_id and m.pred_target=p_pred and m.succ_target=p_succ
         and not exists(select 1 from public.project_plan_manual_link_removals r where r.link_id=m.id)) then
    raise exception using errcode='22023',message='link_duplicate';
  end if;
  if dao_private.plan_would_cycle(d,null,p_pred,p_succ) then
    raise exception using errcode='23514',message='dependency_cycle';
  end if;
  insert into public.project_plan_manual_links(project_id,pred_target,succ_target,created_by)
    values(p_project_id,p_pred,p_succ,auth.uid());
  return dao_private.get_project_plan(p_project_id);
end;
$$;

create or replace function dao_private.replace_plan_link(p_project_id uuid,p_link_id uuid,p_pred text,p_succ text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; l jsonb;
begin
  if not dao_private.project_plan_access(p_project_id) then
    raise exception using errcode='42501',message='Accès au planning du projet refusé';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dao-plan-dependency:'||p_project_id::text,0));
  d:=dao_private.project_plan_data(p_project_id);
  select value into l from jsonb_array_elements(d->'links') where value->>'id'=p_link_id::text;
  if l is null or l->>'state'='rejected' then raise exception using errcode='22023',message='Lien inconnu ou déjà retiré'; end if;
  if p_pred=p_succ or p_pred is null or p_succ is null then raise exception using errcode='22023',message='Lien invalide'; end if;
  if not dao_private.plan_target_ok(d,p_pred) or not dao_private.plan_target_ok(d,p_succ) then
    raise exception using errcode='22023',message='Extrémité non planifiée ou non attribuée';
  end if;
  if exists(select 1 from jsonb_array_elements(d->'links') x where x.value->>'state'='effective'
       and x.value->>'id'<>p_link_id::text and x.value->>'pred_target'=p_pred and x.value->>'succ_target'=p_succ)
     or exists(select 1 from public.project_plan_manual_links m where m.project_id=p_project_id
       and m.pred_target=p_pred and m.succ_target=p_succ and m.id<>p_link_id
       and not exists(select 1 from public.project_plan_manual_link_removals r where r.link_id=m.id)) then
    raise exception using errcode='22023',message='link_duplicate';
  end if;
  if dao_private.plan_would_cycle(d,p_link_id,p_pred,p_succ) then
    raise exception using errcode='23514',message='dependency_cycle';
  end if;
  perform dao_private.plan_drop_link(p_project_id,p_link_id,(l->>'manual')::boolean);
  insert into public.project_plan_manual_links(project_id,pred_target,succ_target,created_by)
    values(p_project_id,p_pred,p_succ,auth.uid());
  return dao_private.get_project_plan(p_project_id);
end;
$$;

create or replace function dao_private.decide_plan_link(p_project_id uuid,p_link_id uuid,p_decision text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d jsonb; l jsonb;
begin
  if not dao_private.project_plan_access(p_project_id) then
    raise exception using errcode='42501',message='Accès au planning du projet refusé';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('dao-plan-dependency:'||p_project_id::text,0));
  if p_decision not in ('confirmed','rejected') then raise exception using errcode='22023',message='Décision invalide'; end if;
  d:=dao_private.project_plan_data(p_project_id);
  select value into l from jsonb_array_elements(d->'links')
    where value->>'id'=p_link_id::text and (value->>'manual')::boolean is not true;
  if l is null then raise exception using errcode='22023',message='Lien inconnu ou lot non attribué'; end if;
  if p_decision='confirmed' then
    if l->>'pred_target' is null or l->>'succ_target' is null then
      raise exception using errcode='22023',message='Lien non résolu : les deux extrémités doivent être attribuées et planifiées';
    end if;
    if dao_private.plan_would_cycle(d,p_link_id,l->>'pred_target',l->>'succ_target') then
      raise exception using errcode='23514',message='dependency_cycle';
    end if;
  end if;
  insert into public.project_plan_link_decisions(project_id,link_id,decision,decided_by)
    values(p_project_id,p_link_id,p_decision,auth.uid());
  return dao_private.get_project_plan(p_project_id);
end;
$$;

create or replace function dao_private.native_dependency_endpoint_award_item(p_project_id uuid,p_target text)
returns uuid language sql stable security definer set search_path='' as $$
  select ai.id from public.award_items ai
  join public.awards aw on aw.id=ai.award_id and aw.status<>'cancelled'
  where ai.project_id=p_project_id and ai.active and (
    (p_target ~* '^lot:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and ai.request_id=(substring(p_target from 5))::uuid)
    or (p_target ~* '^activity:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists(select 1 from public.native_execution_activities a
        where a.id=(substring(p_target from 10))::uuid and a.award_item_id=ai.id and a.active))
    or (p_target ~* '^node:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists(select 1 from public.bid_sub_lots s join public.bid_items bi on bi.id=s.bid_item_id
        where s.id=(substring(p_target from 6))::uuid and bi.id=ai.bid_item_id))
  ) order by ai.id limit 1;
$$;

create or replace function dao_private.native_execution_dependencies_v1(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then
    raise exception using errcode='42501',message='active authentication required';
  end if;
  if not exists(select 1 from public.award_items ai where ai.project_id=p_project_id and ai.active
    and dao_private.site_can_read_award_item(ai.id)) then
    if not exists(select 1 from public.projects p where p.id=p_project_id and dao_private.owner(p.id)) then
      raise exception using errcode='42501',message='project tracking access required';
    end if;
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'from',m.pred_target,'to',m.succ_target,
      'state','effective','relation','FS','lagDays',0,'source','manual') order by m.created_at,m.id)
    from public.project_plan_manual_links m
    cross join lateral (select dao_private.native_dependency_endpoint_award_item(p_project_id,m.pred_target) as id) p
    cross join lateral (select dao_private.native_dependency_endpoint_award_item(p_project_id,m.succ_target) as id) s
    where m.project_id=p_project_id and (m.pred_target like 'activity:%' or m.succ_target like 'activity:%')
      and p.id is not null and s.id is not null
      and dao_private.site_can_read_award_item(p.id) and dao_private.site_can_read_award_item(s.id)
      and not exists(select 1 from public.project_plan_manual_link_removals x where x.link_id=m.id)), '[]'::jsonb);
end; $$;

create or replace function public.native_execution_dependencies_v1(p_project_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select dao_private.native_execution_dependencies_v1($1);
$$;

revoke all on function dao_private.plan_target_ok(jsonb,text),dao_private.plan_would_cycle(jsonb,uuid,text,text),
  dao_private.native_dependency_endpoint_award_item(uuid,text),dao_private.native_execution_dependencies_v1(uuid),
  dao_private.add_plan_link(uuid,text,text),
  dao_private.replace_plan_link(uuid,uuid,text,text),dao_private.decide_plan_link(uuid,uuid,text),
  public.native_execution_dependencies_v1(uuid) from public,anon,authenticated;
grant execute on function public.native_execution_dependencies_v1(uuid) to authenticated;
grant execute on function dao_private.add_plan_link(uuid,text,text) to authenticated,service_role;
grant execute on function dao_private.replace_plan_link(uuid,uuid,text,text),dao_private.decide_plan_link(uuid,uuid,text) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
