import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import test from 'node:test';
import assert from 'node:assert/strict';

const vars = ['DAO_SUPABASE_URL','DAO_SUPABASE_PUBLISHABLE_KEY','DAO_SUPABASE_SECRET_KEY',
  'DAO_TEST_CLIENT_EMAIL','DAO_TEST_CLIENT_PASSWORD','DAO_TEST_ARTISAN_EMAIL','DAO_TEST_ARTISAN_PASSWORD',
  'DAO_TEST_DUAL_EMAIL','DAO_TEST_DUAL_PASSWORD','DAO_TEST_OTHER_EMAIL','DAO_TEST_OTHER_PASSWORD',
  'DAO_TEST_PROJECT_ID','DAO_TEST_REQUEST_ID','DAO_TEST_AWARD_ID','DAO_TEST_BID_ITEM_ID',
  'DAO_TEST_BID_VERSION_ID','DAO_TEST_DRAFT_BID_ID','DAO_TEST_SUBMITTED_BID_ID','DAO_TEST_DOCUMENT_ID',
  'DAO_TEST_PUBLICATION_ID','DAO_TEST_TARGETED_ID','DAO_TEST_INVITE_ONLY_ID','DAO_TEST_OBJECT_PATH',
  'DAO_TEST_CONTRACTOR_ID','DAO_TEST_SECOND_BID_ITEM_ID'];

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
  const dual=await login(url,key,process.env.DAO_TEST_DUAL_EMAIL!,process.env.DAO_TEST_DUAL_PASSWORD!);
  const other=await login(url,key,process.env.DAO_TEST_OTHER_EMAIL!,process.env.DAO_TEST_OTHER_PASSWORD!);
  const project=process.env.DAO_TEST_PROJECT_ID!, request=process.env.DAO_TEST_REQUEST_ID!, award=process.env.DAO_TEST_AWARD_ID!, item=process.env.DAO_TEST_BID_ITEM_ID!;
  const draft=process.env.DAO_TEST_DRAFT_BID_ID!, submitted=process.env.DAO_TEST_SUBMITTED_BID_ID!, doc=process.env.DAO_TEST_DOCUMENT_ID!;
  const publication=process.env.DAO_TEST_PUBLICATION_ID!, targeted=process.env.DAO_TEST_TARGETED_ID!, inviteOnly=process.env.DAO_TEST_INVITE_ONLY_ID!;
  assert.equal(await count(client,'bids',draft),0);
  assert.equal(await count(other,'bid_versions',submitted),0);
  assert.equal(await count(client,'bid_versions',submitted),1);
  assert.equal(await count(artisan,'bid_versions',submitted),1);
  assert.equal(await count(dual,'projects',project),1);
  assert.equal(await count(client,'publications',publication),1);
  assert.equal(await count(artisan,'publications',targeted),1);
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
  const params={p_idempotency_key:`integration-${Date.now()}-a`,p_award_id:award,p_project_id:project,p_contractor_id:process.env.DAO_TEST_CONTRACTOR_ID!,p_request_id:request,p_bid_item_id:item,p_agreed_millimes:1000};
  const first=await client.rpc('award_request_atomic',params); assert.ifError(first.error); assert.ok(first.data);
  const replay=await client.rpc('award_request_atomic',params); assert.ifError(replay.error); assert.deepEqual(replay.data,first.data);
  const forbidden=await other.rpc('award_request_atomic',{...params,p_idempotency_key:`integration-${Date.now()}-b`}); assert.ok(forbidden.error);
  const second=await client.rpc('award_request_atomic',{...params,p_idempotency_key:`integration-${Date.now()}-c`,p_bid_item_id:process.env.DAO_TEST_SECOND_BID_ITEM_ID!}); assert.ok(second.error);
  await admin.storage.from('dao-private').remove([objectPath]);
  await admin.from('command_receipts').delete().eq('idempotency_key',params.p_idempotency_key);
});

