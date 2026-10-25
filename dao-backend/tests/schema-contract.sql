Warning: truncated output (original token count: 12404)
Total output lines: 731

DO $schema_contract$
DECLARE
  expected_versions text[] := ARRAY[
    '20260920171021','20260920171039','20260920171048','20260920171056',
    '20260920172706','20260921010858','20260921013047','20260921013710',
    '20260921084730','20260921091400','20260921094726','20260921094727',
    '20260921094728','20260922133633','20260922142354','20260922142355',
    '20260922160410','20260922192016','20260922192148','20260922202247',
    '20260926092748','20260927102942','20260930084047','20260930163650','20260930165307',
    '20261003015740','20261003030134','20261004120000','20261006203956','20261007182403','20261009103053','20261009180000','20261012220000','20261013014522','20261013211500','20261014183000','20261014194000','20261014230755','20261015010000','20261017140000','20261017190000','20261018000000','20261018020000','20261018030000','20261018040000','20261018050000','20261018060000','20261018070000','20261018071000','20261018072000','20261018080000','20261019012000','20261019020000','20261019104500','20261019130000','20261019160000','20261019170000','20261019180000','20261019190000','20261019200000','20261019210000','20261020010000','20261020020000','20261020030000','20261020060000','20261020070000','20261020050000','20261019140000','20261020080000','20261021010000','20261021020000','20261021030000','20261021040000','20261022230233','20261023010000','20261024060000','20261024080000','20261024090000','20261024100000','20261024110000','20261024120000','20261024130000','20261025030744','20261025100000','20261025120000','20261025140000','20261025160000','20261025043812','20261025180000','20261025200000','20261025210000'
  ];
  expected_tables text[] := ARRAY[
    'account_states','review_assignments','request_sub_lots','request_sub_lot_versions','publication_lot_withdrawals','notification_outbox','oce_sync_mappings','oce_sync_wbs','oce_sync_activities','oce_sync_dependencies','oce_sync_journal','oce_lot_plans','staff_invitation_requests','ai_proposals','ai_runs','audit_events','award_cancellations','award_items','awards','bid_item_results',
    'native_execution_activities','native_execution_activity_revisions','native_execution_activity_commands','native_execution_activity_proposals','native_execution_activity_proposal_acceptances','native_installment_scope_proposals','native_installment_scope_acceptances',
    'bid_documents','bid_group_items','bid_groups','bid_items','bid_quote_lines','bid_sub_lot_links','bid_sub_lots','project_plan_contexts','project_plan_link_decisions','project_plan_manual_link_removals','project_plan_manual_links','project_plan_results','bid_versions','bids',
    'command_receipts','contract_acceptances','contract_amendment_acceptances','contract_amendment_events','contract_amendment_versions','contract_amendments','contract_archives','contract_events','contract_items','contract_parties','contract_versions','precontract_agreements','precontract_agreement_versions','precontract_agreement_acceptances','precontract_agreement_events','precontract_installment_events',
    'contractor_profiles','contractor_service_areas','contractor_trades','contractor_profile_details','contractor_files',
    'contractor_reviews','contractor_review_responses','contractor_review_reports',
    'contracts','conversation_participants','conversations','delegations',
    'document_grants','documents','document_families','document_revisions','document_family_lots','document_dossier_events','governorates','localities','messages',
    'notifications','notification_preferences','portfolio_assets','portfolio_projects','profile_contacts','technical_questions','technical_clarifications','technical_rfi_reads','technical_rfi_receipts','technical_rfi_documents',
    'profiles','project_contract_settings','project_members','project_invitations','project_private_details','project_request_versions',
    'project_requests','project_reviews','project_version_requests',
    'project_versions','projects','publication_recipients',
    'publication_requests','publications','site_client_observations','site_log_events','site_log_evidence','site_technical_inspections','site_technical_inspection_events','site_technical_reserves','site_technical_reserve_events','site_technical_evidence','site_work_situations','site_work_situation_events','support_command_receipts','support_events','support_messages','support_reads','support_tickets','trades','user_roles'
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
      'public.configure_contract_runtime(uuid,text,boolean,text)',
      'public.set_project_contract_enabled(uuid,boolean,text)',
      'public.project_contract_configuration(uuid)',
      'public.start_contract_acceptance(uuid,uuid,text,boolean,uuid)',
      'public.record_contract_acceptance(uuid,uuid,uuid,text,text,text,jsonb,timestamp with time zone,uuid)',
      'public.validate_contract_acceptance(uuid,uuid,text,uuid)',
      'public.cancel_contract_draft(uuid,uuid,text,uui…7404 tokens truncated…%',missing_name;
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

  FOR missing_name IN SELECT unnest(ARRAY[
    'public.native_request_sub_lots_v1(uuid)',
    'public.replace_client_request_sub_lots_v1(uuid,uuid,jsonb)'
  ]) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE')
      OR NOT has_function_privilege('authenticated',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'client official sub-lot API grant mismatch: %',missing_name;
    END IF;
  END LOOP;
  FOR missing_name IN SELECT unnest(ARRAY[
    'dao_private.native_request_sub_lots_v1(uuid)',
    'dao_private.replace_client_request_sub_lots_v1(uuid,uuid,jsonb)'
  ]) LOOP
    IF has_function_privilege('anon',missing_name,'EXECUTE')
      OR has_function_privilege('authenticated',missing_name,'EXECUTE') THEN
      RAISE EXCEPTION 'client official sub-lot internal helper exposed: %',missing_name;
    END IF;
  END LOOP;

  RAISE NOTICE 'schema contract passed: migrations, RLS, event trigger, RPCs, immutability, Storage, trades, and E2E seed';
END
$schema_contract$;
