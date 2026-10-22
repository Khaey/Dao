do $contract_preparation_contract$
declare trigger_state record;
begin
  if has_table_privilege('authenticated', 'public.project_contract_settings', 'INSERT')
     or has_table_privilege('authenticated', 'public.project_contract_settings', 'UPDATE')
     or has_table_privilege('authenticated', 'public.project_contract_settings', 'DELETE')
     or has_table_privilege('anon', 'public.project_contract_settings', 'SELECT') then
    raise exception 'contract preparation: project settings must be RPC-only';
  end if;
  if not has_table_privilege('authenticated', 'public.project_contract_settings', 'SELECT') then
    raise exception 'contract preparation: authenticated read must remain RLS-scoped';
  end if;
  if has_table_privilege('authenticated', 'dao_private.contract_runtime_configuration', 'SELECT')
     or has_table_privilege('authenticated', 'dao_private.contract_runtime_configuration_events', 'SELECT')
     or has_table_privilege('authenticated', 'dao_private.contract_preparation_audit', 'SELECT') then
    raise exception 'contract preparation: private runtime data leaked';
  end if;
  if has_function_privilege('anon', 'public.configure_contract_runtime(uuid,text,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_project_contract_enabled(uuid,boolean,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.project_contract_configuration(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.configure_contract_runtime(uuid,text,boolean,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.set_project_contract_enabled(uuid,boolean,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.project_contract_configuration(uuid)', 'EXECUTE') then
    raise exception 'contract preparation: public command ACL differs';
  end if;
  if has_function_privilege('authenticated', 'dao_private.prepare_contract_after_award()', 'EXECUTE')
     or has_function_privilege('authenticated', 'dao_private.configure_contract_runtime(uuid,text,boolean,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'dao_private.set_project_contract_enabled(uuid,boolean,text)', 'EXECUTE') then
    raise exception 'contract preparation: internal functions are directly executable';
  end if;

  select t.tgdeferrable, t.tginitdeferred, p.proname as function_name
  into trigger_state
  from pg_trigger t
  join pg_proc p on p.oid = t.tgfoid
  where t.tgrelid = 'public.awards'::regclass
    and t.tgname = 'prepare_contract_after_award'
    and not t.tgisinternal;
  if not found or not trigger_state.tgdeferrable or not trigger_state.tginitdeferred
     or trigger_state.function_name <> 'prepare_contract_after_award' then
    raise exception 'contract preparation: deferred award trigger missing or unsafe';
  end if;
end;
$contract_preparation_contract$;
