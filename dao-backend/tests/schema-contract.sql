DO $schema_contract$
DECLARE
  expected_versions text[] := ARRAY[
    '20260920171021','20260920171039','20260920171048','20260920171056',
    '20260920172706','20260921010858','20260921013047','20260921013710',
    '20260921084730','20260921091400','20260921094726','20260921094727',
    '20260921094728','20260922133633','20260922142354','20260922142355',
    '20260922160410','20260922192016','20260922192148','20260922202247',
    '20260926092748','20260927102942','20260930084047','20260930163650','20260930165307',
    '20261003015740','20261003030134','20261004120000','20261006203956','20261007182403','20261009103053','20261009180000','20261012220000','20261013014522','20261013211500','20261014183000','20261014194000','20261014230755','20261015010000','20261017140000','20261017190000','20261018000000','20261018020000','20261018030000','20261018040000','20261018050000','20261018060000','20261018070000','20261018071000','20261018072000','20261018080000','20261019012000','20261019020000','20261019104500','20261019130000','20261019160000','20261019170000','20261019180000','20261019190000','20261019200000','20261019210000','20261020010000','20261020020000','20261020030000','20261020060000','20261020070000','20261020050000','20261019140000','20261020080000','20261021010000','20261021020000','20261021030000','20261021040000'
  ];
  expected_tables text[] := ARRAY[
    'account_states','review_assignments','request_sub_lots','request_sub_lot_versions','publication_lot_withdrawals','notification_outbox','oce_sync_mappings','oce_sync_wbs','oce_sync_activities','oce_sync_dependencies','oce_sync_journal','oce_lot_plans','staff_invitation_requests','ai_proposals','ai_runs','audit_events','award_cancellations','award_items','awards','bid_item_results',
    'bid_documents','bid_group_items','bid_groups','bid_items','bid_quote_lines','bid_sub_lot_links','bid_sub_lots','project_plan_contexts','project_plan_link_decisions','project_plan_manual_link_removals','project_plan_manual_links','project_plan_results','bid_versions','bids',
    'command_receipts','contract_acceptances','contract_amendment_acceptances','contract_amendment_events','contract_amendment_versions','contract_amendments','contract_archives','contract_events','contract_items','contract_parties','contract_versions','precontract_agreements','precontract_agreement_versions','precontract_agreement_acceptances','precontract_agreement_events','precontract_installment_events',
    'contractor_profiles','contractor_service_areas','contractor_trades','contractor_profile_details','contractor_files',
    'contractor_reviews','contractor_review_responses','contractor_review_reports',
    'contracts','conversation_participants','conversations','delegations',
    'document_grants','documents','governorates','localities','messages',
    'notifications','notification_preferences','portfolio_assets','portfolio_projects','profile_contacts','technical_questions','technical_clarifications','technical_rfi_reads','technical_rfi_receipts','technical_rfi_documents',
    'profiles','project_members','project_invitations','project_private_details','project_request_versions',
    'project_requests','project_reviews','project_version_requests',
    'project_versions','projects','publication_recipients',
    'publication_requests','publications','site_client_observations','site_log_events','site_log_evidence','support_command_receipts','support_events','support_messages','support_reads','support_tickets','trades','user_roles'
  ];
  actual_versions text[];
  actual_tables text[];
  missing_name text;
  state record;
BEGIN
  SELECT coalesce(array_agg(version ORDER BY version), ARRAY[]::text[])
    INTO actual_versions
    FROM supabase_migrations.schema_migrations;
  IF cardinality(actual_versions) <> cardinality(expected_versions)
     OR cardinality(actual_versions) <> (SELECT count(DISTINCT version) FROM supabase_migrations.schema_migrations)
     OR EXISTS (SELECT expected_version FROM unnest(expected_versions) AS expected(expected_version)
                EXCEPT SELECT version FROM supabase_migrations.schema_migrations)
     OR EXISTS (SELECT version FROM supabase_migrations.schema_migrations
                EXCEPT SELECT expected_version FROM unnest(expected_versions) AS expected(expected_version)) THEN
    RAISE EXCEPTION 'schema contract: migration history differs; expected %, got %', expected_versions, actual_versions;
  END IF;

  SELECT coalesce(array_agg(c.relname ORDER BY c.relname), ARRAY[]::text[])
    INTO actual_tables
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p');
  IF EXISTS (SELECT expected_table FROM unnest(expected_tables) AS expected(expected_table)
             EXCEPT SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
             WHERE n.nspname='public' AND c.relkind IN ('r','p'))
     OR EXISTS (SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='public' AND c.relkind IN ('r','p')
                EXCEPT SELECT expected_table FROM unnest(expected_tables) AS expected(expected_table)) THEN
    RAISE EXCEPTION 'schema contract: public DAO tables differ; expected %, got %', expected_tables, actual_tables;
  END IF;
  SELECT array_agg(c.relname ORDER BY c.relname) INTO actual_tables
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind IN ('r','p')
      AND (NOT c.relrowsecurity OR c.relforcerowsecurity);
  IF actual_tables IS NOT NULL THEN
    RAISE EXCEPTION 'schema contract: RLS must be enabled without FORCE RLS on every DAO table; offenders %', actual_tables;
  END IF;

  SELECT p.prorettype::regtype::text AS returns,
         p.prosecdef AS security_definer,
         p.proconfig AS config,
         p.proacl::text AS acl,
         pg_get_userbyid(p.proowner) AS owner,
         p.prosrc AS source
    INTO state
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='rls_auto_enable'
      AND pg_get_function_identity_arguments(p.oid)='';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'schema contract: public.rls_auto_enable() is missing';
  END IF;
  IF state.returns <> 'event_trigger' OR NOT state.security_definer
     OR state.owner <> 'postgres'
     OR state.config IS DISTINCT FROM ARRAY['search_path=pg_catalog']::text[]
     OR state.acl::text <> '{postgres=X/postgres}'
     OR position('pg_event_trigger_ddl_commands()' in state.source)=0
     OR position('alter table if exists %s enable row level security' in state.source)=0 THEN
    RAISE EXCEPTION 'schema contract: public.rls_auto_enable() definition, owner, search_path, SECURITY DEFINER, or ACL differs from DEV';
  END IF;

  SELECT e.evtevent,e.evtenabled,e.evttags,
         pg_get_userbyid(e.evtowner) AS owner,
         n.nspname AS function_schema,p.proname AS function_name
    INTO state
    FROM pg_event_trigger e
    JOIN pg_proc p ON p.oid=e.evtfoid
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE e.evtname='ensure_rls';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'schema contract: event trigger ensure_rls is missing';
  END IF;
  IF state.evtevent <> 'ddl_command_end' OR state.evtenabled <> 'O'
     OR state.evttags IS DISTINCT FROM ARRAY['CREATE TABLE','CREATE TABLE AS','SELECT INTO']::text[]
     OR state.owner <> 'postgres' OR state.function_schema <> 'public'
     OR state.function_name <> 'rls_auto_enable' THEN
    RAISE EXCEPTION 'schema contract: ensure_rls event, tags, enabled state, owner, or target differs from DEV';
  END IF;

  FOR missing_name IN
    SELECT required.signature
    FROM unnest(ARRAY[
      'public.create_project_draft(text,numeric,date,bigint,uuid,uuid,uuid)',
      'public.initialize_my_account(text,text,text,text)',
      'dao_private.initialize_registration_account(text,text,text,text)',
      'public.create_collaborative_project(text,text,text,uuid,uuid,uuid,text,text)',
      'public.issue_project_invitation(uuid,text,text,boolean)',
      'public.issue_project_invitation(uuid,text,text,text,boolean)',
      'public.issue_project_invitation(uuid,text,text,text,uuid,boolean)',
      'public.create_client_existing_team_project(text,text,uuid,uuid,uuid,text,text,jsonb)',
      'public.preview_project_invitation(text)',
      'public.project_invitation_registration_context(text)',
      'public.respond_project_invitation(text,boolean)',
      'public.update_project_tracking(uuid,text,text)',
      'public.prepare_contract_foundation(uuid,uuid,uuid,text,uuid)',
      'public.start_contract_acceptance(uuid,uuid,text,boolean,uuid)',
      'public.record_contract_acceptance(uuid,uuid,uuid,text,text,text,jsonb,timestamp with time zone,uuid)',
      'public.validate_contract_acceptance(uuid,uuid,text,uuid)',
      'public.cancel_contract_draft(uuid,uuid,text,uuid)',
      'public.propose_contract_amendment(uuid,uuid,text,bigint,date,integer,text,uuid)',
      'public.record_contract_amendment_acceptance(uuid,uuid,uuid,text,text,text,jsonb,timestamp with time zone,uuid)',
      'public.validate_contract_amendment(uuid,uuid,text,uuid)',
      'public.reject_contract_amendment(uuid,uuid,text,uuid)',
      'public.cancel_contract_amendment(uuid,uuid,text,uuid)',
      'public.project_team(uuid)',
      'public.add_project_request(uuid,uuid,text,text)',
      'public.withdraw_project_request(uuid)',
      'public.publish_project(uuid,text,uuid[],uuid[],timestamptz)',
      'public.create_bid_draft(uuid)',
      'public.submit_bid_version(uuid)',
      'public.award_request_atomic(text,uuid,uuid,uuid,uuid,uuid,bigint)',
      'public.award_bid_item_atomic(text,uuid)',
      'public.award_bid_group_atomic(text,uuid)',
      'public.cancel_award_item_atomic(text,uuid,text,text)',
      'public.publication_lot_availability(uuid)',
      'public.configure_bid_package(uuid,boolean,uuid[])',
      'public.set_my_workspace(text)',
      'public.update_my_contractor_profile(text,text,text,text,integer,text,date,uuid[])',
      'public.my_project_invitations()',
      'public.respond_my_project_invitation(uuid,boolean)',
      'public.my_bid_summaries()',
      'public.withdraw_bid_version(uuid)',
      'public.open_project_conversation(uuid,uuid)',
      'public.open_project_member_conversation(uuid,uuid)',
      'public.list_my_conversations()',
      'public.list_conversation_messages(uuid,timestamptz,integer)',
      'public.send_conversation_message(uuid,text,uuid)',
      'public.mark_conversation_read(uuid)',
      'public.my_notifications(integer,timestamptz,uuid,boolean)',
      'public.my_unread_notification_count()',
      'public.mark_my_notification_read(uuid)',
      'public.my_notification_preferences()',
      'public.update_my_notification_preferences(boolean)',
      'public.mark_my_visible_notifications_read(integer)',
      'public.my_notifications_s2(integer,timestamptz,uuid,boolean,boolean)',
      'public.my_support_summary()',
      'public.create_support_ticket(text,text,text,uuid,text,text,text)',
      'public.list_my_support_tickets(integer,timestamptz,uuid)',
      'public.get_support_ticket(uuid)',
      'public.reply_support_ticket(uuid,text,text)',
      'public.mark_support_ticket_read(uuid)',
      'public.support_queue(integer,timestamptz,uuid,text,text)',
      'public.assign_support_ticket_to_me(uuid)',
      'public.set_support_ticket_status(uuid,text,text)',
      'public.create_rfi_question(uuid,text,text)',
      'public.list_rfi_questions(integer,timestamp with time zone,uuid,uuid)',
      'public.publish_rfi_clarification(uuid,text,boolean,text)',
      'public.mark_rfi_read(uuid)',
      'public.create_rfi_document(uuid,uuid,text,text,text,bigint)',
      'public.approve_rfi_document(uuid)',
      'public.delete_rfi_document(uuid)',
      'public.record_site_progress(uuid,text,integer,text,uuid[],text)',
      'public.record_site_intervention(uuid,date,text,integer,uuid[],text)',
      'public.record_site_progress_v2(uuid,uuid,text,integer,text,uuid[],text)',
      'public.record_site_intervention_v2(uuid,uuid,date,text,integer,uuid,bigint,text,uuid[],text)',
      'public.create_site_milestone(uuid,text,date,text,text,text)',
      'public.update_site_milestone(uuid,date,text,text,text)',
      'public.record_site_observation(uuid,text,text,text)',
      'public.site_execution_snapshot(uuid,timestamp with time zone,uuid,integer)',
      'public.site_execution_snapshot_v2(uuid,timestamp with time zone,uuid,integer)',
      'dao_private.withdraw_project_request(uuid)',
      'dao_private.publish_project(uuid,text,uuid[],uuid[],timestamptz)'
    ]) AS required(signature)
    WHERE to_regprocedure(required.signature) IS NULL
  LOOP
    RAISE EXCEPTION 'schema contract: critical RPC/function % is missing', missing_name;
  END LOOP;
  IF has_table_privilege('authenticated','public.user_roles','INSERT')
     OR has_table_privilege('authenticated','public.contractor_profiles','INSERT') THEN
    RAISE EXCEPTION 'schema contract: authenticated must not insert roles or contractor profiles directly';
  END IF;
  IF has_table_privilege('authenticated','public.project_members','INSERT')
     OR has_table_privilege('authenticated','public.project_members','UPDATE')
     OR has_table_privilege('authenticated','public.project_members','DELETE')
     OR has_table_privilege('authenticated','public.project_invitations','INSERT')
     OR has_table_privilege('authenticated','public.project_invitations','UPDATE')
     OR has_table_privilege('authenticated','public.project_invitations','DELETE')
     OR has_column_privilege('authenticated','public.project_invitations','token_hash','SELECT') THEN
    RAISE EXCEPTION 'schema contract: project participation writes and token hashes must stay RPC-only';
  END IF;
  IF has_table_privilege('authenticated','public.messages','INSERT')
     OR has_table_privilege('authenticated','public.messages','UPDATE')
     OR has_table_privilege('authenticated','public.messages','DELETE')
     OR has_table_privilege('authenticated','public.notifications','UPDATE') THEN
    RAISE EXCEPTION 'schema contract: messaging writes must stay RPC-only';
  END IF;
  IF has_table_privilege('authenticated','public.notification_preferences','SELECT')
     OR has_table_privilege('authenticated','public.notification_preferences','INSERT')
     OR has_table_privilege('authenticated','public.notification_preferences','UPDATE')
     OR has_table_privilege('anon','public.notification_preferences','SELECT') THEN
    RAISE EXCEPTION 'schema contract: notification preferences must stay RPC-only';
  END IF;
  IF has_table_privilege('authenticated','public.support_tickets','INSERT')
     OR has_table_privilege('authenticated','public.support_tickets','UPDATE')
     OR has_table_privilege('authenticated','public.support_messages','INSERT')
     OR has_table_privilege('authenticated','public.support_messages','UPDATE')
     OR has_table_privilege('authenticated','public.support_events','SELECT')
     OR has_table_privilege('anon','public.support_tickets','SELECT') THEN
    RAISE EXCEPTION 'schema contract: support data must stay behind JWT-scoped RPCs';
  END IF;
  IF has_table_privilege('authenticated','public.site_log_events','INSERT')
     OR has_table_privilege('authenticated','public.site_log_events','UPDATE')
     OR has_table_privilege('authenticated','public.site_log_evidence','INSERT')
     OR has_table_privilege('authenticated','public.site_client_observations','INSERT')
     OR has_column_privilege('authenticated','public.site_log_events','command_payload','SELECT')
     OR has_column_privilege('authenticated','public.site_log_events','idempotency_key','SELECT') THEN
    RAISE EXCEPTION 'schema contract: site execution writes and idempotency payloads must stay RPC-only';
  END IF;
  FOR missing_name IN SELECT unnest(ARRAY[
    'public.record_site_progress_v2(uuid,uuid,text,integer,text,uuid[],text)',
    'public.record_site_intervention_v2(uuid,uuid,date,text,integer,uuid,bigint,text,uuid[],text)',
    'public.site_execution_snapshot_v2(uuid,timestamp with time zone,uuid,integer)'
  ]) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE')
      OR NOT has_function_privilege('authenticated',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'schema contract: site execution V2 RPC grant mismatch: %',missing_name;
    END IF;
  END LOOP;
  FOR missing_name IN SELECT unnest(ARRAY[
    'dao_private.record_site_progress_v2(uuid,uuid,text,integer,text,uuid[],text)',
    'dao_private.record_site_intervention_v2(uuid,uuid,date,text,integer,uuid,bigint,text,uuid[],text)',
    'dao_private.site_execution_snapshot_v2(uuid,timestamp with time zone,uuid,integer)'
  ]) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE')
      OR NOT has_function_privilege('authenticated',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'schema contract: site execution V2 internal grant mismatch: %',missing_name;
    END IF;
  END LOOP;
  IF has_function_privilege('anon','public.my_support_summary()','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.my_support_summary()','EXECUTE')
     OR has_function_privilege('authenticated','dao_private.my_support_summary()','EXECUTE') THEN
    RAISE EXCEPTION 'schema contract: support RPC facade grants differ';
  END IF;
  IF has_table_privilege('authenticated','public.technical_questions','INSERT')
     OR has_table_privilege('authenticated','public.technical_clarifications','INSERT')
     OR has_table_privilege('authenticated','public.technical_rfi_receipts','SELECT')
     OR has_table_privilege('anon','public.technical_questions','SELECT')
     OR has_function_privilege('anon','public.create_rfi_question(uuid,text,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.create_rfi_question(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'schema contract: RFI tables or RPC grants differ';
  END IF;
  IF has_function_privilege('authenticated','dao_private.dry_run_invitation_expiry_reminders(integer,timestamptz)','EXECUTE')
     OR has_function_privilege('authenticated','dao_private.generate_invitation_expiry_reminders(integer,timestamptz)','EXECUTE')
     OR has_function_privilege('service_role','dao_private.dry_run_invitation_expiry_reminders(integer,timestamptz)','EXECUTE')
     OR has_function_privilege('service_role','dao_private.generate_invitation_expiry_reminders(integer,timestamptz)','EXECUTE') THEN
    RAISE EXCEPTION 'schema contract: reminder engine must stay private and unscheduled';
  END IF;
  IF to_regclass('public.project_invitations_pending_expiry_s2') IS NULL THEN
    RAISE EXCEPTION 'schema contract: pending invitation expiry index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='projects' AND column_name='client_id' AND is_nullable='YES')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='projects' AND column_name='initiator_id' AND is_nullable='NO')
     OR position('client_id=auth.uid()' IN replace(pg_get_functiondef('dao_private.owner(uuid)'::regprocedure),' ',''))=0 THEN
    RAISE EXCEPTION 'schema contract: client confirmation, initiator or strict owner semantics differ';
  END IF;
  IF has_function_privilege('authenticated','public.initialize_my_account(text,text)','EXECUTE')
     OR has_function_privilege('anon','public.initialize_my_account(text,text,text,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.initialize_my_account(text,text,text,text)','EXECUTE')
     OR NOT has_function_privilege('authenticated','dao_private.initialize_registration_account(text,text,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'schema contract: public registration RPC grants do not match the explicit authenticated allowlist';
  END IF;
  IF has_function_privilege('authenticated','public.award_request_atomic(text,uuid,uuid,uuid,uuid,uuid,bigint)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.award_bid_item_atomic(text,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'schema contract: browser award grants must expose only the derived-input command';
  END IF;
  FOR missing_name IN SELECT unnest(ARRAY['public.award_bid_group_atomic(text,uuid)','public.cancel_award_item_atomic(text,uuid,text,text)','public.publication_lot_availability(uuid)','public.configure_bid_package(uuid,boolean,uuid[])']) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE') OR NOT has_function_privilege('authenticated',missing_name,'EXECUTE') THEN RAISE EXCEPTION 'P2.1 RPC grant mismatch: %',missing_name; END IF;
  END LOOP;
  IF has_table_privilege('authenticated','public.bid_item_results','INSERT') OR has_table_privilege('authenticated','public.award_cancellations','INSERT') OR has_column_privilege('authenticated','public.bid_item_results','source_award_item_id','SELECT') THEN RAISE EXCEPTION 'P2.1 history writes or competing source award exposed'; END IF;
  FOR missing_name IN SELECT unnest(ARRAY[
    'public.create_collaborative_project(text,text,text,uuid,uuid,uuid,text,text)',
    'public.issue_project_invitation(uuid,text,text,boolean)',
    'public.issue_project_invitation(uuid,text,text,text,boolean)',
    'public.issue_project_invitation(uuid,text,text,text,uuid,boolean)',
    'public.create_client_existing_team_project(text,text,uuid,uuid,uuid,text,text,jsonb)',
    'public.respond_project_invitation(text,boolean)',
    'public.revoke_project_invitation(uuid)',
    'public.update_project_member(uuid,boolean,boolean)',
    'public.update_project_tracking(uuid,text,text)',
    'public.assign_project_request_member(uuid,uuid)',
    'public.set_project_document_sharing(uuid,text)',
    'public.project_team(uuid)'
  ]) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE')
       OR NOT has_function_privilege('authenticated',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'schema contract: collaboration RPC % must require authenticated execution', missing_name;
    END IF;
  END LOOP;
  FOR missing_name IN SELECT unnest(ARRAY[
    'public.propose_contract_amendment(uuid,uuid,text,bigint,date,integer,text,uuid)',
    'public.record_contract_amendment_acceptance(uuid,uuid,uuid,text,text,text,jsonb,timestamp with time zone,uuid)',
    'public.validate_contract_amendment(uuid,uuid,text,uuid)',
    'public.reject_contract_amendment(uuid,uuid,text,uuid)',
    'public.cancel_contract_amendment(uuid,uuid,text,uuid)'
  ]) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE')
       OR has_function_privilege('authenticated',missing_name,'EXECUTE')
       OR NOT has_function_privilege('service_role',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'P2.2-C RPC grant mismatch: %',missing_name;
    END IF;
  END LOOP;
  FOR missing_name IN SELECT unnest(ARRAY[
    'public.open_project_conversation(uuid,uuid)',
    'public.open_project_member_conversation(uuid,uuid)',
    'public.list_my_conversations()',
    'public.list_conversation_messages(uuid,timestamptz,integer)',
    'public.send_conversation_message(uuid,text,uuid)',
    'public.mark_conversation_read(uuid)'
  ]) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE') OR NOT has_function_privilege('authenticated',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'messaging RPC grant mismatch: %',missing_name;
    END IF;
  END LOOP;
  -- OCE sync mapping (#58 lot 2): closed tables, service_role-only RPCs.
  FOR missing_name IN SELECT unnest(ARRAY['oce_sync_mappings','oce_sync_wbs','oce_sync_activities','oce_sync_dependencies','oce_sync_journal']) LOOP
    IF has_table_privilege('anon','public.'||missing_name,'SELECT') OR has_table_privilege('authenticated','public.'||missing_name,'SELECT')
       OR has_table_privilege('authenticated','public.'||missing_name,'INSERT') OR has_table_privilege('authenticated','public.'||missing_name,'UPDATE')
       OR has_table_privilege('authenticated','public.'||missing_name,'DELETE') THEN
      RAISE EXCEPTION 'schema contract: OCE sync tables must stay closed: %',missing_name;
    END IF;
  END LOOP;
  FOR missing_name IN SELECT unnest(ARRAY[
    'public.oce_request_mapping(uuid,uuid)','public.oce_set_admission(uuid,boolean)','public.oce_begin_sync(uuid,text,text,text)',
    'public.oce_finish_sync(uuid,boolean,text,text)','public.oce_object_changed(uuid,text,text,text,text)','public.oce_record_object(uuid,text,text,text,text)'
  ]) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE') OR has_function_privilege('authenticated',missing_name,'EXECUTE')
       OR NOT has_function_privilege('service_role',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'OCE sync RPC grant mismatch: %',missing_name;
    END IF;
  END LOOP;
  -- OCE summary access (#58): authenticated-only boolean check, never anon.
  IF has_function_privilege('anon','public.oce_summary_access(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.oce_summary_access(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'OCE summary access grant mismatch';
  END IF;
  -- OCE lot plan (#301): closed table; authenticated RPCs for the plan, service_role-only RPC for the synchroniser.
  IF has_table_privilege('anon','public.oce_lot_plans','SELECT') OR has_table_privilege('authenticated','public.oce_lot_plans','SELECT')
     OR has_table_privilege('authenticated','public.oce_lot_plans','INSERT') OR has_table_privilege('authenticated','public.oce_lot_plans','UPDATE') THEN
    RAISE EXCEPTION 'schema contract: oce_lot_plans must stay closed';
  END IF;
  FOR missing_name IN SELECT unnest(ARRAY['public.oce_save_lot_plan(uuid,uuid,date,date,boolean)','public.oce_get_lot_plan(uuid,uuid)','public.oce_resync_access(uuid,uuid)']) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE') OR NOT has_function_privilege('authenticated',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'OCE lot plan RPC grant mismatch: %',missing_name;
    END IF;
  END LOOP;
  IF has_function_privilege('anon','public.oce_lot_plan_for_sync(uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','public.oce_lot_plan_for_sync(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.oce_lot_plan_for_sync(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'OCE lot plan sync RPC must be service_role only';
  END IF;
  IF has_function_privilege('anon','public.oce_mark_synced(uuid,integer)','EXECUTE') OR has_function_privilege('authenticated','public.oce_mark_synced(uuid,integer)','EXECUTE')
     OR NOT has_function_privilege('service_role','public.oce_mark_synced(uuid,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'OCE mark-synced RPC must be service_role only';
  END IF;
  IF to_regprocedure('public.oce_mark_synced(uuid)') IS NOT NULL OR to_regprocedure('dao_private.oce_mark_synced(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'unused OCE mark-synced(uuid) overload must be removed';
  END IF;
  -- Verified Client reviews (#213 R1): closed tables, authenticated-only RPCs, internal helpers not exposed.
  IF has_table_privilege('authenticated','public.contractor_reviews','SELECT')
     OR has_table_privilege('authenticated','public.contractor_reviews','INSERT')
     OR has_table_privilege('authenticated','public.contractor_reviews','UPDATE')
     OR has_table_privilege('authenticated','public.contractor_reviews','DELETE')
     OR has_table_privilege('anon','public.contractor_reviews','SELECT')
     OR has_table_privilege('authenticated','public.contractor_review_responses','SELECT')
     OR has_table_privilege('authenticated','public.contractor_review_responses','INSERT')
     OR has_table_privilege('authenticated','public.contractor_review_responses','UPDATE')
     OR has_table_privilege('authenticated','public.contractor_review_reports','SELECT')
     OR has_table_privilege('authenticated','public.contractor_review_reports','INSERT')
     OR has_table_privilege('authenticated','public.contractor_review_reports','UPDATE') THEN
    RAISE EXCEPTION 'schema contract: review tables must stay RPC-only';
  END IF;
  FOR missing_name IN SELECT unnest(ARRAY[
    'public.my_review_opportunities()',
    'public.submit_contractor_review(uuid,uuid,jsonb)',
    'public.withdraw_contractor_review(uuid)',
    'public.respond_to_contractor_review(uuid,text)',
    'public.report_contractor_review(uuid,text,text)',
    'public.moderate_contractor_review(uuid,text,text)',
    'public.professional_reviews(uuid,integer,integer)',
    'public.my_received_reviews()',
    'public.review_moderation_queue()',
    'public.review_moderation_page(text,integer,integer)'
  ]) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE') OR NOT has_function_privilege('authenticated',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'review RPC grant mismatch: %',missing_name;
    END IF;
  END LOOP;
  FOR missing_name IN SELECT unnest(ARRAY[
    'dao_private.review_pair(uuid,uuid,uuid)',
    'dao_private.can_read_contractor_reviews(uuid)',
    'dao_private.review_author_label(uuid)',
    'dao_private.contains_contact(text)',
    'dao_private.review_public_json(public.contractor_reviews)',
    'dao_private.review_audit(text,uuid,jsonb)'
  ]) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE') OR has_function_privilege('authenticated',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'review internal helper must not be executable by clients: %',missing_name;
    END IF;
  END LOOP;
  FOR missing_name IN SELECT unnest(ARRAY[
    'public.set_my_workspace(text)',
    'public.update_my_contractor_profile(text,text,text,text,integer,text,date,uuid[])',
    'public.my_project_invitations()',
    'public.respond_my_project_invitation(uuid,boolean)',
    'public.my_bid_summaries()',
    'public.withdraw_bid_version(uuid)'
  ]) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE') OR NOT has_function_privilege('authenticated',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'artisan workflow RPC grant mismatch: %',missing_name;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' AND column_name='last_workspace')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bid_versions' AND column_name='withdrawn_at')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='bid_versions' AND column_name='withdrawn_by') THEN
    RAISE EXCEPTION 'artisan workflow persistence columns are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='project_invitations' AND column_name='principal_request_id'
  ) THEN
    RAISE EXCEPTION 'schema contract: contractor invitations require principal_request_id support';
  END IF;
  IF NOT has_function_privilege('anon','public.preview_project_invitation(text)','EXECUTE') THEN
    RAISE EXCEPTION 'schema contract: token preview must be available before sign-in';
  END IF;
  IF NOT has_function_privilege('anon','public.project_invitation_registration_context(text)','EXECUTE') THEN
    RAISE EXCEPTION 'schema contract: invitation registration context must be available before sign-in';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='contractor_profiles'
      AND column_name='contractor_type' AND (is_nullable<>'YES' OR column_default IS NOT NULL)
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='contractor_profiles'
      AND column_name='contractor_type' AND is_nullable='YES' AND column_default IS NULL
  ) THEN
    RAISE EXCEPTION 'schema contract: contractor_type must remain unset until explicit profile completion';
  END IF;
  IF has_function_privilege('anon','public.rls_auto_enable()','EXECUTE')
     OR has_function_privilege('authenticated','public.rls_auto_enable()','EXECUTE')
     OR has_function_privilege('service_role','public.rls_auto_enable()','EXECUTE')
     OR NOT has_function_privilege('postgres','public.rls_auto_enable()','EXECUTE') THEN
    RAISE EXCEPTION 'schema contract: rls_auto_enable ACL must grant EXECUTE only to postgres';
  END IF;

  FOR state IN
    SELECT * FROM (VALUES
      ('public','projects','read_allowed'),
      ('public','bid_versions','read_allowed'),
      ('public','bid_items','read_allowed'),
      ('public','publications','read_allowed'),
      ('storage','objects','dao_no_direct_read'),
      ('storage','objects','dao_no_direct_insert'),
      ('storage','objects','dao_no_direct_update'),
      ('storage','objects','dao_no_direct_delete')
    ) AS required(schema_name,table_name,policy_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies p
      WHERE p.schemaname=state.schema_name AND p.tablename=state.table_name
        AND p.policyname=state.policy_name) THEN
      RAISE EXCEPTION 'schema contract: critical policy %.%.% is missing', state.schema_name,state.table_name,state.policy_name;
    END IF;
  END LOOP;

  FOR state IN
    SELECT * FROM (VALUES
      ('bid_versions','submitted_version_immutable'),
      ('bid_documents','immutable_bid_document'),
      ('bid_group_items','immutable_bid_group_items'),
      ('bid_groups','immutable_bid_groups'),
      ('bid_items','immutable_bid_items'),
      ('bid_item_results','immutable_bid_item_results'),
      ('award_cancellations','immutable_award_cancellations'),
      ('award_items','protect_award_item')
    ) AS required(table_name,trigger_name)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=state.table_name
        AND t.tgname=state.trigger_name AND NOT t.tgisinternal AND t.tgenabled='O') THEN
      RAISE EXCEPTION 'schema contract: enabled immutability trigger %.% is missing', state.table_name,state.trigger_name;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM storage.buckets b
      WHERE b.id='dao-private' AND b.name='dao-private' AND NOT b.public
        AND b.file_size_limit=20971520
        AND b.allowed_mime_types @> ARRAY['application/pdf','image/jpeg','image/png','image/webp']::text[]
        AND cardinality(b.allowed_mime_types)=4)
     OR NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
       WHERE n.nspname='storage' AND c.relname='objects' AND c.relrowsecurity) THEN
    RAISE EXCEPTION 'schema contract: private dao-private Storage bucket configuration or objects RLS is missing';
  END IF;

  IF (SELECT count(*) FROM public.trades
      WHERE active AND (code,name_fr) IN (
        ('general_contractor','Entreprise générale'),
        ('plumbing','Plomberie'),
        ('electrical','Électricité')
      )) <> 3 THEN
    RAISE EXCEPTION 'schema contract: canonical trade catalog rows are missing or incorrect';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.governorates WHERE code='E2E_TEST')
     OR NOT EXISTS (SELECT 1 FROM public.delegations WHERE code='E2E_TEST_DELEGATION')
     OR NOT EXISTS (SELECT 1 FROM public.localities l JOIN public.delegations d ON d.id=l.delegation_id
       WHERE d.code='E2E_TEST_DELEGATION' AND l.name_fr='Localité E2E') THEN
    RAISE EXCEPTION 'schema contract: synthetic E2E territory seed is missing';
  END IF;

  -- P9-A1: tables stay closed; authenticated callers use only the bounded RPC contract.
  FOR missing_name IN SELECT unnest(ARRAY[
    'precontract_agreements','precontract_agreement_versions',
    'precontract_agreement_acceptances','precontract_agreement_events',
    'precontract_installment_events'
  ]) LOOP
    IF has_table_privilege('anon','public.'||missing_name,'SELECT')
      OR has_table_privilege('authenticated','public.'||missing_name,'SELECT')
      OR has_table_privilege('authenticated','public.'||missing_name,'INSERT')
      OR has_table_privilege('authenticated','public.'||missing_name,'UPDATE')
      OR has_table_privilege('authenticated','public.'||missing_name,'DELETE')
      OR NOT EXISTS(
        SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relname=missing_name AND c.relrowsecurity
      ) THEN
      RAISE EXCEPTION 'precontract agreement table exposure mismatch: %',missing_name;
    END IF;
  END LOOP;
  FOR missing_name IN SELECT unnest(ARRAY[
    'public.propose_precontract_agreement(uuid,uuid,jsonb,uuid)',
    'public.accept_precontract_agreement(uuid,uuid,uuid)',
    'public.reject_precontract_agreement(uuid,uuid,text,uuid)',
    'public.precontract_agreement_snapshot(uuid)',
    'public.precontract_installment_snapshot(uuid)',
    'public.record_precontract_installment_event(uuid,uuid,integer,text,text,uuid)'
  ]) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE')
      OR NOT has_function_privilege('authenticated',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'precontract agreement RPC grant mismatch: %',missing_name;
    END IF;
  END LOOP;
  FOR missing_name IN SELECT unnest(ARRAY[
    'dao_private.precontract_party_for_award(uuid,uuid)',
    'dao_private.precontract_award_reference(uuid)',
    'dao_private.precontract_normalize_terms(uuid,jsonb)',
    'dao_private.propose_precontract_agreement(uuid,uuid,jsonb,uuid)',
    'dao_private.accept_precontract_agreement(uuid,uuid,uuid)',
    'dao_private.reject_precontract_agreement(uuid,uuid,text,uuid)',
    'dao_private.precontract_agreement_snapshot(uuid)',
    'dao_private.precontract_latest_agreed_version(uuid)',
    'dao_private.precontract_installment_snapshot(uuid)',
    'dao_private.record_precontract_installment_event(uuid,uuid,integer,text,text,uuid)'
  ]) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE')
      OR has_function_privilege('authenticated',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'precontract internal helper exposed: %',missing_name;
    END IF;
  END LOOP;
  FOR state IN
    SELECT * FROM (VALUES
      ('precontract_agreements','controlled_precontract_agreement_update'),
      ('precontract_agreements','immutable_precontract_agreements'),
      ('precontract_agreement_versions','immutable_precontract_versions'),
      ('precontract_agreement_acceptances','immutable_precontract_acceptances'),
      ('precontract_agreement_events','immutable_precontract_events'),
      ('precontract_installment_events','immutable_precontract_installment_events')
    ) AS required(table_name,trigger_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
      JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname=state.table_name
        AND t.tgname=state.trigger_name AND NOT t.tgisinternal AND t.tgenabled='O'
    ) THEN
      RAISE EXCEPTION 'precontract immutability trigger missing: %.%',state.table_name,state.trigger_name;
    END IF;
  END LOOP;

  RAISE NOTICE 'schema contract passed: migrations, RLS, event trigger, RPCs, immutability, Storage, trades, and E2E seed';
END
$schema_contract$;
