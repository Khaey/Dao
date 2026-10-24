-- P10-N2 (#409): versioned operational activities after award.
-- Awarded bid sub-lots remain immutable; this table stores the live DAO execution organization.
begin;

create table public.native_execution_activities (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project_id uuid not null references public.projects,
  request_id uuid not null,
  award_item_id uuid not null references public.award_items,
  parent_activity_id uuid,
  kind text not null check(kind in ('sub_lot','activity')),
  title text not null check(length(btrim(title)) between 1 and 180),
  scope text check(scope is null or length(scope)<=4000),
  position integer not null default 0 check(position between 0 and 10000),
  planned_start date,
  planned_end date,
  duration_days integer check(duration_days is null or duration_days between 0 and 36500),
  revision integer not null default 1 check(revision>0),
  active boolean not null default true,
  created_by uuid not null references auth.users,
  updated_by uuid not null references auth.users,
  unique(id,award_item_id),
  foreign key(request_id,project_id) references public.project_requests(id,project_id),
  foreign key(parent_activity_id,award_item_id) references public.native_execution_activities(id,award_item_id),
  check(planned_start is null or planned_end is null or planned_end>=planned_start),
  check(kind<>'sub_lot' or parent_activity_id is null)
);
create index native_execution_activities_award_idx
  on public.native_execution_activities(award_item_id,active,position,id);

create table public.native_execution_activity_revisions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  activity_id uuid not null references public.native_execution_activities,
  revision integer not null check(revision>0),
  action text not null check(action in ('created','updated','retired','manager_change_accepted')),
  project_id uuid not null references public.projects,
  request_id uuid not null,
  award_item_id uuid not null references public.award_items,
  parent_activity_id uuid,
  kind text not null check(kind in ('sub_lot','activity')),
  title text not null,
  scope text,
  position integer not null,
  planned_start date,
  planned_end date,
  duration_days integer,
  active boolean not null,
  actor_id uuid not null references auth.users,
  unique(activity_id,revision),
  foreign key(activity_id,award_item_id) references public.native_execution_activities(id,award_item_id),
  foreign key(parent_activity_id,award_item_id) references public.native_execution_activities(id,award_item_id),
  foreign key(request_id,project_id) references public.project_requests(id,project_id)
);
create index native_execution_activity_revisions_history_idx
  on public.native_execution_activity_revisions(activity_id,revision desc);

create table public.native_execution_activity_commands (
  actor_id uuid not null references auth.users,
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  payload jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,idempotency_key)
);

create table public.native_execution_activity_proposals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  project_id uuid not null references public.projects,
  request_id uuid not null,
  award_item_id uuid not null references public.award_items,
  proposed_by uuid not null references auth.users,
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  command_payload jsonb not null,
  action text not null check(action in ('create','update','retire')),
  activity_id uuid not null,
  expected_revision integer,
  parent_activity_id uuid,
  kind text not null check(kind in ('sub_lot','activity')),
  title text,
  scope text,
  position integer not null check(position between 0 and 10000),
  planned_start date,
  planned_end date,
  duration_days integer check(duration_days is null or duration_days between 0 and 36500),
  state text not null default 'pending_acceptance' check(state in ('pending_acceptance','accepted','rejected','stale')),
  unique(id,award_item_id),
  unique(proposed_by,idempotency_key),
  foreign key(request_id,project_id) references public.project_requests(id,project_id),
  foreign key(parent_activity_id,award_item_id) references public.native_execution_activities(id,award_item_id),
  check((action='create' and expected_revision is null and title is not null)
     or (action in ('update','retire') and expected_revision is not null)),
  check(title is null or length(btrim(title)) between 1 and 180),
  check(scope is null or length(scope)<=4000),
  check(planned_start is null or planned_end is null or planned_end>=planned_start),
  check(kind<>'sub_lot' or parent_activity_id is null)
);

create table public.native_execution_activity_proposal_acceptances (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  proposal_id uuid not null references public.native_execution_activity_proposals,
  party_role text not null check(party_role in ('client','contractor')),
  actor_id uuid not null references auth.users,
  decision text not null check(decision in ('accepted','rejected')),
  idempotency_key text not null check(length(idempotency_key) between 8 and 128),
  unique(proposal_id,party_role),
  unique(actor_id,idempotency_key)
);

alter table public.native_execution_activities enable row level security;
alter table public.native_execution_activity_revisions enable row level security;
alter table public.native_execution_activity_commands enable row level security;
alter table public.native_execution_activity_proposals enable row level security;
alter table public.native_execution_activity_proposal_acceptances enable row level security;
revoke all on public.native_execution_activities,public.native_execution_activity_revisions,
  public.native_execution_activity_commands,public.native_execution_activity_proposals,
  public.native_execution_activity_proposal_acceptances from public,anon,authenticated;

create trigger native_execution_activity_revisions_append_only
  before update or delete on public.native_execution_activity_revisions
  for each row execute function dao_private.plan_decisions_append_only();
create trigger native_execution_activity_acceptances_append_only
  before update or delete on public.native_execution_activity_proposal_acceptances
  for each row execute function dao_private.plan_decisions_append_only();

create function dao_private.native_activity_save_revision(p_activity_id uuid,p_action text,p_actor uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a public.native_execution_activities;
begin
  select * into a from public.native_execution_activities where id=p_activity_id;
  insert into public.native_execution_activity_revisions(activity_id,revision,action,project_id,request_id,
    award_item_id,parent_activity_id,kind,title,scope,position,planned_start,planned_end,duration_days,active,actor_id)
  values(a.id,a.revision,p_action,a.project_id,a.request_id,a.award_item_id,a.parent_activity_id,a.kind,
    a.title,a.scope,a.position,a.planned_start,a.planned_end,a.duration_days,a.active,p_actor);
  perform dao_private.bump_project_plan(a.project_id);
end;
$$;

create function dao_private.native_execution_activity_write(
  p_award_item_id uuid,p_activity_id uuid,p_action text,p_parent_activity_id uuid,p_kind text,
  p_title text,p_scope text,p_position integer,p_planned_start date,p_planned_end date,
  p_duration_days integer,p_expected_revision integer,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item public.award_items; a public.native_execution_activities;
  payload jsonb; prior public.native_execution_activity_commands; result jsonb; action_name text;
begin
  if actor is null or not dao_private.account_active(actor)
    or not dao_private.site_contractor_award_item(p_award_item_id) then
    raise exception using errcode='42501',message='Artisan attributaire actif requis';
  end if;
  if p_action not in ('create','update','retire') or p_idempotency_key is null
    or length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode='22023',message='Commande invalide';
  end if;
  payload:=jsonb_build_object('award_item_id',p_award_item_id,'activity_id',p_activity_id,'action',p_action,
    'parent_activity_id',p_parent_activity_id,'kind',p_kind,'title',p_title,'scope',p_scope,'position',p_position,
    'planned_start',p_planned_start,'planned_end',p_planned_end,'duration_days',p_duration_days,
    'expected_revision',p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key,0));
  select * into prior from public.native_execution_activity_commands where actor_id=actor and idempotency_key=p_idempotency_key;
  if prior.actor_id is not null then
    if prior.payload is distinct from payload then raise exception using errcode='22023',message='Clé idempotente réutilisée'; end if;
    return prior.result;
  end if;
  select * into item from public.award_items where id=p_award_item_id and active for update;
  if item.id is null or not dao_private.site_contractor_award_item(item.id) then raise exception using errcode='42501',message='Attribution inactive'; end if;
  if p_action='create' then
    if p_activity_id is not null or p_expected_revision is not null or p_kind not in ('sub_lot','activity')
      or length(btrim(coalesce(p_title,''))) not between 1 and 180 or p_position not between 0 and 10000
      or (p_duration_days is not null and p_duration_days not between 0 and 36500)
      or (p_planned_start is not null and p_planned_end is not null and p_planned_end<p_planned_start) then
      raise exception using errcode='22023',message='Activité invalide';
    end if;
    if p_kind='sub_lot' and p_parent_activity_id is not null then raise exception using errcode='22023',message='Un sous-lot ne peut pas être imbriqué'; end if;
    if p_kind='activity' and p_parent_activity_id is not null and not exists(
      select 1 from public.native_execution_activities parent where parent.id=p_parent_activity_id
        and parent.award_item_id=p_award_item_id and parent.kind='sub_lot' and parent.active) then
      raise exception using errcode='22023',message='Sous-lot parent invalide';
    end if;
    insert into public.native_execution_activities(project_id,request_id,award_item_id,parent_activity_id,kind,title,
      scope,position,planned_start,planned_end,duration_days,created_by,updated_by)
    values(item.project_id,item.request_id,item.id,p_parent_activity_id,p_kind,btrim(p_title),nullif(btrim(p_scope),''),
      p_position,p_planned_start,p_planned_end,p_duration_days,actor,actor) returning * into a;
    action_name:='created';
  else
    if p_activity_id is null or p_expected_revision is null then raise exception using errcode='22023',message='Révision attendue'; end if;
    select * into a from public.native_execution_activities where id=p_activity_id and award_item_id=item.id for update;
    if a.id is null or not a.active then raise exception using errcode='42501',message='Activité introuvable'; end if;
    if a.revision<>p_expected_revision then raise exception using errcode='40001',message='Révision obsolète'; end if;
    if p_action='retire' then
      if exists(select 1 from public.native_execution_activities c where c.parent_activity_id=a.id and c.active) then
        raise exception using errcode='23514',message='Retirez les activités enfants avant ce sous-lot';
      end if;
      update public.native_execution_activities set active=false,revision=revision+1,updated_at=now(),updated_by=actor where id=a.id returning * into a;
      action_name:='retired';
    else
      if p_kind is distinct from a.kind or length(btrim(coalesce(p_title,''))) not between 1 and 180
        or p_position not between 0 and 10000 or (p_duration_days is not null and p_duration_days not between 0 and 36500)
        or (p_planned_start is not null and p_planned_end is not null and p_planned_end<p_planned_start)
        or (a.kind='sub_lot' and p_parent_activity_id is not null) then
        raise exception using errcode='22023',message='Activité invalide';
      end if;
      if a.kind='activity' and p_parent_activity_id is not null and not exists(
        select 1 from public.native_execution_activities parent where parent.id=p_parent_activity_id
          and parent.award_item_id=item.id and parent.kind='sub_lot' and parent.active) then
        raise exception using errcode='22023',message='Sous-lot parent invalide';
      end if;
      update public.native_execution_activities set parent_activity_id=p_parent_activity_id,title=btrim(p_title),
        scope=nullif(btrim(p_scope),''),position=p_position,planned_start=p_planned_start,planned_end=p_planned_end,
        duration_days=p_duration_days,revision=revision+1,updated_at=now(),updated_by=actor
      where id=a.id returning * into a;
      action_name:='updated';
    end if;
  end if;
  perform dao_private.native_activity_save_revision(a.id,action_name,actor);
  result:=jsonb_build_object('id',a.id,'awardItemId',a.award_item_id,'revision',a.revision,'active',a.active);
  insert into public.native_execution_activity_commands(actor_id,idempotency_key,payload,result)
  values(actor,p_idempotency_key,payload,result);
  return result;
end;
$$;

create function public.native_execution_activity_write(
  p_award_item_id uuid,p_activity_id uuid,p_action text,p_parent_activity_id uuid,p_kind text,
  p_title text,p_scope text,p_position integer,p_planned_start date,p_planned_end date,
  p_duration_days integer,p_expected_revision integer,p_idempotency_key text
) returns jsonb language sql security invoker set search_path='' as $$
  select dao_private.native_execution_activity_write($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);
$$;

create function dao_private.native_execution_prepare_activity_change(
  p_award_item_id uuid,p_action text,p_activity_id uuid,p_parent_activity_id uuid,p_kind text,
  p_title text,p_scope text,p_position integer,p_planned_start date,p_planned_end date,
  p_duration_days integer,p_expected_revision integer,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item public.award_items; a public.native_execution_activities; activity_id uuid; proposal_id uuid;
  payload jsonb; prior public.native_execution_activity_proposals;
begin
  if actor is null or not dao_private.account_active(actor) then raise exception using errcode='42501',message='Authentification active requise'; end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then raise exception using errcode='22023',message='Clé idempotente invalide'; end if;
  select ai.* into item from public.award_items ai join public.awards a on a.id=ai.award_id and a.project_id=ai.project_id
    and a.status in ('confirmed','contracting','contracted')
    join public.projects p on p.id=ai.project_id
    join public.project_requests r on r.id=ai.request_id
    where ai.id=p_award_item_id and ai.active and p.status<>'archived' and r.status in ('awarded','contracted') for update of ai;
  if item.id is null or not dao_private.manages_project(item.project_id) then raise exception using errcode='42501',message='Gestionnaire habilité requis'; end if;
  payload:=jsonb_build_object('award_item_id',p_award_item_id,'action',p_action,'activity_id',p_activity_id,
    'parent_activity_id',p_parent_activity_id,'kind',p_kind,'title',p_title,'scope',p_scope,'position',p_position,
    'planned_start',p_planned_start,'planned_end',p_planned_end,'duration_days',p_duration_days,
    'expected_revision',p_expected_revision);
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key,0));
  select * into prior from public.native_execution_activity_proposals where proposed_by=actor and idempotency_key=p_idempotency_key;
  if prior.id is not null then
    if prior.command_payload is distinct from payload then raise exception using errcode='22023',message='Clé idempotente réutilisée'; end if;
    return jsonb_build_object('proposalId',prior.id,'activityId',prior.activity_id,'state',prior.state);
  end if;
  if p_action not in ('create','update','retire') or p_kind not in ('sub_lot','activity')
    or (p_action='create' and (p_activity_id is not null or p_expected_revision is not null))
    or (p_action<>'create' and (p_activity_id is null or p_expected_revision is null)) then
    raise exception using errcode='22023',message='Proposition invalide';
  end if;
  if p_action<>'create' then
    select * into a from public.native_execution_activities where id=p_activity_id and award_item_id=item.id and active for update;
    if a.id is null or a.revision<>p_expected_revision or a.kind<>p_kind then
      raise exception using errcode='40001',message='Révision d’activité obsolète';
    end if;
    activity_id:=a.id;
  else activity_id:=gen_random_uuid(); end if;
  if p_action<>'retire' and (length(btrim(coalesce(p_title,''))) not between 1 and 180
    or p_position not between 0 and 10000 or (p_duration_days is not null and p_duration_days not between 0 and 36500)
    or (p_planned_start is not null and p_planned_end is not null and p_planned_end<p_planned_start)) then
    raise exception using errcode='22023',message='Activité proposée invalide'; end if;
  if p_kind='sub_lot' and p_parent_activity_id is not null then raise exception using errcode='22023',message='Un sous-lot ne peut pas être imbriqué'; end if;
  if p_action<>'retire' and p_kind='activity' and p_parent_activity_id is not null and not exists(
    select 1 from public.native_execution_activities parent where parent.id=p_parent_activity_id
      and parent.award_item_id=item.id and parent.kind='sub_lot' and parent.active) then
    raise exception using errcode='22023',message='Sous-lot parent invalide'; end if;
  insert into public.native_execution_activity_proposals(project_id,request_id,award_item_id,proposed_by,idempotency_key,command_payload,action,
    activity_id,expected_revision,parent_activity_id,kind,title,scope,position,planned_start,planned_end,duration_days)
  values(item.project_id,item.request_id,item.id,actor,p_idempotency_key,payload,p_action,activity_id,p_expected_revision,p_parent_activity_id,
    p_kind,nullif(btrim(p_title),''),nullif(btrim(p_scope),''),coalesce(p_position,0),p_planned_start,p_planned_end,p_duration_days)
  returning id into proposal_id;
  return jsonb_build_object('proposalId',proposal_id,
    'activityId',activity_id,'state','pending_acceptance');
end;
$$;

create function public.native_execution_prepare_activity_change(
  p_award_item_id uuid,p_action text,p_activity_id uuid,p_parent_activity_id uuid,p_kind text,
  p_title text,p_scope text,p_position integer,p_planned_start date,p_planned_end date,
  p_duration_days integer,p_expected_revision integer,p_idempotency_key text
) returns jsonb language sql security invoker set search_path='' as $$
  select dao_private.native_execution_prepare_activity_change($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13);
$$;

create function dao_private.native_execution_accept_activity_change(p_proposal_id uuid,p_decision text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); proposal public.native_execution_activity_proposals; item public.award_items;
  party text; accepted_roles integer; a public.native_execution_activities;
begin
  if actor is null or not dao_private.account_active(actor) or p_decision not in ('accepted','rejected')
    or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 128 then
    raise exception using errcode='22023',message='Décision invalide'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key,0));
  select * into proposal from public.native_execution_activity_proposals where id=p_proposal_id for update;
  if proposal.id is null then raise exception using errcode='40001',message='Proposition non disponible'; end if;
  select * into item from public.award_items where id=proposal.award_item_id and active for update;
  if item.id is null then raise exception using errcode='42501',message='Attribution inactive'; end if;
  if dao_private.site_client_project(item.project_id) and exists(
      select 1 from public.awards a join public.project_requests r on r.id=item.request_id
      where a.id=item.award_id and a.project_id=item.project_id and a.status in ('confirmed','contracting','contracted')
        and r.status in ('awarded','contracted')) then party:='client';
  elsif dao_private.site_contractor_award_item(item.id) then party:='contractor';
  else raise exception using errcode='42501',message='Partie au lot attribué requise'; end if;
  if exists(select 1 from public.native_execution_activity_proposal_acceptances where actor_id=actor and idempotency_key=p_idempotency_key) then
    if exists(select 1 from public.native_execution_activity_proposal_acceptances where actor_id=actor and idempotency_key=p_idempotency_key
      and proposal_id=p_proposal_id and party_role=party and decision=p_decision) then
      return jsonb_build_object('proposalId',p_proposal_id,'state',proposal.state);
    end if;
    raise exception using errcode='22023',message='Clé idempotente réutilisée';
  end if;
  if proposal.state<>'pending_acceptance' then raise exception using errcode='40001',message='Proposition non disponible'; end if;
  if exists(select 1 from public.native_execution_activity_proposal_acceptances where proposal_id=p_proposal_id and party_role=party) then
    raise exception using errcode='23505',message='Décision déjà enregistrée';
  else
    insert into public.native_execution_activity_proposal_acceptances(proposal_id,party_role,actor_id,decision,idempotency_key)
      values(p_proposal_id,party,actor,p_decision,p_idempotency_key);
  end if;
  if p_decision='rejected' then
    update public.native_execution_activity_proposals set state='rejected' where id=p_proposal_id;
  elsif exists(select 1 from public.native_execution_activity_proposal_acceptances where proposal_id=p_proposal_id and decision='rejected') then
    update public.native_execution_activity_proposals set state='rejected' where id=p_proposal_id;
  else
    select count(*) into accepted_roles from public.native_execution_activity_proposal_acceptances where proposal_id=p_proposal_id and decision='accepted';
    if accepted_roles=2 then
      if proposal.action<>'retire' and proposal.kind='activity' and proposal.parent_activity_id is not null
        and not exists(select 1 from public.native_execution_activities parent where parent.id=proposal.parent_activity_id
          and parent.award_item_id=proposal.award_item_id and parent.kind='sub_lot' and parent.active) then
        update public.native_execution_activity_proposals set state='stale' where id=p_proposal_id;
        return jsonb_build_object('proposalId',p_proposal_id,'state','stale');
      end if;
      if proposal.action='create' then
        insert into public.native_execution_activities(id,project_id,request_id,award_item_id,parent_activity_id,kind,title,
          scope,position,planned_start,planned_end,duration_days,created_by,updated_by)
        values(proposal.activity_id,proposal.project_id,proposal.request_id,proposal.award_item_id,proposal.parent_activity_id,
          proposal.kind,proposal.title,proposal.scope,proposal.position,proposal.planned_start,proposal.planned_end,
          proposal.duration_days,proposal.proposed_by,actor) returning * into a;
        perform dao_private.native_activity_save_revision(a.id,'manager_change_accepted',actor);
      else
        select * into a from public.native_execution_activities where id=proposal.activity_id and award_item_id=proposal.award_item_id for update;
        if a.id is null or not a.active or a.revision<>proposal.expected_revision then
          update public.native_execution_activity_proposals set state='stale' where id=p_proposal_id;
          return jsonb_build_object('proposalId',p_proposal_id,'state','stale');
        end if;
        if proposal.action='retire' then
          if exists(select 1 from public.native_execution_activities c where c.parent_activity_id=a.id and c.active) then
            update public.native_execution_activity_proposals set state='stale' where id=p_proposal_id;
            return jsonb_build_object('proposalId',p_proposal_id,'state','stale');
          end if;
          update public.native_execution_activities set active=false,revision=revision+1,updated_at=now(),updated_by=actor where id=a.id returning * into a;
        else
          update public.native_execution_activities set parent_activity_id=proposal.parent_activity_id,title=proposal.title,
            scope=proposal.scope,position=proposal.position,planned_start=proposal.planned_start,planned_end=proposal.planned_end,
            duration_days=proposal.duration_days,revision=revision+1,updated_at=now(),updated_by=actor where id=a.id returning * into a;
        end if;
        perform dao_private.native_activity_save_revision(a.id,'manager_change_accepted',actor);
      end if;
      update public.native_execution_activity_proposals set state='accepted' where id=p_proposal_id;
    end if;
  end if;
  return jsonb_build_object('proposalId',p_proposal_id,'state',(select state from public.native_execution_activity_proposals where id=p_proposal_id));
end;
$$;

create function public.native_execution_accept_activity_change(p_proposal_id uuid,p_decision text,p_idempotency_key text)
returns jsonb language sql security invoker set search_path='' as $$
  select dao_private.native_execution_accept_activity_change($1,$2,$3);
$$;

create function dao_private.native_execution_activity_overlay(p_project_id uuid,p_base jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); workspace text; activity_items jsonb; proposals jsonb; agreements jsonb; lots jsonb;
  activities_truncated boolean:=false; proposals_truncated boolean:=false;
begin
  if actor is null or not dao_private.account_active(actor) then raise exception using errcode='42501',message='Authentification active requise'; end if;
  if dao_private.manages_project(p_project_id) then workspace:='dao_manager';
  elsif dao_private.site_client_project(p_project_id) then workspace:='client';
  elsif dao_private.site_actor_workspace('contractor') then workspace:='contractor';
  else raise exception using errcode='42501',message='Accès au suivi du projet refusé'; end if;

  activities_truncated:= (
    select count(*)>1000 from public.native_execution_activities a
    where a.project_id=p_project_id and exists(
      select 1 from jsonb_array_elements(coalesce(p_base->'lots','[]'::jsonb)) l
      where l.value#>>'{award,awardItemId}'=a.award_item_id::text)
  );
  select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'requestId',a.request_id,'awardItemId',a.award_item_id,
      'parentActivityId',a.parent_activity_id,'kind',a.kind,'title',a.title,'scope',a.scope,
      'position',a.position,'revision',a.revision,'active',a.active,'createdBy',a.created_by,'updatedBy',a.updated_by,'updatedAt',a.updated_at,
      'plannedDates',jsonb_build_object('start',a.planned_start,'end',a.planned_end,'durationDays',a.duration_days,'source','dao_native_execution'),
      'history',coalesce(history.items,'[]'::jsonb)
    ) order by a.request_id,a.position,a.id),'[]'::jsonb)
    into activity_items
  from (select a.* from public.native_execution_activities a
    where a.project_id=p_project_id and exists(
      select 1 from jsonb_array_elements(coalesce(p_base->'lots','[]'::jsonb)) l
      where l.value#>>'{award,awardItemId}'=a.award_item_id::text)
    order by a.request_id,a.position,a.id limit 1000) a
  left join lateral (
    select jsonb_agg(jsonb_build_object('revision',v.revision,'action',v.action,'title',v.title,
      'scope',v.scope,'position',v.position,'plannedStart',v.planned_start,'plannedEnd',v.planned_end,
      'durationDays',v.duration_days,'active',v.active,'actorId',v.actor_id,'at',v.created_at) order by v.revision desc) as items
    from (select h.* from public.native_execution_activity_revisions h
      where h.activity_id=a.id order by h.revision desc limit 20) v
  ) history on true;

  proposals_truncated:= (
    select count(*)>200 from public.native_execution_activity_proposals p
    where p.project_id=p_project_id and exists(
      select 1 from jsonb_array_elements(coalesce(p_base->'lots','[]'::jsonb)) l
      where l.value#>>'{award,awardItemId}'=p.award_item_id::text)
  );
  select coalesce(jsonb_agg(jsonb_build_object(
      'proposalId',p.id,'requestId',p.request_id,'awardItemId',p.award_item_id,'proposedBy',p.proposed_by,
      'activityId',p.activity_id,'action',p.action,'kind',p.kind,'title',p.title,'scope',p.scope,
      'parentActivityId',p.parent_activity_id,'position',p.position,
      'plannedDates',jsonb_build_object('start',p.planned_start,'end',p.planned_end,'durationDays',p.duration_days),
      'state',p.state,'createdAt',p.created_at,
      'acceptedBy',coalesce(acceptances.roles,'[]'::jsonb)
    ) order by p.created_at desc,p.id),'[]'::jsonb)
    into proposals
  from (select p.* from public.native_execution_activity_proposals p
    where p.project_id=p_project_id and exists(
      select 1 from jsonb_array_elements(coalesce(p_base->'lots','[]'::jsonb)) l
      where l.value#>>'{award,awardItemId}'=p.award_item_id::text)
    order by p.created_at desc,p.id limit 200) p
  left join lateral (select jsonb_agg(x.party_role order by x.party_role) as roles
    from public.native_execution_activity_proposal_acceptances x where x.proposal_id=p.id and x.decision='accepted') acceptances on true;

  select coalesce(jsonb_agg(agreement.value order by agreement.award_id),'[]'::jsonb)
    into agreements
  from (
    select distinct on (l.value#>>'{modalities,awardId}')
      l.value#>>'{modalities,awardId}' as award_id,l.value->'modalities' as value
    from jsonb_array_elements(coalesce(p_base->'lots','[]'::jsonb)) l(value)
    where jsonb_typeof(l.value->'modalities')='object'
    order by l.value#>>'{modalities,awardId}',l.value#>>'{requestId}'
  ) agreement;

  select coalesce(jsonb_agg(l.value || jsonb_build_object('permissions',
      coalesce(l.value->'permissions','{}'::jsonb) || jsonb_build_object(
        'canEditActivities',workspace='contractor' and dao_private.site_contractor_award_item((l.value#>>'{award,awardItemId}')::uuid),
        'canAcceptEngagingChange',l.value->'award'<>'null'::jsonb and workspace in ('client','contractor') and
          (workspace='client' and dao_private.site_client_project(p_project_id)
           or workspace='contractor' and dao_private.site_contractor_award_item((l.value#>>'{award,awardItemId}')::uuid))
      ),
      'modalities',case when jsonb_typeof(l.value->'modalities')='object' then
        jsonb_build_object('awardId',l.value#>>'{modalities,awardId}',
          'agreementVersionId',l.value#>>'{modalities,agreementVersionId}') else null end)
      order by l.ordinality),'[]'::jsonb)
    into lots
  from jsonb_array_elements(coalesce(p_base->'lots','[]'::jsonb)) with ordinality l(value,ordinality);

  return p_base || jsonb_build_object('lots',lots,'activities',jsonb_build_object('supported',true,'items',activity_items,'truncated',activities_truncated),
    'agreementsByAward',agreements,'changeProposals',proposals,'changeProposalsTruncated',proposals_truncated);
end;
$$;

create or replace function public.native_execution_plan_v1(
  p_project_id uuid,p_after_request_id uuid default null,p_limit integer default 50
) returns jsonb language plpgsql security definer set search_path='' as $$
declare base jsonb;
begin
  base:=dao_private.native_execution_plan_v1(p_project_id,p_after_request_id,p_limit);
  return dao_private.native_execution_activity_overlay(p_project_id,base);
end;
$$;

revoke all on function dao_private.native_activity_save_revision(uuid,text,uuid),
  dao_private.native_execution_activity_write(uuid,uuid,text,uuid,text,text,text,integer,date,date,integer,integer,text),
  dao_private.native_execution_prepare_activity_change(uuid,text,uuid,uuid,text,text,text,integer,date,date,integer,integer,text),
  dao_private.native_execution_accept_activity_change(uuid,text,text),
  dao_private.native_execution_activity_overlay(uuid,jsonb),
  public.native_execution_activity_write(uuid,uuid,text,uuid,text,text,text,integer,date,date,integer,integer,text),
  public.native_execution_prepare_activity_change(uuid,text,uuid,uuid,text,text,text,integer,date,date,integer,integer,text),
  public.native_execution_accept_activity_change(uuid,text,text) from public,anon,authenticated;
grant execute on function public.native_execution_activity_write(uuid,uuid,text,uuid,text,text,text,integer,date,date,integer,integer,text),
  public.native_execution_prepare_activity_change(uuid,text,uuid,uuid,text,text,text,integer,date,date,integer,integer,text),
  public.native_execution_accept_activity_change(uuid,text,text) to authenticated;
grant execute on function dao_private.native_execution_activity_write(uuid,uuid,text,uuid,text,text,text,integer,date,date,integer,integer,text),
  dao_private.native_execution_prepare_activity_change(uuid,text,uuid,uuid,text,text,text,integer,date,date,integer,integer,text),
  dao_private.native_execution_accept_activity_change(uuid,text,text) to authenticated;

commit;
