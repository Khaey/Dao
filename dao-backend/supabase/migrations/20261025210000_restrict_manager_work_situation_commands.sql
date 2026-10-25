-- Preserve the P12 function contract and grants while reserving party commands to the party JWT.
begin;

create or replace function dao_private.site_work_situation_command_v1(
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
    if role_value is distinct from 'contractor'
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
  if p_action in ('save_draft','submit','withdraw') and role_value<>'contractor' then raise exception using errcode='42501',message='Contractor action required'; end if;
  if p_action='save_draft' then
    if s.status not in ('draft','revision_requested','contested') then raise exception using errcode='40001',message='Situation is not editable'; end if;
    next_lines:=dao_private.site_work_situation_validate_lines(s.project_id,s.contractor_id,p_lines);
    new_status:='draft'; kind_value:='draft_saved';
  elsif p_action='submit' then
    if role_value<>'contractor' or s.status not in ('draft','revision_requested') then raise exception using errcode='42501',message='Only awarded contractor may submit'; end if;
    new_status:='submitted'; kind_value:='submitted';
  elsif p_action='start_review' then
    if role_value<>'client' or s.status<>'submitted' then raise exception using errcode='42501',message='Review access denied'; end if;
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

notify pgrst, 'reload schema';
commit;
