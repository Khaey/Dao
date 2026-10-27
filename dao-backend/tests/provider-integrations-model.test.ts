import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

test('provider integrations overview migration is executable and manifests are immutable', async () => {
  const migrations=join(process.cwd(),'supabase','migrations');
  const name=(await readdir(migrations)).find(file=>file.endsWith('_provider_integrations_overview_v1.sql'));
  assert.ok(name);
  const sql=await readFile(join(migrations,name),'utf8');
  const db=new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin;
    create schema dao_private;
    create function dao_private.settings_require_admin() returns uuid
      language sql stable as $$ select '00000000-0000-0000-0000-000000000001'::uuid $$;
  `);
  await db.exec(sql);

  const result=await db.query<{overview:any}>('select public.admin_integrations_overview() overview');
  const dto=result.rows[0].overview;
  assert.equal(dto.contract_version,'provider-integrations.v1');
  assert.equal(dto.registry_version,1);
  assert.equal(dto.categories.length,8);
  assert.equal(dto.connectors.length,6);
  assert.deepEqual(dto.legal_entities,[]);
  assert.deepEqual(dto.connections,[]);
  assert.deepEqual(dto.policies,[]);

  await assert.rejects(
    db.exec("update dao_private.provider_manifests set label='Changed' where provider_id='dropbox_sign_test'"),
    /versionnés et immuables/,
  );
  await assert.rejects(
    db.exec(`insert into dao_private.provider_manifests(
      provider_id,manifest_version,label,category,status,adapter_version,countries,capabilities,environments,
      auth_modes,live_locked,connection_check_supported,fields
    ) values('unsafe','1','Unsafe','maps','candidate',null,array['TN'],array['maps.map'],array['sandbox'],
      array['api_key'],true,false,'[{"key":"endpoint","label":"Endpoint","help":"","required":true,"type":"text","secret":false}]')`),
    /check constraint/,
  );
  await db.close();
});
