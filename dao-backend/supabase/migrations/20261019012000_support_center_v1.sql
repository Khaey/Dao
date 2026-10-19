begin;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_no bigint generated always as identity unique,
  requester_id uuid not null references auth.users(id),
  subject text not null check(length(subject) between 4 and 120),
  category text not null check(category in ('account','project','offer','professional_profile','technical','other')),
  status text not null default 'open' check(status in ('open','waiting_staff','waiting_user','resolved','closed')),
  project_id uuid references public.projects(id),
  assignee_id uuid references auth.users(id),
  origin_route text check(origin_route is null or (length(origin_route)<=160 and origin_route ~ '^/(login|register|app)?[A-Za-z0-9/_-]*$')),
  origin_faq_id text check(origin_faq_id is null or origin_faq_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(), resolved_at timestamptz, closed_at timestamptz
);
create table public.support_messages (
  id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.support_tickets(id),
  author_id uuid references auth.users(id), author_role text not null check(author_role in ('requester','staff','system')),
  body text not null check(length(body) between 1 and 4000), idempotency_key text not null,
  created_at timestamptz not null default now(), unique(author_id,idempotency_key)
);
create table public.support_reads (
  ticket_id uuid not null references public.support_tickets(id), user_id uuid not null references auth.users(id),
  read_at timestamptz not null default now(), primary key(ticket_id,user_id)
);
create table public.support_events (
  id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.support_tickets(id),
  actor_id uuid references auth.users(id), event_type text not null check(event_type in ('created','assigned','status_changed','replied','read')),
  details jsonb not null default '{}' check(jsonb_typeof(details)='object'), created_at timestamptz not null default now()
);
create table public.support_command_receipts (
  actor_id uuid not null references auth.users(id), idempotency_key text not null,
  command text not null check(command in ('create_ticket','reply_ticket')), result jsonb not null,
  created_at timestamptz not null default now(), primary key(actor_id,idempotency_key)
);

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.support_reads enable row level security;
alter table public.support_events enable row level security;
alter table public.support_command_receipts enable row level security;

create function dao_private.support_staff() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and dao_private.account_active(auth.uid()) and exists(
   select 1 from public.user_roles where user_id=auth.uid() and role in ('dao_reviewer','dao_admin'));
$$;
create function dao_private.support_ticket_access(p_ticket_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and dao_private.account_active(auth.uid()) and exists(
   select 1 from public.support_tickets t where t.id=p_ticket_id
     and (t.requester_id=auth.uid() or dao_private.support_staff()));
$$;
create function dao_private.support_project_allowed(p_project_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select p_project_id is null or exists(select 1 from public.project_members m join public.projects p on p.id=m.project_id
   where m.project_id=p_project_id and m.user_id=auth.uid() and m.status='accepted' and p.status<>'archived');
$$;

create policy support_tickets_visible on public.support_tickets for select to authenticated using(dao_private.support_ticket_access(id));
create policy support_messages_visible on public.support_messages for select to authenticated using(dao_private.support_ticket_access(ticket_id));
create policy support_reads_visible on public.support_reads for select to authenticated using(user_id=auth.uid() and dao_private.support_ticket_access(ticket_id));

create function dao_private.my_support_summary() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid();
begin
 if actor is null or not dao_private.account_active(actor) then raise exception using errcode='42501',message='Compte actif requis'; end if;
 return (select jsonb_build_object(
   'open',count(*) filter(where status not in ('resolved','closed')),
   'unread',count(*) filter(where last_message_at>coalesce((select r.read_at from public.support_reads r where r.ticket_id=t.id and r.user_id=actor),t.created_at-interval '1 microsecond')))
 from public.support_tickets t where t.requester_id=actor);
end;$$;

create function dao_private.create_support_ticket(p_subject text,p_category text,p_body text,p_project_id uuid,
 p_origin_route text,p_origin_faq_id text,p_idempotency_key text) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); clean_subject text:=btrim(coalesce(p_subject,'')); clean_body text:=btrim(coalesce(p_body,''));
 ticket public.support_tickets; result jsonb;
begin
 if actor is null or not dao_private.account_active(actor) then raise exception using errcode='42501',message='Compte actif requis'; end if;
 if length(clean_subject) not between 4 and 120 or length(clean_body) not between 1 and 4000
   or p_category not in ('account','project','offer','professional_profile','technical','other')
   or p_idempotency_key is null or length(p_idempotency_key) not between 16 and 128
   or not dao_private.support_project_allowed(p_project_id) then raise exception using errcode='22023',message='Paramètres invalides'; end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key,0));
 select r.result into result from public.support_command_receipts r where r.actor_id=actor and r.idempotency_key=p_idempotency_key;
 if result is not null then return result; end if;
 if (select count(*) from public.support_tickets where requester_id=actor and created_at>now()-interval '1 hour')>=10 then
   raise exception using errcode='P0001',message='Trop de demandes'; end if;
 insert into public.support_tickets(requester_id,subject,category,project_id,origin_route,origin_faq_id)
 values(actor,clean_subject,p_category,p_project_id,p_origin_route,p_origin_faq_id) returning * into ticket;
 insert into public.support_messages(ticket_id,author_id,author_role,body,idempotency_key)
 values(ticket.id,actor,'requester',clean_body,p_idempotency_key||':initial');
 insert into public.support_reads(ticket_id,user_id) values(ticket.id,actor);
 insert into public.support_events(ticket_id,actor_id,event_type) values(ticket.id,actor,'created');
 result:=jsonb_build_object('id',ticket.id,'reference','AS-'||lpad(ticket.ticket_no::text,6,'0'));
 insert into public.support_command_receipts values(actor,p_idempotency_key,'create_ticket',result,now());
 return result;
end;$$;

create function dao_private.list_my_support_tickets(p_limit integer default 20,p_before timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); safe_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
begin
 if actor is null or not dao_private.account_active(actor) then raise exception using errcode='42501',message='Compte actif requis'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'reference','AS-'||lpad(x.ticket_no::text,6,'0'),
   'subject',x.subject,'category',x.category,'status',x.status,'project_id',x.project_id,'created_at',x.created_at,
   'updated_at',x.updated_at,'last_message_at',x.last_message_at,'unread_count',case when x.last_message_at>coalesce(x.read_at,x.created_at-interval '1 microsecond') then 1 else 0 end,
   'assignee_label',x.assignee_label) order by x.last_message_at desc,x.id desc) from (
   select t.*,r.read_at,case when t.assignee_id is null then null else coalesce(p.display_name,'Équipe D.A.O.') end assignee_label
   from public.support_tickets t left join public.support_reads r on r.ticket_id=t.id and r.user_id=actor
   left join public.profiles p on p.user_id=t.assignee_id where t.requester_id=actor
   and (p_before is null or (t.last_message_at,t.id)<(p_before,p_before_id)) order by t.last_message_at desc,t.id desc limit safe_limit
 ) x),'[]'::jsonb);
end;$$;

create function dao_private.get_support_ticket(p_ticket_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not dao_private.support_ticket_access(p_ticket_id) then raise exception using errcode='42501',message='Ticket introuvable'; end if;
 return (select jsonb_build_object('ticket',jsonb_build_object('id',t.id,'reference','AS-'||lpad(t.ticket_no::text,6,'0'),
  'subject',t.subject,'category',t.category,'status',t.status,'project_id',t.project_id,'created_at',t.created_at,
  'updated_at',t.updated_at,'last_message_at',t.last_message_at,'assignee_label',case when t.assignee_id is null then null else coalesce(ap.display_name,'Équipe D.A.O.') end,
  'requester_label',case when dao_private.support_staff() then coalesce(rp.display_name,'Utilisateur D.A.O.') else null end),
  'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'ticket_id',m.ticket_id,'author_role',m.author_role,
   'author_label',case when m.author_role='staff' then 'Équipe D.A.O.' when m.author_role='system' then 'D.A.O.'
    when m.author_id=auth.uid() then 'Vous' else coalesce(rp.display_name,'Utilisateur D.A.O.') end,
   'body',m.body,'created_at',m.created_at) order by m.created_at,m.id) from public.support_messages m where m.ticket_id=t.id),'[]'::jsonb))
 from public.support_tickets t left join public.profiles ap on ap.user_id=t.assignee_id left join public.profiles rp on rp.user_id=t.requester_id where t.id=p_ticket_id);
end;$$;

create function dao_private.support_queue(p_limit integer default 20,p_before timestamptz default null,p_before_id uuid default null,
 p_status text default null,p_assignee text default 'all') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,20),1),50); begin
 if not dao_private.support_staff() or (p_status is not null and p_status not in ('open','waiting_staff','waiting_user','resolved','closed'))
   or p_assignee not in ('me','unassigned','all') then raise exception using errcode='42501',message='Accès refusé'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'reference','AS-'||lpad(x.ticket_no::text,6,'0'),
  'subject',x.subject,'category',x.category,'status',x.status,'project_id',x.project_id,'created_at',x.created_at,
  'updated_at',x.updated_at,'last_message_at',x.last_message_at,'unread_count',0,'assignee_label',x.assignee_label,
  'requester_label',x.requester_label) order by x.last_message_at desc,x.id desc) from (
   select t.*,coalesce(ap.display_name,'Équipe D.A.O.') assignee_label,coalesce(rp.display_name,'Utilisateur D.A.O.') requester_label
   from public.support_tickets t left join public.profiles ap on ap.user_id=t.assignee_id left join public.profiles rp on rp.user_id=t.requester_id
   where (p_status is null or t.status=p_status) and (p_assignee='all' or (p_assignee='me' and t.assignee_id=auth.uid())
    or (p_assignee='unassigned' and t.assignee_id is null))
   and (p_before is null or (t.last_message_at,t.id)<(p_before,p_before_id)) order by t.last_message_at desc,t.id desc limit safe_limit
  ) x),'[]'::jsonb); end;$$;

create function dao_private.reply_support_ticket(p_ticket_id uuid,p_body text,p_idempotency_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); clean_body text:=btrim(coalesce(p_body,'')); ticket public.support_tickets; role text; msg public.support_messages; result jsonb;
begin
 if not dao_private.support_ticket_access(p_ticket_id) or length(clean_body) not between 1 and 4000
   or p_idempotency_key is null or length(p_idempotency_key) not between 16 and 128 then raise exception using errcode='42501',message='Ticket introuvable'; end if;
 select * into ticket from public.support_tickets where id=p_ticket_id for update;
 if ticket.status='closed' then raise exception using errcode='22023',message='Ticket fermé'; end if;
 role:=case when actor=ticket.requester_id then 'requester' else 'staff' end;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key,0));
 select r.result into result from public.support_command_receipts r where r.actor_id=actor and r.idempotency_key=p_idempotency_key;
 if result is not null then return result; end if;
 insert into public.support_messages(ticket_id,author_id,author_role,body,idempotency_key) values(ticket.id,actor,role,clean_body,p_idempotency_key) returning * into msg;
 update public.support_tickets set status=case when role='requester' then 'waiting_staff' else 'waiting_user' end,
   updated_at=now(),last_message_at=msg.created_at where id=ticket.id;
 insert into public.support_events(ticket_id,actor_id,event_type) values(ticket.id,actor,'replied');
 result:=jsonb_build_object('id',msg.id,'created_at',msg.created_at);
 insert into public.support_command_receipts values(actor,p_idempotency_key,'reply_ticket',result,now()); return result;
end;$$;

create function dao_private.mark_support_ticket_read(p_ticket_id uuid) returns timestamptz language plpgsql security definer set search_path='' as $$
declare stamp timestamptz:=now(); begin if not dao_private.support_ticket_access(p_ticket_id) then raise exception using errcode='42501',message='Ticket introuvable'; end if;
 insert into public.support_reads values(p_ticket_id,auth.uid(),stamp) on conflict(ticket_id,user_id) do update set read_at=excluded.read_at;
 return stamp; end;$$;

create function dao_private.assign_support_ticket_to_me(p_ticket_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare ticket public.support_tickets; begin if not dao_private.support_staff() then raise exception using errcode='42501',message='Accès refusé'; end if;
 update public.support_tickets set assignee_id=auth.uid(),updated_at=now() where id=p_ticket_id returning * into ticket;
 if ticket.id is null then raise exception using errcode='42501',message='Ticket introuvable'; end if;
 insert into public.support_events(ticket_id,actor_id,event_type,details) values(ticket.id,auth.uid(),'assigned',jsonb_build_object('self',true));
 return jsonb_build_object('id',ticket.id,'assigned',true); end;$$;

create function dao_private.set_support_ticket_status(p_ticket_id uuid,p_status text,p_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare ticket public.support_tickets; reason text:=btrim(coalesce(p_reason,'')); begin
 if not dao_private.support_staff() or p_status not in ('open','waiting_staff','waiting_user','resolved','closed')
   or (p_status in ('resolved','closed') and length(reason) not between 4 and 500) then raise exception using errcode='42501',message='Accès refusé'; end if;
 update public.support_tickets set status=p_status,updated_at=now(),resolved_at=case when p_status='resolved' then now() else resolved_at end,
   closed_at=case when p_status='closed' then now() else null end where id=p_ticket_id returning * into ticket;
 if ticket.id is null then raise exception using errcode='42501',message='Ticket introuvable'; end if;
 insert into public.support_events(ticket_id,actor_id,event_type,details) values(ticket.id,auth.uid(),'status_changed',jsonb_build_object('status',p_status,'reason',nullif(reason,'')));
 return jsonb_build_object('id',ticket.id,'status',ticket.status); end;$$;

create function dao_private.immutable_support_history() returns trigger language plpgsql set search_path='' as $$
begin raise exception using errcode='23514',message='Historique support immuable'; end;$$;
create trigger immutable_support_messages before update or delete on public.support_messages for each row execute function dao_private.immutable_support_history();
create trigger immutable_support_events before update or delete on public.support_events for each row execute function dao_private.immutable_support_history();

create index support_tickets_requester_order_idx on public.support_tickets(requester_id,last_message_at desc,id desc);
create index support_tickets_queue_idx on public.support_tickets(status,assignee_id,last_message_at desc,id desc);
create index support_messages_ticket_order_idx on public.support_messages(ticket_id,created_at,id);

create function public.my_support_summary() returns jsonb language sql security definer set search_path='' as $$select dao_private.my_support_summary();$$;
create function public.create_support_ticket(p_subject text,p_category text,p_body text,p_project_id uuid default null,p_origin_route text default null,p_origin_faq_id text default null,p_idempotency_key text default null)
 returns jsonb language sql security definer set search_path='' as $$select dao_private.create_support_ticket($1,$2,$3,$4,$5,$6,$7);$$;
create function public.list_my_support_tickets(p_limit integer default 20,p_before timestamptz default null,p_before_id uuid default null) returns jsonb language sql security definer set search_path='' as $$select dao_private.list_my_support_tickets($1,$2,$3);$$;
create function public.get_support_ticket(p_ticket_id uuid) returns jsonb language sql security definer set search_path='' as $$select dao_private.get_support_ticket($1);$$;
create function public.reply_support_ticket(p_ticket_id uuid,p_body text,p_idempotency_key text) returns jsonb language sql security definer set search_path='' as $$select dao_private.reply_support_ticket($1,$2,$3);$$;
create function public.mark_support_ticket_read(p_ticket_id uuid) returns timestamptz language sql security definer set search_path='' as $$select dao_private.mark_support_ticket_read($1);$$;
create function public.support_queue(p_limit integer default 20,p_before timestamptz default null,p_before_id uuid default null,p_status text default null,p_assignee text default 'all') returns jsonb language sql security definer set search_path='' as $$select dao_private.support_queue($1,$2,$3,$4,$5);$$;
create function public.assign_support_ticket_to_me(p_ticket_id uuid) returns jsonb language sql security definer set search_path='' as $$select dao_private.assign_support_ticket_to_me($1);$$;
create function public.set_support_ticket_status(p_ticket_id uuid,p_status text,p_reason text default null) returns jsonb language sql security definer set search_path='' as $$select dao_private.set_support_ticket_status($1,$2,$3);$$;

revoke all on public.support_tickets,public.support_messages,public.support_reads,public.support_events,public.support_command_receipts from public,anon,authenticated;
revoke all on function dao_private.support_staff(),dao_private.support_ticket_access(uuid),dao_private.support_project_allowed(uuid),
 dao_private.my_support_summary(),dao_private.create_support_ticket(text,text,text,uuid,text,text,text),
 dao_private.list_my_support_tickets(integer,timestamptz,uuid),dao_private.get_support_ticket(uuid),
 dao_private.reply_support_ticket(uuid,text,text),dao_private.mark_support_ticket_read(uuid),
 dao_private.support_queue(integer,timestamptz,uuid,text,text),
 dao_private.assign_support_ticket_to_me(uuid),dao_private.set_support_ticket_status(uuid,text,text),
 dao_private.immutable_support_history() from public,anon,authenticated;
revoke all on function public.my_support_summary(),public.create_support_ticket(text,text,text,uuid,text,text,text),
 public.list_my_support_tickets(integer,timestamptz,uuid),public.get_support_ticket(uuid),public.reply_support_ticket(uuid,text,text),
 public.mark_support_ticket_read(uuid),public.support_queue(integer,timestamptz,uuid,text,text),public.assign_support_ticket_to_me(uuid),public.set_support_ticket_status(uuid,text,text) from public,anon,authenticated;
grant execute on function public.my_support_summary(),public.create_support_ticket(text,text,text,uuid,text,text,text),
 public.list_my_support_tickets(integer,timestamptz,uuid),public.get_support_ticket(uuid),public.reply_support_ticket(uuid,text,text),
 public.mark_support_ticket_read(uuid),public.support_queue(integer,timestamptz,uuid,text,text),public.assign_support_ticket_to_me(uuid),public.set_support_ticket_status(uuid,text,text) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
