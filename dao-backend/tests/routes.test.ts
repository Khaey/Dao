import test from 'node:test';
import assert from 'node:assert/strict';
import { createDaoApi } from '../src/server/nextHandlers.js';

const services:any = { projects:{create:async(i:any)=>i}, publications:{}, bids:{}, awards:{}, documents:{} };
test('route adapter rejects unauthenticated project creation', async()=>{
  const api=createDaoApi(services, async()=>null);
  const response=await api.createProject(new Request('http://localhost',{method:'POST',body:JSON.stringify({client_id:'attacker',title:'x'}),headers:{'content-type':'application/json'}}));
  assert.equal(response.status,401);
});
test('route adapter derives identity from resolved actor', async()=>{
  const api=createDaoApi(services, async()=>({id:'session-user'}));
  const response=await api.createProject(new Request('http://localhost',{method:'POST',body:JSON.stringify({client_id:'attacker',name:'x'}),headers:{authorization:'Bearer jwt','content-type':'application/json'}}));
  const body=await response.json();
  assert.equal(response.status,200); assert.equal(body.data.client_id,'session-user'); assert.notEqual(body.data.client_id,'attacker');
});
test('bid routes never pass a browser contractor id to the service', async()=>{
  const api=createDaoApi({ projects:{}, publications:{}, bids:{ createDraft:async(input:any)=>input, addItem:async(input:any)=>input }, awards:{}, documents:{} } as any, async()=>({id:'session-user'}));
  const response=await api.createBidDraft(new Request('http://localhost',{method:'POST',body:JSON.stringify({publication_id:'pub',contractor_id:'attacker'}),headers:{authorization:'Bearer jwt','content-type':'application/json'}}));
  const body=await response.json();
  assert.equal(response.status,200); assert.deepEqual(body.data,{publication_id:'pub'}); assert.equal(body.data.contractor_id,undefined);
});
