begin;

create table public.notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace text not null check (workspace in ('client','contractor')),
  invitation_expiring boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key(user_id,workspace)
);
alter table public.notification_preferences enable row level security;
create policy own_notification_preferences on public.notification_preferences
  for all to authenticated
  using(user_id=auth.uid() and workspace=dao_private.notification_workspace())
  with check(user_id=auth.uid() and workspace=dao_private.notification_workspace());
revoke all on table public.notification_preferences from public,anon,authenticated;

create function dao_private.my_notification_preferences() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare current_workspace text; enabled boolean;
begin
  current_workspace:=dao_private.notification_workspace();
  if current_workspace='staff' then raise exception using errcode='42501',message='Espace autorisé requis'; end if;
  select p.invitation_expiring into enabled from public.notification_preferences p
    where p.user_id=auth.uid() and p.workspace=current_workspace;
  return jsonb_build_object('workspace',current_workspace,'invitation_expiring',coalesce(enabled,true));
end;
$$;

create function dao_private.update_my_notification_preferences(p_invitation_expiring boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_workspace text;
begin
  if p_invitation_expiring is null then raise exception using errcode='22023',message='Préférence invalide'; end if;
  current_workspace:=dao_private.notification_workspace();
  if current_workspace='staff' then raise exception using errcode='42501',message='Espace autorisé requis'; end if;
  insert into public.notification_preferences(user_id,workspace,invitation_expiring)
    values(auth.uid(),current_workspace,p_invitation_expiring)
    on conflict(user_id,workspace) do update
      set invitation_expiring=excluded.invitation_expiring,updated_at=now();
  return jsonb_build_object('workspace',current_workspace,'invitation_expiring',p_invitation_expiring);
end;
$$;

create function dao_private.mark_my_visible_notifications_read(p_limit integer default 500) returns jsonb
language plpgsql security definer set search_path='' as $$
declare marked integer; remaining boolean;
begin
  perform dao_private.notification_workspace();
  if p_limit is null or p_limit<1 or p_limit>500 then
    raise exception using errcode='22023',message='Limite invalide';
  end if;
  with target as materialized (
    select n.id from public.notifications n
    where n.user_id=auth.uid() and n.read_at is null and dao_private.notification_visible(n)
    order by n.created_at,n.id limit p_limit
    for update skip locked
  )
  update public.notifications n set read_at=now() from target t where n.id=t.id;
  get diagnostics marked=row_count;
  select exists(select 1 from public.notifications n
    where n.user_id=auth.uid() and n.read_at is null and dao_private.notification_visible(n))
    into remaining;
  return jsonb_build_object('marked',marked,'has_more',remaining);
end;
$$;

create function public.my_notification_preferences() returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.my_notification_preferences(); $$;
create function public.update_my_notification_preferences(p_invitation_expiring boolean) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.update_my_notification_preferences($1); $$;
create function public.mark_my_visible_notifications_read(p_limit integer default 500) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.mark_my_visible_notifications_read($1); $$;

revoke all on function dao_private.my_notification_preferences(),
  dao_private.update_my_notification_preferences(boolean),dao_private.mark_my_visible_notifications_read(integer)
  from public,anon,authenticated;
grant execute on function dao_private.my_notification_preferences(),
  dao_private.update_my_notification_preferences(boolean),dao_private.mark_my_visible_notifications_read(integer)
  to authenticated,service_role;
revoke all on function public.my_notification_preferences(),
  public.update_my_notification_preferences(boolean),public.mark_my_visible_notifications_read(integer)
  from public,anon,authenticated;
grant execute on function public.my_notification_preferences(),
  public.update_my_notification_preferences(boolean),public.mark_my_visible_notifications_read(integer)
  to authenticated,service_role;

notify pgrst,'reload schema';
commit;
