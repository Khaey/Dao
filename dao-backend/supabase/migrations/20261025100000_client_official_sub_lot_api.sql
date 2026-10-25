-- P10 DEV3: versioned Client-owned official sub-lots before lot publication.
-- Existing snapshots stay immutable; each replacement creates a new request version.
begin;

create or replace function dao_private.copy_client_sub_lots() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if current_setting('dao.skip_client_sub_lot_copy',true)='on' then return NEW; end if;
  if auth.uid() is not null and not dao_private.staff() then
    insert into public.request_sub_lot_versions(sub_lot_id,request_id,project_id,request_version_id,ordinal,title,scope,budget_millimes)
      select s.sub_lot_id,s.request_id,s.project_id,NEW.id,s.ordinal,s.title,s.scope,s.budget_millimes
      from public.request_sub_lot_versions s
      where s.request_version_id=(select id from public.project_request_versions
        where request_id=NEW.request_id and version_no<NEW.version_no order by version_no desc limit 1);
  end if;
  return NEW;
end; $$;

create or replace function dao_private.native_request_sub_lots_v1(p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_project_id uuid; v_version public.project_request_versions; v_project_status text;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then
    raise exception using errcode='42501',message='active authentication required';
  end if;
  select r.project_id,p.status into v_project_id,v_project_status
    from public.project_requests r join public.projects p on p.id=r.project_id where r.id=p_request_id;
  if v_project_id is null then raise exception using errcode='P0002',message='request not found'; end if;
  if not dao_private.owner(v_project_id) then raise exception using errcode='42501',message='project owner required'; end if;
  select rv.* into v_version from public.project_request_versions rv
    where rv.request_id=p_request_id order by rv.version_no desc limit 1;
  if v_version.id is null then raise exception using errcode='P0002',message='request version not found'; end if;
  return jsonb_build_object(
    'projectId',v_project_id,'requestId',p_request_id,'requestVersionId',v_version.id,
    'requestVersion',v_version.version_no,'canEdit',
    v_project_status='draft'
      and exists(select 1 from public.project_versions pv where pv.project_id=v_project_id and pv.status='draft')
      and not exists(select 1 from public.publication_requests pr join public.project_request_versions x on x.id=pr.request_version_id where x.request_id=p_request_id)
      and not exists(select 1 from public.award_items ai where ai.request_id=p_request_id and ai.active),
    'items',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',s.sub_lot_id,'title',s.title,'scope',s.scope,'budgetMillimes',s.budget_millimes::text
    ) order by s.ordinal,s.sub_lot_id),'[]'::jsonb)
      from public.request_sub_lot_versions s where s.request_version_id=v_version.id)
  );
end; $$;

create or replace function public.native_request_sub_lots_v1(p_request_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select dao_private.native_request_sub_lots_v1($1);
$$;

create or replace function dao_private.replace_client_request_sub_lots_v1(
  p_request_id uuid,p_expected_request_version_id uuid,p_items jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_request public.project_requests; v_project public.projects; v_project_version public.project_versions;
  v_previous public.project_request_versions; v_next public.project_request_versions;
  v_item jsonb; v_id uuid; v_seen uuid[]:='{}'; v_ids uuid[]:='{}'; v_ordinal integer:=0;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then
    raise exception using errcode='42501',message='active authentication required';
  end if;
  if p_request_id is null or p_expected_request_version_id is null or p_items is null
     or jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items)>100 then
    raise exception using errcode='22023',message='invalid sub-lot replacement';
  end if;
  select * into v_request from public.project_requests where id=p_request_id for update;
  if v_request.id is null then raise exception using errcode='P0002',message='request not found'; end if;
  if not dao_private.owner(v_request.project_id) then raise exception using errcode='42501',message='project owner required'; end if;
  select * into v_project from public.projects where id=v_request.project_id for update;
  if v_project.status<>'draft' or v_request.status<>'open' then raise exception using errcode='23514',message='project/request is not editable'; end if;
  select * into v_project_version from public.project_versions where project_id=v_project.id and status='draft' order by version_no desc limit 1 for update;
  if v_project_version.id is null then raise exception using errcode='23514',message='draft project version required'; end if;
  if exists(select 1 from public.publication_requests pr join public.project_request_versions x on x.id=pr.request_version_id where x.request_id=p_request_id)
     or exists(select 1 from public.award_items ai where ai.request_id=p_request_id and ai.active) then
    raise exception using errcode='23514',message='published or awarded lots cannot change official sub-lots';
  end if;
  select rv.* into v_previous from public.project_version_requests l
    join public.project_request_versions rv on rv.id=l.request_version_id
    where l.project_version_id=v_project_version.id and rv.request_id=p_request_id for update of rv;
  if v_previous.id is null or v_previous.id<>p_expected_request_version_id then
    raise exception using errcode='40001',message='request version changed';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item)<>'object'
      or (v_item - array['id','title','scope','budgetMillimes'])<>'{}'::jsonb
      or jsonb_typeof(v_item->'title') is distinct from 'string' or length(btrim(v_item->>'title')) not between 1 and 200
      or jsonb_typeof(v_item->'scope') is distinct from 'string' or length(btrim(v_item->>'scope')) not between 1 and 10000
      or (v_item ? 'budgetMillimes' and v_item->'budgetMillimes'<>'null'::jsonb
          and (jsonb_typeof(v_item->'budgetMillimes') is distinct from 'string' or v_item->>'budgetMillimes' !~ '^[0-9]{1,18}$'))
      or (nullif(v_item->>'id','') is not null and v_item->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception using errcode='22023',message='invalid sub-lot item';
    end if;
    if nullif(v_item->>'id','') is not null then
      v_id:=(v_item->>'id')::uuid;
      if v_id=any(v_seen) or not exists(select 1 from public.request_sub_lots s where s.id=v_id and s.request_id=p_request_id and s.project_id=v_project.id) then
        raise exception using errcode='22023',message='unknown or duplicate sub-lot id';
      end if;
    else
      insert into public.request_sub_lots(request_id,project_id) values(p_request_id,v_project.id) returning id into v_id;
    end if;
    v_seen:=array_append(v_seen,v_id);
    v_ids:=array_append(v_ids,v_id);
    v_ordinal:=v_ordinal+1;
  end loop;

  perform set_config('dao.skip_client_sub_lot_copy','on',true);
  insert into public.project_request_versions(request_id,project_id,version_no,trade_id,title,scope,budget_millimes)
  values(v_previous.request_id,v_previous.project_id,
    (select coalesce(max(version_no),0)+1 from public.project_request_versions where request_id=p_request_id),v_previous.trade_id,
    v_previous.title,v_previous.scope,v_previous.budget_millimes) returning * into v_next;

  v_ordinal:=0;
  for v_item in select value from jsonb_array_elements(p_items) loop
    v_ordinal:=v_ordinal+1;
    v_id:=v_ids[v_ordinal];
    insert into public.request_sub_lot_versions(sub_lot_id,request_id,project_id,request_version_id,ordinal,title,scope,budget_millimes)
    values(v_id,p_request_id,v_project.id,v_next.id,v_ordinal-1,btrim(v_item->>'title'),btrim(v_item->>'scope'),
      case when v_item->'budgetMillimes' is null or v_item->'budgetMillimes'='null'::jsonb then null else (v_item->>'budgetMillimes')::bigint end);
  end loop;

  delete from public.project_version_requests where project_version_id=v_project_version.id and request_version_id=v_previous.id;
  insert into public.project_version_requests(project_id,project_version_id,request_version_id)
    values(v_project.id,v_project_version.id,v_next.id);
  return dao_private.native_request_sub_lots_v1(p_request_id);
end; $$;

create or replace function public.replace_client_request_sub_lots_v1(
  p_request_id uuid,p_expected_request_version_id uuid,p_items jsonb
) returns jsonb language sql security definer set search_path='' as $$
  select dao_private.replace_client_request_sub_lots_v1($1,$2,$3);
$$;

revoke all on function dao_private.native_request_sub_lots_v1(uuid),
  public.native_request_sub_lots_v1(uuid),
  dao_private.replace_client_request_sub_lots_v1(uuid,uuid,jsonb),
  public.replace_client_request_sub_lots_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.native_request_sub_lots_v1(uuid),
  public.replace_client_request_sub_lots_v1(uuid,uuid,jsonb) to authenticated;

commit;
