begin;

create table public.technical_questions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  project_id uuid not null references public.projects,
  publication_id uuid not null references public.publications,
  publication_request_id uuid not null references public.publication_requests,
  request_id uuid not null references public.project_requests,
  author_id uuid not null references auth.users,
  body text not null check(length(btrim(body)) between 1 and 4000),
  status text not null default 'new' check(status in ('new','in_progress','published','archived')),
  last_activity_at timestamptz not null default now()
);
create index technical_questions_scope_order on public.technical_questions(publication_request_id,last_activity_at desc,id desc);
create index technical_questions_author_order on public.technical_questions(author_id,last_activity_at desc,id desc);

create table public.technical_clarifications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  question_id uuid not null references public.technical_questions,
  version_no integer not null check(version_no between 1 and 100),
  author_id uuid not null references auth.users,
  body text not null check(length(btrim(body)) between 1 and 8000),
  impacts_scope boolean not null default false,
  published_at timestamptz not null default now(),
  supersedes_id uuid references public.technical_clarifications,
  unique(question_id,version_no)
);
create index technical_clarifications_question_order on public.technical_clarifications(question_id,version_no desc);

create table public.technical_rfi_reads (
  question_id uuid not null references public.technical_questions,
  user_id uuid not null references auth.users,
  read_at timestamptz not null default now(),
  primary key(question_id,user_id)
);

create table public.technical_rfi_receipts (
  actor_id uuid not null references auth.users,
  idempotency_key text not null check(length(idempotency_key) between 8 and 120),
  operation text not null check(operation in ('create_question','publish_clarification')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(actor_id,idempotency_key)
);

create table public.technical_rfi_documents (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  question_id uuid not null references public.technical_questions,
  clarification_id uuid references public.technical_clarifications,
  owner_id uuid not null references auth.users,
  object_path text not null unique,
  original_name text not null check(length(original_name) between 1 and 200),
  mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check(size_bytes between 1 and 20971520),
  status text not null default 'quarantined' check(status in ('quarantined','approved','rejected'))
);
create index technical_rfi_documents_question on public.technical_rfi_documents(question_id,created_at,id);

alter table public.technical_questions enable row level security;
alter table public.technical_clarifications enable row level security;
alter table public.technical_rfi_reads enable row level security;
alter table public.technical_rfi_receipts enable row level security;
alter table public.technical_rfi_documents enable row level security;

create function dao_private.rfi_request_owner(p_publication_request_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.publication_requests pr join public.publications p on p.id=pr.publication_id
    join public.projects x on x.id=p.project_id
    where pr.id=p_publication_request_id and x.client_id=auth.uid() and x.status<>'archived' and dao_private.account_active(auth.uid()));
$$;

create function dao_private.rfi_user_eligible(p_publication_request_id uuid,p_user_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.publication_requests pr
    join public.publications p on p.id=pr.publication_id
    join public.project_request_versions rv on rv.id=pr.request_version_id
    join public.project_requests r on r.id=rv.request_id
    join public.contractor_profiles cp on cp.user_id=p_user_id and cp.verification_status='verified'
    where pr.id=p_publication_request_id and p.status='published'
      and (p.submission_deadline is null or p.submission_deadline>now())
      and r.status in ('open','reserved')
      and (p.visibility='public' or exists(select 1 from public.publication_recipients x
        where x.publication_id=p.id and x.contractor_id=cp.id and x.revoked_at is null
          and ((p.visibility='targeted' and x.source='targeted') or (p.visibility='invite_only' and x.source='invitation'))))
      and dao_private.account_active(p_user_id)
      and exists(select 1 from public.user_roles ur where ur.user_id=p_user_id and ur.role='contractor')
      and not exists(select 1 from public.publication_lot_withdrawals w where w.publication_request_id=pr.id)
      and not exists(select 1 from public.award_items ai where ai.request_id=r.id and ai.active));
$$;

create function dao_private.rfi_request_eligible(p_publication_request_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and dao_private.rfi_user_eligible(p_publication_request_id,auth.uid());
$$;

create function dao_private.rfi_question_access(p_question_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.technical_questions q where q.id=p_question_id and (
    q.author_id=auth.uid() or dao_private.rfi_request_owner(q.publication_request_id)
    or (q.status='published' and dao_private.rfi_request_eligible(q.publication_request_id))));
$$;

create function dao_private.rfi_document_access(p_document_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.technical_rfi_documents d join public.technical_questions q on q.id=d.question_id
    where d.id=p_document_id and d.status='approved' and (
      q.author_id=auth.uid() or dao_private.rfi_request_owner(q.publication_request_id)
      or (d.clarification_id is not null and q.status='published' and dao_private.rfi_request_eligible(q.publication_request_id))));
$$;

create policy rfi_questions_visible on public.technical_questions for select to authenticated using(dao_private.rfi_question_access(id));
create policy rfi_clarifications_visible on public.technical_clarifications for select to authenticated using(dao_private.rfi_question_access(question_id));
create policy rfi_reads_visible on public.technical_rfi_reads for select to authenticated using(user_id=auth.uid() and dao_private.rfi_question_access(question_id));
create policy rfi_documents_visible on public.technical_rfi_documents for select to authenticated using(dao_private.rfi_document_access(id));

create function dao_private.rfi_question_json(q public.technical_questions) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not dao_private.rfi_question_access(q.id) then raise exception using errcode='42501',message='Question introuvable'; end if;
  select jsonb_build_object(
    'id',q.id,'created_at',q.created_at,'updated_at',q.updated_at,'project_id',q.project_id,
    'publication_id',q.publication_id,'publication_request_id',q.publication_request_id,'request_id',q.request_id,
    'project_title',coalesce(pv.title,'Chantier'),'lot_title',pr.safe_title,'body',q.body,'status',q.status,
    'mine',q.author_id=auth.uid(),'owner',dao_private.rfi_request_owner(q.publication_request_id),'author_label',case when q.author_id=auth.uid() then 'Votre question' when dao_private.rfi_request_owner(q.publication_request_id) then coalesce(cp.business_name,'Soumissionnaire') else 'Soumissionnaire' end,
    'unread',q.last_activity_at>coalesce((select rr.read_at from public.technical_rfi_reads rr where rr.question_id=q.id and rr.user_id=auth.uid()),q.created_at-interval '1 microsecond'),
    'clarifications',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'version_no',c.version_no,'body',c.body,'impacts_scope',c.impacts_scope,'published_at',c.published_at) order by c.version_no)
      from public.technical_clarifications c where c.question_id=q.id),'[]'::jsonb),
    'documents',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'clarification_id',d.clarification_id,'original_name',d.original_name,'mime_type',d.mime_type,'size_bytes',d.size_bytes,'created_at',d.created_at) order by d.created_at,d.id)
      from public.technical_rfi_documents d where d.question_id=q.id and d.status='approved' and dao_private.rfi_document_access(d.id)),'[]'::jsonb)
  ) into result
  from public.projects p join public.publication_requests pr on pr.id=q.publication_request_id
  left join lateral(select v.title from public.project_versions v where v.project_id=p.id order by v.version_no desc limit 1) pv on true
  left join public.contractor_profiles cp on cp.user_id=q.author_id where p.id=q.project_id;
  return result;
end $$;

create function dao_private.create_rfi_question(p_publication_request_id uuid,p_body text,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); clean text:=btrim(coalesce(p_body,'')); q public.technical_questions; receipt jsonb; scope record; recipient_client uuid;
begin
  if actor is null or length(clean) not between 1 and 4000 or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120
    then raise exception using errcode='22023',message='Paramètres invalides'; end if;
  select r.result into receipt from public.technical_rfi_receipts r where r.actor_id=actor and r.idempotency_key=p_idempotency_key;
  if receipt is not null then return receipt; end if;
  if not dao_private.rfi_request_eligible(p_publication_request_id) then raise exception using errcode='42501',message='Lot indisponible'; end if;
  if (select count(*) from public.technical_questions where author_id=actor and created_at>now()-interval '1 hour')>=10
    then raise exception using errcode='P0001',message='Trop de questions'; end if;
  select p.project_id,p.id publication_id,rv.request_id,x.client_id into scope
    from public.publication_requests pr join public.publications p on p.id=pr.publication_id
    join public.project_request_versions rv on rv.id=pr.request_version_id join public.projects x on x.id=p.project_id
    where pr.id=p_publication_request_id;
  insert into public.technical_questions(project_id,publication_id,publication_request_id,request_id,author_id,body)
    values(scope.project_id,scope.publication_id,p_publication_request_id,scope.request_id,actor,clean) returning * into q;
  insert into public.technical_rfi_reads(question_id,user_id) values(q.id,actor);
  receipt:=dao_private.rfi_question_json(q);
  insert into public.technical_rfi_receipts values(actor,p_idempotency_key,'create_question',receipt,now());
  select x.client_id into recipient_client from public.projects x where x.id=q.project_id;
  perform dao_private.emit_internal_notification(recipient_client,'rfi_question','rfi_question:'||q.id,
    jsonb_build_object('project_id',q.project_id,'question_id',q.id,'publication_request_id',q.publication_request_id,'workspace','client'));
  return receipt;
end $$;

create function dao_private.list_rfi_questions(p_limit integer default 20,p_before timestamptz default null,p_before_id uuid default null,p_publication_request_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if auth.uid() is null or p_limit not between 1 and 50 or (p_before is null)<>(p_before_id is null) then raise exception using errcode='22023',message='Pagination invalide'; end if;
  with page as (select q.* from public.technical_questions q where dao_private.rfi_question_access(q.id)
      and (p_publication_request_id is null or q.publication_request_id=p_publication_request_id)
      and (p_before is null or (q.last_activity_at,q.id)<(p_before,p_before_id))
      order by q.last_activity_at desc,q.id desc limit p_limit+1),
    bounded as (select * from page order by last_activity_at desc,id desc limit p_limit)
  select jsonb_build_object('items',coalesce((select jsonb_agg(dao_private.rfi_question_json(b) order by b.last_activity_at desc,b.id desc) from bounded b),'[]'::jsonb),
    'has_more',(select count(*)>p_limit from page),'unread',(select count(*) from public.technical_questions q where dao_private.rfi_question_access(q.id) and q.last_activity_at>coalesce((select r.read_at from public.technical_rfi_reads r where r.question_id=q.id and r.user_id=auth.uid()),q.created_at-interval '1 microsecond'))) into result;
  return result;
end $$;

create function dao_private.publish_rfi_clarification(p_question_id uuid,p_body text,p_impacts_scope boolean,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); clean text:=btrim(coalesce(p_body,'')); q public.technical_questions; c public.technical_clarifications; prior uuid; next_version integer; receipt jsonb; recipient uuid;
begin
  if actor is null or length(clean) not between 1 and 8000 or p_impacts_scope is null or p_idempotency_key is null or length(p_idempotency_key) not between 8 and 120
    then raise exception using errcode='22023',message='Paramètres invalides'; end if;
  select r.result into receipt from public.technical_rfi_receipts r where r.actor_id=actor and r.idempotency_key=p_idempotency_key;
  if receipt is not null then return receipt; end if;
  select * into q from public.technical_questions where id=p_question_id for update;
  if q.id is null or not dao_private.rfi_request_owner(q.publication_request_id) or q.status='archived' then raise exception using errcode='42501',message='Question introuvable'; end if;
  select id,version_no into prior,next_version from public.technical_clarifications where question_id=q.id order by version_no desc limit 1;
  next_version:=coalesce(next_version,0)+1;
  insert into public.technical_clarifications(question_id,version_no,author_id,body,impacts_scope,supersedes_id)
    values(q.id,next_version,actor,clean,p_impacts_scope,prior) returning * into c;
  update public.technical_questions set status='published',updated_at=now(),last_activity_at=now() where id=q.id returning * into q;
  insert into public.technical_rfi_reads(question_id,user_id) values(q.id,actor) on conflict(question_id,user_id) do update set read_at=excluded.read_at;
  receipt:=dao_private.rfi_question_json(q);
  insert into public.technical_rfi_receipts values(actor,p_idempotency_key,'publish_clarification',receipt,now());
  for recipient in select cp.user_id from public.contractor_profiles cp
    where dao_private.rfi_user_eligible(q.publication_request_id,cp.user_id)
  loop perform dao_private.emit_internal_notification(recipient,'rfi_clarification','rfi_clarification:'||c.id,
    jsonb_build_object('project_id',q.project_id,'question_id',q.id,'publication_request_id',q.publication_request_id,'workspace','contractor')); end loop;
  return receipt;
end $$;

create function dao_private.mark_rfi_read(p_question_id uuid) returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not dao_private.rfi_question_access(p_question_id) then raise exception using errcode='42501',message='Question introuvable'; end if;
  insert into public.technical_rfi_reads(question_id,user_id) values(p_question_id,auth.uid()) on conflict(question_id,user_id) do update set read_at=excluded.read_at;
  return true;
end $$;

create function dao_private.create_rfi_document(p_question_id uuid,p_clarification_id uuid,p_object_path text,p_original_name text,p_mime_type text,p_size_bytes bigint)
returns public.technical_rfi_documents language plpgsql security definer set search_path='' as $$
declare q public.technical_questions; d public.technical_rfi_documents;
begin
  select * into q from public.technical_questions where id=p_question_id for update;
  if q.id is null or not (q.author_id=auth.uid() or dao_private.rfi_request_owner(q.publication_request_id)) then raise exception using errcode='42501',message='Question introuvable'; end if;
  if p_clarification_id is null and q.author_id<>auth.uid() then raise exception using errcode='42501',message='Document question refusé'; end if;
  if p_clarification_id is not null and (not dao_private.rfi_request_owner(q.publication_request_id) or not exists(select 1 from public.technical_clarifications c where c.id=p_clarification_id and c.question_id=q.id)) then raise exception using errcode='42501',message='Clarification refusée'; end if;
  if p_object_path not like 'rfi/'||q.id::text||'/%' or p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp') or p_size_bytes not between 1 and 20971520 then raise exception using errcode='22023',message='Document invalide'; end if;
  insert into public.technical_rfi_documents(question_id,clarification_id,owner_id,object_path,original_name,mime_type,size_bytes)
    values(q.id,p_clarification_id,auth.uid(),p_object_path,p_original_name,p_mime_type,p_size_bytes) returning * into d; return d;
end $$;

create function dao_private.approve_rfi_document(p_document_id uuid) returns public.technical_rfi_documents language plpgsql security definer set search_path='' as $$
declare d public.technical_rfi_documents;
begin
  update public.technical_rfi_documents set status='approved' where id=p_document_id and owner_id=auth.uid() and status='quarantined' returning * into d;
  if d.id is null then raise exception using errcode='42501',message='Document refusé'; end if; return d;
end $$;

create function dao_private.delete_rfi_document(p_document_id uuid) returns public.technical_rfi_documents language plpgsql security definer set search_path='' as $$
declare d public.technical_rfi_documents;
begin
  delete from public.technical_rfi_documents where id=p_document_id and owner_id=auth.uid() and status<>'approved' returning * into d;
  if d.id is null then raise exception using errcode='42501',message='Document refusé'; end if; return d;
end $$;

create function dao_private.immutable_rfi_history() returns trigger language plpgsql set search_path='' as $$begin raise exception using errcode='23514',message='Historique RFI immuable'; end$$;
create trigger immutable_rfi_clarifications before update or delete on public.technical_clarifications for each row execute function dao_private.immutable_rfi_history();
create trigger immutable_rfi_question_body before update of body,author_id,publication_request_id,request_id,project_id,publication_id on public.technical_questions for each row execute function dao_private.immutable_rfi_history();

-- Extend the existing live notification authorization without changing private conversation grants.
create or replace function dao_private.notification_visible(n public.notifications) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare workspace text; pid uuid; iid uuid; cid uuid; qid uuid;
begin
  if auth.uid() is null or n.user_id is distinct from auth.uid() or not dao_private.account_active(auth.uid()) then return false; end if;
  workspace:=dao_private.notification_workspace(); if workspace='staff' then return false; end if;
  pid:=dao_private.notification_uuid(n.payload->>'project_id');
  if not exists(select 1 from public.projects where id=pid and status<>'archived') then return false; end if;
  if n.kind='project_message' then cid:=dao_private.notification_uuid(n.payload->>'conversation_id'); return exists(select 1 from public.conversations c join public.projects p on p.id=c.project_id where c.id=cid and c.project_id=pid and dao_private.conversation(c.id) and workspace=case when p.client_id=auth.uid() then 'client' else 'contractor' end); end if;
  if n.payload->>'workspace' is distinct from workspace then return false; end if;
  qid:=dao_private.notification_uuid(n.payload->>'question_id');
  if n.kind='rfi_question' then return workspace='client' and exists(select 1 from public.technical_questions q where q.id=qid and q.project_id=pid and dao_private.rfi_request_owner(q.publication_request_id)); end if;
  if n.kind='rfi_clarification' then return workspace='contractor' and exists(select 1 from public.technical_questions q where q.id=qid and q.project_id=pid and q.status='published' and dao_private.rfi_request_eligible(q.publication_request_id)); end if;
  if n.kind in ('review_approved','review_rejected') then return workspace='client' and dao_private.owner(pid) and exists(select 1 from public.project_versions v where v.id=dao_private.notification_uuid(n.payload->>'version_id') and v.project_id=pid and v.status=case when n.kind='review_approved' then 'approved' else 'rejected' end); end if;
  iid:=dao_private.notification_uuid(n.payload->>'invitation_id');
  if n.kind='invitation_expiring' then return exists(select 1 from public.project_invitations i where i.id=iid and i.project_id=pid and i.expected_role=workspace and dao_private.invitation_expiry_reminder_allowed(i,auth.uid(),now()));
  elsif n.kind='invitation_received' then return exists(select 1 from public.project_invitations i join auth.users u on u.id=auth.uid()
    join public.project_members sender on sender.project_id=i.project_id and sender.user_id=i.created_by and sender.status='accepted'
    where i.id=iid and i.project_id=pid and i.expected_role=workspace and i.status='pending' and i.expires_at>now()
      and u.email_confirmed_at is not null and lower(u.email)=i.recipient_email and dao_private.account_active(i.created_by)
      and (sender.participation_role<>'contractor' or not exists(select 1 from public.contractor_profiles where user_id=i.created_by and verification_status='suspended')));
  elsif n.kind='invitation_accepted' then return exists(select 1 from public.project_invitations i join public.projects p on p.id=i.project_id join public.project_members recipient on recipient.project_id=p.id and recipient.user_id=auth.uid() and recipient.status='accepted' and recipient.participation_role=workspace join public.project_members joined on joined.project_id=p.id and joined.user_id=i.accepted_by and joined.status='accepted' and joined.participation_role=i.expected_role where i.id=iid and p.id=pid and i.status='accepted' and p.initiator_id=auth.uid() and i.accepted_by<>auth.uid() and dao_private.account_active(i.accepted_by) and exists(select 1 from public.user_roles where user_id=i.accepted_by and role=i.expected_role) and (i.expected_role<>'contractor' or not exists(select 1 from public.contractor_profiles where user_id=i.accepted_by and verification_status='suspended'))); end if;
  return false;
end $$;

create or replace function dao_private.my_notifications_s2(p_limit integer default 20,p_before timestamptz default null,p_before_id uuid default null,p_unread boolean default false,p_action boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; current_workspace text;
begin
  current_workspace:=dao_private.notification_workspace();
  if p_limit is null or p_limit<1 or p_limit>50 or p_unread is null or p_action is null or (p_before is null)<>(p_before_id is null) then raise exception using errcode='22023',message='Pagination invalide'; end if;
  with visible as materialized (select n.* from public.notifications n where n.user_id=auth.uid() and dao_private.notification_visible(n)),
  page as (select n.id,n.created_at,n.kind,n.read_at,n.kind='invitation_expiring' action_required,
      case when n.kind='invitation_expiring' then (select i.expires_at from public.project_invitations i where i.id=dao_private.notification_uuid(n.payload->>'invitation_id')) else null end expires_at,
      case when n.kind='project_message' then dao_private.notification_uuid(n.payload->>'conversation_id')
        when n.kind in ('rfi_question','rfi_clarification') then dao_private.notification_uuid(n.payload->>'question_id')
        when n.kind in ('invitation_received','invitation_expiring') then dao_private.notification_uuid(n.payload->>'invitation_id')
        else dao_private.notification_uuid(n.payload->>'project_id') end target_id
    from visible n where (not p_unread or n.read_at is null) and (not p_action or n.kind='invitation_expiring') and (p_before is null or (n.created_at,n.id)<(p_before,p_before_id)) order by n.created_at desc,n.id desc limit p_limit+1),
  bounded as (select * from page order by created_at desc,id desc limit p_limit)
  select jsonb_build_object('workspace',current_workspace,'rows',coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc,b.id desc) from bounded b),'[]'::jsonb),'unread_count',(select count(*) from visible where read_at is null),'has_more',(select count(*)>p_limit from page)) into result; return result;
end $$;

create function public.create_rfi_question(p_publication_request_id uuid,p_body text,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$select dao_private.create_rfi_question($1,$2,$3)$$;
create function public.list_rfi_questions(p_limit integer default 20,p_before timestamptz default null,p_before_id uuid default null,p_publication_request_id uuid default null) returns jsonb language sql stable security definer set search_path='' as $$select dao_private.list_rfi_questions($1,$2,$3,$4)$$;
create function public.publish_rfi_clarification(p_question_id uuid,p_body text,p_impacts_scope boolean,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$select dao_private.publish_rfi_clarification($1,$2,$3,$4)$$;
create function public.mark_rfi_read(p_question_id uuid) returns boolean language sql security definer set search_path='' as $$select dao_private.mark_rfi_read($1)$$;
create function public.create_rfi_document(p_question_id uuid,p_clarification_id uuid,p_object_path text,p_original_name text,p_mime_type text,p_size_bytes bigint) returns public.technical_rfi_documents language sql security definer set search_path='' as $$select dao_private.create_rfi_document($1,$2,$3,$4,$5,$6)$$;
create function public.approve_rfi_document(p_document_id uuid) returns public.technical_rfi_documents language sql security definer set search_path='' as $$select dao_private.approve_rfi_document($1)$$;
create function public.delete_rfi_document(p_document_id uuid) returns public.technical_rfi_documents language sql security definer set search_path='' as $$select dao_private.delete_rfi_document($1)$$;

revoke all on public.technical_questions,public.technical_clarifications,public.technical_rfi_reads,public.technical_rfi_receipts,public.technical_rfi_documents from public,anon,authenticated;
grant select on public.technical_questions,public.technical_clarifications,public.technical_rfi_reads,public.technical_rfi_documents to authenticated;
grant all on public.technical_questions,public.technical_clarifications,public.technical_rfi_reads,public.technical_rfi_receipts,public.technical_rfi_documents to service_role;
revoke all on function dao_private.rfi_request_owner(uuid),dao_private.rfi_user_eligible(uuid,uuid),dao_private.rfi_request_eligible(uuid),dao_private.rfi_question_access(uuid),dao_private.rfi_document_access(uuid),dao_private.rfi_question_json(public.technical_questions),dao_private.create_rfi_question(uuid,text,text),dao_private.list_rfi_questions(integer,timestamptz,uuid,uuid),dao_private.publish_rfi_clarification(uuid,text,boolean,text),dao_private.mark_rfi_read(uuid),dao_private.create_rfi_document(uuid,uuid,text,text,text,bigint),dao_private.approve_rfi_document(uuid),dao_private.delete_rfi_document(uuid),dao_private.immutable_rfi_history() from public,anon,authenticated;
revoke all on function public.create_rfi_question(uuid,text,text),public.list_rfi_questions(integer,timestamptz,uuid,uuid),public.publish_rfi_clarification(uuid,text,boolean,text),public.mark_rfi_read(uuid),public.create_rfi_document(uuid,uuid,text,text,text,bigint),public.approve_rfi_document(uuid),public.delete_rfi_document(uuid) from public,anon,authenticated;
grant execute on function public.create_rfi_question(uuid,text,text),public.list_rfi_questions(integer,timestamptz,uuid,uuid),public.publish_rfi_clarification(uuid,text,boolean,text),public.mark_rfi_read(uuid),public.create_rfi_document(uuid,uuid,text,text,text,bigint),public.approve_rfi_document(uuid),public.delete_rfi_document(uuid) to authenticated,service_role;
grant execute on function dao_private.rfi_request_owner(uuid),dao_private.rfi_request_eligible(uuid),dao_private.rfi_question_access(uuid),dao_private.rfi_document_access(uuid),dao_private.notification_visible(public.notifications) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
