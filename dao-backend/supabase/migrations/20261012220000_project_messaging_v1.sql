begin;

-- Private chantier messaging reuses the original conversation tables. Access
-- is evaluated from the live project memberships on every read and command;
-- a historical participant row never grants access by itself.
create or replace function dao_private.messaging_pair(p_project_id uuid,p_contractor_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1
    from public.projects p
    join public.contractor_profiles cp on cp.id=p_contractor_id
    join public.project_members client_member on client_member.project_id=p.id
      and client_member.user_id=p.client_id and client_member.participation_role='client'
      and client_member.status='accepted'
    join public.project_members contractor_member on contractor_member.project_id=p.id
      and contractor_member.user_id=cp.user_id and contractor_member.participation_role='contractor'
      and contractor_member.status='accepted'
    where p.id=p_project_id and p.client_id is not null and p.confirmed_at is not null
      and p.status<>'archived' and cp.verification_status<>'suspended'
      and dao_private.account_active(p.client_id) and dao_private.account_active(cp.user_id)
  );
$$;

create or replace function dao_private.conversation(c uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and dao_private.account_active(auth.uid()) and exists(
    select 1 from public.conversations conv
    join public.projects p on p.id=conv.project_id
    join public.contractor_profiles cp on cp.id=conv.contractor_id
    where conv.id=c
      and dao_private.messaging_pair(conv.project_id,conv.contractor_id)
      and auth.uid() in (p.client_id,cp.user_id)
  );
$$;

revoke all on function dao_private.messaging_pair(uuid,uuid),dao_private.conversation(uuid)
  from public,anon,authenticated;
grant execute on function dao_private.messaging_pair(uuid,uuid),dao_private.conversation(uuid)
  to authenticated,service_role;

create function dao_private.open_project_conversation(p_project_id uuid,p_contractor_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); cid uuid; client_user uuid; contractor_user uuid;
begin
  if actor is null or not dao_private.account_active(actor) then
    raise exception using errcode='42501',message='Compte actif requis';
  end if;
  select p.client_id,cp.user_id into client_user,contractor_user
  from public.projects p cross join public.contractor_profiles cp
  where p.id=p_project_id and cp.id=p_contractor_id;
  if client_user is null or contractor_user is null
     or actor not in (client_user,contractor_user)
     or not dao_private.messaging_pair(p_project_id,p_contractor_id) then
    raise exception using errcode='42501',message='Conversation non autorisée';
  end if;
  insert into public.conversations(project_id,contractor_id)
  values(p_project_id,p_contractor_id)
  on conflict(project_id,contractor_id) do update set project_id=excluded.project_id
  returning id into cid;
  insert into public.conversation_participants(conversation_id,user_id)
  values(cid,client_user),(cid,contractor_user) on conflict do nothing;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(actor,'conversation_opened','conversation',cid,
    jsonb_build_object('project_id',p_project_id,'contractor_id',p_contractor_id));
  return cid;
end;
$$;

create function dao_private.open_project_member_conversation(p_project_id uuid,p_member_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare contractor uuid;
begin
  select cp.id into contractor from public.project_members m
  join public.contractor_profiles cp on cp.user_id=m.user_id
  where m.id=p_member_id and m.project_id=p_project_id
    and m.participation_role='contractor' and m.status='accepted';
  if contractor is null then raise exception using errcode='42501',message='Professionnel non autorisé'; end if;
  return dao_private.open_project_conversation(p_project_id,contractor);
end;
$$;

create function dao_private.list_my_conversations()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid()) then
    raise exception using errcode='42501',message='Compte actif requis';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',c.id,'project_id',c.project_id,'contractor_id',c.contractor_id,
      'project_title',coalesce(pv.title,'Chantier'),
      'participant_name',case when p.client_id=auth.uid() then cp.business_name else coalesce(pr.display_name,'Client D.A.O') end,
      'last_message_at',last_message.created_at,'last_message',last_message.body,
      'unread_count',(select count(*) from public.notifications n where n.user_id=auth.uid()
        and n.kind='project_message' and n.read_at is null
        and n.payload->>'conversation_id'=c.id::text)
    ) order by coalesce(last_message.created_at,c.created_at) desc,c.id)
    from public.conversations c
    join public.projects p on p.id=c.project_id
    join public.contractor_profiles cp on cp.id=c.contractor_id
    left join public.profiles pr on pr.user_id=p.client_id
    left join lateral (select title from public.project_versions where project_id=p.id order by version_no desc limit 1) pv on true
    left join lateral (select created_at,body from public.messages where conversation_id=c.id order by created_at desc,id desc limit 1) last_message on true
    where dao_private.conversation(c.id)
  ),'[]'::jsonb);
end;
$$;

create function dao_private.list_conversation_messages(p_conversation_id uuid,p_before timestamptz default null,p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,30),1),50);
begin
  if not dao_private.conversation(p_conversation_id) then
    raise exception using errcode='42501',message='Conversation non autorisée';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from (
    select m.id,m.created_at,m.author_id,m.body
    from public.messages m where m.conversation_id=p_conversation_id
      and (p_before is null or m.created_at<p_before)
    order by m.created_at desc,m.id desc limit safe_limit
  ) x),'[]'::jsonb);
end;
$$;

create function dao_private.send_conversation_message(p_conversation_id uuid,p_body text,p_idempotency_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); clean_body text:=btrim(coalesce(p_body,'')); existing jsonb;
  msg public.messages; recipient uuid; project uuid;
begin
  if actor is null or not dao_private.conversation(p_conversation_id) then
    raise exception using errcode='42501',message='Conversation non autorisée';
  end if;
  if length(clean_body)<1 or length(clean_body)>4000 then
    raise exception using errcode='22023',message='Le message doit contenir entre 1 et 4 000 caractères';
  end if;
  if p_idempotency_key is null then raise exception using errcode='22023',message='Clé idempotente requise'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_idempotency_key::text,0));
  select result into existing from public.command_receipts
    where actor_id=actor and idempotency_key=p_idempotency_key::text and command='send_conversation_message';
  if existing is not null then return existing; end if;
  if exists(select 1 from public.command_receipts where actor_id=actor and idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée';
  end if;
  if (select count(*) from public.messages where conversation_id=p_conversation_id
      and author_id=actor and created_at>now()-interval '1 minute')>=20 then
    raise exception using errcode='P0001',message='Trop de messages, réessayez dans un instant';
  end if;
  insert into public.messages(conversation_id,author_id,body)
  values(p_conversation_id,actor,clean_body) returning * into msg;
  select c.project_id,case when p.client_id=actor then cp.user_id else p.client_id end
    into project,recipient from public.conversations c join public.projects p on p.id=c.project_id
    join public.contractor_profiles cp on cp.id=c.contractor_id where c.id=p_conversation_id;
  insert into public.notifications(user_id,kind,payload)
  values(recipient,'project_message',jsonb_build_object('conversation_id',p_conversation_id,
    'project_id',project,'message_id',msg.id,'href','/app/messages/'||p_conversation_id::text));
  existing:=to_jsonb(msg);
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
  values(actor,p_idempotency_key::text,'send_conversation_message',existing);
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(actor,'message_sent','message',msg.id,jsonb_build_object('conversation_id',p_conversation_id,'project_id',project));
  return existing;
end;
$$;

create function dao_private.mark_conversation_read(p_conversation_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  if not dao_private.conversation(p_conversation_id) then
    raise exception using errcode='42501',message='Conversation non autorisée';
  end if;
  update public.notifications set read_at=coalesce(read_at,now())
  where user_id=auth.uid() and kind='project_message' and read_at is null
    and payload->>'conversation_id'=p_conversation_id::text;
  get diagnostics changed=row_count;
  return changed;
end;
$$;

create function dao_private.append_only_messaging() returns trigger
language plpgsql set search_path='' as $$
begin raise exception using errcode='23514',message='Historique de messagerie immuable'; end;
$$;
create trigger immutable_messages before update or delete on public.messages
for each row execute function dao_private.append_only_messaging();
create trigger immutable_conversations before delete on public.conversations
for each row execute function dao_private.append_only_messaging();
create trigger immutable_conversation_participants before update or delete on public.conversation_participants
for each row execute function dao_private.append_only_messaging();

create index messages_conversation_chronology_idx on public.messages(conversation_id,created_at desc,id desc);
create index notifications_project_message_idx on public.notifications(user_id,kind,read_at)
where kind='project_message';

create function public.open_project_conversation(p_project_id uuid,p_contractor_id uuid) returns uuid
language sql security invoker set search_path='' as $$select dao_private.open_project_conversation($1,$2);$$;
create function public.open_project_member_conversation(p_project_id uuid,p_member_id uuid) returns uuid
language sql security invoker set search_path='' as $$select dao_private.open_project_member_conversation($1,$2);$$;
create function public.list_my_conversations() returns jsonb
language sql security invoker set search_path='' as $$select dao_private.list_my_conversations();$$;
create function public.list_conversation_messages(p_conversation_id uuid,p_before timestamptz default null,p_limit integer default 30) returns jsonb
language sql security invoker set search_path='' as $$select dao_private.list_conversation_messages($1,$2,$3);$$;
create function public.send_conversation_message(p_conversation_id uuid,p_body text,p_idempotency_key uuid) returns jsonb
language sql security invoker set search_path='' as $$select dao_private.send_conversation_message($1,$2,$3);$$;
create function public.mark_conversation_read(p_conversation_id uuid) returns integer
language sql security invoker set search_path='' as $$select dao_private.mark_conversation_read($1);$$;

revoke all on function dao_private.open_project_conversation(uuid,uuid),dao_private.open_project_member_conversation(uuid,uuid),dao_private.list_my_conversations(),
 dao_private.list_conversation_messages(uuid,timestamptz,integer),dao_private.send_conversation_message(uuid,text,uuid),
 dao_private.mark_conversation_read(uuid),dao_private.append_only_messaging() from public,anon,authenticated;
grant execute on function dao_private.open_project_conversation(uuid,uuid),dao_private.open_project_member_conversation(uuid,uuid),dao_private.list_my_conversations(),
 dao_private.list_conversation_messages(uuid,timestamptz,integer),dao_private.send_conversation_message(uuid,text,uuid),
 dao_private.mark_conversation_read(uuid) to authenticated,service_role;
revoke all on function public.open_project_conversation(uuid,uuid),public.open_project_member_conversation(uuid,uuid),public.list_my_conversations(),
 public.list_conversation_messages(uuid,timestamptz,integer),public.send_conversation_message(uuid,text,uuid),
 public.mark_conversation_read(uuid) from public,anon,authenticated;
grant execute on function public.open_project_conversation(uuid,uuid),public.open_project_member_conversation(uuid,uuid),public.list_my_conversations(),
 public.list_conversation_messages(uuid,timestamptz,integer),public.send_conversation_message(uuid,text,uuid),
 public.mark_conversation_read(uuid) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
