begin;

-- Mutable projections are separate from append-only business evidence.
create table public.account_states (
  user_id uuid primary key references auth.users, status text not null default 'active'
    check(status in ('active','suspended')), updated_at timestamptz not null default now()
);
create table public.review_assignments (
  project_id uuid primary key references public.projects,
  reviewer_id uuid references auth.users, assigned_at timestamptz,
  review_version_id uuid references public.project_versions,
  updated_at timestamptz not null default now()
);
create table public.request_sub_lots (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  request_id uuid not null, project_id uuid not null,
  foreign key(request_id,project_id) references public.project_requests(id,project_id),
  unique(id,request_id,project_id)
);
create table public.request_sub_lot_versions (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  sub_lot_id uuid not null, request_id uuid not null, project_id uuid not null,
  request_version_id uuid not null, ordinal integer not null check(ordinal>=0),
  title text not null check(length(trim(title)) between 1 and 200),
  scope text not null check(length(trim(scope)) between 1 and 10000),
  budget_millimes bigint check(budget_millimes>=0),
  foreign key(sub_lot_id,request_id,project_id) references public.request_sub_lots(id,request_id,project_id),
  foreign key(request_version_id,project_id,request_id) references public.project_request_versions(id,project_id,request_id),
  unique(sub_lot_id,request_version_id), unique(request_version_id,ordinal)
);
create table public.publication_lot_withdrawals (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  publication_request_id uuid not null unique references public.publication_requests,
  project_id uuid not null references public.projects, actor_id uuid not null references auth.users,
  reason text not null check(reason in ('correction','publication_error','client_request','postponed','scope_change','premature','other')),
  comment text, check(reason<>'other' or (comment is not null and length(trim(comment))>0))
);
create table public.notification_outbox (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  event_key text not null unique, project_id uuid references public.projects,
  recipient_id uuid not null references auth.users, kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
  attempts integer not null default 0 check(attempts between 0 and 5),
  next_attempt_at timestamptz not null default now(), lease_token uuid, lease_until timestamptz,
  first_attempt_at timestamptz, sent_at timestamptz, error_code text
);
create index notification_due on public.notification_outbox(status,next_attempt_at);
create table public.staff_invitation_requests (
  id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(),
  actor_id uuid not null references auth.users, email text not null,
  display_name text not null check(length(trim(display_name)) between 1 and 200),
  role text not null check(role in ('dao_reviewer','dao_admin')),
  target_user_id uuid references auth.users,
  status text not null default 'pending' check(status in ('pending','completed','failed')),
  idempotency_key text not null, unique(actor_id,idempotency_key)
);
alter table public.project_versions add column created_by uuid references auth.users default auth.uid();
alter table public.project_request_versions add column created_by uuid references auth.users default auth.uid();
alter table public.publication_requests add column technical_scope jsonb not null default '[]'::jsonb;
alter table public.bids add column publication_id uuid references public.publications;
alter table public.bids drop constraint bids_project_id_contractor_id_key;
alter table public.bids add constraint bids_project_contractor_publication_key unique(project_id,contractor_id,publication_id);
alter table public.bid_versions add column publication_id uuid references public.publications;
-- Only unsubmitted drafts are backfilled; submitted commercial rows are untouched.
update public.bid_versions bv set publication_id=(
  select (array_agg(p.id))[1] from public.publications p where p.project_id=bv.project_id
    and p.published_at<=bv.created_at and not exists(select 1 from public.bid_items bi where bi.bid_version_id=bv.id and not exists(select 1 from public.publication_requests pr where pr.publication_id=p.id and pr.request_version_id=bi.request_version_id)) having count(*)=1
) where bv.status='draft' and bv.submitted_at is null;
-- Header provenance is safe only when the project has exactly one historical
-- publication. No submitted version or commercial content is rewritten.
update public.bids b set publication_id=(select (array_agg(id))[1] from public.publications where project_id=b.project_id having count(*)=1)
where publication_id is null;
-- Existing reviews inherit their last actual staff decision, never a guessed
-- reviewer. New client submissions subsequently clear this projection.
insert into public.review_assignments(project_id,reviewer_id,assigned_at,review_version_id)
select p.id,review.actor_id,review.created_at,v.id from public.projects p
join lateral(select * from public.project_versions where project_id=p.id order by version_no desc limit 1) v on v.status in ('dao_review','approved','rejected')
join lateral(select * from public.project_reviews where project_version_id=v.id and actor_role='dao' order by created_at desc,id desc limit 1) review on true
where exists(select 1 from public.user_roles where user_id=review.actor_id and role in ('dao_reviewer','dao_admin'));
-- Multiple disjoint live publications permit republication of a withdrawn lot
-- while other lots remain open. A project-serialized trigger enforces lot uniqueness.
drop index public.one_live_publication;
create index live_publications_by_project on public.publications(project_id) where status in ('published','suspended');

create function dao_private.account_active(p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select p_user_id is not null and not exists(select 1 from public.account_states where user_id=p_user_id and status='suspended');
$$;
create function dao_private.admin() returns boolean
language sql stable security definer set search_path='' as $$
  select dao_private.account_active(auth.uid()) and exists(select 1 from public.user_roles where user_id=auth.uid() and role='dao_admin');
$$;
create or replace function dao_private.staff() returns boolean
language sql stable security definer set search_path='' as $$
  select dao_private.account_active(auth.uid()) and exists(select 1 from public.user_roles where user_id=auth.uid() and role in ('dao_admin','dao_reviewer'));
$$;
create function dao_private.manages_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select dao_private.admin() or (dao_private.staff() and exists(select 1 from public.review_assignments where project_id=p_project_id and reviewer_id=auth.uid()));
$$;
revoke all on function dao_private.account_active(uuid),dao_private.admin(),dao_private.manages_project(uuid) from public;
grant execute on function dao_private.account_active(uuid),dao_private.admin(),dao_private.manages_project(uuid) to anon,authenticated,service_role;

create function dao_private.require_staff_project(p_project_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not dao_private.manages_project(p_project_id) then raise exception using errcode='42501',message='Ce dossier appartient à un autre gestionnaire. Prenez en charge la revue.'; end if;
end; $$;
revoke all on function dao_private.require_staff_project(uuid) from public,anon,authenticated;

create function dao_private.append_only() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='23514',message='Historique immuable'; end; $$;
revoke all on function dao_private.append_only() from public,anon,authenticated;
create trigger immutable_audit_events before update or delete on public.audit_events for each row execute function dao_private.append_only();
create trigger immutable_sub_lot_identity before update or delete on public.request_sub_lots for each row execute function dao_private.append_only();
create trigger immutable_sub_lot_snapshot before update or delete on public.request_sub_lot_versions for each row execute function dao_private.append_only();
create trigger immutable_publication_withdrawal before update or delete on public.publication_lot_withdrawals for each row execute function dao_private.append_only();

create function dao_private.suspended_actor_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and not dao_private.account_active(auth.uid()) then raise exception using errcode='42501',message='Compte suspendu'; end if;
  if TG_OP='DELETE' then return OLD; end if; return NEW;
end; $$;
revoke all on function dao_private.suspended_actor_guard() from public,anon,authenticated;

-- Defense in depth: suspension applies immediately to existing JWTs, every
-- exposed table read and every mutation, including SECURITY DEFINER commands.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security',t.tablename);
    execute format('create policy active_account on public.%I as restrictive for all to authenticated using (dao_private.account_active(auth.uid())) with check (dao_private.account_active(auth.uid()))',t.tablename);
    execute format('create trigger active_actor before insert or update or delete on public.%I for each row execute function dao_private.suspended_actor_guard()',t.tablename);
  end loop;
end $$;

revoke all on public.account_states,public.review_assignments,public.request_sub_lots,public.request_sub_lot_versions,public.publication_lot_withdrawals,public.notification_outbox,public.staff_invitation_requests from public,anon,authenticated;
grant select on public.account_states,public.review_assignments,public.request_sub_lots,public.request_sub_lot_versions,public.publication_lot_withdrawals to authenticated;
grant all on public.account_states,public.review_assignments,public.request_sub_lots,public.request_sub_lot_versions,public.publication_lot_withdrawals,public.notification_outbox,public.staff_invitation_requests to service_role;
create policy read_allowed on public.account_states for select to authenticated using(user_id=auth.uid() or dao_private.staff());
create policy read_allowed on public.review_assignments for select to authenticated using(dao_private.staff() or dao_private.owner(project_id));
create policy read_allowed on public.request_sub_lots for select to authenticated using(dao_private.can_view_project(project_id));
create policy read_allowed on public.request_sub_lot_versions for select to authenticated using(dao_private.can_view_project(project_id));
create policy read_allowed on public.publication_lot_withdrawals for select to authenticated using(dao_private.staff() or dao_private.owner(project_id) or exists(select 1 from public.publication_requests pr where pr.id=publication_request_id and dao_private.publication(pr.publication_id)));
-- Outbox recipients/contents and staff invite emails are never exposed to browser reads.

create function dao_private.queue_project_notice(p_key text,p_project_id uuid,p_kind text,p_payload jsonb,p_recipient uuid default null)
returns void language plpgsql security definer set search_path='' as $$
declare recipient uuid; begin
  recipient:=coalesce(p_recipient,(select client_id from public.projects where id=p_project_id));
  if recipient is not null then
    insert into public.notification_outbox(event_key,project_id,recipient_id,kind,payload)
    values(p_key||':'||recipient::text,p_project_id,recipient,p_kind,p_payload) on conflict(event_key) do nothing;
  end if;
end; $$;
revoke all on function dao_private.queue_project_notice(text,uuid,text,jsonb,uuid) from public,anon,authenticated;

create function dao_private.audit_business(p_project_id uuid,p_action text,p_entity_type text,p_entity_id uuid,p_metadata jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),p_action,p_entity_type,p_entity_id,p_metadata||jsonb_build_object('project_id',p_project_id,'client_id',(select client_id from public.projects where id=p_project_id),'acting_for_client',dao_private.staff()));
end; $$;
revoke all on function dao_private.audit_business(uuid,text,text,uuid,jsonb) from public,anon,authenticated;

alter table public.project_versions add column superseded_by_id uuid references public.project_versions;

create function dao_private.claim_review(p_project_id uuid) returns public.project_versions
language plpgsql security definer set search_path='' as $$
declare v public.project_versions; a public.review_assignments; begin
  if not dao_private.staff() then raise exception using errcode='42501',message='Gestionnaire requis'; end if;
  perform 1 from public.projects where id=p_project_id for update;
  select * into v from public.project_versions where project_id=p_project_id order by version_no desc limit 1;
  if v.id is null or v.status not in ('client_review','dao_review') then raise exception using errcode='23514',message='Aucune revue à prendre en charge'; end if;
  select * into a from public.review_assignments where project_id=p_project_id;
  if a.reviewer_id is not null and a.reviewer_id<>auth.uid() then raise exception using errcode='42501',message='Revue déjà prise en charge'; end if;
  if a.reviewer_id is null then
    insert into public.review_assignments(project_id,reviewer_id,assigned_at,review_version_id)
    values(p_project_id,auth.uid(),now(),v.id)
    on conflict(project_id) do update set reviewer_id=excluded.reviewer_id,assigned_at=excluded.assigned_at,review_version_id=excluded.review_version_id,updated_at=now();
    perform dao_private.audit_business(p_project_id,'review_claimed','project',p_project_id,jsonb_build_object('version_id',v.id));
  end if;
  if v.status='client_review' then update public.project_versions set status='dao_review' where id=v.id returning * into v; end if;
  return v;
end; $$;
revoke all on function dao_private.claim_review(uuid) from public,anon,authenticated;

-- Existing review endpoints retain their interface, but claim/permissions are
-- now database-enforced. Refusing an unassigned dossier claims it atomically.
create or replace function dao_private.review_project(p_project_id uuid,p_approve boolean,p_comment text default null)
returns public.project_versions language plpgsql security definer set search_path='' as $$
declare v public.project_versions; begin
  if not dao_private.staff() then raise exception using errcode='42501',message='Gestionnaire requis'; end if;
  perform 1 from public.projects where id=p_project_id for update;
  select * into v from public.project_versions where project_id=p_project_id order by version_no desc limit 1;
  if v.id is null or v.status not in ('client_review','dao_review') then raise exception using errcode='23514',message='Aucune revue en attente'; end if;
  if p_approve is null then raise exception using errcode='22023',message='Décision explicite obligatoire'; end if;
  if not p_approve and nullif(trim(p_comment),'') is null then raise exception using errcode='22023',message='Motif de correction obligatoire'; end if;
  if v.status='client_review' or not exists(select 1 from public.review_assignments where project_id=p_project_id and reviewer_id is not null) then
    v:=dao_private.claim_review(p_project_id);
    if p_approve then return v; end if;
  end if;
  perform dao_private.require_staff_project(p_project_id);
  update public.project_versions set status=case when p_approve then 'approved' else 'rejected' end where id=v.id returning * into v;
  insert into public.project_reviews(project_version_id,actor_id,actor_role,decision,reason)
  values(v.id,auth.uid(),'dao',case when p_approve then 'approved' else 'rejected' end,nullif(trim(p_comment),''));
  perform dao_private.audit_business(p_project_id,case when p_approve then 'review_approved' else 'review_rejected' end,'project',p_project_id,jsonb_build_object('version_id',v.id,'reason',nullif(trim(p_comment),'')));
  return v;
end; $$;

create function dao_private.save_staff_review(p_project_id uuid,p_expected_version_id uuid,p_input jsonb)
returns public.project_versions language plpgsql security definer set search_path='' as $$
declare oldv public.project_versions; newv public.project_versions; lot jsonb; sub jsonb;
  oldrv public.project_request_versions; newrv public.project_request_versions;
  rid uuid; sid uuid; oldsubs jsonb; newsubs jsonb; seen uuid[]:='{}'; withdrawn uuid[]:='{}'; removed uuid; sub_seen uuid[]; ord integer;
begin
  perform 1 from public.projects where id=p_project_id for update;
  perform dao_private.require_staff_project(p_project_id);
  select * into oldv from public.project_versions where project_id=p_project_id order by version_no desc limit 1;
  if oldv.id is distinct from p_expected_version_id then raise exception using errcode='23514',message='Dossier modifié entre-temps : rechargez la version'; end if;
  if oldv.status not in ('client_review','dao_review') and not(oldv.status='approved' and exists(select 1 from public.publication_lot_withdrawals where project_id=p_project_id)) then
    raise exception using errcode='23514',message='Modification réservée à la revue ou à la correction après retrait'; end if;
  if nullif(trim(p_input->>'title'),'') is null or nullif(trim(p_input->>'description'),'') is null
    or jsonb_typeof(p_input->'lots') is distinct from 'array' or jsonb_array_length(p_input->'lots') not between 1 and 100 then
    raise exception using errcode='22023',message='Titre, périmètre et au moins un lot obligatoires'; end if;
  -- The editable assembly is a new draft within this transaction only. It
  -- becomes dao_review after every exact lot/sub-lot snapshot has been linked.
  insert into public.project_versions(project_id,version_no,title,description,governorate_id,delegation_id,locality_id,status,project_type,surface_m2,desired_start_date,desired_end_date,indicative_budget_millimes)
  values(p_project_id,oldv.version_no+1,trim(p_input->>'title'),trim(p_input->>'description'),
    coalesce(nullif(p_input->>'governorate_id','')::uuid,oldv.governorate_id),
    case when p_input?'delegation_id' then nullif(p_input->>'delegation_id','')::uuid else oldv.delegation_id end,
    case when p_input?'locality_id' then nullif(p_input->>'locality_id','')::uuid else oldv.locality_id end,'draft',
    coalesce(p_input->>'project_type',oldv.project_type),
    case when p_input?'surface_m2' then nullif(p_input->>'surface_m2','')::numeric else oldv.surface_m2 end,
    case when p_input?'desired_start_date' then nullif(p_input->>'desired_start_date','')::date else oldv.desired_start_date end,
    case when p_input?'desired_end_date' then nullif(p_input->>'desired_end_date','')::date else oldv.desired_end_date end,
    case when p_input?'indicative_budget_millimes' then nullif(p_input->>'indicative_budget_millimes','')::bigint else oldv.indicative_budget_millimes end)
  returning * into newv;
  for lot in select value from jsonb_array_elements(coalesce(p_input->'withdraw_lots','[]')) loop
    removed:=(lot->>'request_id')::uuid;
    if nullif(trim(lot->>'reason'),'') is null or not exists(select 1 from public.project_version_requests l join public.project_request_versions rv on rv.id=l.request_version_id where l.project_version_id=oldv.id and rv.request_id=removed)
      or exists(select 1 from public.publication_requests pr join public.project_request_versions rv on rv.id=pr.request_version_id where rv.request_id=removed)
      or exists(select 1 from public.award_items where request_id=removed) then raise exception using errcode='23514',message='Retrait réservé à un lot de la revue encore jamais publié, avec motif'; end if;
    update public.project_requests set status='withdrawn' where id=removed;
    withdrawn:=array_append(withdrawn,removed);
    perform dao_private.audit_business(p_project_id,'review_lot_withdrawn','request',removed,jsonb_build_object('reason',lot->>'reason','previous_version_id',oldv.id));
  end loop;
  for lot in select value from jsonb_array_elements(p_input->'lots') loop
    rid:=nullif(lot->>'request_id','')::uuid; oldrv:=null;
    if nullif(trim(lot->>'title'),'') is null or nullif(trim(lot->>'scope'),'') is null or not exists(select 1 from public.trades where id=(lot->>'trade_id')::uuid and active) then raise exception using errcode='22023',message='Lot : métier, titre et périmètre obligatoires'; end if;
    if rid is null then
      insert into public.project_requests(project_id) values(p_project_id) returning id into rid;
      perform dao_private.audit_business(p_project_id,'lot_created','request',rid);
    else
      if rid=any(seen) or not exists(select 1 from public.project_requests where id=rid and project_id=p_project_id and status<>'withdrawn') then raise exception using errcode='22023',message='Lot invalide ou dupliqué'; end if;
      select rv.* into oldrv from public.project_request_versions rv join public.project_version_requests l on l.request_version_id=rv.id where l.project_version_id=oldv.id and rv.request_id=rid;
      if oldrv.id is null then raise exception using errcode='23514',message='Lot absent de la version examinée'; end if;
    end if;
    seen:=array_append(seen,rid);
    if jsonb_typeof(coalesce(lot->'sub_lots','[]'::jsonb))<>'array' or jsonb_array_length(coalesce(lot->'sub_lots','[]'::jsonb))>100 then raise exception using errcode='22023',message='Sous-lots invalides'; end if;
    newsubs:=coalesce(lot->'sub_lots','[]'::jsonb);
    select coalesce(jsonb_agg(jsonb_build_object('id',sub_lot_id,'title',title,'scope',scope,'budget_millimes',budget_millimes) order by ordinal),'[]'::jsonb) into oldsubs from public.request_sub_lot_versions where request_version_id=oldrv.id;
    if oldrv.id is not null and oldrv.title=trim(lot->>'title') and oldrv.scope=trim(lot->>'scope') and oldrv.trade_id=(lot->>'trade_id')::uuid and oldrv.budget_millimes is not distinct from nullif(lot->>'budget_millimes','')::bigint and oldsubs=newsubs then newrv:=oldrv;
    else
      if exists(select 1 from public.award_items where request_id=rid and active)
        or exists(select 1 from public.publication_requests pr join public.publications p on p.id=pr.publication_id join public.project_request_versions rv on rv.id=pr.request_version_id where rv.request_id=rid and p.status in ('published','suspended') and not exists(select 1 from public.publication_lot_withdrawals w where w.publication_request_id=pr.id)) then
        raise exception using errcode='23514',message='Retirez le lot de la publication avant de corriger son périmètre'; end if;
      insert into public.project_request_versions(request_id,project_id,version_no,trade_id,title,scope,budget_millimes)
      values(rid,p_project_id,coalesce((select max(version_no) from public.project_request_versions where request_id=rid),0)+1,(lot->>'trade_id')::uuid,trim(lot->>'title'),trim(lot->>'scope'),nullif(lot->>'budget_millimes','')::bigint) returning * into newrv;
      ord:=0; sub_seen:='{}';
      for sub in select value from jsonb_array_elements(newsubs) loop
        sid:=nullif(sub->>'id','')::uuid;
        if sid is null then insert into public.request_sub_lots(request_id,project_id) values(rid,p_project_id) returning id into sid;
        elsif sid=any(sub_seen) or not exists(select 1 from public.request_sub_lots where id=sid and request_id=rid and project_id=p_project_id) then raise exception using errcode='22023',message='Sous-lot invalide ou dupliqué'; end if;
        sub_seen:=array_append(sub_seen,sid);
        insert into public.request_sub_lot_versions(sub_lot_id,request_id,project_id,request_version_id,ordinal,title,scope,budget_millimes)
        values(sid,rid,p_project_id,newrv.id,ord,trim(sub->>'title'),trim(sub->>'scope'),nullif(sub->>'budget_millimes','')::bigint);
        perform dao_private.audit_business(p_project_id,'sub_lot_versioned','sub_lot',sid,jsonb_build_object('request_id',rid,'request_version_id',newrv.id,'ordinal',ord)); ord:=ord+1;
      end loop;
      if oldrv.id is not null then perform dao_private.audit_business(p_project_id,'lot_updated','request',rid,jsonb_build_object('previous_version_id',oldrv.id,'version_id',newrv.id)); end if;
    end if;
    insert into public.project_version_requests(project_id,project_version_id,request_version_id) values(p_project_id,newv.id,newrv.id);
  end loop;
  if exists(select 1 from public.project_version_requests l join public.project_request_versions rv on rv.id=l.request_version_id where l.project_version_id=oldv.id and not(rv.request_id=any(seen) or rv.request_id=any(withdrawn))) then
    raise exception using errcode='23514',message='Conservez les lots historiques ; retrait via la commande dédiée'; end if;
  update public.project_versions set status='dao_review' where id=newv.id returning * into newv;
  update public.project_versions set superseded_by_id=newv.id where id=oldv.id;
  update public.review_assignments set review_version_id=newv.id,updated_at=now() where project_id=p_project_id;
  perform dao_private.audit_business(p_project_id,'staff_project_updated','project',p_project_id,jsonb_build_object('previous_version_id',oldv.id,'version_id',newv.id));
  return newv;
end; $$;
revoke all on function dao_private.save_staff_review(uuid,uuid,jsonb) from public,anon,authenticated;

create function dao_private.backoffice_command(p_action text,p_input jsonb,p_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb; project uuid; target uuid; v public.project_versions;
  rowp public.publication_requests; req uuid; assignment public.review_assignments;
  current_state text; changed boolean; inv public.staff_invitation_requests; prof public.contractor_profiles;
begin
  if actor is null or not dao_private.staff() then raise exception using errcode='42501',message='Accès réservé au back-office'; end if;
  if p_key is null or length(trim(p_key)) not between 8 and 200 or jsonb_typeof(p_input)<>'object' then raise exception using errcode='22023',message='Commande invalide'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=actor and cr.idempotency_key=p_key;
  if result is not null then
    if result->>'action' is distinct from p_action or result->'input' is distinct from p_input then raise exception using errcode='22023',message='Clé réutilisée pour une autre commande'; end if;
    return result->'data';
  end if;
  project:=nullif(p_input->>'project_id','')::uuid; target:=nullif(p_input->>'user_id','')::uuid;
  if p_action='claim' then v:=dao_private.claim_review(project); result:=to_jsonb(v);
  elsif p_action='reassign' then
    if not dao_private.admin() or nullif(trim(p_input->>'reason'),'') is null then raise exception using errcode='42501',message='Admin et motif de réaffectation requis'; end if;
    perform 1 from public.projects where id=project for update;
    select * into v from public.project_versions where project_id=project order by version_no desc limit 1;
    if v.status not in ('client_review','dao_review') or not dao_private.account_active(target) or not exists(select 1 from public.user_roles where user_id=target and role in ('dao_reviewer','dao_admin')) then raise exception using errcode='23514',message='Revue ou gestionnaire indisponible'; end if;
    select * into assignment from public.review_assignments where project_id=project;
    insert into public.review_assignments(project_id,reviewer_id,assigned_at,review_version_id) values(project,target,now(),v.id)
    on conflict(project_id) do update set reviewer_id=excluded.reviewer_id,assigned_at=excluded.assigned_at,review_version_id=excluded.review_version_id,updated_at=now();
    update public.project_versions set status='dao_review' where id=v.id;
    perform dao_private.audit_business(project,'review_reassigned','project',project,jsonb_build_object('previous_reviewer_id',assignment.reviewer_id,'reviewer_id',target,'reason',p_input->>'reason')); result:=jsonb_build_object('reviewer_id',target);
  elsif p_action='save_review' then v:=dao_private.save_staff_review(project,(p_input->>'expected_version_id')::uuid,p_input->'data'); result:=to_jsonb(v);
  elsif p_action='withdraw_publication_lot' then
    select * into rowp from public.publication_requests where id=(p_input->>'publication_request_id')::uuid;
    select project_id into project from public.publications where id=rowp.publication_id;
    perform 1 from public.projects where id=project for update; perform dao_private.require_staff_project(project);
    select request_id into req from public.project_request_versions where id=rowp.request_version_id;
    if not exists(select 1 from public.publications where id=rowp.publication_id and status in ('published','suspended')) or exists(select 1 from public.publication_lot_withdrawals where publication_request_id=rowp.id) then raise exception using errcode='23514',message='Lot déjà retiré ou publication inactive'; end if;
    if exists(select 1 from public.award_items where request_id=req and active) then raise exception using errcode='23514',message='Annuler d’abord l’attribution'; end if;
    insert into public.publication_lot_withdrawals(publication_request_id,project_id,actor_id,reason,comment) values(rowp.id,project,actor,p_input->>'reason',nullif(trim(p_input->>'comment'),''));
    if not exists(select 1 from public.publication_requests pr where pr.publication_id=rowp.publication_id and not exists(select 1 from public.publication_lot_withdrawals w where w.publication_request_id=pr.id)) then update public.publications set status='closed',closed_at=now() where id=rowp.publication_id; end if;
    perform dao_private.audit_business(project,'publication_lot_withdrawn','request',req,jsonb_build_object('publication_id',rowp.publication_id,'publication_request_id',rowp.id,'reason',p_input->>'reason','comment',p_input->>'comment','title',rowp.safe_title));
    perform dao_private.queue_project_notice('withdraw:'||rowp.id,project,'lot_withdrawn',jsonb_build_object('lot',rowp.safe_title,'reason',p_input->>'reason','comment',p_input->>'comment'));
    for target in select distinct cp.user_id from public.bid_items bi join public.bid_versions bv on bv.id=bi.bid_version_id join public.contractor_profiles cp on cp.id=bv.contractor_id where bi.request_version_id=rowp.request_version_id and bv.submitted_at is not null loop
      perform dao_private.queue_project_notice('withdraw-pro:'||rowp.id,project,'lot_withdrawn_professional',jsonb_build_object('lot',rowp.safe_title),target);
    end loop; result:=jsonb_build_object('request_id',req,'status','withdrawn');
  elsif p_action in ('assisted_award','assisted_cancel') then
    if nullif(trim(p_input->>'reason'),'') is null then raise exception using errcode='22023',message='Indiquez le contexte de la demande du client'; end if;
    if p_action='assisted_cancel' then select project_id into project from public.award_items where id=(p_input->>'award_item_id')::uuid;
    elsif nullif(p_input->>'group_id','') is not null then select bv.project_id into project from public.bid_groups g join public.bid_versions bv on bv.id=g.bid_version_id where g.id=(p_input->>'group_id')::uuid;
    else select project_id into project from public.bid_items where id=(p_input->>'bid_item_id')::uuid; end if;
    perform 1 from public.projects where id=project for update;
    perform dao_private.require_staff_project(project);
    if p_action='assisted_award' then result:=dao_private.award_offer_atomic(p_key||':award',nullif(p_input->>'bid_item_id','')::uuid,nullif(p_input->>'group_id','')::uuid);
    else result:=dao_private.cancel_award_item_atomic(p_key||':cancel',(p_input->>'award_item_id')::uuid,p_input->>'cancellation_reason',p_input->>'comment'); end if;
    perform dao_private.audit_business(project,p_action,'project',project,result||jsonb_build_object('reason',p_input->>'reason'));
  elsif p_action='professional' then
    select * into prof from public.contractor_profiles where id=(p_input->>'contractor_id')::uuid for update;
    if prof.id is null then raise exception using errcode='22023',message='Professionnel inconnu'; end if;
    current_state:=p_input->>'decision';
    if current_state in ('suspend','reactivate','approve_identity','hide_identity') and not dao_private.admin() then raise exception using errcode='42501',message='Action Admin uniquement'; end if;
    if current_state in ('reject','suspend') and nullif(trim(p_input->>'reason'),'') is null then raise exception using errcode='22023',message='Motif obligatoire'; end if;
    if current_state in ('verify','reject') and prof.verification_status='suspended' and not dao_private.admin() then raise exception using errcode='42501',message='La réactivation relève de l’Admin'; end if;
    if current_state not in ('verify','reject','suspend','reactivate','approve_identity','hide_identity') then raise exception using errcode='22023',message='Décision invalide'; end if;
    update public.contractor_profiles set verification_status=case current_state when 'verify' then 'verified' when 'reject' then 'rejected' when 'suspend' then 'suspended' when 'reactivate' then 'pending' else verification_status end,
      public_identity_status=case current_state when 'approve_identity' then 'approved' when 'hide_identity' then 'hidden' else public_identity_status end where id=prof.id returning * into prof;
    insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata) values(actor,'professional_'||current_state,'contractor',prof.id,jsonb_build_object('user_id',prof.user_id,'reason',p_input->>'reason'));
    result:=to_jsonb(prof);
  elsif p_action in ('role','account') then
    if not dao_private.admin() then raise exception using errcode='42501',message='Administration réservée'; end if;
    perform pg_advisory_xact_lock(640064);
    if not dao_private.admin() then raise exception using errcode='42501',message='Administration révoquée'; end if;
    if not exists(select 1 from auth.users where id=target) then raise exception using errcode='22023',message='Compte inconnu'; end if;
    if p_action='account' then
      if p_input->>'status' not in ('active','suspended') or (p_input->>'status'='suspended' and nullif(trim(p_input->>'reason'),'') is null) then raise exception using errcode='22023',message='État et motif requis'; end if;
      if target=actor and p_input->>'status'='suspended' then raise exception using errcode='23514',message='Vous ne pouvez pas suspendre votre propre compte'; end if;
      insert into public.account_states(user_id,status) values(target,p_input->>'status') on conflict(user_id) do update set status=excluded.status,updated_at=now();
    else
      if p_input->>'role' not in ('client','contractor','dao_reviewer','dao_admin') or jsonb_typeof(p_input->'enabled') is distinct from 'boolean' then raise exception using errcode='22023',message='Rôle et activation explicites requis'; end if;
      if (p_input->>'enabled')::boolean then
        if p_input->>'role'='contractor' and not exists(select 1 from public.contractor_profiles where user_id=target) then raise exception using errcode='23514',message='Complétez d’abord le profil professionnel ; aucun profil fictif'; end if;
        insert into public.user_roles(user_id,role) values(target,p_input->>'role') on conflict(user_id,role) do nothing;
      else delete from public.user_roles where user_id=target and role=p_input->>'role'; end if;
    end if;
    if not exists(select 1 from public.user_roles where role='dao_admin' and dao_private.account_active(user_id)) then raise exception using errcode='23514',message='Impossible de retirer ou suspendre le dernier Admin actif'; end if;
    insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata) values(actor,'account_'||p_action,'user',target,p_input-'idempotency_key'); result:=jsonb_build_object('user_id',target);
  elsif p_action='prepare_staff_invitation' then
    if not dao_private.admin() or p_input->>'role' not in ('dao_reviewer','dao_admin') or p_input->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception using errcode='42501',message='Invitation staff réservée à l’Admin'; end if;
    insert into public.staff_invitation_requests(actor_id,email,display_name,role,idempotency_key) values(actor,lower(trim(p_input->>'email')),trim(p_input->>'display_name'),p_input->>'role',p_key) returning * into inv; result:=to_jsonb(inv);
  elsif p_action='complete_staff_invitation' then
    if not dao_private.admin() then raise exception using errcode='42501',message='Admin requis'; end if;
    select * into inv from public.staff_invitation_requests where id=(p_input->>'invitation_id')::uuid and actor_id=actor for update;
    if inv.id is null or inv.status='failed' or not exists(select 1 from auth.users u where u.id=target and lower(to_jsonb(u)->>'email')=inv.email) then raise exception using errcode='42501',message='Invitation ou identité invalide'; end if;
    insert into public.profiles(user_id,display_name) values(target,inv.display_name) on conflict(user_id) do nothing;
    insert into public.user_roles(user_id,role) values(target,inv.role) on conflict(user_id,role) do nothing;
    update public.staff_invitation_requests set status='completed',target_user_id=target where id=inv.id;
    insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata) values(actor,'staff_invited','user',target,jsonb_build_object('role',inv.role,'invitation_id',inv.id)); result:=jsonb_build_object('invitation_id',inv.id,'status','completed');
  else raise exception using errcode='22023',message='Commande back-office inconnue'; end if;
  insert into public.command_receipts(actor_id,idempotency_key,command,result) values(actor,p_key,'backoffice_'||p_action,jsonb_build_object('action',p_action,'input',p_input,'data',result));
  return result;
end; $$;
create function public.backoffice_command(p_action text,p_input jsonb,p_key text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.backoffice_command($1,$2,$3); $$;
revoke all on function dao_private.backoffice_command(text,jsonb,text),public.backoffice_command(text,jsonb,text) from public,anon;
grant execute on function dao_private.backoffice_command(text,jsonb,text),public.backoffice_command(text,jsonb,text) to authenticated,service_role;

create or replace function dao_private.publish_project(
  p_project_id uuid,p_visibility text,p_request_ids uuid[] default null,
  p_contractor_ids uuid[] default null,p_submission_deadline timestamptz default null
) returns public.publications
language plpgsql security definer set search_path=''
as $$
declare
  v public.project_versions;
  p public.publications;
  rid uuid;
  rv public.project_request_versions;
  v_request public.project_requests;
  c uuid;
begin
  if auth.uid() is null or not dao_private.staff() then
    raise exception using errcode='42501',message='DAO reviewer required';
  end if;
  perform 1 from public.projects where id=p_project_id for update;
  perform dao_private.require_staff_project(p_project_id);
  select * into v
  from public.project_versions
  where project_id=p_project_id
  order by version_no desc
  limit 1
  for update;
  if v.id is null or v.status<>'approved' then
    raise exception using errcode='23514',message='approved project version required';
  end if;
  if p_visibility is null or p_visibility not in ('public','targeted','invite_only') then
    raise exception using errcode='23514',message='invalid visibility';
  end if;
  if p_visibility<>'public' and coalesce(cardinality(p_contractor_ids),0)=0 then
    raise exception using errcode='23514',message='recipients required';
  end if;
  if p_request_ids is null or cardinality(p_request_ids)=0 then
    raise exception using errcode='23514',message='at least one request must be selected';
  end if;
  if exists (
    select 1 from unnest(p_request_ids) as selected(request_id)
    where selected.request_id is null
  ) then
    raise exception using errcode='23514',message='request selection cannot contain null';
  end if;
  if (select count(*) from unnest(p_request_ids)) <>
     (select count(distinct selected.request_id) from unnest(p_request_ids) as selected(request_id)) then
    raise exception using errcode='23514',message='request selection cannot contain duplicates';
  end if;

  -- Validate every request against the exact snapshots attached to the
  -- approved project version before creating any publication rows.
  for rid in select selected.request_id from unnest(p_request_ids) as selected(request_id) loop
    select * into v_request
    from public.project_requests r
    where r.id=rid and r.project_id=p_project_id and r.status='open'
    for update;
    if v_request.id is null then
      raise exception using errcode='23514',message='selected request must be active in this project';
    end if;

    select snapshot.* into rv
    from public.project_version_requests pvr
    join public.project_request_versions snapshot
      on snapshot.id=pvr.request_version_id and snapshot.project_id=pvr.project_id
    where pvr.project_id=p_project_id
      and pvr.project_version_id=v.id
      and snapshot.request_id=rid;
    if rv.id is null then
      raise exception using errcode='23514',message='selected request is not included in the approved project version';
    end if;
  end loop;

  insert into public.publications(project_id,project_version_id,visibility,safe_title,safe_description,
    governorate_id,delegation_id,project_type,surface_m2,desired_start_date,desired_end_date,
    indicative_budget_millimes,submission_deadline)
  values(p_project_id,v.id,p_visibility,v.title,v.description,v.governorate_id,v.delegation_id,
    v.project_type,v.surface_m2,v.desired_start_date,v.desired_end_date,v.indicative_budget_millimes,
    p_submission_deadline)
  returning * into p;

  for rid in select selected.request_id from unnest(p_request_ids) as selected(request_id) loop
    select snapshot.* into rv
    from public.project_version_requests pvr
    join public.project_request_versions snapshot
      on snapshot.id=pvr.request_version_id and snapshot.project_id=pvr.project_id
    where pvr.project_id=p_project_id
      and pvr.project_version_id=v.id
      and snapshot.request_id=rid;
    insert into public.publication_requests(publication_id,request_version_id,trade_id,safe_title,safe_scope)
    values(p.id,rv.id,rv.trade_id,rv.title,rv.scope);
  end loop;

  if p_visibility<>'public' then
    foreach c in array p_contractor_ids loop
      insert into public.publication_recipients(publication_id,contractor_id,source)
      values(p.id,c,case when p_visibility='targeted' then 'targeted' else 'invitation' end);
    end loop;
  end if;
  update public.projects set status='open' where id=p_project_id;
  perform dao_private.audit_business(p_project_id,'publication_created','publication',p.id,jsonb_build_object('version_id',v.id));
  return p;
end;
$$;


create or replace function dao_private.create_bid_draft(p_publication_id uuid)
returns public.bid_versions
language plpgsql
security definer
set search_path=''
as $$
declare
  v_publication public.publications;
  v_contractor uuid;
  v_bid public.bids;
  v_version public.bid_versions;
  v_next_version integer;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select cp.id into v_contractor
  from public.contractor_profiles cp
  where cp.user_id=auth.uid() and cp.verification_status='verified'
    and exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role='contractor');
  if v_contractor is null then raise exception using errcode='42501',message='verified contractor role required'; end if;
  select p.* into v_publication
  from public.publications p
  where p.id=p_publication_id and p.status='published'
    and (p.submission_deadline is null or p.submission_deadline>now())
    and dao_private.publication(p.id);
  if v_publication.id is null then raise exception using errcode='42501',message='publication unavailable'; end if;
  perform 1 from public.projects where id=v_publication.project_id for update;
  if not exists(select 1 from public.publication_requests pr
    join public.project_request_versions rv on rv.id=pr.request_version_id
    join public.project_requests r on r.id=rv.request_id
    where pr.publication_id=p_publication_id and r.status in ('open','reserved') and not exists(select 1 from public.publication_lot_withdrawals w where w.publication_request_id=pr.id)
      and not exists(select 1 from public.award_items ai where ai.request_id=r.id and ai.active)) then
    raise exception using errcode='23514',message='aucun lot ouvert aux offres';
  end if;
  insert into public.bids(project_id,contractor_id,publication_id)
  values(v_publication.project_id,v_contractor,p_publication_id) on conflict(project_id,contractor_id,publication_id) do nothing;
  -- Serialize retries for the same contractor/project before choosing the
  -- next version number, making duplicate clicks safe under concurrency.
  select b.* into v_bid from public.bids b
  where b.project_id=v_publication.project_id and b.contractor_id=v_contractor and b.publication_id=p_publication_id
  for update;
  select bv.* into v_version from public.bid_versions bv
  where bv.bid_id=v_bid.id and bv.status='draft' and bv.publication_id=p_publication_id and exists(select 1 from public.contractor_profiles cp where cp.id=bv.contractor_id and cp.verification_status='verified') order by bv.version_no desc limit 1;
  if v_version.id is not null then return v_version; end if;
  select coalesce(max(bv.version_no),0)+1 into v_next_version from public.bid_versions bv where bv.bid_id=v_bid.id;
  insert into public.bid_versions(bid_id,project_id,version_no,contractor_id,publication_id,expires_at)
  values(v_bid.id,v_publication.project_id,v_next_version,v_contractor,p_publication_id,coalesce(v_publication.submission_deadline,now()+interval '30 days'))
  returning * into v_version;
  return v_version;
end;
$$;

create or replace function dao_private.upsert_bid_item(
  p_publication_id uuid,
  p_version_id uuid,
  p_publication_request_id uuid,
  p_price_millimes bigint,
  p_duration_days integer,
  p_inclusions text,
  p_exclusions text default null
)
returns public.bid_items
language plpgsql
security definer
set search_path=''
as $$
declare
  v_version public.bid_versions;
  v_publication public.publications;
  v_publication_request public.publication_requests;
  v_item public.bid_items;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='authentication required';
  end if;
  if p_price_millimes<0 or p_duration_days<=0 or nullif(trim(p_inclusions),'') is null then
    raise exception using errcode='23514', message='invalid bid item';
  end if;

  perform 1 from public.projects where id=(select project_id from public.bid_versions where id=p_version_id) for update;
  select bv.* into v_version
  from public.bid_versions bv
  where bv.id=p_version_id
    and bv.status='draft' and bv.publication_id=p_publication_id and exists(select 1 from public.contractor_profiles cp where cp.id=bv.contractor_id and cp.verification_status='verified')
    and dao_private.pro(bv.contractor_id)
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id=auth.uid() and ur.role='contractor'
    );
  if v_version.id is null then
    raise exception using errcode='42501', message='owned draft required';
  end if;

  select p.* into v_publication
  from public.publications p
  where p.id=p_publication_id
    and p.project_id=v_version.project_id
    and p.status='published'
    and (p.submission_deadline is null or p.submission_deadline>now())
    and dao_private.publication(p.id);
  if v_publication.id is null then
    raise exception using errcode='42501', message='publication unavailable';
  end if;

  select pr.* into v_publication_request
  from public.publication_requests pr
  join public.project_request_versions rv on rv.id=pr.request_version_id
  where pr.publication_id=v_publication.id
    and pr.id=p_publication_request_id and not exists(select 1 from public.publication_lot_withdrawals w where w.publication_request_id=pr.id)
    and rv.project_id=v_version.project_id;
  if v_publication_request.id is null then
    raise exception using errcode='42501', message='request is not published';
  end if;

  if not exists(select 1 from public.project_request_versions rv join public.project_requests r on r.id=rv.request_id
    where rv.id=v_publication_request.request_version_id and r.status in ('open','reserved')
      and not exists(select 1 from public.award_items ai where ai.request_id=r.id and ai.active)) then
    raise exception using errcode='23514',message='lot fermé aux nouvelles offres';
  end if;
  insert into public.bid_items(
    bid_version_id,project_id,request_version_id,price_millimes,
    duration_days,inclusions,exclusions,contractor_id,request_id
  )
  select
    v_version.id,v_version.project_id,v_publication_request.request_version_id,
    p_price_millimes,p_duration_days,p_inclusions,p_exclusions,
    v_version.contractor_id,(select rv.request_id from public.project_request_versions rv where rv.id=v_publication_request.request_version_id)
  on conflict(bid_version_id,request_version_id) do update set
    price_millimes=excluded.price_millimes,
    duration_days=excluded.duration_days,
    inclusions=excluded.inclusions,
    exclusions=excluded.exclusions
  returning * into v_item;
  return v_item;
end;
$$;

create or replace function dao_private.submit_bid_version(p_version_id uuid)
returns public.bid_versions
language plpgsql
security definer
set search_path=''
as $$
declare
  v public.bid_versions;
  v_item_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='authentication required';
  end if;

  perform 1 from public.projects where id=(select project_id from public.bid_versions where id=p_version_id) for update;
  select bv.* into v
  from public.bid_versions bv
  where bv.id=p_version_id
    and bv.status='draft' and exists(select 1 from public.contractor_profiles cp where cp.id=bv.contractor_id and cp.verification_status='verified')
    and dao_private.pro(bv.contractor_id)
    and exists (
      select 1 from public.user_roles ur
      where ur.user_id=auth.uid() and ur.role='contractor'
    );
  if v.id is null then
    raise exception using errcode='42501', message='bid is not an owned draft';
  end if;

  select count(*) into v_item_count
  from public.bid_items bi where bi.bid_version_id=v.id;
  if v_item_count=0 then
    raise exception using errcode='23514', message='at least one bid item required';
  end if;

  if not exists (
    select 1
    from public.publications p
    where p.project_id=v.project_id and p.id=v.publication_id
      and p.status='published'
      and (p.submission_deadline is null or p.submission_deadline>now())
      and dao_private.publication(p.id)
      and not exists (
        select 1 from public.bid_items bi
        where bi.bid_version_id=v.id
          and not exists (
            select 1 from public.publication_requests pr
            where pr.publication_id=p.id
              and pr.request_version_id=bi.request_version_id and not exists(select 1 from public.publication_lot_withdrawals w where w.publication_request_id=pr.id)
          )
      )
  ) then
    raise exception using errcode='42501', message='bid requests are not published';
  end if;

  if exists(select 1 from public.bid_items bi join public.project_requests r on r.id=bi.request_id
    where bi.bid_version_id=v.id and (r.status not in ('open','reserved')
      or exists(select 1 from public.award_items ai where ai.request_id=r.id and ai.active))) then
    raise exception using errcode='23514',message='lot fermé aux nouvelles offres';
  end if;
  update public.bid_versions
  set status='superseded', validity='obsolete'
  where bid_id=v.bid_id
    and id<>v.id
    and status='submitted'
    and submitted_at is not null;

  update public.bid_versions
  set status='submitted', submitted_at=now(), validity='current'
  where id=v.id and status='draft'
  returning * into v;
  if not found then
    raise exception using errcode='42501', message='bid is not an owned draft';
  end if;
  return v;
end;
$$;

create or replace function dao_private.publication_lot_availability(p_publication_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null or not dao_private.publication(p_publication_id) then
    raise exception using errcode='42501',message='publication unavailable';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('publication_request_id',pr.id,'request_id',rv.request_id,
    'status',case when exists(select 1 from public.publication_lot_withdrawals w where w.publication_request_id=pr.id) then 'withdrawn' else r.status end,'accepts_offers',exists(select 1 from public.publications p where p.id=pr.publication_id and p.status='published') and not exists(select 1 from public.publication_lot_withdrawals w where w.publication_request_id=pr.id) and r.status in ('open','reserved') and not exists(select 1 from public.award_items ai where ai.request_id=r.id and ai.active)))
    from public.publication_requests pr join public.project_request_versions rv on rv.id=pr.request_version_id
    join public.project_requests r on r.id=rv.request_id where pr.publication_id=p_publication_id),'[]'::jsonb);
end;
$$;

create or replace function dao_private.award_offer_atomic(p_key text,p_item_id uuid,p_group_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result jsonb; item public.bid_items; ids uuid[]; v_command text;
  award_id uuid; ai_id uuid; winner record; group_offer public.bid_groups; total numeric; discount bigint:=0;
  left_discount bigint; allocated bigint; amount bigint; output jsonb:='[]';
begin
  if actor is null then raise exception using errcode='42501',message='award authorization required'; end if;
  if p_key is null or length(trim(p_key))<8 then raise exception using errcode='22023',message='idempotency key required'; end if;
  v_command:=case when p_group_id is null then 'award_bid_item' else 'award_bid_group' end;
  -- Actor/key serialization makes concurrent retries and conflicting reuse safe.
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=actor and cr.idempotency_key=p_key;
  if result is not null then
    if not exists(select 1 from public.command_receipts cr where cr.actor_id=actor and cr.idempotency_key=p_key and cr.command=v_command)
      or (p_group_id is null and coalesce(result->>'bid_item_id',(select bid_item_id::text from public.award_items where id=(result->>'award_item_id')::uuid)) is distinct from p_item_id::text)
      or (p_group_id is not null and result->>'group_id' is distinct from p_group_id::text) then
      raise exception using errcode='22023',message='idempotency key reused with different command';
    end if;
    return result;
  end if;
  if p_group_id is null then ids:=array[p_item_id]; else
    select * into group_offer from public.bid_groups where id=p_group_id and indivisible;
    select array_agg(bid_item_id order by bid_item_id) into ids from public.bid_group_items where group_id=p_group_id;
    if group_offer.id is null or coalesce(cardinality(ids),0)<2 then raise exception using errcode='23514',message='package indivisible invalide'; end if;
    discount:=group_offer.discount_millimes;
  end if;
  select * into item from public.bid_items where id=ids[1];
  if item.id is null or not (dao_private.owner(item.project_id) or dao_private.manages_project(item.project_id)) then
    raise exception using errcode='42501',message='award authorization required';
  end if;
  perform 1 from public.projects where id=item.project_id for update;
  if exists(select 1 from public.projects where id=item.project_id and status='archived') then
    raise exception using errcode='23514',message='chantier archivé';
  end if;
  if (select count(*) from public.bid_items bi join public.bid_versions bv on bv.id=bi.bid_version_id
    where bi.id=any(ids) and bi.project_id=item.project_id and bi.contractor_id=item.contractor_id
      and bv.status='submitted' and bv.validity='current' and bv.submitted_at is not null and bv.expires_at>now())<>cardinality(ids) then
    raise exception using errcode='23514',message='offer is not awardable';
  end if;
  if p_group_id is null and exists(select 1 from public.bid_group_items gi join public.bid_groups g on g.id=gi.group_id
    where gi.bid_item_id=item.id and g.indivisible and (select count(*) from public.bid_group_items where group_id=g.id)>1) then
    raise exception using errcode='23514',message='indivisible offer requires grouped award';
  end if;
  perform 1 from public.project_requests r where r.id in (select request_id from public.bid_items where id=any(ids)) order by r.id for update;
  if exists(select 1 from public.bid_items bi join public.project_requests r on r.id=bi.request_id where bi.id=any(ids)
    and (r.status not in ('open','reserved') or exists(select 1 from public.award_items ai where ai.request_id=r.id and ai.active))) then
    raise exception using errcode='23514',message='project request is not awardable';
  end if;
  if exists(select 1 from public.bid_items bi join public.bid_versions bv on bv.id=bi.bid_version_id where bi.id=any(ids) and exists(select 1 from public.publication_requests pr join public.publication_lot_withdrawals w on w.publication_request_id=pr.id where pr.request_version_id=bi.request_version_id and (bv.publication_id is null or pr.publication_id=bv.publication_id))) then raise exception using errcode='23514',message='Lot retiré de la publication'; end if;
  select sum(price_millimes) into total from public.bid_items where id=any(ids);
  if discount>total then raise exception using errcode='23514',message='invalid package discount'; end if;
  left_discount:=discount;
  insert into public.awards(project_id,contractor_id,status) values(item.project_id,item.contractor_id,'confirmed') returning id into award_id;
  for winner in select bi.*,sum(price_millimes) over(order by bi.id) as cumulative_price from public.bid_items bi where bi.id=any(ids) order by bi.id loop
    -- Legacy package discounts use cumulative proportional rounding in UUID
    -- order: no negative line, and the total is exactly sum(prices)-discount.
    allocated:=case when total=0 then 0 else (floor(discount::numeric*winner.cumulative_price/total)-floor(discount::numeric*(winner.cumulative_price-winner.price_millimes)/total))::bigint end;
    left_discount:=left_discount-allocated; amount:=winner.price_millimes-allocated;
    insert into public.award_items(award_id,project_id,contractor_id,request_id,bid_item_id,agreed_millimes)
    values(award_id,item.project_id,item.contractor_id,winner.request_id,winner.id,amount) returning id into ai_id;
    update public.project_requests set status='awarded' where id=winner.request_id;
    insert into public.bid_item_results(bid_item_id,source_award_item_id,status,actor_id)
    select bi.id,ai_id,case when bi.id=winner.id then 'selected' else 'not_selected' end,actor
    from public.bid_items bi join public.bid_versions bv on bv.id=bi.bid_version_id
    where bi.request_id=winner.request_id and bv.status='submitted' and bv.validity='current' and bv.submitted_at is not null;
    output:=output||jsonb_build_array(jsonb_build_object('award_item_id',ai_id,'request_id',winner.request_id,'bid_item_id',winner.id,'agreed_millimes',amount));
  end loop;
  result:=jsonb_build_object('award_id',award_id,'items',output,'group_id',p_group_id,'bid_item_id',p_item_id,'status','awarded');
  if p_group_id is null then result:=result||jsonb_build_object('award_item_id',ai_id,'request_id',item.request_id); end if;
  insert into public.command_receipts(actor_id,idempotency_key,command,result) values(actor,p_key,v_command,result);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata) values(actor,'award_confirmed','project',item.project_id,result);
  return result;
end;
$$;

create or replace function dao_private.cancel_award_item_atomic(p_key text,p_award_item_id uuid,p_reason text,p_comment text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); item public.award_items; ids uuid[]; result jsonb; batch uuid:=gen_random_uuid();
begin
  if actor is null then raise exception using errcode='42501',message='award authorization required'; end if;
  if p_key is null or length(trim(p_key))<8 then raise exception using errcode='22023',message='idempotency key required'; end if;
  if p_reason is null or p_reason not in ('disagreement','withdrawal','financing','unavailable','award_error','mutual_agreement','deadline','other')
    or (p_reason='other' and nullif(trim(p_comment),'') is null) then
    raise exception using errcode='22023',message='motif obligatoire ; autre requiert un commentaire';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_key,0));
  select cr.result into result from public.command_receipts cr where cr.actor_id=actor and cr.idempotency_key=p_key;
  if result is not null then
    if not exists(select 1 from public.command_receipts cr where cr.actor_id=actor and cr.idempotency_key=p_key and cr.command='cancel_award_item')
      or result->>'award_item_id' is distinct from p_award_item_id::text
      or result->>'reason' is distinct from p_reason or result->>'comment' is distinct from nullif(trim(p_comment),'') then
      raise exception using errcode='22023',message='idempotency key reused with different command';
    end if;
    return result;
  end if;
  select * into item from public.award_items where id=p_award_item_id;
  if item.id is null or not (dao_private.owner(item.project_id) or dao_private.manages_project(item.project_id)) then
    raise exception using errcode='42501',message='award authorization required';
  end if;
  perform 1 from public.projects where id=item.project_id for update;
  select * into item from public.award_items where id=p_award_item_id;
  if not item.active then raise exception using errcode='23514',message='attribution déjà annulée'; end if;
  -- A package cannot be left partially active, even when selected via one lot.
  select array_agg(ai.id order by ai.id) into ids from public.award_items ai
  where ai.award_id=item.award_id and ai.active and (ai.id=item.id or exists(
    select 1 from public.bid_group_items selected join public.bid_groups g on g.id=selected.group_id and g.indivisible
    join public.bid_group_items member on member.group_id=g.id
    where selected.bid_item_id=item.bid_item_id and member.bid_item_id=ai.bid_item_id));
  if exists(select 1 from public.contracts where award_id=item.award_id)
    or exists(select 1 from public.project_requests where id in(select request_id from public.award_items where id=any(ids)) and status='contracted') then
    raise exception using errcode='23514',message='annulation contractuelle hors périmètre';
  end if;
  insert into public.award_cancellations(award_item_id,batch_id,actor_id,reason,comment)
    select id,batch,actor,p_reason,nullif(trim(p_comment),'') from public.award_items where id=any(ids);
  update public.award_items set active=false where id=any(ids);
  update public.project_requests set status='open' where status='awarded' and id in(select request_id from public.award_items where id=any(ids));
  insert into public.bid_item_results(bid_item_id,source_award_item_id,status,actor_id)
    select bi.id,ai.id,'available',actor from public.award_items ai join public.bid_items bi on bi.request_id=ai.request_id
    join public.bid_versions bv on bv.id=bi.bid_version_id
    where ai.id=any(ids) and bv.status='submitted' and bv.validity='current' and bv.submitted_at is not null;
  update public.awards set status='cancelled' where id=item.award_id and not exists(select 1 from public.award_items where award_id=item.award_id and active);
  result:=jsonb_build_object('award_item_id',item.id,'cancelled_item_ids',ids,'batch_id',batch,'reason',p_reason,'comment',nullif(trim(p_comment),''),'status','cancelled');
  insert into public.command_receipts(actor_id,idempotency_key,command,result) values(actor,p_key,'cancel_award_item',result);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata) values(actor,'award_cancelled','project',item.project_id,result);
  return result;
end;
$$;

create function dao_private.freeze_review_snapshot() returns trigger language plpgsql set search_path='' as $$
begin
  if TG_TABLE_NAME='project_versions' then
    if OLD.status<>'draft' and (TG_OP='DELETE' or (to_jsonb(NEW)-'status'-'superseded_by_id') is distinct from (to_jsonb(OLD)-'status'-'superseded_by_id')) then raise exception using errcode='23514',message='Créez une nouvelle version du dossier soumis'; end if;
    if TG_OP='UPDATE' and OLD.status<>'draft' and NEW.status='draft' then raise exception using errcode='23514',message='Une version soumise ne redevient pas brouillon'; end if;
  elsif exists(select 1 from public.project_version_requests l join public.project_versions v on v.id=l.project_version_id where l.request_version_id=OLD.id and v.status<>'draft') or exists(select 1 from public.publication_requests where request_version_id=OLD.id) then raise exception using errcode='23514',message='Périmètre soumis immuable : créez une nouvelle version'; end if;
  if TG_OP='DELETE' then return OLD; end if; return NEW;
end; $$;
revoke all on function dao_private.freeze_review_snapshot() from public,anon,authenticated;
create trigger freeze_project_snapshot before update or delete on public.project_versions for each row execute function dao_private.freeze_review_snapshot();
create trigger freeze_request_snapshot before update or delete on public.project_request_versions for each row execute function dao_private.freeze_review_snapshot();
create function dao_private.freeze_review_link() returns trigger language plpgsql set search_path='' as $$
declare vid uuid; begin
  vid:=case when TG_OP='DELETE' then OLD.project_version_id else NEW.project_version_id end;
  if exists(select 1 from public.project_versions where id=vid and status<>'draft') and auth.uid() is not null then raise exception using errcode='23514',message='Composition du dossier soumis immuable'; end if;
  if TG_OP='DELETE' then return OLD; end if; return NEW;
end; $$;
revoke all on function dao_private.freeze_review_link() from public,anon,authenticated;
create trigger freeze_review_link before insert or update or delete on public.project_version_requests for each row execute function dao_private.freeze_review_link();

create function dao_private.publication_snapshot_guard() returns trigger language plpgsql set search_path='' as $$
declare project uuid; rid uuid; begin
  if TG_OP<>'INSERT' then raise exception using errcode='23514',message='Snapshot publié immuable'; end if;
  select project_id into project from public.publications where id=NEW.publication_id;
  perform 1 from public.projects where id=project for update;
  select request_id into rid from public.project_request_versions where id=NEW.request_version_id;
  if exists(select 1 from public.publication_requests pr join public.publications p on p.id=pr.publication_id join public.project_request_versions rv on rv.id=pr.request_version_id where p.project_id=project and p.status in ('published','suspended') and rv.request_id=rid and not exists(select 1 from public.publication_lot_withdrawals w where w.publication_request_id=pr.id)) then raise exception using errcode='23505',message='Ce lot possède déjà une publication active'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',sub_lot_id,'title',title,'scope',scope,'budget_millimes',budget_millimes,'ordinal',ordinal) order by ordinal),'[]'::jsonb) into NEW.technical_scope from public.request_sub_lot_versions where request_version_id=NEW.request_version_id;
  return NEW;
end; $$;
revoke all on function dao_private.publication_snapshot_guard() from public,anon,authenticated;
create trigger publication_snapshot_guard before insert or update or delete on public.publication_requests for each row execute function dao_private.publication_snapshot_guard();
create function dao_private.publication_identity_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if TG_OP='DELETE' or (to_jsonb(NEW)-'status'-'closed_at') is distinct from (to_jsonb(OLD)-'status'-'closed_at') then raise exception using errcode='23514',message='Publication immuable : créez une nouvelle publication'; end if;
  if OLD.status in ('closed','superseded') and NEW.status in ('published','suspended') then raise exception using errcode='23514',message='Une ancienne publication ne peut pas être réactivée'; end if;
  return NEW;
end; $$;
revoke all on function dao_private.publication_identity_guard() from public,anon,authenticated;
create trigger publication_identity_guard before update or delete on public.publications for each row execute function dao_private.publication_identity_guard();

create function dao_private.staff_scope_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid; data jsonb; begin
  data:=case when TG_OP='DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  pid:=case when TG_TABLE_NAME='projects' then (data->>'id')::uuid else (data->>'project_id')::uuid end;
  if dao_private.staff() and pid is not null and not dao_private.owner(pid) and not dao_private.manages_project(pid) then raise exception using errcode='42501',message='Dossier affecté à un autre gestionnaire'; end if;
  if TG_OP='DELETE' then return OLD; end if; return NEW;
end; $$;
revoke all on function dao_private.staff_scope_guard() from public,anon,authenticated;
do $$ declare t record; begin
  for t in select c.table_name from information_schema.columns c where c.table_schema='public' and c.column_name='project_id' and c.table_name not in ('review_assignments','notification_outbox','publication_lot_withdrawals') loop
    execute format('create trigger staff_scope before insert or update or delete on public.%I for each row execute function dao_private.staff_scope_guard()',t.table_name);
  end loop;
  create trigger staff_scope before update or delete on public.projects for each row execute function dao_private.staff_scope_guard();
end $$;

create function dao_private.lock_admin_invariant() returns trigger language plpgsql set search_path='' as $$
begin perform pg_advisory_xact_lock(640064); if TG_OP='DELETE' then return OLD; end if; return NEW; end; $$;
create function dao_private.check_admin_invariant() returns trigger language plpgsql set search_path='' as $$
declare uid uuid; removed boolean; begin
  if TG_TABLE_NAME='user_roles' then
    removed:=TG_OP='DELETE' and OLD.role='dao_admin'; uid:=OLD.user_id;
    if TG_OP='UPDATE' then removed:=OLD.role='dao_admin' and (NEW.role<>'dao_admin' or NEW.user_id<>OLD.user_id); end if;
  else uid:=NEW.user_id; removed:=NEW.status='suspended' and exists(select 1 from public.user_roles where user_id=uid and role='dao_admin'); end if;
  if removed and not exists(select 1 from public.user_roles where role='dao_admin' and dao_private.account_active(user_id)) then raise exception using errcode='23514',message='Impossible de retirer ou suspendre le dernier Admin actif'; end if;
  if TG_OP='DELETE' then return OLD; end if; return NEW;
end; $$;
revoke all on function dao_private.lock_admin_invariant(),dao_private.check_admin_invariant() from public,anon,authenticated;
create trigger lock_admin_invariant before insert or update or delete on public.user_roles for each row execute function dao_private.lock_admin_invariant();
create trigger check_admin_invariant after update or delete on public.user_roles for each row execute function dao_private.check_admin_invariant();
create trigger lock_admin_invariant before insert or update on public.account_states for each row execute function dao_private.lock_admin_invariant();
create trigger check_admin_invariant after insert or update on public.account_states for each row execute function dao_private.check_admin_invariant();

create function dao_private.enrich_business_audit() returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid; begin
  if NEW.entity_type='project' then pid:=NEW.entity_id; else pid:=nullif(NEW.metadata->>'project_id','')::uuid; end if;
  if pid is not null then NEW.metadata:=NEW.metadata||jsonb_build_object('project_id',pid,'client_id',(select client_id from public.projects where id=pid),'acting_for_client',dao_private.staff()); end if;
  if NEW.action in ('award_confirmed','award_cancelled') then
    NEW.metadata:=NEW.metadata||jsonb_build_object('contractor_id',coalesce((select contractor_id from public.awards where id=nullif(NEW.metadata->>'award_id','')::uuid),(select contractor_id from public.award_items where id=nullif(NEW.metadata->>'award_item_id','')::uuid)));
    if NEW.action='award_cancelled' then NEW.metadata:=NEW.metadata||jsonb_build_object('items',(select jsonb_agg(jsonb_build_object('request_id',request_id,'bid_item_id',bid_item_id)) from public.award_items where id in(select value::uuid from jsonb_array_elements_text(NEW.metadata->'cancelled_item_ids')))); end if;
  end if;
  return NEW;
end; $$;
revoke all on function dao_private.enrich_business_audit() from public,anon,authenticated;
create trigger enrich_business_audit before insert on public.audit_events for each row execute function dao_private.enrich_business_audit();
drop policy read_allowed on public.audit_events;
create policy read_allowed on public.audit_events for select to authenticated using(dao_private.admin() or (dao_private.staff() and exists(select 1 from public.review_assignments a where a.reviewer_id=auth.uid() and a.project_id=nullif(metadata->>'project_id','')::uuid)) or (entity_type='project' and dao_private.owner(entity_id)));

do $$ declare f record; body text; begin
  for f in select p.oid::regprocedure as signature,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='dao_private' and p.proname in ('owner','pro','project_member','contractor_initiator','can_view_project','can_prepare_project','can_view_project_private_details') loop
    body:=pg_get_functiondef(f.signature::oid);
    body:=replace(body,f.prosrc,'select dao_private.account_active(auth.uid()) and ('||regexp_replace(trim(f.prosrc),'^select |;[[:space:]]*$','','g')||');'); execute body;
  end loop;
end $$;

create function dao_private.review_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text; begin
  if TG_OP='UPDATE' and OLD.status=NEW.status then return NEW; end if;
  kind:=case NEW.status when 'client_review' then case when NEW.version_no>1 then 'review_resubmitted' else 'review_submitted' end when 'approved' then 'review_approved' else null end;
  if NEW.status='client_review' then insert into public.review_assignments(project_id,review_version_id) values(NEW.project_id,NEW.id) on conflict(project_id) do update set reviewer_id=null,assigned_at=null,review_version_id=NEW.id,updated_at=now(); end if;
  if kind is not null then perform dao_private.queue_project_notice(kind||':'||NEW.id,NEW.project_id,kind,jsonb_build_object('title',NEW.title,'version',NEW.version_no)); end if;
  return NEW;
end; $$;
create trigger review_notice after insert or update of status on public.project_versions for each row execute function dao_private.review_notice();
create function dao_private.audit_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare pid uuid; begin
  pid:=nullif(NEW.metadata->>'project_id','')::uuid;
  if pid is not null and NEW.action in ('review_claimed','review_reassigned','staff_project_updated','review_rejected') then perform dao_private.queue_project_notice(NEW.action||':'||NEW.id,pid,NEW.action,NEW.metadata||jsonb_build_object('title',(select title from public.project_versions where project_id=pid order by version_no desc limit 1))); end if;
  return NEW;
end; $$;
revoke all on function dao_private.review_notice(),dao_private.audit_notice() from public,anon,authenticated;
create trigger audit_notice after insert on public.audit_events for each row execute function dao_private.audit_notice();

alter table public.notification_outbox add column delivery_email text;
alter table public.notification_outbox add column delivery_message jsonb;
create function public.claim_notification_outbox(p_limit integer default 10) returns setof public.notification_outbox
language plpgsql security definer set search_path='' as $$
begin
  update public.notification_outbox set status='failed',error_code='RETRY_WINDOW_EXPIRED',lease_token=null,lease_until=null where status in ('pending','sending') and (first_attempt_at<now()-interval '23 hours' or (attempts>=5 and lease_until<now()));
  return query with due as (select id from public.notification_outbox where attempts<5 and next_attempt_at<=now() and (status='pending' or (status='sending' and lease_until<now())) order by next_attempt_at,id for update skip locked limit greatest(1,least(p_limit,50)))
    update public.notification_outbox o set status='sending',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes',first_attempt_at=coalesce(first_attempt_at,now()),delivery_email=coalesce(delivery_email,(select to_jsonb(u)->>'email' from auth.users u where u.id=o.recipient_id)) from due where o.id=due.id returning o.*;
end; $$;
create function public.complete_notification_outbox(p_id uuid,p_lease uuid,p_success boolean,p_code text default null) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  update public.notification_outbox set status=case when p_success then 'sent' when attempts>=5 then 'failed' else 'pending' end,sent_at=case when p_success then now() else null end,error_code=case when p_success then null else left(p_code,80) end,next_attempt_at=now()+make_interval(secs=>least(3600,(30*power(2,attempts))::integer)),lease_token=null,lease_until=null where id=p_id and status='sending' and lease_token=p_lease; return found;
end; $$;
revoke all on function public.claim_notification_outbox(integer),public.complete_notification_outbox(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_notification_outbox(integer),public.complete_notification_outbox(uuid,uuid,boolean,text) to service_role;

create function dao_private.backoffice_read(p_view text,p_filters jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; q text:=left(coalesce(p_filters->>'q',''),200); pid uuid:=nullif(p_filters->>'project_id','')::uuid;
  offset_rows integer:=greatest(0,least(coalesce((p_filters->>'offset')::integer,0),100000));
begin
  if not dao_private.staff() then raise exception using errcode='42501',message='Accès réservé au back-office'; end if;
  if p_view in ('users','outbox') and not dao_private.admin() then raise exception using errcode='42501',message='Administration réservée'; end if;
  if p_view in ('users','clients','staff') then
    select coalesce(jsonb_agg(x),'[]') into result from (
      select u.id,coalesce(p.display_name,'Compte') as display_name,to_jsonb(u)->>'email' as email,
        (to_jsonb(u)->>'email_confirmed_at') is not null as email_confirmed,coalesce(s.status,'active') as account_status,
        coalesce((select jsonb_agg(role order by role) from public.user_roles where user_id=u.id),'[]') as roles,
        case when p_view='clients' then (select coalesce(jsonb_agg(jsonb_build_object('id',pr.id,'title',v.title,'status',pr.status,'participation',m.participation_role)),'[]') from public.projects pr left join lateral(select title from public.project_versions where project_id=pr.id order by version_no desc limit 1) v on true left join public.project_members m on m.project_id=pr.id and m.user_id=u.id where pr.client_id=u.id or m.status='accepted') else null end as projects,
        case when p_view='clients' then (select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.profile_contacts c where c.user_id=u.id) else null end as contacts,
        case when p_view='clients' then (select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'project_id',i.project_id,'status',i.status,'expected_role',i.expected_role,'expires_at',i.expires_at)),'[]') from public.project_invitations i where i.accepted_by=u.id or i.created_by=u.id or lower(i.recipient_email)=lower(to_jsonb(u)->>'email') or exists(select 1 from public.projects where id=i.project_id and client_id=u.id)) else null end as invitations
      from auth.users u left join public.profiles p on p.user_id=u.id left join public.account_states s on s.user_id=u.id
      where (p_view='users' or exists(select 1 from public.user_roles where user_id=u.id and role=case when p_view='clients' then 'client' else 'dao_reviewer' end) or (p_view='staff' and exists(select 1 from public.user_roles where user_id=u.id and role='dao_admin')))
        and (q='' or concat(p.display_name,' ',to_jsonb(u)->>'email') ilike '%'||q||'%')
        and (nullif(p_filters->>'status','') is null or coalesce(s.status,'active')=p_filters->>'status')
      order by p.display_name,u.id limit 100 offset offset_rows
    ) x;
  elsif p_view='professionals' then
    select coalesce(jsonb_agg(x),'[]') into result from (select cp.*,p.display_name,to_jsonb(u)->>'email' as email,coalesce(s.status,'active') as account_status,
      (select coalesce(jsonb_agg(to_jsonb(c)),'[]') from public.profile_contacts c where c.user_id=cp.user_id) as contacts,
      (select coalesce(jsonb_agg(jsonb_build_object('trade_id',ct.trade_id,'name',t.name_fr)),'[]') from public.contractor_trades ct join public.trades t on t.id=ct.trade_id where ct.contractor_id=cp.id) as trades
      from public.contractor_profiles cp join auth.users u on u.id=cp.user_id left join public.profiles p on p.user_id=u.id left join public.account_states s on s.user_id=u.id
      where (q='' or concat(cp.business_name,' ',p.display_name,' ',to_jsonb(u)->>'email') ilike '%'||q||'%') and (nullif(p_filters->>'status','') is null or cp.verification_status=p_filters->>'status') order by cp.business_name,cp.id limit 100 offset offset_rows) x;
  elsif p_view='projects' then
    select coalesce(jsonb_agg(x),'[]') into result from (select pr.*,to_jsonb(v) as version,cp.display_name as client_name,a.reviewer_id,rp.display_name as reviewer_name,dao_private.manages_project(pr.id) as can_manage,
      (select count(*) from public.project_version_requests l join public.project_request_versions rv on rv.id=l.request_version_id join public.project_requests r on r.id=rv.request_id where l.project_version_id=v.id and r.status='open' and not exists(select 1 from public.publication_requests pr join public.publications pp on pp.id=pr.publication_id join public.project_request_versions snapshot on snapshot.id=pr.request_version_id where snapshot.request_id=r.id and pp.status in ('published','suspended') and not exists(select 1 from public.publication_lot_withdrawals w where w.publication_request_id=pr.id))) as publishable_lots
      from public.projects pr join lateral(select * from public.project_versions where project_id=pr.id order by version_no desc limit 1) v on true left join public.profiles cp on cp.user_id=pr.client_id left join public.review_assignments a on a.project_id=pr.id left join public.profiles rp on rp.user_id=a.reviewer_id
      where (q='' or concat(v.title,' ',cp.display_name) ilike '%'||q||'%') and (nullif(p_filters->>'status','') is null or v.status=p_filters->>'status') and (coalesce(p_filters->>'mine','false')<>'true' or a.reviewer_id=auth.uid()) order by pr.created_at desc,pr.id limit 100 offset offset_rows) x;
  elsif p_view='project' then
    select jsonb_build_object('project',to_jsonb(pr),'version',to_jsonb(v),'can_manage',dao_private.manages_project(pid),'assignment',to_jsonb(a),'lots',(select coalesce(jsonb_agg(to_jsonb(rv)||jsonb_build_object('withdrawals',(select coalesce(jsonb_agg(to_jsonb(w)),'[]') from public.publication_lot_withdrawals w join public.publication_requests pr on pr.id=w.publication_request_id join public.project_request_versions previous on previous.id=pr.request_version_id where previous.request_id=rv.request_id),'currently_published',exists(select 1 from public.publication_requests pr join public.publications pp on pp.id=pr.publication_id join public.project_request_versions snapshot on snapshot.id=pr.request_version_id where snapshot.request_id=rv.request_id and pp.status in ('published','suspended') and not exists(select 1 from public.publication_lot_withdrawals w where w.publication_request_id=pr.id)),'sub_lots',(select coalesce(jsonb_agg(jsonb_build_object('id',s.sub_lot_id,'title',s.title,'scope',s.scope,'budget_millimes',s.budget_millimes) order by ordinal),'[]') from public.request_sub_lot_versions s where s.request_version_id=rv.id)) order by rv.created_at,rv.id),'[]') from public.project_version_requests l join public.project_request_versions rv on rv.id=l.request_version_id where l.project_version_id=v.id),'versions',(select jsonb_agg(to_jsonb(pv) order by version_no desc) from public.project_versions pv where project_id=pid)) into result
      from public.projects pr join lateral(select * from public.project_versions where project_id=pid order by version_no desc limit 1) v on true left join public.review_assignments a on a.project_id=pid where pr.id=pid;
  elsif p_view='history' then
    select coalesce(jsonb_agg(x),'[]') into result from (select e.*,p.display_name as actor_name,c.display_name as client_name,
      case e.entity_type when 'user' then (select display_name from public.profiles where user_id=e.entity_id) when 'contractor' then (select business_name from public.contractor_profiles where id=e.entity_id) when 'request' then (select title from public.project_request_versions where request_id=e.entity_id order by version_no desc limit 1) when 'publication' then (select safe_title from public.publications where id=e.entity_id) else null end as subject_name,
      (select title from public.project_versions where project_id=nullif(e.metadata->>'project_id','')::uuid order by version_no desc limit 1) as project_title
      from public.audit_events e left join public.profiles p on p.user_id=e.actor_id left join public.profiles c on c.user_id=nullif(e.metadata->>'client_id','')::uuid
      where (dao_private.admin() or e.actor_id=auth.uid() or exists(select 1 from public.review_assignments where project_id=nullif(e.metadata->>'project_id','')::uuid and reviewer_id=auth.uid()))
        and (pid is null or nullif(e.metadata->>'project_id','')::uuid=pid) and (q='' or concat(e.action,' ',p.display_name,' ',e.entity_id,' ',e.metadata) ilike '%'||q||'%')
        and (nullif(p_filters->>'actor_id','') is null or e.actor_id=(p_filters->>'actor_id')::uuid)
        and (nullif(p_filters->>'action','') is null or e.action=p_filters->>'action')
        and (nullif(p_filters->>'client_id','') is null or (e.metadata->>'client_id'=p_filters->>'client_id' or (e.entity_type='user' and e.entity_id::text=p_filters->>'client_id')))
        and (nullif(p_filters->>'contractor_id','') is null or e.entity_id::text=p_filters->>'contractor_id' or e.metadata->>'contractor_id'=p_filters->>'contractor_id')
        and (nullif(p_filters->>'lot_id','') is null or e.entity_id::text=p_filters->>'lot_id' or e.metadata->>'request_id'=p_filters->>'lot_id' or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(e.metadata->'items')='array' then e.metadata->'items' else '[]'::jsonb end) item where item->>'request_id'=p_filters->>'lot_id'))
        and (nullif(p_filters->>'publication_id','') is null or e.metadata->>'publication_id'=p_filters->>'publication_id')
        and (nullif(p_filters->>'from','') is null or e.created_at>=(p_filters->>'from')::timestamptz)
        and (nullif(p_filters->>'to','') is null or e.created_at<(p_filters->>'to')::date+interval '1 day') order by e.created_at desc,e.id limit 100 offset offset_rows) x;
  elsif p_view='outbox' then
    select coalesce(jsonb_agg(x),'[]') into result from (select id,created_at,project_id,kind,status,attempts,next_attempt_at,sent_at,error_code from public.notification_outbox order by created_at desc limit 100 offset offset_rows) x;
  else raise exception using errcode='22023',message='Vue inconnue'; end if;
  return jsonb_build_object('rows',coalesce(result,'[]'),'admin',dao_private.admin(),'actor_id',auth.uid(),'offset',offset_rows,'limit',100);
end; $$;
create function public.backoffice_read(p_view text,p_filters jsonb default '{}'::jsonb) returns jsonb language sql security invoker set search_path='' as $$ select dao_private.backoffice_read($1,$2); $$;
revoke all on function dao_private.backoffice_read(text,jsonb),public.backoffice_read(text,jsonb) from public,anon;
grant execute on function dao_private.backoffice_read(text,jsonb),public.backoffice_read(text,jsonb) to authenticated,service_role;

create function public.prepare_notification_delivery(p_id uuid,p_lease uuid,p_message jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; begin
  update public.notification_outbox set delivery_message=coalesce(delivery_message,p_message)
    where id=p_id and status='sending' and lease_token=p_lease returning delivery_message into result;
  return result;
end; $$;
revoke all on function public.prepare_notification_delivery(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_notification_delivery(uuid,uuid,jsonb) to service_role;

create function dao_private.sub_lot_insert_guard() returns trigger language plpgsql set search_path='' as $$
begin
  if exists(select 1 from public.publication_requests where request_version_id=NEW.request_version_id) or exists(select 1 from public.project_version_requests l join public.project_versions v on v.id=l.project_version_id where l.request_version_id=NEW.request_version_id and v.status<>'draft') then raise exception using errcode='23514',message='Sous-lots du snapshot soumis immuables'; end if;
  return NEW;
end; $$;
create trigger sub_lot_insert_guard before insert on public.request_sub_lot_versions for each row execute function dao_private.sub_lot_insert_guard();
create function dao_private.copy_client_sub_lots() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is not null and not dao_private.staff() then
    insert into public.request_sub_lot_versions(sub_lot_id,request_id,project_id,request_version_id,ordinal,title,scope,budget_millimes)
      select s.sub_lot_id,s.request_id,s.project_id,NEW.id,s.ordinal,s.title,s.scope,s.budget_millimes from public.request_sub_lot_versions s
      where s.request_version_id=(select id from public.project_request_versions where request_id=NEW.request_id and version_no<NEW.version_no order by version_no desc limit 1);
  end if; return NEW;
end; $$;
create trigger copy_client_sub_lots after insert on public.project_request_versions for each row execute function dao_private.copy_client_sub_lots();
revoke all on function dao_private.sub_lot_insert_guard(),dao_private.copy_client_sub_lots() from public,anon,authenticated;

create or replace function dao_private.publication(p uuid) returns boolean language sql stable security definer set search_path='' as $$
 select (auth.uid() is null or dao_private.account_active(auth.uid())) and exists(select 1 from public.publications x where x.id=p and (
  dao_private.staff() or dao_private.owner(x.project_id) or (x.status='published' and (
    x.visibility='public' or exists(select 1 from public.publication_recipients r join public.contractor_profiles c on c.id=r.contractor_id where r.publication_id=x.id and r.revoked_at is null and c.user_id=auth.uid() and c.verification_status='verified' and ((x.visibility='targeted' and r.source='targeted') or (x.visibility='invite_only' and r.source='invitation')))))
  or exists(select 1 from public.bid_versions bv join public.contractor_profiles cp on cp.id=bv.contractor_id
    where cp.user_id=auth.uid() and bv.submitted_at is not null and (bv.publication_id=x.id or (bv.publication_id is null and x.published_at<=bv.submitted_at and exists(select 1 from public.bid_items bi join public.publication_requests pr on pr.request_version_id=bi.request_version_id where bi.bid_version_id=bv.id and pr.publication_id=x.id))))));
$$;
create function dao_private.project_review_history(p_project_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not (dao_private.owner(p_project_id) or dao_private.manages_project(p_project_id)) then raise exception using errcode='42501',message='Historique réservé au client ou au gestionnaire affecté'; end if;
 return jsonb_build_object('versions',(select coalesce(jsonb_agg(to_jsonb(v)||jsonb_build_object('author_name',p.display_name,'lots',(select coalesce(jsonb_agg(to_jsonb(rv)||jsonb_build_object('withdrawals',(select coalesce(jsonb_agg(to_jsonb(w)),'[]') from public.publication_lot_withdrawals w join public.publication_requests pr on pr.id=w.publication_request_id join public.project_request_versions previous on previous.id=pr.request_version_id where previous.request_id=rv.request_id),'currently_published',exists(select 1 from public.publication_requests pr join public.publications pp on pp.id=pr.publication_id join public.project_request_versions snapshot on snapshot.id=pr.request_version_id where snapshot.request_id=rv.request_id and pp.status in ('published','suspended') and not exists(select 1 from public.publication_lot_withdrawals w where w.publication_request_id=pr.id)),'sub_lots',(select coalesce(jsonb_agg(to_jsonb(s) order by ordinal),'[]') from public.request_sub_lot_versions s where s.request_version_id=rv.id))),'[]') from public.project_version_requests l join public.project_request_versions rv on rv.id=l.request_version_id where l.project_version_id=v.id)) order by v.version_no desc),'[]') from public.project_versions v left join public.profiles p on p.user_id=v.created_by where v.project_id=p_project_id),
 'events',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('actor_name',p.display_name) order by e.created_at desc,e.id),'[]') from public.audit_events e left join public.profiles p on p.user_id=e.actor_id where e.metadata->>'project_id'=p_project_id::text and e.action in ('review_claimed','review_reassigned','review_approved','review_rejected','staff_project_updated','lot_created','lot_updated','review_lot_withdrawn','sub_lot_versioned','publication_lot_withdrawn','publication_created','award_confirmed','award_cancelled','assisted_award','assisted_cancel')));
end; $$;
create function public.project_review_history(p_project_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select dao_private.project_review_history($1); $$;
revoke all on function dao_private.project_review_history(uuid),public.project_review_history(uuid) from public,anon;
grant execute on function dao_private.project_review_history(uuid),public.project_review_history(uuid) to authenticated,service_role;

-- The legacy award facade delegates to the canonical derived-input command,
-- including project-first locking, withdrawal and assigned-staff authorization.
create or replace function dao_private.award_request_atomic(p_idempotency_key text,p_award_id uuid,p_project_id uuid,p_contractor_id uuid,p_request_id uuid,p_bid_item_id uuid,p_agreed_millimes bigint)
returns jsonb language sql security definer set search_path='' as $$ select dao_private.award_offer_atomic($1,$6,null); $$;

commit;
