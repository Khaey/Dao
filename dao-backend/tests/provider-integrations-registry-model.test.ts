import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const ACTOR='00000000-0000-0000-0000-000000000001';

test('provider registry persists multiple sandbox connections with idempotency and honest checks', async () => {
  const migrations=join(process.cwd(),'supabase','migrations');
  const files=await readdir(migrations);
  const overview=files.find(file=>file.endsWith('_provider_integrations_overview_v1.sql'));
  const registry=files.find(file=>file.endsWith('_provider_integrations_registry_v1.sql'));
  assert.ok(overview);assert.ok(registry);
  const db=new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${ACTOR}');
    create schema dao_private;
    create table public.profiles(user_id uuid primary key,display_name text);
    insert into public.profiles values('${ACTOR}','Admin TEST');
    create function dao_private.settings_require_admin() returns uuid
      language sql stable as $$ select '${ACTOR}'::uuid $$;
  `);
  await db.exec(await readFile(join(migrations,overview),'utf8'));
  await db.exec(await readFile(join(migrations,registry),'utf8'));

  const command=async(action:string,input:Record<string,unknown>,key:string)=>{
    const result=await db.query<{result:any}>(
      'select public.admin_integration_command($1,$2::jsonb,$3::uuid) result',
      [action,JSON.stringify(input),key],
    );
    return result.rows[0].result;
  };
  const firstInput={provider_id:'dropbox_sign_test',alias:'Dropbox TEST A',country:'TN',
    legal_entity_id:'dao_tn_sandbox',environment:'sandbox',params:{},reason:'Création connexion sandbox A'};
  const keyA='10000000-0000-4000-8000-000000000001';
  const first=await command('create_connection',firstInput,keyA);
  assert.deepEqual(await command('create_connection',firstInput,keyA),first,'idempotent replay');
  const second=await command('create_connection',{...firstInput,alias:'Dropbox TEST B',reason:'Création connexion sandbox B'},
    '10000000-0000-4000-8000-000000000002');
  assert.notEqual(first.connection_id,second.connection_id);

  const checked=await command('test_connection',{connection_id:first.connection_id,reason:'Contrôle borné sans credential'},
    '10000000-0000-4000-8000-000000000003');
  assert.equal(checked.check_status,'unconfigured');
  assert.equal(checked.check_reason,'credentials_missing');
  await assert.rejects(command('set_default',{category:'signature',capability:'signature.sequential',country:'TN',
    legal_entity_id:'dao_tn_sandbox',environment:'sandbox',connection_id:first.connection_id,expected_version:null,
    reason:'Définir la connexion par défaut'},'10000000-0000-4000-8000-000000000004'),/non vérifiée/);
  await assert.rejects(command('suspend',{connection_id:first.connection_id,expected_version:99,
    reason:'Conflit de version attendu'},'10000000-0000-4000-8000-000000000005'),/connexion a été modifiée/);
  const suspended=await command('suspend',{connection_id:first.connection_id,expected_version:1,
    reason:'Suspendre les nouvelles opérations'},'10000000-0000-4000-8000-000000000006');
  assert.equal(suspended.connection_version,2);

  const dto=(await db.query<{dto:any}>('select public.admin_integrations_overview() dto')).rows[0].dto;
  assert.equal(dto.connections.length,2);
  assert.equal(dto.connections.find((item:any)=>item.id===first.connection_id).state,'suspended');
  assert.equal(dto.connections.find((item:any)=>item.id===second.connection_id).state,'unconfigured');
  assert.equal(dto.connections.every((item:any)=>item.secrets[0].present===false),true);
  assert.equal(dto.policies.length,0);
  assert.equal(dto.legal_entities[0].sandbox_only,true);
  const events=(await db.query<{events:any}>("select public.admin_integration_events(null,50) events")).rows[0].events;
  assert.equal(events.length,4);
  assert.equal(JSON.stringify(dto).includes('secret_ref'),false);
  await assert.rejects(db.exec('delete from dao_private.provider_events'),/ajout seul/);
  await db.close();
});
