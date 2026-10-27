import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

test('provider integrations v1: Admin-only real RPC and redacted manifest DTO', async () => {
  const url=process.env.DAO_SUPABASE_URL!;
  assert.equal(url,'http://127.0.0.1:54321','Disposable local stack only');
  const key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!;
  assert.ok(key);assert.ok(secret);
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const service=createClient(url,secret,options),anon=createClient(url,key,options);

  async function actor(label:string,role:string){
    const email=`provider-${label}-${randomUUID()}@example.invalid`,password='Provider!'+randomUUID();
    const created=await service.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error);
    const id=created.data.user!.id;
    assert.ifError((await service.from('profiles').insert({user_id:id,display_name:`Provider ${label}`})).error);
    assert.ifError((await service.from('user_roles').insert({user_id:id,role})).error);
    const auth=createClient(url,key,options);const login=await auth.auth.signInWithPassword({email,password});assert.ifError(login.error);
    return createClient(url,key,{...options,global:{headers:{Authorization:'Bearer '+login.data.session!.access_token}}});
  }

  const admin=await actor('admin','dao_admin');
  const reviewer=await actor('reviewer','dao_reviewer');
  const client=await actor('client','client');
  const contractor=await actor('contractor','contractor');

  for(const db of [anon,reviewer,client,contractor]){
    const denied=await db.rpc('admin_integrations_overview');
    assert.ok(denied.error,'non Admin must be denied');
    assert.equal(denied.error.code,'42501');
  }

  const response=await admin.rpc('admin_integrations_overview');assert.ifError(response.error);
  const dto=response.data;
  assert.equal(dto.contract_version,'provider-integrations.v1');
  assert.equal(dto.registry_version,1);
  assert.deepEqual(dto.markets,['TN']);
  assert.deepEqual(dto.legal_entities,[]);
  assert.deepEqual(dto.connections,[]);
  assert.deepEqual(dto.policies,[]);
  assert.equal(dto.categories.length,8);
  assert.equal(dto.connectors.length,6);
  const dropbox=dto.connectors.find((item:any)=>item.provider_id==='dropbox_sign_test');
  assert.equal(dropbox.status,'installed');
  assert.equal(dropbox.connection_check_supported,false);
  assert.equal(dropbox.live_locked,true);
  assert.deepEqual(dropbox.environments,['sandbox']);
  const serialized=JSON.stringify(dto);
  for(const forbidden of ['secret_ref','api_key_value','access_token','callback_url']) assert.equal(serialized.includes(forbidden),false,forbidden);

  assert.ok((await admin.schema('dao_private').from('provider_manifests').select('*')).error);
  assert.ok((await admin.schema('dao_private').rpc('admin_integrations_overview')).error);
});
