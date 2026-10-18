begin;

create function dao_private.my_notifications_s2(p_limit integer default 20,p_before timestamptz default null,
  p_before_id uuid default null,p_unread boolean default false,p_action boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; current_workspace text;
begin
  current_workspace:=dao_private.notification_workspace();
  if p_limit is null or p_limit<1 or p_limit>50 or p_unread is null or p_action is null
     or (p_before is null)<>(p_before_id is null) then
    raise exception using errcode='22023',message='Pagination invalide';
  end if;
  with visible as materialized (
    select n.* from public.notifications n where n.user_id=auth.uid() and dao_private.notification_visible(n)
  ), page as (
    select n.id,n.created_at,n.kind,n.read_at,n.kind='invitation_expiring' action_required,
      case when n.kind='invitation_expiring' then (select i.expires_at from public.project_invitations i
        where i.id=dao_private.notification_uuid(n.payload->>'invitation_id')) else null end expires_at,
      case when n.kind='project_message' then dao_private.notification_uuid(n.payload->>'conversation_id')
        when n.kind in ('invitation_received','invitation_expiring') then dao_private.notification_uuid(n.payload->>'invitation_id')
        else dao_private.notification_uuid(n.payload->>'project_id') end as target_id
    from visible n where (not p_unread or n.read_at is null)
      and (not p_action or n.kind='invitation_expiring')
      and (p_before is null or (n.created_at,n.id)<(p_before,p_before_id))
    order by n.created_at desc,n.id desc limit p_limit+1
  ), bounded as (select * from page order by created_at desc,id desc limit p_limit)
  select jsonb_build_object('workspace',current_workspace,
    'rows',coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc,b.id desc) from bounded b),'[]'::jsonb),
    'unread_count',(select count(*) from visible where read_at is null),
    'has_more',(select count(*)>p_limit from page)) into result;
  return result;
end;
$$;
create function public.my_notifications_s2(p_limit integer default 20,p_before timestamptz default null,
  p_before_id uuid default null,p_unread boolean default false,p_action boolean default false)
returns jsonb language sql stable security invoker set search_path='' as $$
  select dao_private.my_notifications_s2($1,$2,$3,$4,$5);
$$;
revoke all on function dao_private.my_notifications_s2(integer,timestamptz,uuid,boolean,boolean),
  public.my_notifications_s2(integer,timestamptz,uuid,boolean,boolean) from public,anon,authenticated;
grant execute on function dao_private.my_notifications_s2(integer,timestamptz,uuid,boolean,boolean),
  public.my_notifications_s2(integer,timestamptz,uuid,boolean,boolean) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
