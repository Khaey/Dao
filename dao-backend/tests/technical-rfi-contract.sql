do $rfi_contract$
declare signature text;
begin
  if not (select relrowsecurity from pg_class where oid='public.technical_questions'::regclass)
     or not (select relrowsecurity from pg_class where oid='public.technical_clarifications'::regclass)
     or has_table_privilege('anon','public.technical_questions','SELECT')
     or has_table_privilege('authenticated','public.technical_questions','INSERT')
     or has_table_privilege('authenticated','public.technical_clarifications','INSERT')
     or has_table_privilege('authenticated','public.technical_rfi_receipts','SELECT') then
    raise exception 'RFI RLS/grants boundary differs';
  end if;
  if has_function_privilege('authenticated','dao_private.rfi_user_eligible(uuid,uuid)','EXECUTE')
     or has_function_privilege('anon','dao_private.rfi_user_eligible(uuid,uuid)','EXECUTE') then
    raise exception 'RFI arbitrary-user eligibility helper is exposed';
  end if;
  foreach signature in array array[
    'create_rfi_question(uuid,text,text)','list_rfi_questions(integer,timestamp with time zone,uuid,uuid)',
    'publish_rfi_clarification(uuid,text,boolean,text)','mark_rfi_read(uuid)',
    'create_rfi_document(uuid,uuid,text,text,text,bigint)','approve_rfi_document(uuid)','delete_rfi_document(uuid)'
  ] loop
    if to_regprocedure('public.'||signature) is null or has_function_privilege('anon','public.'||signature,'EXECUTE') or not has_function_privilege('authenticated','public.'||signature,'EXECUTE') then raise exception 'RFI facade mismatch: %',signature; end if;
  end loop;
  if not exists(select 1 from pg_trigger where tgname='immutable_rfi_clarifications' and tgrelid='public.technical_clarifications'::regclass and not tgisinternal)
     or not exists(select 1 from pg_trigger where tgname='immutable_rfi_question_body' and tgrelid='public.technical_questions'::regclass and not tgisinternal) then raise exception 'RFI history immutability missing'; end if;
end $rfi_contract$;
