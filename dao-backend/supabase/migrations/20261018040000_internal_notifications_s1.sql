begin;

-- A separate in-app channel. Never read or mutate notification_outbox.
alter table public.notifications add column event_key text;
create unique index notifications_s1_event_key on public.notifications(user_id,event_key) where event_key is not null;
create index notifications_personal_chronology on public.notifications(user_id,created_at desc,id desc);
create index notifications_personal_unread on public.notifications(user_id,created_at desc,id desc) where read_at is null;

create function dao_private.notification_uuid(p_value text) returns uuid
language sql immutable set search_path='' as $$
  select case when p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then p_value::uuid else null end;
$$;
create function dao_private.notification_workspace() returns text
language plpgsql stable security definer set search_path='' as $$
declare workspace text;
begin
  if auth.uid() is null or not dao_private.account_active(auth.uid())
     or not exists(select 1 from auth.users where id=auth.uid()) then
    raise exception using errcode='42501',message='Compte actif requis';
  end if;
  if dao_private.staff() then return 'staff'; end if;
  select case when p.last_workspace='contractor' and exists(select 1 from public.user_roles r where r.user_id=p.user_id and r.role='contractor') then 'contractor'
    when exists(select 1 from public.user_roles r where r.user_id=p.user_id and r.role='client') then 'client'
    when exists(select 1 from public.user_roles r where r.user_id=p.user_id and r.role='contractor') then 'contractor' end
  into workspace from public.profiles p where p.user_id=auth.uid();
  if workspace is null then raise exception using errcode='42501',message='Espace autorisé requis'; end if;
  if workspace='contractor' and exists(select 1 from public.contractor_profiles where user_id=auth.uid() and verification_status='suspended') then
    raise exception using errcode='42501',message='Compte actif requis';
  end if;
  return workspace;
end;
$$;

-- One live authorization predicate for direct RLS, page, count and marking.
-- Unknown/historical kinds are hidden, never guessed or cast unsafely.
create function dao_private.notification_visible(n public.notifications) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare workspace text; pid uuid; iid uuid; cid uuid;
begin
  if auth.uid() is null or n.user_id is distinct from auth.uid() or not dao_private.account_active(auth.uid()) then return false; end if;
  workspace:=dao_private.notification_workspace();
  if workspace='staff' then return false; end if;
  pid:=dao_private.notification_uuid(n.payload->>'project_id');
  if not exists(select 1 from public.projects where id=pid and status<>'archived') then return false; end if;
  if n.kind='project_message' then
    cid:=dao_private.notification_uuid(n.payload->>'conversation_id');
    return exists(select 1 from public.conversations c join public.projects p on p.id=c.project_id
      where c.id=cid and c.project_id=pid and dao_private.conversation(c.id)
        and workspace=case when p.client_id=auth.uid() then 'client' else 'contractor' end);
  end if;
  if n.payload->>'workspace' is distinct from workspace then return false; end if;
  if n.kind in ('review_approved','review_rejected') then
    return workspace='client' and dao_private.owner(pid) and exists(
      select 1 from public.project_versions v where v.id=dao_private.notification_uuid(n.payload->>'version_id') and v.project_id=pid
      and v.status=case when n.kind='review_approved' then 'approved' else 'rejected' end);
  end if;
  iid:=dao_private.notification_uuid(n.payload->>'invitation_id');
  if n.kind='invitation_received' then
    return exists(select 1 from public.project_invitations i join auth.users u on u.id=auth.uid()
      join public.project_members sender on sender.project_id=i.project_id and sender.user_id=i.created_by and sender.status='accepted'
      where i.id=iid and i.project_id=pid and i.expected_role=workspace and i.status='pending' and i.expires_at>now()
        and u.email_confirmed_at is not null and lower(u.email)=i.recipient_email
        and dao_private.account_active(i.created_by)
        and (sender.participation_role<>'contractor' or not exists(select 1 from public.contractor_profiles where user_id=i.created_by and verification_status='suspended')));
  elsif n.kind='invitation_accepted' then
    return exists(select 1 from public.project_invitations i join public.projects p on p.id=i.project_id
      join public.project_members recipient on recipient.project_id=p.id and recipient.user_id=auth.uid()
        and recipient.status='accepted' and recipient.participation_role=workspace
      join public.project_members joined on joined.project_id=p.id and joined.user_id=i.accepted_by
        and joined.status='accepted' and joined.participation_role=i.expected_role
      where i.id=iid and p.id=pid and i.status='accepted' and p.initiator_id=auth.uid()
        and i.accepted_by<>auth.uid() and dao_private.account_active(i.accepted_by)
        and exists(select 1 from public.user_roles where user_id=i.accepted_by and role=i.expected_role)
        and (i.expected_role<>'contractor' or not exists(select 1 from public.contractor_profiles where user_id=i.accepted_by and verification_status='suspended')));
  end if;
  return false;
end;
$$;

drop policy read_allowed on public.notifications;
create policy read_allowed on public.notifications for select to authenticated using(dao_private.notification_visible(notifications));

create function dao_private.emit_internal_notification(p_recipient uuid,p_kind text,p_key text,p_payload jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  if p_recipient is null or not dao_private.account_active(p_recipient)
     or not exists(select 1 from auth.users where id=p_recipient)
     or not exists(select 1 from public.user_roles where user_id=p_recipient and role=p_payload->>'workspace')
     or exists(select 1 from public.user_roles where user_id=p_recipient and role in ('dao_admin','dao_reviewer')) then return; end if;
  if p_payload->>'workspace'='contractor' and exists(select 1 from public.contractor_profiles where user_id=p_recipient and verification_status='suspended') then return; end if;
  insert into public.notifications(user_id,kind,event_key,payload)
  values(p_recipient,p_kind,p_key,p_payload) on conflict(user_id,event_key) where event_key is not null do nothing;
end;
$$;
create function dao_private.internal_review_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid; kind text;
begin
  if NEW.status=OLD.status or NEW.status not in ('approved','rejected') then return NEW; end if;
  select client_id into recipient from public.projects where id=NEW.project_id and status<>'archived';
  kind:=case when NEW.status='approved' then 'review_approved' else 'review_rejected' end;
  perform dao_private.emit_internal_notification(recipient,kind,kind||':'||NEW.id,
    jsonb_build_object('project_id',NEW.project_id,'version_id',NEW.id,'workspace','client'));
  return NEW;
end;
$$;
create trigger internal_review_notification after update of status on public.project_versions
for each row execute function dao_private.internal_review_notification();

create function dao_private.internal_invitation_notification() returns trigger
language plpgsql security definer set search_path='' as $$
declare recipient uuid; workspace text; sender_role text; p public.projects;
begin
  select * into p from public.projects where id=NEW.project_id and status<>'archived';
  select participation_role into sender_role from public.project_members where project_id=p.id and user_id=NEW.created_by and status='accepted';
  if p.id is null or sender_role is null or not dao_private.account_active(NEW.created_by)
     or (sender_role='contractor' and exists(select 1 from public.contractor_profiles where user_id=NEW.created_by and verification_status='suspended')) then return NEW; end if;
  if TG_OP='INSERT' then
    if NEW.status<>'pending' or NEW.expires_at<=now() or NEW.recipient_email is null then return NEW; end if;
    -- Only existing, confirmed identities; never resolve invitations lazily by email in browser.
    for recipient in select id from auth.users where lower(email)=NEW.recipient_email and email_confirmed_at is not null loop
      if recipient<>NEW.created_by then
        perform dao_private.emit_internal_notification(recipient,'invitation_received','invitation_received:'||NEW.id,
          jsonb_build_object('project_id',p.id,'invitation_id',NEW.id,'workspace',NEW.expected_role));
      end if;
    end loop;
  elsif OLD.status='pending' and NEW.status='accepted' and NEW.accepted_by is not null and p.initiator_id<>NEW.accepted_by
      and dao_private.account_active(NEW.accepted_by)
      and (NEW.expected_role<>'contractor' or not exists(select 1 from public.contractor_profiles where user_id=NEW.accepted_by and verification_status='suspended')) then
    select participation_role into workspace from public.project_members where project_id=p.id and user_id=p.initiator_id and status='accepted';
    if workspace is not null and exists(select 1 from public.project_members where project_id=p.id and user_id=NEW.accepted_by and status='accepted' and participation_role=NEW.expected_role) then
      perform dao_private.emit_internal_notification(p.initiator_id,'invitation_accepted','invitation_accepted:'||NEW.id,
        jsonb_build_object('project_id',p.id,'invitation_id',NEW.id,'workspace',workspace));
    end if;
  end if;
  return NEW;
end;
$$;
create trigger internal_invitation_notification after insert or update of status on public.project_invitations
for each row execute function dao_private.internal_invitation_notification();

create function dao_private.my_notifications(p_limit integer default 20,p_before timestamptz default null,p_before_id uuid default null,p_unread boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; workspace text;
begin
  workspace:=dao_private.notification_workspace();
  if p_limit is null or p_limit<1 or p_limit>50 or p_unread is null or (p_before is null)<>(p_before_id is null) then
    raise exception using errcode='22023',message='Pagination invalide';
  end if;
  with visible as materialized (
    select n.* from public.notifications n where n.user_id=auth.uid() and dao_private.notification_visible(n)
  ), page as (
    select n.id,n.created_at,n.kind,n.read_at,
      case when n.kind='project_message' then dao_private.notification_uuid(n.payload->>'conversation_id')
        when n.kind='invitation_received' then dao_private.notification_uuid(n.payload->>'invitation_id')
        else dao_private.notification_uuid(n.payload->>'project_id') end as target_id
    from visible n where (not p_unread or n.read_at is null) and (p_before is null or (n.created_at,n.id)<(p_before,p_before_id))
    order by n.created_at desc,n.id desc limit p_limit+1
  ), bounded as (select * from page order by created_at desc,id desc limit p_limit)
  select jsonb_build_object('workspace',workspace,'rows',coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc,b.id desc) from bounded b),'[]'::jsonb),
    'unread_count',(select count(*) from visible where read_at is null),'has_more',(select count(*)>p_limit from page)) into result;
  return result;
end;
$$;
create function dao_private.my_unread_notification_count() returns bigint
language plpgsql stable security definer set search_path='' as $$
begin
  perform dao_private.notification_workspace();
  return (select count(*) from public.notifications n where n.user_id=auth.uid() and n.read_at is null and dao_private.notification_visible(n));
end;
$$;
create function dao_private.mark_my_notification_read(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
  perform dao_private.notification_workspace();
  update public.notifications n set read_at=coalesce(n.read_at,now())
    where n.id=p_id and n.user_id=auth.uid() and n.read_at is null and dao_private.notification_visible(n);
  -- Uniform success for hidden, unknown, already read and foreign IDs.
  return true;
end;
$$;

create function public.my_notifications(p_limit integer default 20,p_before timestamptz default null,p_before_id uuid default null,p_unread boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$ select dao_private.my_notifications($1,$2,$3,$4); $$;
create function public.my_unread_notification_count() returns bigint
language sql stable security invoker set search_path='' as $$ select dao_private.my_unread_notification_count(); $$;
create function public.mark_my_notification_read(p_id uuid) returns boolean
language sql security invoker set search_path='' as $$ select dao_private.mark_my_notification_read($1); $$;

revoke all on function dao_private.notification_uuid(text),dao_private.notification_workspace(),dao_private.notification_visible(public.notifications),
 dao_private.emit_internal_notification(uuid,text,text,jsonb),dao_private.internal_review_notification(),dao_private.internal_invitation_notification(),
 dao_private.my_notifications(integer,timestamptz,uuid,boolean),dao_private.my_unread_notification_count(),dao_private.mark_my_notification_read(uuid)
 from public,anon,authenticated;
grant execute on function dao_private.notification_visible(public.notifications),dao_private.my_notifications(integer,timestamptz,uuid,boolean),
 dao_private.my_unread_notification_count(),dao_private.mark_my_notification_read(uuid) to authenticated,service_role;
revoke all on function public.my_notifications(integer,timestamptz,uuid,boolean),public.my_unread_notification_count(),public.mark_my_notification_read(uuid) from public,anon,authenticated;
grant execute on function public.my_notifications(integer,timestamptz,uuid,boolean),public.my_unread_notification_count(),public.mark_my_notification_read(uuid) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
