begin;

-- Native technical situations are quantity-only. This schema has no payable
-- amount, debt, invoice, payment, guarantee, or ledger field.
create table public.site_work_situations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project_id uuid not null references public.projects,
  contractor_id uuid not null references public.contractor_profiles,
  created_by uuid not null references auth.users,
  period_start date not null,
  period_end date not null,
  status text not null check(status in ('draft','submitted','under_review','revision_requested','validated_technical','contested','withdrawn')),
  revision integer not null default 1 check(revision>0),
  lines jsonb not null check(jsonb_typeof(lines)='array' and jsonb_array_length(lines) between 1 and 100),
  idempotency_key text not null check(length(idempotency_key) between 8 and 100),
  command_payload jsonb not null,
  unique(created_by,idempotency_key),
  unique(id,project_id,contractor_id),
  check(period_end>=period_start)
);
create index site_work_situations_project_page_idx on public.site_work_situations(project_id,created_at desc,id desc);
create index site_work_situations_contractor_period_idx on public.site_work_situations(project_id,contractor_id,period_start,period_end,status);

create table public.site_work_situation_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  situation_id uuid not null,
  project_id uuid not null references public.projects,
  contractor_id uuid not null references public.contractor_profiles,
  actor_id uuid not null references auth.users,
  actor_role text not null check(actor_role in ('client','contractor','manager')),
  revision integer not null check(revision>0),
  event_kind text not null check(event_kind in ('created','draft_saved','submitted','review_started','revision_requested','quantities_validated','contested','manager_suggestion','withdrawn')),
  status_after text not null check(status_after in ('draft','submitted','under_review','revision_requested','validated_technical','contested','withdrawn')),
  note text,
  idempotency_key text not null check(length(idempotency_key) between 8 and 100),
  command_payload jsonb not null,
  unique(situation_id,revision),
  unique(actor_id,idempotency_key),
  unique(id,project_id,contractor_id),
  foreign key(situation_id,project_id,contractor_id) references public.site_work_situations(id,project_id,contractor_id),
  check(note is null or length(btrim(note)) between 1 and 2000)
);
create index site_work_situation_events_page_idx on public.site_work_situation_events(situation_id,created_at desc,id desc);

create function dao_private.site_work_situation_actor_role(p_project_id uuid,p_contractor_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select case when dao_private.site_client_project(p_project_id) then 'client'
    when dao_private.manages_project(p_project_id) then 'manager'
    when dao_private.site_actor_workspace('contractor') and exists(
      select 1 from public.contractor_profiles cp where (p_contractor_id is null or cp.id=p_contractor_id) and cp.user_id=auth.uid()
        and cp.verification_status<>'suspended' and exists(select 1 from public.award_items ai
          where ai.project_id=p_project_id and ai.contractor_id=cp.id)
    ) then 'contractor' else null end;
$$;
create function dao_private.site_work_situation_can_read(p_situation_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and dao_private.account_active(auth.uid()) and exists(
    select 1 from public.site_work_situations s join public.projects p on p.id=s.project_id and p.status<>'archived'
    where s.id=p_situation_id and dao_private.site_work_situation_actor_role(s.project_id,s.contractor_id) is not null);
$$;

create function dao_private.site_work_situation_validate_lines(p_project uuid,p_contractor uuid,p_lines jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_line_json jsonb; ai public.award_items; ql public.bid_quote_lines; v_award_item_id uuid; v_quote_line_id uuid;
  label_value text; unit_value text; qty bigint; sources uuid[]; docs uuid[]; n integer; total numeric; cleaned jsonb:='[]'::jsonb;
begin
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines) not between 1 and 100 then
    raise exception using errcode='22023',message='Situation lines are invalid'; end if;
  for v_line_json in select value from jsonb_array_elements(p_lines) loop
    v_award_item_id:=nullif(v_line_json->>'awardItemId','')::uuid; v_quote_line_id:=nullif(v_line_json->>'quoteLineId','')::uuid;
    label_value:=nullif(btrim(v_line_json->>'label'),''); unit_value:=nullif(btrim(v_line_json->>'quantityUnit'),'');
    qty:=nullif(v_line_json->>'quantityReportedMilli','')::bigint;
    if (v_line_json->>'lineId') is null or (v_line_json->>'lineId')::uuid is null or v_award_item_id is null
      or label_value is null or length(label_value)>240 or unit_value is null or length(unit_value)>40
      or qty is null or qty not between 1 and 1000000000000 then
      raise exception using errcode='22023',message='Situation line is invalid'; end if;
    select z.* into ai from public.award_items z join public.awards a on a.id=z.award_id
      where z.id=v_award_item_id and z.project_id=p_project and z.contractor_id=p_contractor and z.active and a.status<>'cancelled';
    if ai.id is null then raise exception using errcode='42501',message='Awarded lot unavailable'; end if;
    if v_quote_line_id is not null then
      select * into ql from public.bid_quote_lines where id=v_quote_line_id and bid_item_id=ai.bid_item_id;
      if ql.id is null or ql.unit<>unit_value then raise exception using errcode='42501',message='Quote line outside awarded lot'; end if;
      label_value:=ql.designation;
    end if;
    if jsonb_typeof(coalesce(v_line_json->'sourceEventIds','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(v_line_json->'sourceEventIds','[]'::jsonb))>20
      or jsonb_typeof(coalesce(v_line_json->'evidenceDocumentIds','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(v_line_json->'evidenceDocumentIds','[]'::jsonb))>10 then
      raise exception using errcode='22023',message='Situation references are invalid'; end if;
    select coalesce(array_agg(v::uuid),'{}'::uuid[]) into sources from jsonb_array_elements_text(coalesce(v_line_json->'sourceEventIds','[]'::jsonb)) v;
    select coalesce(array_agg(v::uuid),'{}'::uuid[]) into docs from jsonb_array_elements_text(coalesce(v_line_json->'evidenceDocumentIds','[]'::jsonb)) v;
    select count(distinct v) into n from unnest(sources) v;
    if n<>cardinality(sources) then raise exception using errcode='22023',message='Duplicate source event'; end if;
    select count(distinct v) into n from unnest(docs) v;
    if n<>cardinality(docs) then raise exception using errcode='22023',message='Duplicate evidence document'; end if;
    if cardinality(sources)>0 then
      select sum(e.executed_quantity_milli)::numeric,count(*) into total,n from public.site_log_events e
      where e.id=any(sources) and e.project_id=p_project and e.award_item_id=v_award_item_id and e.event_kind='intervention'
        and e.executed_quantity_milli is not null and e.quantity_unit=unit_value and (v_quote_line_id is null or e.quote_line_id=v_quote_line_id);
      if n<>cardinality(sources) or total<>qty then raise exception using errcode='22023',message='Quantity differs from source events'; end if;
    end if;
    if cardinality(docs)>0 then
      select count(*) into n from public.documents d where d.id=any(docs) and d.project_id=p_project
        and d.owner_id=auth.uid() and d.status='approved' and d.share_scope='project_members';
      if n<>cardinality(docs) then raise exception using errcode='42501',message='Evidence document is not authorized'; end if;
    end if;
    cleaned:=cleaned||jsonb_build_array(jsonb_build_object('lineId',(v_line_json->>'lineId')::uuid,'awardItemId',ai.id,
      'requestId',ai.request_id,'quoteLineId',v_quote_line_id,'label',label_value,'quantityUnit',unit_value,
      'quantityReportedMilli',qty::text,'quantityValidatedMilli',null,'sourceEventIds',to_jsonb(sources),'evidenceDocumentIds',to_jsonb(docs)));
  end loop;
  if (select count(distinct v->>'lineId') from jsonb_array_elements(cleaned) v)<>jsonb_array_length(cleaned)
    or (select count(distinct concat_ws('|',v->>'awardItemId',coalesce(v->>'quoteLineId',''),lower(v->>'label')))
      from jsonb_array_elements(cleaned) v)<>jsonb_array_length(cleaned)
    or exists(select 1 from jsonb_array_elements(cleaned) x
      cross join lateral jsonb_array_elements_text(x->'sourceEventIds') src(value)
      group by src.value having count(*)>1) then
    raise exception using errcode='22023',message='Duplicate situation line'; end if;
  return cleaned;
end;
$$;

create function dao_private.site_work_situation_command_v1(
  p_action text,p_situation_id uuid,p_project_id uuid,p_contractor_id uuid,p_period_start date,p_period_end date,
  p_lines jsonb,p_validated_lines jsonb,p_note text,p_expected_revision integer,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); role_value text; s public.site_work_situations; ev public.site_work_situation_events;
  event_id uuid; new_status text; kind_value text; payload jsonb; next_revision integer; row_value jsonb;
  line_id uuid; qty bigint; count_lines integer; count_matches integer; next_lines jsonb;
begin
  if actor is null or not dao_private.account_active(actor) or p_action not in
    ('create','save_draft','submit','start_review','request_revision','validate_technical','contest','manager_suggestion','withdraw')
    or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 100
    or (p_note is not null and length(btrim(p_note)) not between 1 and 2000) then
    raise exception using errcode='22023',message='Invalid work situation command'; end if;
  if p_action='create' then
    role_value:=dao_private.site_work_situation_actor_role(p_project_id,p_contractor_id);
    if role_value is null or role_value not in ('contractor','manager')
      or not exists(select 1 from public.projects p where p.id=p_project_id and p.status<>'archived')
      or p_period_start is null or p_period_end is null or p_period_end<p_period_start then
      raise exception using errcode='42501',message='Work situation access denied'; end if;
    payload:=jsonb_build_object('action',p_action,'projectId',p_project_id,'contractorId',p_contractor_id,
      'periodStart',p_period_start,'periodEnd',p_period_end,'lines',p_lines);
    perform pg_advisory_xact_lock(hashtextextended(actor::text||':work-situation:'||p_idempotency_key,0));
    select * into s from public.site_work_situations where created_by=actor and idempotency_key=p_idempotency_key;
    if s.id is not null then
      if s.command_payload is distinct from payload then raise exception using errcode='22023',message='Idempotency key reused'; end if;
      return jsonb_build_object('situationId',s.id,'status',s.status,'revision',s.revision); end if;
    perform pg_advisory_xact_lock(hashtextextended(p_project_id::text||':'||p_contractor_id::text||':work-situation-period',0));
    if exists(select 1 from public.site_work_situations existing where existing.project_id=p_project_id
      and existing.contractor_id=p_contractor_id and existing.status<>'withdrawn'
      and daterange(existing.period_start,existing.period_end,'[]') && daterange(p_period_start,p_period_end,'[]')) then
      raise exception using errcode='23505',message='A work situation already covers this period'; end if;
    next_lines:=dao_private.site_work_situation_validate_lines(p_project_id,p_contractor_id,p_lines);
    insert into public.site_work_situations(project_id,contractor_id,created_by,period_start,period_end,status,revision,lines,idempotency_key,command_payload)
    values(p_project_id,p_contractor_id,actor,p_period_start,p_period_end,'draft',1,next_lines,p_idempotency_key,payload) returning * into s;
    insert into public.site_work_situation_events(situation_id,project_id,contractor_id,actor_id,actor_role,revision,event_kind,status_after,idempotency_key,command_payload)
    values(s.id,p_project_id,p_contractor_id,actor,role_value,1,'created','draft',p_idempotency_key,payload) returning id into event_id;
    return jsonb_build_object('situationId',s.id,'eventId',event_id,'status','draft','revision',1);
  end if;
  select * into s from public.site_work_situations where id=p_situation_id for update;
  if s.id is null then raise exception using errcode='42501',message='Work situation unavailable'; end if;
  role_value:=dao_private.site_work_situation_actor_role(s.project_id,s.contractor_id);
  if role_value is null then raise exception using errcode='42501',message='Work situation access denied'; end if;
  payload:=jsonb_build_object('action',p_action,'situationId',p_situation_id,'lines',p_lines,'validatedLines',case when p_action='validate_technical' then p_validated_lines else null end,'suggestedLines',case when p_action='manager_suggestion' then p_validated_lines else null end,
    'note',nullif(btrim(coalesce(p_note,'')),''),'expectedRevision',p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':work-situation-command:'||p_idempotency_key,0));
  select * into ev from public.site_work_situation_events where actor_id=actor and idempotency_key=p_idempotency_key;
  if ev.id is not null then
    if ev.situation_id<>s.id or ev.command_payload is distinct from payload then raise exception using errcode='22023',message='Idempotency key reused'; end if;
    return jsonb_build_object('situationId',s.id,'eventId',ev.id,'status',ev.status_after,'revision',ev.revision); end if;
  if p_expected_revision is null or p_expected_revision<>s.revision then raise exception using errcode='40001',message='Work situation revision changed'; end if;
  if role_value='contractor' and p_action<>'contest' and not exists(select 1 from public.award_items ai join public.awards a on a.id=ai.award_id
    where ai.project_id=s.project_id and ai.contractor_id=s.contractor_id and ai.active and a.status<>'cancelled') then
    raise exception using errcode='42501',message='Active awarded lot required'; end if;
  if p_action in ('save_draft','submit','withdraw') and role_value not in ('contractor','manager') then raise exception using errcode='42501',message='Contractor or manager action required'; end if;
  if p_action='save_draft' then
    if s.status not in ('draft','revision_requested','contested') then raise exception using errcode='40001',message='Situation is not editable'; end if;
    next_lines:=dao_private.site_work_situation_validate_lines(s.project_id,s.contractor_id,p_lines);
    new_status:='draft'; kind_value:='draft_saved';
  elsif p_action='submit' then
    if role_value<>'contractor' or s.status not in ('draft','revision_requested') then raise exception using errcode='42501',message='Only awarded contractor may submit'; end if;
    new_status:='submitted'; kind_value:='submitted';
  elsif p_action='start_review' then
    if role_value not in ('client','manager') or s.status<>'submitted' then raise exception using errcode='42501',message='Review access denied'; end if;
    new_status:='under_review'; kind_value:='review_started';
  elsif p_action='request_revision' then
    if role_value<>'client' or s.status not in ('submitted','under_review','contested','validated_technical') or p_note is null then raise exception using errcode='42501',message='Client revision request required'; end if;
    new_status:='revision_requested'; kind_value:='revision_requested';
  elsif p_action in ('validate_technical','manager_suggestion') then
    if jsonb_typeof(p_validated_lines)<>'array' then raise exception using errcode='22023',message='Quantity decisions are invalid'; end if;
    if p_action='validate_technical' and (role_value<>'client' or s.status<>'under_review') then raise exception using errcode='42501',message='Client technical validation required'; end if;
    if p_action='manager_suggestion' and (role_value<>'manager' or s.status not in ('submitted','under_review','contested')) then raise exception using errcode='42501',message='Manager suggestion unavailable'; end if;
    select count(*) into count_lines from jsonb_array_elements(s.lines);
    select count(*) into count_matches from jsonb_array_elements(p_validated_lines) v
      join jsonb_array_elements(s.lines) l on l->>'lineId'=v->>'lineId';
    if (select count(distinct v->>'lineId') from jsonb_array_elements(p_validated_lines) v)<>jsonb_array_length(p_validated_lines)
      or (p_action='validate_technical' and jsonb_array_length(p_validated_lines)<>count_lines)
      or jsonb_array_length(p_validated_lines)<1 or jsonb_array_length(p_validated_lines)>count_lines or count_matches<>jsonb_array_length(p_validated_lines) then
      raise exception using errcode='22023',message='Quantity decisions do not match situation lines'; end if;
    for row_value in select value from jsonb_array_elements(p_validated_lines) loop
      line_id:=(row_value->>'lineId')::uuid; qty:=(row_value->>'quantityValidatedMilli')::bigint;
      if qty is null or qty not between 0 and 1000000000000 then raise exception using errcode='22023',message='Validated quantity is invalid'; end if;
    end loop;
    if p_action='validate_technical' then
      select jsonb_agg(case when v.value->>'lineId'=l.value->>'lineId' then l.value||jsonb_build_object('quantityValidatedMilli',v.value->>'quantityValidatedMilli') else l.value end order by l.ordinality)
        into next_lines from jsonb_array_elements(s.lines) with ordinality l(value,ordinality)
        left join lateral (select value from jsonb_array_elements(p_validated_lines) where value->>'lineId'=l.value->>'lineId') v on true;
      new_status:='validated_technical'; kind_value:='quantities_validated';
    else new_status:=s.status; kind_value:='manager_suggestion'; end if;
  elsif p_action='contest' then
    if role_value not in ('client','contractor') or s.status not in ('under_review','validated_technical') or p_note is null then raise exception using errcode='42501',message='Party contest required'; end if;
    new_status:='contested'; kind_value:='contested';
  elsif p_action='withdraw' then
    if role_value<>'contractor' or s.status not in ('draft','submitted','revision_requested','contested') then raise exception using errcode='42501',message='Withdrawal unavailable'; end if;
    new_status:='withdrawn'; kind_value:='withdrawn';
  end if;
  next_revision:=s.revision+1;
  update public.site_work_situations set status=new_status,revision=next_revision,updated_at=now(),
    lines=coalesce(next_lines,s.lines) where id=s.id;
  insert into public.site_work_situation_events(situation_id,project_id,contractor_id,actor_id,actor_role,revision,event_kind,status_after,note,idempotency_key,command_payload)
  values(s.id,s.project_id,s.contractor_id,actor,role_value,next_revision,kind_value,new_status,nullif(btrim(coalesce(p_note,'')),''),p_idempotency_key,payload)
  returning id into event_id;
  return jsonb_build_object('situationId',s.id,'eventId',event_id,'status',new_status,'revision',next_revision);
end;
$$;

create function dao_private.native_work_situations_v1(p_project_id uuid,p_situation_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare n integer:=least(greatest(coalesce(p_limit,30),1),50); items jsonb; more boolean; detail jsonb;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then raise exception using errcode='42501',message='Active authentication required'; end if;
  if p_situation_id is not null then
    select jsonb_build_object('id',s.id,'createdAt',s.created_at,'updatedAt',s.updated_at,'projectId',s.project_id,'contractorId',s.contractor_id,
      'periodStart',s.period_start,'periodEnd',s.period_end,'status',s.status,'revision',s.revision,'lines',s.lines,
      'technicalStatement',coalesce((select jsonb_agg(jsonb_build_object('lineId',l.value->>'lineId','awardItemId',l.value->>'awardItemId',
        'quoteLineId',l.value->>'quoteLineId','quantityUnit',l.value->>'quantityUnit',
        'previouslyValidatedMilli',coalesce((select sum((pl.value->>'quantityValidatedMilli')::bigint)::text
          from public.site_work_situations ps cross join lateral jsonb_array_elements(ps.lines) pl
          where ps.project_id=s.project_id and ps.contractor_id=s.contractor_id and ps.status='validated_technical'
            and ps.period_end<s.period_start and pl.value->>'awardItemId'=l.value->>'awardItemId'
            and pl.value->>'quoteLineId' is not distinct from l.value->>'quoteLineId'
            and pl.value->>'quantityUnit'=l.value->>'quantityUnit'), '0'),
        'currentValidatedMilli',l.value->>'quantityValidatedMilli',
        'cumulativeValidatedMilli',case when l.value->>'quantityValidatedMilli' is null then null else
          (coalesce((select sum((pl.value->>'quantityValidatedMilli')::bigint) from public.site_work_situations ps
            cross join lateral jsonb_array_elements(ps.lines) pl where ps.project_id=s.project_id and ps.contractor_id=s.contractor_id
              and ps.status='validated_technical' and ps.period_end<s.period_start
              and pl.value->>'awardItemId'=l.value->>'awardItemId'
              and pl.value->>'quoteLineId' is not distinct from l.value->>'quoteLineId'
              and pl.value->>'quantityUnit'=l.value->>'quantityUnit'),0)
            +(l.value->>'quantityValidatedMilli')::bigint)::text end) order by l.ordinality)
        from jsonb_array_elements(s.lines) with ordinality l(value,ordinality)),'[]'::jsonb)) into detail
    from public.site_work_situations s where s.id=p_situation_id and dao_private.site_work_situation_can_read(s.id);
    if detail is null then raise exception using errcode='42501',message='Work situation access denied'; end if;
    return detail;
  end if;
  if p_project_id is null or dao_private.site_work_situation_actor_role(p_project_id,null) is null
    or (p_before_created_at is null)<>(p_before_id is null) then raise exception using errcode='42501',message='Work situation access denied'; end if;
  with page as (select s.* from public.site_work_situations s where s.project_id=p_project_id
    and (p_before_created_at is null or (s.created_at,s.id)<(p_before_created_at,p_before_id))
    and dao_private.site_work_situation_can_read(s.id) order by s.created_at desc,s.id desc limit n+1),
  numbered as (select page.*,row_number() over(order by created_at desc,id desc) rn from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at,'updatedAt',updated_at,'projectId',project_id,'contractorId',contractor_id,
    'periodStart',period_start,'periodEnd',period_end,'status',status,'revision',revision,'lineCount',jsonb_array_length(lines))
    order by created_at desc,id desc) filter(where rn<=n),'[]'::jsonb),coalesce(bool_or(rn>n),false) into items,more from numbered;
  return jsonb_build_object('projectId',p_project_id,'items',items,'hasMore',more);
end;
$$;
create function dao_private.native_work_situation_events_v1(p_situation_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare n integer:=least(greatest(coalesce(p_limit,30),1),50); items jsonb; more boolean;
begin
  if auth.uid() is null or not dao_private.site_work_situation_can_read(p_situation_id) or (p_before_created_at is null)<>(p_before_id is null) then
    raise exception using errcode='42501',message='Work situation access denied'; end if;
  with page as (select e.* from public.site_work_situation_events e where e.situation_id=p_situation_id
    and (p_before_created_at is null or (e.created_at,e.id)<(p_before_created_at,p_before_id)) order by e.created_at desc,e.id desc limit n+1),
  numbered as (select page.*,row_number() over(order by created_at desc,id desc) rn from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'createdAt',created_at,'actorId',actor_id,'actorRole',actor_role,'revision',revision,
    'kind',event_kind,'statusAfter',status_after,'note',note,'payload',command_payload) order by created_at desc,id desc) filter(where rn<=n),'[]'::jsonb),
    coalesce(bool_or(rn>n),false) into items,more from numbered;
  return jsonb_build_object('situationId',p_situation_id,'items',items,'hasMore',more);
end;
$$;

alter table public.site_work_situations enable row level security;
alter table public.site_work_situation_events enable row level security;
revoke all on public.site_work_situations,public.site_work_situation_events from public,anon,authenticated;
grant select(id,created_at,updated_at,project_id,contractor_id,created_by,period_start,period_end,status,revision) on public.site_work_situations to authenticated;
grant select(id,created_at,situation_id,project_id,contractor_id,actor_id,actor_role,revision,event_kind,status_after,note) on public.site_work_situation_events to authenticated;
grant all on public.site_work_situations,public.site_work_situation_events to service_role;
create policy read_work_situations on public.site_work_situations for select to authenticated using (dao_private.site_work_situation_can_read(id));
create policy read_work_situation_events on public.site_work_situation_events for select to authenticated using (dao_private.site_work_situation_can_read(situation_id));
create function dao_private.site_work_situation_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='23514',message='work situation history is append-only'; end;
$$;
create trigger immutable_site_work_situation_events before update or delete on public.site_work_situation_events for each row execute function dao_private.site_work_situation_immutable();
create trigger no_delete_site_work_situations before delete on public.site_work_situations for each row execute function dao_private.site_work_situation_immutable();

create function public.native_work_situations_v1(p_project_id uuid,p_situation_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$ select dao_private.native_work_situations_v1($1,$2,$3,$4,$5); $$;
create function public.native_work_situation_events_v1(p_situation_id uuid,p_before_created_at timestamptz,p_before_id uuid,p_limit integer)
returns jsonb language sql security invoker set search_path='' as $$ select dao_private.native_work_situation_events_v1($1,$2,$3,$4); $$;
create function public.native_work_situation_command_v1(
  p_action text,p_situation_id uuid,p_project_id uuid,p_contractor_id uuid,p_period_start date,p_period_end date,
  p_lines jsonb,p_validated_lines jsonb,p_note text,p_expected_revision integer,p_idempotency_key text
) returns jsonb language sql security invoker set search_path='' as $$
  select dao_private.site_work_situation_command_v1($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11);
$$;
revoke all on function dao_private.site_work_situation_actor_role(uuid,uuid),dao_private.site_work_situation_can_read(uuid),
  dao_private.site_work_situation_validate_lines(uuid,uuid,jsonb),
  dao_private.site_work_situation_command_v1(text,uuid,uuid,uuid,date,date,jsonb,jsonb,text,integer,text),
  dao_private.native_work_situations_v1(uuid,uuid,timestamptz,uuid,integer),
  dao_private.native_work_situation_events_v1(uuid,timestamptz,uuid,integer),dao_private.site_work_situation_immutable(),
  public.native_work_situations_v1(uuid,uuid,timestamptz,uuid,integer),
  public.native_work_situation_events_v1(uuid,timestamptz,uuid,integer),
  public.native_work_situation_command_v1(text,uuid,uuid,uuid,date,date,jsonb,jsonb,text,integer,text)
  from public,anon,authenticated;
grant execute on function dao_private.site_work_situation_actor_role(uuid,uuid),dao_private.site_work_situation_can_read(uuid) to authenticated,service_role;
grant execute on function dao_private.site_work_situation_command_v1(text,uuid,uuid,uuid,date,date,jsonb,jsonb,text,integer,text),
  dao_private.native_work_situations_v1(uuid,uuid,timestamptz,uuid,integer),
  dao_private.native_work_situation_events_v1(uuid,timestamptz,uuid,integer) to authenticated,service_role;
grant execute on function public.native_work_situations_v1(uuid,uuid,timestamptz,uuid,integer),
  public.native_work_situation_events_v1(uuid,timestamptz,uuid,integer),
  public.native_work_situation_command_v1(text,uuid,uuid,uuid,date,date,jsonb,jsonb,text,integer,text) to authenticated;
notify pgrst,'reload schema';
commit;
