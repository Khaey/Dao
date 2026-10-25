import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

test('settings S1: real JWT resolver, workspace/project isolation and no private surface', async t => {
  const url=process.env.DAO_SUPABASE_URL!;assert.equal(url,'http://127.0.0.1:54321','Disposable local stack only');
  const key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!;assert.ok(key);assert.ok(secret);
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(url,secret,options),anon=createClient(url,key,options);
  const actors:Record<string,any>={};
  async function insert(table:string,input:any){const r=await admin.from(table).insert(input).select('*').single();assert.ifError(r.error);return r.data!;}
  async function rpc(db:any,args:any={}){const r=await db.rpc('my_effective_settings',args);assert.ifError(r.error);return r.data;}
  async function denied(db:any,args:any={}){const r=await db.rpc('my_effective_settings',args);assert.ok(r.error,'my_effective_settings must deny access');assert.ok(!JSON.stringify(r.error).includes('dao_private.'));}
  const roles:Record<string,string[]>={client:['client'],other:['client'],pro:['contractor'],dual:['client','contractor'],staff:['dao_reviewer'],operator:['dao_admin']};
  for(const [name,list] of Object.entries(roles)) {
    const email=`settings-${name}-${randomUUID()}@example.invalid`,password='S!'+randomUUID();
    const user=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(user.error);
    const auth=createClient(url,key,options);const login=await auth.auth.signInWithPassword({email,password});assert.ifError(login.error);
    const db=createClient(url,key,{...options,global:{headers:{Authorization:'Bearer '+login.data.session!.access_token}}});
    actors[name]={id:user.data.user!.id,db};await insert('profiles',{user_id:actors[name].id,display_name:'Synthetic '+name});
    for(const role of list)await insert('user_roles',{user_id:actors[name].id,role});
    if(list.includes('contractor'))await insert('contractor_profiles',{user_id:actors[name].id,business_name:'Synthetic '+name,verification_status:'verified'});
  }
  const {client,other,pro,dual,staff,operator}=actors;
  const project=await insert('projects',{client_id:client.id});

  await t.test('anon, forged JWT and private functions are refused',async()=>{
    await denied(anon);
    await denied(createClient(url,key,{...options,global:{headers:{Authorization:'Bearer forged.jwt.invalid'}}}));
    for(const a of [client,staff,operator]){
      assert.ok((await a.db.schema('dao_private').rpc('resolve_setting',{p_key:'bids.rfi',p_user:other.id,p_workspace:'client',p_project:null})).error);
      assert.ok((await a.db.schema('dao_private').from('setting_definitions').select('*')).error);
    }
  });

  await t.test('real DTO: defaults equal today, workspace and owner choice separated',async()=>{
    const c=await rpc(client.db,{p_workspace:'client'});
    assert.equal(c.workspace,'client');assert.equal(c.catalog_version,1);
    assert.deepEqual(c.settings['invitations.ttl_days'],{value:7,state:'available',source:'default'});
    assert.equal(c.settings['bids.quote_pdf'],undefined);
    const p=await rpc(pro.db,{p_workspace:'contractor'});
    assert.equal(p.settings['bids.counter_proposals'].owner_choice,false);
    const asPro=await rpc(dual.db,{p_workspace:'contractor'}),asClient=await rpc(dual.db,{p_workspace:'client'});
    assert.ok(asPro.settings['bids.quote_pdf']&&!asPro.settings['client.invite_professionals']);
    assert.ok(asClient.settings['client.invite_professionals']&&!asClient.settings['bids.quote_pdf']);
    await denied(client.db,{p_workspace:'contractor'});await denied(pro.db,{p_workspace:'staff'});
  });

  await t.test('project scope: owner yes, other Client/Artisan/unassigned reviewer no, admin yes',async()=>{
    assert.deepEqual((await rpc(client.db,{p_workspace:'client',p_project_id:project.id})).settings['project.contract_enabled'],
      {value:false,state:'owner_choice',source:'default'});
    await denied(other.db,{p_workspace:'client',p_project_id:project.id});
    await denied(pro.db,{p_workspace:'contractor',p_project_id:project.id});
    await denied(staff.db,{p_workspace:'staff',p_project_id:project.id});
    await denied(client.db,{p_workspace:'client',p_project_id:randomUUID()});
    assert.equal((await rpc(operator.db,{p_workspace:'staff',p_project_id:project.id})).workspace,'staff');
  });

  await t.test('suspension is checked live',async()=>{
    const r=await operator.db.rpc('backoffice_command',{p_action:'account',p_input:{user_id:other.id,status:'suspended',reason:'Synthetic settings test'},p_key:randomUUID()});
    assert.ifError(r.error);await denied(other.db);
  });

  await t.test('performance baseline over real HTTP (indicative)',async()=>{
    const runs=20,start=performance.now();
    for(let i=0;i<runs;i++)await rpc(dual.db,{p_workspace:'contractor'});
    console.log(`settings-s1 real: 1 RPC per screen, ${((performance.now()-start)/runs).toFixed(1)} ms/call avg over ${runs}`);
  });
});
