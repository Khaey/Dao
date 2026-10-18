begin;

create index project_invitations_pending_expiry_s2
  on public.project_invitations(expires_at,id)
  where status='pending';

create function dao_private.invitation_expiry_reminder_allowed(
  i public.project_invitations,p_recipient uuid,p_now timestamptz
) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  return p_now is not null
    and i.status='pending' and i.expires_at>p_now and i.expires_at<=p_now+interval '24 hours'
    and i.recipient_email is not null
    and exists(select 1 from auth.users u where u.id=p_recipient and u.email_confirmed_at is not null
      and lower(u.email)=i.recipient_email)
    and dao_private.account_active(p_recipient)
    and exists(select 1 from public.user_roles r where r.user_id=p_recipient and r.role=i.expected_role)
    and (i.expected_role<>'contractor' or not exists(select 1 from public.contractor_profiles c
      where c.user_id=p_recipient and c.verification_status='suspended'))
    and exists(select 1 from public.projects p where p.id=i.project_id and p.status<>'archived')
    and dao_private.account_active(i.created_by)
    and exists(select 1 from public.project_members m where m.project_id=i.project_id
      and m.user_id=i.created_by and m.status='accepted'
      and (m.participation_role<>'contractor' or not exists(select 1 from public.contractor_profiles c
        where c.user_id=i.created_by and c.verification_status='suspended')))
    and coalesce((select n.invitation_expiring from public.notification_preferences n
      where n.user_id=p_recipient and n.workspace=i.expected_role),true);
end;
$$;

create function dao_private.dry_run_invitation_expiry_reminders(
  p_limit integer default 100,p_now timestamptz default now()
) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare eligible integer;
begin
  if p_limit is null or p_limit<1 or p_limit>500 or p_now is null then
    raise exception using errcode='22023',message='Paramètres invalides';
  end if;
  select count(*) into eligible from (
    select 1 from public.project_invitations i join auth.users u on lower(u.email)=i.recipient_email
    where i.status='pending' and i.expires_at>p_now and i.expires_at<=p_now+interval '24 hours'
      and dao_private.invitation_expiry_reminder_allowed(i,u.id,p_now)
      and not exists(select 1 from public.notifications n where n.user_id=u.id
        and n.event_key='invitation_expiring:'||i.id||':24h')
    order by i.expires_at,i.id limit p_limit
  ) candidates;
  return jsonb_build_object('eligible',eligible,'limit',p_limit);
end;
$$;

create function dao_private.generate_invitation_expiry_reminders(
  p_limit integer default 100,p_now timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path='' as $$
declare generated integer; remaining boolean;
begin
  if p_limit is null or p_limit<1 or p_limit>500 or p_now is null then
    raise exception using errcode='22023',message='Paramètres invalides';
  end if;
  with candidates as materialized (
    select i invitation,u.id recipient_id from public.project_invitations i
    join auth.users u on lower(u.email)=i.recipient_email
    where i.status='pending' and i.expires_at>p_now and i.expires_at<=p_now+interval '24 hours'
      and dao_private.invitation_expiry_reminder_allowed(i,u.id,p_now)
      and not exists(select 1 from public.notifications n where n.user_id=u.id
        and n.event_key='invitation_expiring:'||i.id||':24h')
    order by i.expires_at,i.id limit p_limit
    for update of i skip locked
  )
  insert into public.notifications(user_id,kind,event_key,payload)
  select c.recipient_id,'invitation_expiring','invitation_expiring:'||(c.invitation).id||':24h',
    jsonb_build_object('project_id',(c.invitation).project_id,'invitation_id',(c.invitation).id,
      'workspace',(c.invitation).expected_role,'expires_at',(c.invitation).expires_at,'severity','action_required')
  from candidates c
  where dao_private.invitation_expiry_reminder_allowed(c.invitation,c.recipient_id,p_now)
  on conflict(user_id,event_key) where event_key is not null do nothing;
  get diagnostics generated=row_count;
  select exists(
    select 1 from public.project_invitations i join auth.users u on lower(u.email)=i.recipient_email
    where i.status='pending' and i.expires_at>p_now and i.expires_at<=p_now+interval '24 hours'
      and dao_private.invitation_expiry_reminder_allowed(i,u.id,p_now)
      and not exists(select 1 from public.notifications n where n.user_id=u.id
        and n.event_key='invitation_expiring:'||i.id||':24h')
  ) into remaining;
  return jsonb_build_object('generated',generated,'has_more',remaining);
end;
$$;

-- Extend the S1 live predicate in a new migration; S1 history remains immutable.
create or replace function dao_private.notification_visible(n public.notifications) returns boolean
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
  if n.kind='invitation_expiring' then
    return exists(select 1 from public.project_invitations i where i.id=iid and i.project_id=pid
      and i.expected_role=workspace and dao_private.invitation_expiry_reminder_allowed(i,auth.uid(),now()));
  elsif n.kind='invitation_received' then
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

revoke all on function dao_private.invitation_expiry_reminder_allowed(public.project_invitations,uuid,timestamptz),
  dao_private.dry_run_invitation_expiry_reminders(integer,timestamptz),
  dao_private.generate_invitation_expiry_reminders(integer,timestamptz)
  from public,anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
