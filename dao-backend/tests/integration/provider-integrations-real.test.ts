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
    const command=await db.rpc('admin_integration_command',{p_action:'create_connection',p_input:{reason:'Action interdite'},p_idempotency_key:randomUUID()});
    assert.equal(command.error?.code,'42501');
    const events=await db.rpc('admin_integration_events',{p_connection_id:null,p_limit:50});
    assert.equal(events.error?.code,'42501');
  }

  const response=await admin.rpc('admin_integrations_overview');assert.ifError(response.error);
  const dto=response.data;
  assert.equal(dto.contract_version,'provider-integrations.v1');
  assert.equal(dto.registry_version,1);
  assert.deepEqual(dto.markets,['TN']);
  assert.equal(dto.legal_entities.length,1);
  assert.equal(dto.legal_entities[0].sandbox_only,true);
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

  const command=async(action:string,input:any,idempotency_key=randomUUID())=>{
    const r=await admin.rpc('admin_integration_command',{p_action:action,p_input:input,p_idempotency_key:idempotency_key});
    return r;
  };
  const createInput={provider_id:'dropbox_sign_test',alias:'Dropbox TEST réel A',country:'TN',
    legal_entity_id:'dao_tn_sandbox',environment:'sandbox',params:{},reason:'Fixture intégration connexion A'};
  const idempotency=randomUUID();
  const created=await command('create_connection',createInput,idempotency);assert.ifError(created.error);
  const replay=await command('create_connection',createInput,idempotency);assert.ifError(replay.error);
  assert.deepEqual(replay.data,created.data);
  const second=await command('create_connection',{...createInput,alias:'Dropbox TEST réel B',reason:'Fixture intégration connexion B'});assert.ifError(second.error);
  assert.notEqual(second.data.connection_id,created.data.connection_id);
  const reused=await command('create_connection',{...createInput,alias:'Autre payload'},idempotency);
  assert.equal(reused.error?.code,'22023');
  const candidate=await command('create_connection',{...createInput,provider_id:'ngsign',reason:'Candidat non installable'});
  assert.equal(candidate.error?.code,'22023');
  const live=await command('create_connection',{...createInput,environment:'live',reason:'LIVE doit être refusé'});
  assert.equal(live.error?.code,'22023');

  const checked=await command('test_connection',{connection_id:created.data.connection_id,reason:'Contrôle honnête sans credential'});
  assert.ifError(checked.error);assert.equal(checked.data.check_status,'unconfigured');
  const defaultDenied=await command('set_default',{category:'signature',capability:'signature.sequential',country:'TN',
    legal_entity_id:'dao_tn_sandbox',environment:'sandbox',connection_id:created.data.connection_id,expected_version:null,
    reason:'Définir le défaut sans vérification'});
  assert.equal(defaultDenied.error?.code,'42501');
  const stale=await command('suspend',{connection_id:created.data.connection_id,expected_version:99,reason:'Conflit optimiste attendu'});
  assert.equal(stale.error?.code,'40001');
  const suspended=await command('suspend',{connection_id:created.data.connection_id,expected_version:1,reason:'Suspendre les nouvelles opérations'});
  assert.ifError(suspended.error);assert.equal(suspended.data.connection_version,2);

  const current=await admin.rpc('admin_integrations_overview');assert.ifError(current.error);
  assert.equal(current.data.connections.length,2);
  assert.equal(current.data.connections.find((item:any)=>item.id===created.data.connection_id).state,'suspended');
  assert.equal(current.data.connections.find((item:any)=>item.id===second.data.connection_id).state,'unconfigured');
  assert.equal(current.data.connections.every((item:any)=>item.secrets[0].present===false),true);
  assert.deepEqual(current.data.policies,[]);
  const history=await admin.rpc('admin_integration_events',{p_connection_id:null,p_limit:50});assert.ifError(history.error);
  assert.equal(history.data.length,4);
  assert.equal(JSON.stringify(current.data).includes('secret_ref'),false);

  assert.ok((await admin.schema('dao_private').from('provider_manifests').select('*')).error);
  assert.ok((await admin.schema('dao_private').from('provider_connections').select('*')).error);
  assert.ok((await admin.schema('dao_private').rpc('admin_integrations_overview')).error);
});
