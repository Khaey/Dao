-- P13 corrections: native tracking is restricted to an assigned DAO reviewer,
-- manual links are projected after reload for every supported endpoint, and
-- sub-lot durations are derived from the dates supplied by the contractor.
begin;

create or replace function dao_private.native_execution_manager_access(p_project_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select dao_private.account_active(auth.uid())
    and dao_private.staff()
    and exists (
      select 1 from public.review_assignments a
      where a.project_id=p_project_id and a.reviewer_id=auth.uid()
    );
$$;

-- Keep the back-office Admin authority intact, but allow the native projection
-- wrapper to opt into the stricter assigned-reviewer rule.
create or replace function dao_private.manages_project(p_project_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select case when current_setting('dao.native_tracking_scope', true)='assigned'
    then dao_private.native_execution_manager_access(p_project_id)
    else dao_private.admin() or (dao_private.staff() and exists(
      select 1 from public.review_assignments
      where project_id=p_project_id and reviewer_id=auth.uid()))
  end;
$$;

create or replace function public.native_execution_plan_v1(
  p_project_id uuid,p_after_request_id uuid default null,p_limit integer default 50
) returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb;
begin
  perform set_config('dao.native_tracking_scope','assigned',true);
  base:=dao_private.native_execution_plan_v1(p_project_id,p_after_request_id,p_limit);
  base:=dao_private.native_execution_activity_overlay(p_project_id,base);
  base:=dao_private.native_execution_installment_scope_overlay(base);
  return dao_private.native_execution_activity_event_overlay(base);
end;
$$;

-- A manager can read the native dependency projection only when assigned to
-- the dossier. Site-party visibility remains unchanged for Client/Artisan.
create or replace function dao_private.native_execution_dependencies_v1(p_project_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then
    raise exception using errcode='42501',message='active authentication required';
  end if;
  if not dao_private.native_execution_manager_access(p_project_id)
     and not exists(select 1 from public.award_items ai where ai.project_id=p_project_id and ai.active
       and dao_private.site_can_read_award_item(ai.id))
     and not exists(select 1 from public.projects p where p.id=p_project_id and dao_private.owner(p.id)) then
    raise exception using errcode='42501',message='project tracking access required';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'from',m.pred_target,'to',m.succ_target,
      'state','effective','relation','FS','lagDays',0,'source','manual') order by m.created_at,m.id)
    from public.project_plan_manual_links m
    cross join lateral (select dao_private.native_dependency_endpoint_award_item(p_project_id,m.pred_target) as id) p
    cross join lateral (select dao_private.native_dependency_endpoint_award_item(p_project_id,m.succ_target) as id) s
    where m.project_id=p_project_id
      and p.id is not null and s.id is not null
      and (dao_private.native_execution_manager_access(p_project_id)
        or (dao_private.site_can_read_award_item(p.id) and dao_private.site_can_read_award_item(s.id)))
      and not exists(select 1 from public.project_plan_manual_link_removals x where x.link_id=m.id)), '[]'::jsonb);
end; $$;

-- Dates remain the contractor's source of truth; duration is never allowed to
-- drift from the inclusive date interval during a replace operation.
create or replace function dao_private.replace_bid_sub_lots(p_bid_item_id uuid,p_sub_lots jsonb)
returns setof public.bid_sub_lots
language plpgsql security definer set search_path='' as $$
declare v_item public.bid_items; entry jsonb; pos integer:=0; n integer; v_key uuid; v_start date; v_end date; v_days integer;
  v_budget bigint; v_official uuid; v_sum bigint:=0;
begin
  if jsonb_typeof(p_sub_lots)<>'array' then raise exception using errcode='22023',message='sub-lots must be an array'; end if;
  n:=jsonb_array_length(p_sub_lots); if n>100 then raise exception using errcode='22023',message='too many sub-lots'; end if;
  select bi.* into v_item from public.bid_items bi join public.bid_versions bv on bv.id=bi.bid_version_id
    where bi.id=p_bid_item_id and bv.status='draft' and bv.submitted_at is null and dao_private.pro(bv.contractor_id) for update of bv;
  if v_item.id is null then raise exception using errcode='42501',message='bid item is not an owned draft'; end if;
  delete from public.bid_sub_lots where bid_item_id=v_item.id;
  for entry in select value from jsonb_array_elements(p_sub_lots) loop
    pos:=pos+1;
    begin
      v_key:=coalesce(nullif(entry->>'node_key','')::uuid,gen_random_uuid());
      v_start:=nullif(entry->>'start_date','')::date; v_end:=nullif(entry->>'end_date','')::date;
      if (v_start is null) <> (v_end is null) or (v_end is not null and v_end<v_start) then
        raise exception using errcode='23514',message='invalid sub-lot dates';
      end if;
      if v_start is null then v_days:=null;
      else
        v_days:=(v_end-v_start)+1;
        if nullif(entry->>'duration_days','') is not null
           and (entry->>'duration_days')::integer<>v_days then
          raise exception using errcode='23514',message='invalid sub-lot dates';
        end if;
      end if;
      v_budget:=nullif(entry->>'budget_millimes','')::bigint; v_official:=nullif(entry->>'official_sub_lot_id','')::uuid;
    exception when others then
      if sqlstate in ('22023','23514') then raise; else raise exception using errcode='22023',message='invalid sub-lot field'; end if;
    end;
    v_sum:=v_sum+coalesce(v_budget,0);
    insert into public.bid_sub_lots(bid_version_id,bid_item_id,project_id,request_id,contractor_id,node_key,position,title,scope,
      start_date,end_date,duration_days,budget_millimes,official_sub_lot_id)
    values(v_item.bid_version_id,v_item.id,v_item.project_id,v_item.request_id,v_item.contractor_id,v_key,pos,trim(entry->>'title'),
      nullif(trim(coalesce(entry->>'scope','')),''),v_start,v_end,v_days,v_budget,v_official);
  end loop;
  if v_sum>v_item.price_millimes then raise exception using errcode='23514',message='sub_lot_budget_exceeds_price'; end if;
  delete from public.bid_sub_lot_links l where l.bid_version_id=v_item.bid_version_id and (
    (l.pred_kind='proposal' and not exists(select 1 from public.bid_sub_lots s where s.bid_version_id=l.bid_version_id and s.node_key=l.pred_ref))
    or (l.succ_kind='proposal' and not exists(select 1 from public.bid_sub_lots s where s.bid_version_id=l.bid_version_id and s.node_key=l.succ_ref)));
  return query select * from public.bid_sub_lots where bid_item_id=v_item.id order by position;
end $$;

revoke all on function dao_private.native_execution_manager_access(uuid) from public,anon,authenticated;
grant execute on function dao_private.native_execution_manager_access(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
