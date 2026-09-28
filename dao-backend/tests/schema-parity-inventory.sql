-- Read-only, DAO-scoped structural inventory for comparing fresh local Supabase
-- with DEV. It hashes definitions and security metadata without reading rows.
-- Finalize the CSV with schema-parity-inventory.mjs before comparing: the SQL
-- includes a temporary hex-encoded function definition so semantic fingerprints
-- can ignore SQL comments/formatting without discarding meaningful string literals.
WITH catalog_objects AS (
  SELECT
    'schema'::text AS kind,
    n.nspname::text AS object_name,
    jsonb_build_object(
      'owner', pg_get_userbyid(n.nspowner),
      'acl', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'grantor', grantor_role.rolname,
            'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END,
            'privilege', acl.privilege_type,
            'grantable', acl.is_grantable
          )
          ORDER BY grantor_role.rolname, CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END, acl.privilege_type, acl.is_grantable
        )
        FROM aclexplode(COALESCE(n.nspacl, acldefault('n'::"char", n.nspowner))) AS acl
        LEFT JOIN pg_roles AS grantor_role ON grantor_role.oid = acl.grantor
        LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
      ), '[]'::jsonb)
    ) AS details
  FROM pg_namespace AS n
  WHERE n.nspname IN ('public', 'dao_private')

  UNION ALL

  SELECT
    'relation'::text,
    format('%I.%I', n.nspname, c.relname),
    jsonb_build_object(
      'kind', c.relkind,
      'owner', pg_get_userbyid(c.relowner),
      'persistence', c.relpersistence,
      'rls_enabled', c.relrowsecurity,
      'rls_forced', c.relforcerowsecurity,
      'replica_identity', c.relreplident,
      'acl', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'grantor', grantor_role.rolname,
            'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END,
            'privilege', acl.privilege_type,
            'grantable', acl.is_grantable
          )
          ORDER BY grantor_role.rolname, CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END, acl.privilege_type, acl.is_grantable
        )
        FROM aclexplode(COALESCE(c.relacl, acldefault((CASE WHEN c.relkind = 'S' THEN 'S' ELSE 'r' END)::"char", c.relowner))) AS acl
        LEFT JOIN pg_roles AS grantor_role ON grantor_role.oid = acl.grantor
        LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
      ), '[]'::jsonb),
      'columns', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'name', a.attname,
            'type', format_type(a.atttypid, a.atttypmod),
            'not_null', a.attnotnull,
            'default', (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef AS d WHERE d.adrelid = a.attrelid AND d.adnum = a.attnum),
            'identity', NULLIF(a.attidentity, ''),
            'generated', NULLIF(a.attgenerated, ''),
            'collation', CASE WHEN a.attcollation = 0 THEN NULL ELSE format('%I.%I', collation_schema.nspname, collation_obj.collname) END,
            'acl', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'grantor', grantor_role.rolname,
                  'grantee', CASE WHEN column_acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END,
                  'privilege', column_acl.privilege_type,
                  'grantable', column_acl.is_grantable
                )
                ORDER BY grantor_role.rolname, CASE WHEN column_acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END, column_acl.privilege_type, column_acl.is_grantable
              )
              FROM aclexplode(a.attacl) AS column_acl
              LEFT JOIN pg_roles AS grantor_role ON grantor_role.oid = column_acl.grantor
              LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = column_acl.grantee
            ), '[]'::jsonb)
          ) ORDER BY a.attnum
        )
        FROM pg_attribute AS a
        LEFT JOIN pg_collation AS collation_obj ON collation_obj.oid = a.attcollation
        LEFT JOIN pg_namespace AS collation_schema ON collation_schema.oid = collation_obj.collnamespace
        WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      ), '[]'::jsonb),
      'sequence', CASE WHEN c.relkind = 'S' THEN (
        SELECT jsonb_build_object(
          'start', sequence.seqstart,
          'increment', sequence.seqincrement,
          'maximum', sequence.seqmax,
          'minimum', sequence.seqmin,
          'cache', sequence.seqcache,
          'cycle', sequence.seqcycle
        )
        FROM pg_sequence AS sequence WHERE sequence.seqrelid = c.oid
      ) ELSE NULL END
    )
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('public', 'dao_private')
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f', 'S')

  UNION ALL

  SELECT
    'constraint'::text,
    format('%I.%I.%I', n.nspname, table_class.relname, con.conname),
    jsonb_build_object(
      'type', con.contype,
      'definition', pg_get_constraintdef(con.oid, true),
      'validated', con.convalidated,
      'deferrable', con.condeferrable,
      'initially_deferred', con.condeferred
    )
  FROM pg_constraint AS con
  JOIN pg_class AS table_class ON table_class.oid = con.conrelid
  JOIN pg_namespace AS n ON n.oid = table_class.relnamespace
  WHERE n.nspname IN ('public', 'dao_private')

  UNION ALL

  SELECT
    'index'::text,
    format('%I.%I', index_schema.nspname, index_class.relname),
    jsonb_build_object(
      'table', format('%I.%I', table_schema.nspname, table_class.relname),
      'definition', pg_get_indexdef(index_class.oid),
      'unique', index_data.indisunique,
      'primary', index_data.indisprimary,
      'valid', index_data.indisvalid,
      'ready', index_data.indisready,
      'replica_identity', index_data.indisreplident,
      'nulls_not_distinct', index_data.indnullsnotdistinct
    )
  FROM pg_index AS index_data
  JOIN pg_class AS index_class ON index_class.oid = index_data.indexrelid
  JOIN pg_namespace AS index_schema ON index_schema.oid = index_class.relnamespace
  JOIN pg_class AS table_class ON table_class.oid = index_data.indrelid
  JOIN pg_namespace AS table_schema ON table_schema.oid = table_class.relnamespace
  WHERE table_schema.nspname IN ('public', 'dao_private')

  UNION ALL

  SELECT
    'function'::text,
    format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)),
    jsonb_build_object(
      'definition', pg_get_functiondef(p.oid),
      'owner', pg_get_userbyid(p.proowner),
      'language', language.lanname,
      'security_definer', p.prosecdef,
      'config', to_jsonb(p.proconfig),
      'volatility', p.provolatile,
      'strict', p.proisstrict,
      'parallel', p.proparallel,
      'acl', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'grantor', grantor_role.rolname,
            'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END,
            'privilege', acl.privilege_type,
            'grantable', acl.is_grantable
          )
          ORDER BY grantor_role.rolname, CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE grantee_role.rolname END, acl.privilege_type, acl.is_grantable
        )
        FROM aclexplode(COALESCE(p.proacl, acldefault('f'::"char", p.proowner))) AS acl
        LEFT JOIN pg_roles AS grantor_role ON grantor_role.oid = acl.grantor
        LEFT JOIN pg_roles AS grantee_role ON grantee_role.oid = acl.grantee
      ), '[]'::jsonb)
    )
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_language AS language ON language.oid = p.prolang
  WHERE n.nspname IN ('public', 'dao_private')
    AND p.prokind IN ('f', 'p')
    AND NOT EXISTS (
      SELECT 1 FROM pg_depend AS extension_dependency
      WHERE extension_dependency.classid = 'pg_proc'::regclass
        AND extension_dependency.objid = p.oid
        AND extension_dependency.deptype = 'e'
    )

  UNION ALL

  SELECT
    'trigger'::text,
    format('%I.%I.%I', n.nspname, table_class.relname, trigger.tgname),
    jsonb_build_object(
      'definition', pg_get_triggerdef(trigger.oid, true),
      'enabled', trigger.tgenabled,
      'constraint_trigger', trigger.tgconstraint <> 0,
      'function', format('%I.%I(%s)', function_schema.nspname, trigger_function.proname, pg_get_function_identity_arguments(trigger_function.oid)),
      'arguments', encode(trigger.tgargs, 'hex')
    )
  FROM pg_trigger AS trigger
  JOIN pg_class AS table_class ON table_class.oid = trigger.tgrelid
  JOIN pg_namespace AS n ON n.oid = table_class.relnamespace
  JOIN pg_proc AS trigger_function ON trigger_function.oid = trigger.tgfoid
  JOIN pg_namespace AS function_schema ON function_schema.oid = trigger_function.pronamespace
  WHERE n.nspname IN ('public', 'dao_private')
    AND NOT trigger.tgisinternal

  UNION ALL

  SELECT
    'event_trigger'::text,
    event_trigger.evtname,
    jsonb_build_object(
      'event', event_trigger.evtevent,
      'tags', to_jsonb(event_trigger.evttags),
      'enabled', event_trigger.evtenabled,
      'owner', pg_get_userbyid(event_trigger.evtowner),
      'function', format('%I.%I(%s)', function_schema.nspname, trigger_function.proname, pg_get_function_identity_arguments(trigger_function.oid))
    )
  FROM pg_event_trigger AS event_trigger
  JOIN pg_proc AS trigger_function ON trigger_function.oid = event_trigger.evtfoid
  JOIN pg_namespace AS function_schema ON function_schema.oid = trigger_function.pronamespace
  WHERE function_schema.nspname IN ('public', 'dao_private')

  UNION ALL

  SELECT
    'policy'::text,
    format('%I.%I.%I', policy.schemaname, policy.tablename, policy.policyname),
    jsonb_build_object(
      'permissive', policy.permissive,
      'roles', to_jsonb(policy.roles),
      'command', policy.cmd,
      'using', policy.qual,
      'with_check', policy.with_check
    )
  FROM pg_policies AS policy
  WHERE policy.schemaname IN ('public', 'dao_private')
     OR (policy.schemaname = 'storage' AND policy.tablename = 'objects')
)
SELECT
  kind,
  object_name,
  md5(details::text) AS raw_fingerprint,
  CASE WHEN kind = 'function' THEN md5(details->>'definition') END AS function_definition_raw_fingerprint,
  CASE WHEN kind = 'function' THEN md5((details - 'definition')::text) END AS function_metadata_fingerprint,
  CASE WHEN kind = 'function' THEN encode(convert_to(details->>'definition', 'UTF8'), 'hex') END AS function_definition_hex
FROM catalog_objects
ORDER BY kind, object_name;
