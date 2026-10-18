do $notifications_s1_contract$
declare signature text; state record;
begin
  if has_table_privilege('authenticated','public.notifications','INSERT')
     or has_table_privilege('authenticated','public.notifications','UPDATE')
     or has_table_privilege('authenticated','public.notifications','DELETE')
     or has_table_privilege('anon','public.notifications','SELECT')
     or has_table_privilege('authenticated','public.notification_outbox','SELECT') then
    raise exception 'notifications S1: direct writes or outbox access';
  end if;
  foreach signature in array array['my_notifications(integer,timestamp with time zone,uuid,boolean)','my_unread_notification_count()','mark_my_notification_read(uuid)'] loop
    if to_regprocedure('public.'||signature) is null or to_regprocedure('dao_private.'||signature) is null then
      raise exception 'notifications S1: missing command';
    end if;
    if has_function_privilege('anon','public.'||signature,'EXECUTE') or not has_function_privilege('authenticated','public.'||signature,'EXECUTE') then
      raise exception 'notifications S1: unexpected command grants';
    end if;
    select p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner into state from pg_proc p where p.oid=('public.'||signature)::regprocedure;
    if state.prosecdef or state.proconfig is distinct from array['search_path=""']::text[] or state.owner<>'postgres' then raise exception 'notifications S1: public facade boundary'; end if;
    select p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner into state from pg_proc p where p.oid=('dao_private.'||signature)::regprocedure;
    if not state.prosecdef or state.proconfig is distinct from array['search_path=""']::text[] or state.owner<>'postgres' then raise exception 'notifications S1: private command boundary'; end if;
  end loop;
  if has_function_privilege('authenticated','dao_private.emit_internal_notification(uuid,text,text,jsonb)','EXECUTE')
     or has_function_privilege('anon','dao_private.emit_internal_notification(uuid,text,text,jsonb)','EXECUTE') then
    raise exception 'notifications S1: private emitter exposed';
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='notifications' and policyname='read_allowed' and qual like '%notification_visible%') then
    raise exception 'notifications S1: live RLS predicate missing';
  end if;
end;
$notifications_s1_contract$;
