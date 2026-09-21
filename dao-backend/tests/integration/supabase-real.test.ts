import { createClient } from '@supabase/supabase-js';
import test from 'node:test';
import assert from 'node:assert/strict';

const required=['DAO_SUPABASE_URL','DAO_SUPABASE_PUBLISHABLE_KEY','DAO_TEST_CLIENT_EMAIL','DAO_TEST_CLIENT_PASSWORD','DAO_TEST_ARTISAN_EMAIL','DAO_TEST_ARTISAN_PASSWORD','DAO_TEST_DUAL_EMAIL','DAO_TEST_DUAL_PASSWORD','DAO_TEST_OTHER_EMAIL','DAO_TEST_OTHER_PASSWORD'];
const missing=required.filter(k=>!process.env[k]);
test('Supabase real integration configuration', async()=>{
  assert.equal(missing.length,0,`Missing required integration variables: ${missing.join(', ')}`);
  const url=process.env.DAO_SUPABASE_URL!; const key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!;
  const client=createClient(url,key);
  for (const [email,password] of [['DAO_TEST_CLIENT_EMAIL','DAO_TEST_CLIENT_PASSWORD'],['DAO_TEST_ARTISAN_EMAIL','DAO_TEST_ARTISAN_PASSWORD'],['DAO_TEST_DUAL_EMAIL','DAO_TEST_DUAL_PASSWORD'],['DAO_TEST_OTHER_EMAIL','DAO_TEST_OTHER_PASSWORD']]) {
    const {data,error}=await client.auth.signInWithPassword({email:process.env[email]!,password:process.env[password]!});
    assert.ifError(error); assert.ok(data.session?.access_token);
  }
  // The remaining assertions are intentionally fixture-driven. Supply IDs from
  // a disposable DEV scenario; no IDs or credentials are committed here.
  const fixtureIds=['DAO_TEST_PROJECT_ID','DAO_TEST_DRAFT_BID_ID','DAO_TEST_SUBMITTED_BID_ID','DAO_TEST_PUBLICATION_ID','DAO_TEST_TARGETED_ID','DAO_TEST_INVITE_ONLY_ID','DAO_TEST_DOCUMENT_ID','DAO_TEST_AWARD_ID','DAO_TEST_REQUEST_ID'];
  const absent=fixtureIds.filter(k=>!process.env[k]);
  assert.equal(absent.length,0,`Missing required fixture variables: ${absent.join(', ')}`);
  const session=(await client.auth.signInWithPassword({email:process.env.DAO_TEST_CLIENT_EMAIL!,password:process.env.DAO_TEST_CLIENT_PASSWORD!})).data.session!;
  const userClient=createClient(url,key,{global:{headers:{Authorization:`Bearer ${session.access_token}`}}});
  const {error:projectError}=await userClient.from('projects').select('id').eq('id',process.env.DAO_TEST_PROJECT_ID!).single();
  assert.ifError(projectError);
  const {data:draft}=await userClient.from('bids').select('id').eq('id',process.env.DAO_TEST_DRAFT_BID_ID!);
  assert.equal(draft?.length ?? 0,0);
});
