import test from 'node:test';
import assert from 'node:assert/strict';
import { createDaoApi } from '../src/server/nextHandlers.js';

const services:any = { projects:{create:async(i:any)=>i}, publications:{}, bids:{}, awards:{}, documents:{} };
test('route adapter rejects unauthenticated project creation', async()=>{
  const api=createDaoApi(services, async()=>null);
  const response=await api.createProject(new Request('http://localhost',{method:'POST',body:JSON.stringify({client_id:'attacker',title:'x'}),headers:{'content-type':'application/json'}}));
  assert.equal(response.status,401);
});
test('route adapter does not accept browser ownership fields', async()=>{
  const api=createDaoApi(services, async()=>({id:'session-user'}));
  const response=await api.createProject(new Request('http://localhost',{method:'POST',body:JSON.stringify({client_id:'attacker',name:'x'}),headers:{authorization:'Bearer jwt','content-type':'application/json'}}));
  const body=await response.json();
  assert.equal(response.status,200); assert.equal(body.data.client_id,undefined); assert.notEqual(body.data.client_id,'attacker');
});
test('bid routes never pass a browser contractor id to the service', async()=>{
  const api=createDaoApi({ projects:{}, publications:{}, bids:{ createDraft:async(input:any)=>input, addItem:async(input:any)=>input }, awards:{}, documents:{} } as any, async()=>({id:'session-user'}));
  const response=await api.createBidDraft(new Request('http://localhost',{method:'POST',body:JSON.stringify({publication_id:'pub',contractor_id:'attacker'}),headers:{authorization:'Bearer jwt','content-type':'application/json'}}));
  const body=await response.json();
  assert.equal(response.status,200); assert.deepEqual(body.data,{publication_id:'pub'}); assert.equal(body.data.contractor_id,undefined);
});
test('profile initialization rejects forged internal roles before calling the RPC', async()=>{
  let called=false;
  const api=createDaoApi({ projects:{}, publications:{}, bids:{}, awards:{}, documents:{}, profiles:{initialize:async()=>{called=true;return {};}} } as any, async()=>({id:'signup-user'}));
  for (const account_type of ['dao_admin','dao_reviewer','staff','']) {
    const response=await api.initializeProfile(new Request('http://localhost/api/profile',{method:'POST',body:JSON.stringify({account_type}),headers:{authorization:'Bearer jwt','content-type':'application/json'}}));
    assert.equal(response.status,400);
  }
  const missing=await api.initializeProfile(new Request('http://localhost/api/profile',{method:'POST',body:JSON.stringify({}),headers:{authorization:'Bearer jwt','content-type':'application/json'}}));
  assert.equal(missing.status,400);
  const noBusinessName=await api.initializeProfile(new Request('http://localhost/api/profile',{method:'POST',body:JSON.stringify({account_type:'contractor'}),headers:{authorization:'Bearer jwt','content-type':'application/json'}}));
  assert.equal(noBusinessName.status,400);
  assert.equal(called,false);
});
test('profile initialization forwards only the public client/contractor choice to the secure RPC service', async()=>{
  const calls:any[]=[];
  const api=createDaoApi({ projects:{}, publications:{}, bids:{}, awards:{}, documents:{}, profiles:{initialize:async(input:any)=>{calls.push(input);return input;}} } as any, async()=>({id:'signup-user'}));
  const response=await api.initializeProfile(new Request('http://localhost/api/profile',{method:'POST',body:JSON.stringify({account_type:'contractor',business_name:' Atelier DAO ',user_id:'forged'}),headers:{authorization:'Bearer jwt','content-type':'application/json'}}));
  assert.equal(response.status,200);
  assert.equal(calls[0].account_type,'contractor');
  assert.equal(calls[0].business_name,'Atelier DAO');
  assert.notEqual(calls[0].user_id,'forged');
});

test('P2.1 package/cancellation endpoints require actor identity and preserve SQL denial codes',async()=>{
  const services:any={projects:{},publications:{},bids:{configurePackage:async()=>{throw {code:'42501',message:'denied'};}},awards:{cancel:async()=>{throw {code:'22023',message:'motif obligatoire'};}},documents:{}};
  const anonymous=createDaoApi(services,async()=>null as any);
  const request=()=>new Request('http://localhost/api/action',{method:'POST',body:'{}'});
  assert.equal((await anonymous.cancelAward(request())).status,401);
  assert.equal((await anonymous.configureBidPackage(request())).status,401);
  const authenticated=createDaoApi(services,async()=>({id:'actor'}));
  assert.equal((await authenticated.cancelAward(request())).status,400);
  assert.equal((await authenticated.configureBidPackage(request())).status,403);
});
