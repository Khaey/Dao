import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import test from 'node:test';
import assert from 'node:assert/strict';

const vars = ['DAO_SUPABASE_URL','DAO_SUPABASE_PUBLISHABLE_KEY','DAO_SUPABASE_SECRET_KEY',
  'DAO_TEST_CLIENT_EMAIL','DAO_TEST_CLIENT_PASSWORD','DAO_TEST_ARTISAN_EMAIL','DAO_TEST_ARTISAN_PASSWORD',
  'DAO_TEST_TARGETED_EMAIL','DAO_TEST_TARGETED_PASSWORD',
  'DAO_TEST_DUAL_EMAIL','DAO_TEST_DUAL_PASSWORD','DAO_TEST_OTHER_EMAIL','DAO_TEST_OTHER_PASSWORD',
  'DAO_TEST_PROJECT_ID','DAO_TEST_TEMP_PROJECT_ID','DAO_TEST_REQUEST_ID','DAO_TEST_AWARD_ID','DAO_TEST_BID_ITEM_ID',
  'DAO_TEST_BID_VERSION_ID','DAO_TEST_DRAFT_BID_ID','DAO_TEST_SUBMITTED_BID_ID','DAO_TEST_DOCUMENT_ID',
  'DAO_TEST_PUBLICATION_ID','DAO_TEST_TARGETED_ID','DAO_TEST_INVITE_ONLY_ID','DAO_TEST_OBJECT_PATH',
  'DAO_TEST_CONTRACTOR_ID','DAO_TEST_TEMP_REQUEST_ID','DAO_TEST_TEMP_AWARD_ID','DAO_TEST_TEMP_BID_ITEM_ID',
  'DAO_TEST_SECOND_AWARD_ID','DAO_TEST_SECOND_CONTRACTOR_ID','DAO_TEST_SECOND_BID_ITEM_ID'];

async function login(url:string,key:string,email:string,password:string) {
  const c=createClient(url,key); const {data,error}=await c.auth.signInWithPassword({email,password});
  assert.ifError(error); assert.ok(data.session?.access_token);
  return createClient(url,key,{global:{headers:{Authorization:`Bearer ${data.session!.access_token}`} }});
}
async function count(c:SupabaseClient, table:string, id:string) {
  const {data,error}=await c.from(table).select('id').eq('id',id); assert.ifError(error); return data?.length ?? 0;
}

test('Supabase real MVP integration', async()=>{
  const missing=vars.filter(k=>!process.env[k]);
  assert.equal(missing.length,0,`Missing integration variables: ${missing.join(', ')}`);
  const url=process.env.DAO_SUPABASE_URL!, key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!, secret=process.env.DAO_SUPABASE_SECRET_KEY!;
  const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
  const client=await login(url,key,process.env.DAO_TEST_CLIENT_EMAIL!,process.env.DAO_TEST_CLIENT_PASSWORD!);
  const artisan=await login(url,key,process.env.DAO_TEST_ARTISAN_EMAIL!,process.env.DAO_TEST_ARTISAN_PASSWORD!);
  const targetedActor=await login(url,key,process.env.DAO_TEST_TARGETED_EMAIL!,process.env.DAO_TEST_TARGETED_PASSWORD!);
  const dual=await login(url,key,process.env.DAO_TEST_DUAL_EMAIL!,process.env.DAO_TEST_DUAL_PASSWORD!);
  const other=await login(url,key,process.env.DAO_TEST_OTHER_EMAIL!,process.env.DAO_TEST_OTHER_PASSWORD!);
  const project=process.env.DAO_TEST_PROJECT_ID!, request=process.env.DAO_TEST_REQUEST_ID!;
  const draft=process.env.DAO_TEST_DRAFT_BID_ID!, submitted=process.env.DAO_TEST_SUBMITTED_BID_ID!, doc=process.env.DAO_TEST_DOCUMENT_ID!;
  const publication=process.env.DAO_TEST_PUBLICATION_ID!, targeted=process.env.DAO_TEST_TARGETED_ID!, inviteOnly=process.env.DAO_TEST_INVITE_ONLY_ID!;
  assert.equal(await count(client,'bids',draft),0);
  assert.equal(await count(other,'bid_versions',submitted),0);
  assert.equal(await count(client,'bid_versions',submitted),1);
  assert.equal(await count(artisan,'bid_versions',submitted),1);
  const {data:dualRoles,error:dualRolesError}=await dual.from('user_roles').select('role').in('role',['client','contractor']);
  assert.ifError(dualRolesError);
  assert.deepEqual((dualRoles ?? []).map((r:any)=>r.role).sort(),['client','contractor']);
  assert.equal(await count(client,'publications',publication),1);
  assert.equal(await count(targetedActor,'publications',targeted),1);
  assert.equal(await count(other,'publications',targeted),0);
  assert.equal(await count(other,'publications',inviteOnly),0);
  const objectPath=`bid/${process.env.DAO_TEST_BID_VERSION_ID!}/integration-${Date.now()}.pdf`;
  const {data:version,error:versionError}=await artisan.from('bid_versions').select('id').eq('id',process.env.DAO_TEST_BID_VERSION_ID!).single();
  assert.ifError(versionError); assert.ok(version);
  const {data:upload,error:uploadError}=await admin.storage.from('dao-private').createSignedUploadUrl(objectPath);
  assert.ifError(uploadError); assert.ok(upload?.token);
  const blob=new Blob(['DAO integration'],{type:'application/pdf'});
  const {error:putError}=await createClient(url,key).storage.from('dao-private').uploadToSignedUrl(objectPath,upload!.token,blob);
  assert.ifError(putError);
  const {data:approved,error:docError}=await client.from('bid_documents').select('id').eq('id',doc).single();
  assert.ifError(docError); assert.ok(approved);
  const {data:signed,error:signedError}=await admin.storage.from('dao-private').createSignedUrl(process.env.DAO_TEST_OBJECT_PATH!,300);
  assert.ifError(signedError); assert.ok(signed?.signedUrl);
  const {data:blocked}=await other.from('bid_documents').select('id').eq('id',doc); assert.equal(blocked?.length ?? 0,0);
  const tempProject=process.env.DAO_TEST_TEMP_PROJECT_ID!, tempRequest=process.env.DAO_TEST_TEMP_REQUEST_ID!, tempAward=process.env.DAO_TEST_TEMP_AWARD_ID!, tempItem=process.env.DAO_TEST_TEMP_BID_ITEM_ID!;
  const keys=[`integration-${Date.now()}-a`,`integration-${Date.now()}-b`,`integration-${Date.now()}-c`];
  try {
    const params={p_idempotency_key:keys[0],p_award_id:tempAward,p_project_id:tempProject,p_contractor_id:process.env.DAO_TEST_CONTRACTOR_ID!,p_request_id:tempRequest,p_bid_item_id:tempItem,p_agreed_millimes:1000};
    const first=await client.rpc('award_request_atomic',params); assert.ifError(first.error); assert.ok(first.data);
    const replay=await client.rpc('award_request_atomic',params); assert.ifError(replay.error); assert.deepEqual(replay.data,first.data);
    const forbidden=await other.rpc('award_request_atomic',{...params,p_idempotency_key:keys[1]}); assert.ok(forbidden.error);
    const second=await client.rpc('award_request_atomic',{
      ...params,
      p_idempotency_key:keys[2],
      p_award_id:process.env.DAO_TEST_SECOND_AWARD_ID!,
      p_contractor_id:process.env.DAO_TEST_SECOND_CONTRACTOR_ID!,
      p_bid_item_id:process.env.DAO_TEST_SECOND_BID_ITEM_ID!
    });
    assert.ok(second.error, 'second active award must fail');
    assert.match(`${second.error?.code ?? ''} ${second.error?.message ?? ''}`, /23505|one_active_award_per_request/i);
  } finally {
    await admin.from('award_items').delete().eq('award_id',tempAward).eq('request_id',tempRequest);
    await admin.from('award_items').delete().eq('award_id',process.env.DAO_TEST_SECOND_AWARD_ID!).eq('request_id',tempRequest);
    for (const key of keys) await admin.from('command_receipts').delete().eq('idempotency_key',key);
  }
  await admin.storage.from('dao-private').remove([objectPath]);
});
