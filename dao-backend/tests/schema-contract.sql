DO $schema_contract$
DECLARE
  expected_versions text[] := ARRAY[
    '20260920171021','20260920171039','20260920171048','20260920171056',
    '20260920172706','20260921010858','20260921013047','20260921013710',
    '20260921084730','20260921091400','20260921094726','20260921094727',
    '20260921094728','20260922133633','20260922142354','20260922142355',
    '20260922160410','20260922192016','20260922192148','20260922202247',
    '20260926092748','20260927102942','20260930084047','20260930163650','20260930165307',
    '20261003005500'
  ];
  expected_tables text[] := ARRAY[
    'ai_proposals','ai_runs','audit_events','award_items','awards',
    'bid_documents','bid_group_items','bid_groups','bid_items','bid_versions','bids',
    'command_receipts','contract_parties','contract_versions',
    'contractor_profiles','contractor_service_areas','contractor_trades',
    'contracts','conversation_participants','conversations','delegations',
    'document_grants','documents','governorates','localities','messages',
    'notifications','portfolio_assets','portfolio_projects','profile_contacts',
    'profiles','project_members','project_invitations','project_private_details','project_request_versions',
    'project_requests','project_reviews','project_version_requests',
    'project_versions','projects','publication_recipients',
    'publication_requests','publications','trades','user_roles'
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
      'public.preview_project_invitation(text)',
      'public.respond_project_invitation(text,boolean)',
      'public.update_project_tracking(uuid,text,text)',
      'public.project_team(uuid)',
      'public.add_project_request(uuid,uuid,text,text)',
      'public.withdraw_project_request(uuid)',
      'public.publish_project(uuid,text,uuid[],uuid[],timestamptz)',
      'public.create_bid_draft(uuid)',
      'public.submit_bid_version(uuid)',
      'public.award_request_atomic(text,uuid,uuid,uuid,uuid,uuid,bigint)',
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
  FOR missing_name IN SELECT unnest(ARRAY[
    'public.create_collaborative_project(text,text,text,uuid,uuid,uuid,text,text)',
    'public.issue_project_invitation(uuid,text,text,boolean)',
    'public.issue_project_invitation(uuid,text,text,text,boolean)',
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
  IF NOT has_function_privilege('anon','public.preview_project_invitation(text)','EXECUTE') THEN
    RAISE EXCEPTION 'schema contract: token preview must be available before sign-in';
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
      ('bid_items','immutable_bid_items')
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

  RAISE NOTICE 'schema contract passed: migrations, RLS, event trigger, RPCs, immutability, Storage, trades, and E2E seed';
END
$schema_contract$;
