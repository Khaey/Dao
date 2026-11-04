-- #548 — deterministic, justified and revisioned BTP takeoffs.
-- Forecast takeoffs are intentionally isolated from execution quantities,
-- quotes, prices and planning. Published catalogue formulas remain immutable.
begin;

alter table public.btp_measurement_templates
  add constraint btp_measurement_templates_id_version_unique unique(id,catalog_version_id);

create table public.btp_takeoffs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects,
  catalog_version_id uuid not null references public.btp_catalog_versions,
  work_id uuid not null,
  template_id uuid not null,
  scope_key text not null check (scope_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'),
  label text not null check (length(label) between 1 and 160),
  created_by uuid not null references auth.users,
  status text not null default 'draft' check (status in ('draft','submitted','validated')),
  current_revision integer not null default 0 check (current_revision>=0),
  validated_revision integer check (validated_revision is null or validated_revision>0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(work_id,catalog_version_id) references public.btp_works(id,catalog_version_id),
  foreign key(template_id,catalog_version_id) references public.btp_measurement_templates(id,catalog_version_id),
  unique(project_id,work_id,scope_key),
  unique(id,current_revision)
);
create index btp_takeoffs_project_idx on public.btp_takeoffs(project_id,updated_at desc,id);

create table public.btp_takeoff_revisions (
  id uuid primary key default gen_random_uuid(),
  takeoff_id uuid not null references public.btp_takeoffs,
  revision integer not null check (revision>0),
  calculation_status text not null check (calculation_status in ('insufficient_data','calculated')),
  canonical_inputs jsonb not null check (jsonb_typeof(canonical_inputs)='object'),
  formula_snapshot jsonb not null check (jsonb_typeof(formula_snapshot)='object'),
  justification jsonb not null check (jsonb_typeof(justification)='object'),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  result_sha256 text not null check (result_sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  unique(takeoff_id,revision)
);
create index btp_takeoff_revisions_history_idx on public.btp_takeoff_revisions(takeoff_id,revision desc);

create table public.btp_takeoff_events (
  id uuid primary key default gen_random_uuid(),
  takeoff_id uuid not null references public.btp_takeoffs,
  revision integer not null,
  event_type text not null check (event_type in ('calculated','insufficient_data','submitted','validated','validation_invalidated')),
  actor_id uuid not null references auth.users,
  note text,
  created_at timestamptz not null default now(),
  foreign key(takeoff_id,revision) references public.btp_takeoff_revisions(takeoff_id,revision),
  check (note is null or length(note) between 1 and 1000)
);
create index btp_takeoff_events_history_idx on public.btp_takeoff_events(takeoff_id,created_at,id);

create table dao_private.btp_takeoff_command_receipts (
  actor_id uuid not null,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9._:-]{8,100}$'),
  action text not null,
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,idempotency_key)
);

create function dao_private.btp_takeoff_immutable() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception using errcode='42501',message='takeoff history is append-only';
end;
$$;
create trigger btp_takeoff_revisions_immutable before update or delete on public.btp_takeoff_revisions
for each row execute function dao_private.btp_takeoff_immutable();
create trigger btp_takeoff_events_immutable before update or delete on public.btp_takeoff_events
for each row execute function dao_private.btp_takeoff_immutable();

create function dao_private.btp_takeoff_expected_unit(p_name text) returns text
language sql immutable set search_path='' as $$
  select case
    when p_name ~ '_m3$' then 'm3'
    when p_name ~ '_m2$' then 'm2'
    when p_name ~ '_m$' then 'm'
    when p_name ~ '_count$' then 'unit'
    else null
  end;
$$;

create function dao_private.btp_takeoff_eval(p_formula jsonb,p_inputs jsonb,p_steps jsonb default '[]'::jsonb)
returns table(value numeric,dimension text,steps jsonb)
language plpgsql immutable set search_path='' as $$
declare op text:=p_formula->>'op'; arg jsonb; child_value numeric; child_dimension text; acc numeric; dim text; out_steps jsonb:=coalesce(p_steps,'[]'::jsonb);
  left_value numeric; left_dim text; right_value numeric; right_dim text; field text; item jsonb;
begin
  if op='identity' then
    field:=p_formula->>'arg';
    if field is null or not (p_inputs ? field) then raise exception using errcode='22023',message='formula input missing'; end if;
    value:=(p_inputs->field->>'value')::numeric; dimension:=dao_private.btp_takeoff_expected_unit(field);
    steps:=out_steps||jsonb_build_array(jsonb_build_object('op','identity','field',field,'value',value,'unit',dimension)); return next; return;
  elsif op='multiply' then
    if jsonb_typeof(p_formula->'args')<>'array' or jsonb_array_length(p_formula->'args') not between 2 and 3 then
      raise exception using errcode='22023',message='unsupported multiply formula';
    end if;
    acc:=1;dim:='scalar';
    for item in select x from jsonb_array_elements(p_formula->'args') x loop
      if jsonb_typeof(item)='string' then
        field:=trim(both '"' from item::text);
        if not (p_inputs ? field) then raise exception using errcode='22023',message='formula input missing'; end if;
        child_value:=(p_inputs->field->>'value')::numeric;child_dimension:=dao_private.btp_takeoff_expected_unit(field);
      else
        select e.value,e.dimension,e.steps into child_value,child_dimension,out_steps from dao_private.btp_takeoff_eval(item,p_inputs,out_steps) e;
      end if;
      acc:=acc*child_value;
      dim:=case when dim='scalar' then child_dimension when dim='m' and child_dimension='m' then 'm2'
        when dim='m2' and child_dimension='m' then 'm3' else null end;
      if dim is null then raise exception using errcode='22023',message='formula dimensions are incompatible'; end if;
    end loop;
    value:=acc;dimension:=dim;steps:=out_steps||jsonb_build_array(jsonb_build_object('op','multiply','value',value,'unit',dimension)); return next; return;
  elsif op='subtract' then
    if jsonb_typeof(p_formula->'args')<>'array' or jsonb_array_length(p_formula->'args')<>2 then
      raise exception using errcode='22023',message='unsupported subtract formula';
    end if;
    arg:=p_formula->'args'->0;
    if jsonb_typeof(arg)='string' then field:=trim(both '"' from arg::text);left_value:=(p_inputs->field->>'value')::numeric;left_dim:=dao_private.btp_takeoff_expected_unit(field);
    else select e.value,e.dimension,e.steps into left_value,left_dim,out_steps from dao_private.btp_takeoff_eval(arg,p_inputs,out_steps) e; end if;
    arg:=p_formula->'args'->1;
    if jsonb_typeof(arg)='string' then field:=trim(both '"' from arg::text);right_value:=(p_inputs->field->>'value')::numeric;right_dim:=dao_private.btp_takeoff_expected_unit(field);
    else select e.value,e.dimension,e.steps into right_value,right_dim,out_steps from dao_private.btp_takeoff_eval(arg,p_inputs,out_steps) e; end if;
    if left_dim is distinct from right_dim or left_value<right_value then raise exception using errcode='22023',message='subtraction is dimensionally invalid'; end if;
    value:=left_value-right_value;dimension:=left_dim;steps:=out_steps||jsonb_build_array(jsonb_build_object('op','subtract','left',left_value,'right',right_value,'value',value,'unit',dimension)); return next; return;
  end if;
  raise exception using errcode='22023',message='unsupported formula operation';
end;
$$;

create function dao_private.btp_takeoff_payload(p_takeoff_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',t.id,'projectId',t.project_id,'catalogVersionId',t.catalog_version_id,'workId',t.work_id,'templateId',t.template_id,
    'scopeKey',t.scope_key,'label',t.label,'status',t.status,'currentRevision',t.current_revision,'validatedRevision',t.validated_revision,
    'current',(select jsonb_build_object('id',r.id,'revision',r.revision,'status',r.calculation_status,'inputs',r.canonical_inputs,
      'formula',r.formula_snapshot,'justification',r.justification,'inputSha256',r.input_sha256,'resultSha256',r.result_sha256,
      'createdBy',r.created_by,'createdAt',r.created_at) from public.btp_takeoff_revisions r where r.takeoff_id=t.id and r.revision=t.current_revision),
    'validated',(select jsonb_build_object('id',r.id,'revision',r.revision,'status',r.calculation_status,'inputs',r.canonical_inputs,
      'formula',r.formula_snapshot,'justification',r.justification,'inputSha256',r.input_sha256,'resultSha256',r.result_sha256,
      'createdBy',r.created_by,'createdAt',r.created_at) from public.btp_takeoff_revisions r where r.takeoff_id=t.id and r.revision=t.validated_revision),
    'history',(select coalesce(jsonb_agg(jsonb_build_object('revision',r.revision,'status',r.calculation_status,
      'result',r.justification->'result','createdBy',r.created_by,'createdAt',r.created_at) order by r.revision desc),'[]'::jsonb)
      from public.btp_takeoff_revisions r where r.takeoff_id=t.id),
    'events',(select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id',e.id,'revision',e.revision,'type',e.event_type,
      'actorId',e.actor_id,'note',e.note,'createdAt',e.created_at)) order by e.created_at,e.id),'[]'::jsonb)
      from public.btp_takeoff_events e where e.takeoff_id=t.id)
  ) from public.btp_takeoffs t where t.id=p_takeoff_id;
$$;

create function dao_private.btp_takeoff_snapshot_v1(p_project_id uuid,p_takeoff_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not dao_private.can_view_project(p_project_id) then
    raise exception using errcode='42501',message='project takeoff access required';
  end if;
  if p_takeoff_id is not null then
    select dao_private.btp_takeoff_payload(t.id) into result from public.btp_takeoffs t where t.id=p_takeoff_id and t.project_id=p_project_id;
    if result is null then raise exception using errcode='P0002',message='takeoff not found'; end if;
    return result;
  end if;
  return jsonb_build_object('projectId',p_project_id,'items',(select coalesce(jsonb_agg(dao_private.btp_takeoff_payload(t.id) order by t.updated_at desc,t.id),'[]'::jsonb)
    from public.btp_takeoffs t where t.project_id=p_project_id));
end;
$$;

create function dao_private.btp_takeoff_template_v1(p_project_id uuid,p_work_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or not (dao_private.owner(p_project_id) or dao_private.manages_project(p_project_id)) then
    raise exception using errcode='42501',message='project takeoff write access required';
  end if;
  select jsonb_build_object('catalogVersionId',v.id,'catalogVersionCode',v.code,'workId',w.id,'workCode',w.code,
    'workLabel',w.label_fr,'templateId',m.id,'outputUnitCode',m.output_unit_code,'inputSchema',m.input_schema,
    'formulaAst',m.formula_ast,'roundingScale',m.rounding_scale,'assumptions',m.assumptions_fr,'sourceRef',m.source_ref)
  into result from public.btp_measurement_templates m join public.btp_works w on w.id=m.work_id and w.catalog_version_id=m.catalog_version_id
    join public.btp_catalog_versions v on v.id=m.catalog_version_id
    where m.work_id=p_work_id and m.active and w.active and v.status='published' order by v.effective_from desc limit 1;
  if result is null then raise exception using errcode='P0002',message='published measurement template not found'; end if;
  return result;
end;
$$;

create function dao_private.btp_takeoff_command_v1(p_action text,p_input jsonb,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); payload_hash text; prior dao_private.btp_takeoff_command_receipts; result jsonb;
  v_project_id uuid;v_work_id uuid;v_takeoff_id uuid;template record;takeoff public.btp_takeoffs;v_revision integer;expected integer;
  v_scope_key text;v_label text;canonical jsonb;required_name text;missing text[]:='{}';entry jsonb;expected_unit text;
  original jsonb;conversion_factor numeric;
  calc record;rounded numeric;formula jsonb;justification jsonb;input_hash text;result_hash text;note text;
begin
  if actor is null or p_action not in ('calculate','submit','validate') or p_idempotency_key!~'^[A-Za-z0-9._:-]{8,100}$' or jsonb_typeof(p_input)<>'object' then
    raise exception using errcode='22023',message='invalid takeoff command';
  end if;
  payload_hash:=encode(sha256(convert_to(p_action||':'||p_input::text,'UTF8')),'hex');
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':btp-takeoff:'||p_idempotency_key,0));
  select * into prior from dao_private.btp_takeoff_command_receipts where actor_id=actor and idempotency_key=p_idempotency_key;
  if found then
    if prior.action<>p_action or prior.payload_sha256<>payload_hash then raise exception using errcode='22023',message='idempotency key already used'; end if;
    return prior.result;
  end if;

  if p_action='calculate' then
    begin
      v_project_id:=(p_input->>'projectId')::uuid;v_work_id:=(p_input->>'workId')::uuid;
      v_takeoff_id:=nullif(p_input->>'takeoffId','')::uuid;expected:=nullif(p_input->>'expectedRevision','')::integer;
    exception when others then raise exception using errcode='22023',message='invalid project, work or revision'; end;
    if not (dao_private.owner(v_project_id) or dao_private.manages_project(v_project_id)) then raise exception using errcode='42501',message='project takeoff write access required'; end if;
    v_scope_key:=coalesce(p_input->>'scopeKey','');v_label:=btrim(coalesce(p_input->>'label',''));canonical:=coalesce(p_input->'canonicalInputs','{}'::jsonb);
    if v_scope_key!~'^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$' or length(v_label) not between 1 and 160 or jsonb_typeof(canonical)<>'object' then
      raise exception using errcode='22023',message='invalid takeoff scope or inputs';
    end if;
    select m.id,m.catalog_version_id,m.output_unit_code,m.input_schema,m.formula_ast,m.rounding_scale,m.assumptions_fr,m.source_ref,
      w.code work_code,w.label_fr work_label into template
    from public.btp_measurement_templates m join public.btp_works w on w.id=m.work_id and w.catalog_version_id=m.catalog_version_id
      join public.btp_catalog_versions v on v.id=m.catalog_version_id
    where m.work_id=v_work_id and m.active and w.active and v.status='published' order by v.effective_from desc limit 1;
    if not found then raise exception using errcode='P0002',message='published measurement template not found'; end if;
    for required_name in select jsonb_array_elements_text(template.input_schema->'required') loop
      if not (canonical ? required_name) then missing:=array_append(missing,required_name);continue; end if;
      entry:=canonical->required_name;expected_unit:=dao_private.btp_takeoff_expected_unit(required_name);
      if jsonb_typeof(entry)<>'object' or expected_unit is null or entry->>'unit'<>expected_unit
        or coalesce(entry->>'value','')!~'^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$'
        or jsonb_typeof(entry->'source')<>'object' or entry->'source'->>'kind' not in ('manual','document','survey','bim_import')
        or length(btrim(coalesce(entry->'source'->>'reference',''))) not between 1 and 300
        or jsonb_typeof(entry->'original')<>'object'
        or coalesce(entry->'original'->>'value','')!~'^(0|[1-9][0-9]{0,8})(\.[0-9]{1,6})?$' then
        raise exception using errcode='22023',message='invalid canonical measurement input';
      end if;
      original:=entry->'original';
      conversion_factor:=case
        when expected_unit='m' and original->>'unit'='m' then 1
        when expected_unit='m' and original->>'unit'='cm' then 0.01
        when expected_unit='m' and original->>'unit'='mm' then 0.001
        when expected_unit='m2' and original->>'unit'='m2' then 1
        when expected_unit='m2' and original->>'unit'='cm2' then 0.0001
        when expected_unit='m2' and original->>'unit'='mm2' then 0.000001
        when expected_unit='m3' and original->>'unit'='m3' then 1
        when expected_unit='m3' and original->>'unit'='l' then 0.001
        when expected_unit='m3' and original->>'unit'='cm3' then 0.000001
        when expected_unit='unit' and original->>'unit'='unit' then 1
        else null end;
      if conversion_factor is null or (original->>'value')::numeric*conversion_factor<>(entry->>'value')::numeric then
        raise exception using errcode='22023',message='canonical measurement does not match original input';
      end if;
    end loop;
    if exists(select 1 from jsonb_object_keys(canonical) k
      where not (coalesce(template.input_schema->'properties','{}'::jsonb) ? k or template.input_schema->'required' ? k)) then
      raise exception using errcode='22023',message='unsupported measurement input';
    end if;
    if v_takeoff_id is null then
      insert into public.btp_takeoffs(project_id,catalog_version_id,work_id,template_id,scope_key,label,created_by)
      values(v_project_id,template.catalog_version_id,v_work_id,template.id,v_scope_key,v_label,actor)
      returning * into takeoff;
    else
      select * into takeoff from public.btp_takeoffs t where t.id=v_takeoff_id and t.project_id=v_project_id for update;
      if not found then raise exception using errcode='P0002',message='takeoff not found'; end if;
      if takeoff.work_id<>v_work_id or expected is null or expected<>takeoff.current_revision then raise exception using errcode='40001',message='takeoff revision changed'; end if;
    end if;
    v_revision:=takeoff.current_revision+1;
    formula:=jsonb_build_object('templateId',template.id,'catalogVersionId',template.catalog_version_id,'workCode',template.work_code,
      'outputUnitCode',template.output_unit_code,'ast',template.formula_ast,'roundingScale',template.rounding_scale,
      'assumptions',template.assumptions_fr,'sourceRef',template.source_ref,'engineVersion','dao-takeoff-v1');
    if cardinality(missing)>0 then
      justification:=jsonb_build_object('status','insufficient_data','missingFields',to_jsonb(missing),
        'questions',(select jsonb_agg('Renseignez '||x||' en '||dao_private.btp_takeoff_expected_unit(x)||' avec sa provenance.' order by x) from unnest(missing) x),
        'canonicalInputs',canonical,
        'conversions',(select coalesce(jsonb_agg(jsonb_build_object('field',x.key,'from',x.value->'original',
          'to',jsonb_build_object('value',x.value->>'value','unit',x.value->>'unit'),'source',x.value->'source') order by x.key),'[]'::jsonb)
          from jsonb_each(canonical) x),
        'catalogVersionId',template.catalog_version_id,'templateId',template.id,'engineVersion','dao-takeoff-v1');
    else
      select * into calc from dao_private.btp_takeoff_eval(template.formula_ast,canonical);
      if calc.dimension<>template.output_unit_code or calc.value<=0 or calc.value>1000000000000000 then
        raise exception using errcode='22023',message='calculated quantity is invalid or out of range';
      end if;
      rounded:=round(calc.value,template.rounding_scale);
      justification:=jsonb_build_object('status','calculated','formula',template.formula_ast,'canonicalInputs',canonical,
        'conversions',(select coalesce(jsonb_agg(jsonb_build_object('field',x.key,'from',x.value->'original',
          'to',jsonb_build_object('value',x.value->>'value','unit',x.value->>'unit'),'source',x.value->'source') order by x.key),'[]'::jsonb)
          from jsonb_each(canonical) x),'steps',calc.steps,
        'rawResult',calc.value,'result',jsonb_build_object('value',rounded,'unit',template.output_unit_code,'roundingScale',template.rounding_scale),
        'catalogVersionId',template.catalog_version_id,'templateId',template.id,'workId',v_work_id,'engineVersion','dao-takeoff-v1',
        'assumptions',template.assumptions_fr,'sourceRef',template.source_ref);
    end if;
    input_hash:=encode(sha256(convert_to(canonical::text,'UTF8')),'hex');result_hash:=encode(sha256(convert_to(justification::text,'UTF8')),'hex');
    insert into public.btp_takeoff_revisions(takeoff_id,revision,calculation_status,canonical_inputs,formula_snapshot,justification,input_sha256,result_sha256,created_by)
    values(takeoff.id,v_revision,case when cardinality(missing)>0 then 'insufficient_data' else 'calculated' end,canonical,formula,justification,input_hash,result_hash,actor);
    if takeoff.status='validated' then
      insert into public.btp_takeoff_events(takeoff_id,revision,event_type,actor_id,note) values(takeoff.id,v_revision,'validation_invalidated',actor,'Nouvelle révision ; résultat validé précédent conservé.');
    end if;
    update public.btp_takeoffs set current_revision=v_revision,status='draft',label=v_label,updated_at=now() where id=takeoff.id;
    insert into public.btp_takeoff_events(takeoff_id,revision,event_type,actor_id) values(takeoff.id,v_revision,case when cardinality(missing)>0 then 'insufficient_data' else 'calculated' end,actor);
    result:=dao_private.btp_takeoff_payload(takeoff.id);
  else
    begin v_takeoff_id:=(p_input->>'takeoffId')::uuid;expected:=(p_input->>'expectedRevision')::integer;
    exception when others then raise exception using errcode='22023',message='invalid takeoff or revision'; end;
    note:=nullif(btrim(coalesce(p_input->>'note','')),'');
    if note is not null and length(note)>1000 then raise exception using errcode='22023',message='note too long'; end if;
    select * into takeoff from public.btp_takeoffs t where t.id=v_takeoff_id for update;
    if not found then raise exception using errcode='P0002',message='takeoff not found'; end if;
    if expected<>takeoff.current_revision then raise exception using errcode='40001',message='takeoff revision changed'; end if;
    if p_action='submit' then
      if not (dao_private.owner(takeoff.project_id) or dao_private.manages_project(takeoff.project_id)) then raise exception using errcode='42501',message='takeoff submit access required'; end if;
      if takeoff.status<>'draft' or not exists(select 1 from public.btp_takeoff_revisions r where r.takeoff_id=takeoff.id and r.revision=expected and r.calculation_status='calculated') then
        raise exception using errcode='22023',message='only a calculated draft can be submitted';
      end if;
      update public.btp_takeoffs set status='submitted',updated_at=now() where id=takeoff.id;
      insert into public.btp_takeoff_events(takeoff_id,revision,event_type,actor_id,note) values(takeoff.id,expected,'submitted',actor,note);
    else
      if not dao_private.manages_project(takeoff.project_id) then raise exception using errcode='42501',message='assigned manager validation required'; end if;
      if takeoff.status<>'submitted' then raise exception using errcode='22023',message='only a submitted takeoff can be validated'; end if;
      update public.btp_takeoffs set status='validated',validated_revision=expected,updated_at=now() where id=takeoff.id;
      insert into public.btp_takeoff_events(takeoff_id,revision,event_type,actor_id,note) values(takeoff.id,expected,'validated',actor,note);
    end if;
    result:=dao_private.btp_takeoff_payload(takeoff.id);
  end if;
  insert into dao_private.btp_takeoff_command_receipts(actor_id,idempotency_key,action,payload_sha256,result)
  values(actor,p_idempotency_key,p_action,payload_hash,result);
  return result;
end;
$$;

create function public.btp_takeoff_snapshot_v1(p_project_id uuid,p_takeoff_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.btp_takeoff_snapshot_v1($1,$2); $$;
create function public.btp_takeoff_template_v1(p_project_id uuid,p_work_id uuid) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.btp_takeoff_template_v1($1,$2); $$;
create function public.btp_takeoff_command_v1(p_action text,p_input jsonb,p_idempotency_key text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.btp_takeoff_command_v1($1,$2,$3); $$;

do $$ declare t text; begin
  foreach t in array array['btp_takeoffs','btp_takeoff_revisions','btp_takeoff_events'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
end $$;
create policy btp_takeoffs_read on public.btp_takeoffs for select to authenticated using (dao_private.can_view_project(project_id));
create policy btp_takeoff_revisions_read on public.btp_takeoff_revisions for select to authenticated
using (exists(select 1 from public.btp_takeoffs t where t.id=takeoff_id and dao_private.can_view_project(t.project_id)));
create policy btp_takeoff_events_read on public.btp_takeoff_events for select to authenticated
using (exists(select 1 from public.btp_takeoffs t where t.id=takeoff_id and dao_private.can_view_project(t.project_id)));

revoke all on function dao_private.btp_takeoff_immutable(),dao_private.btp_takeoff_expected_unit(text),
  dao_private.btp_takeoff_eval(jsonb,jsonb,jsonb),dao_private.btp_takeoff_payload(uuid),
  dao_private.btp_takeoff_snapshot_v1(uuid,uuid),dao_private.btp_takeoff_template_v1(uuid,uuid),
  dao_private.btp_takeoff_command_v1(text,jsonb,text) from public,anon,authenticated;
grant execute on function dao_private.btp_takeoff_snapshot_v1(uuid,uuid),dao_private.btp_takeoff_template_v1(uuid,uuid),
  dao_private.btp_takeoff_command_v1(text,jsonb,text) to authenticated,service_role;
revoke all on function public.btp_takeoff_snapshot_v1(uuid,uuid),public.btp_takeoff_template_v1(uuid,uuid),
  public.btp_takeoff_command_v1(text,jsonb,text) from public,anon;
grant execute on function public.btp_takeoff_snapshot_v1(uuid,uuid),public.btp_takeoff_template_v1(uuid,uuid),
  public.btp_takeoff_command_v1(text,jsonb,text) to authenticated,service_role;

commit;
