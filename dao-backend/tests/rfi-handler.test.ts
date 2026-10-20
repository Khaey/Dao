import test from 'node:test';import assert from 'node:assert/strict';
import {createRfiHandler} from '../src/server/rfiHandler.js';
import {RfiService} from '../src/services/RfiService.js';

const actor=async()=>({id:'00000000-0000-4000-8000-000000000001'});
test('RFI handler validates, maps and keeps responses private',async()=>{const calls:any[]=[];const db={rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:{items:[]},error:null};}};const docs:any={};const api=createRfiHandler(new RfiService(db),docs,actor);
  const response=await api.create(new Request('http://local/api/rfi',{method:'POST',headers:{authorization:'Bearer x'},body:JSON.stringify({publication_request_id:'00000000-0000-4000-8000-000000000002',body:'  Section câble ?  ',idempotency_key:'12345678'})}));
  assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.deepEqual(calls[0],{name:'create_rfi_question',args:{p_publication_request_id:'00000000-0000-4000-8000-000000000002',p_body:'Section câble ?',p_idempotency_key:'12345678'}});
});
test('RFI handler rejects anonymous, invalid and forbidden commands',async()=>{const docs:any={};const denied=createRfiHandler(new RfiService({rpc:async()=>({data:null,error:{code:'42501'}})}),docs,actor);assert.equal((await denied.create(new Request('http://local',{method:'POST',headers:{authorization:'Bearer x'},body:'{}'}))).status,400);assert.equal((await denied.markRead(new Request('http://local',{method:'POST',headers:{authorization:'Bearer x'}}),'00000000-0000-4000-8000-000000000002')).status,403);const anonymous=createRfiHandler(new RfiService({}),docs,async()=>null);assert.equal((await anonymous.list(new Request('http://local'))).status,401);});
