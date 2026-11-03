import test from 'node:test';
import assert from 'node:assert/strict';
import { createBtpReferenceHandler } from '../src/server/btpReferenceHandler.js';
import { BtpReferenceService } from '../src/services/BtpReferenceService.js';

const actor={id:'54110000-0000-4000-8000-00000000a001'};
const snapshot={catalogVersion:{id:'v',code:'TN-2026.1',countryCode:'TN'},units:[],lots:[],rules:[],dependencies:[],measurementTemplates:[],priceSources:[]};

test('BTP catalogue API requires JWT and exposes GET through an allowlisted filter only',async()=>{
  let calls:any[]=[];
  const service={snapshot:async(type:string|null,country:string)=>{calls.push({type,country});return snapshot;}} as any;
  const anonymous=createBtpReferenceHandler(service,async()=>null);
  assert.equal((await anonymous.catalog(new Request('https://dao.test/api/btp/catalog'))).status,401);
  const handler=createBtpReferenceHandler(service,async()=>actor);
  assert.equal((await handler.catalog(new Request('https://dao.test/api/btp/catalog?project_type=extension&country=tn',{headers:{authorization:'Bearer test'}}))).status,200);
  assert.deepEqual(calls,[{type:'extension',country:'TN'}]);
  assert.equal((await handler.catalog(new Request('https://dao.test/api/btp/catalog?admin=true',{headers:{authorization:'Bearer test'}}))).status,400);
  assert.equal((await handler.catalog(new Request('https://dao.test/api/btp/catalog?country=TN&country=FR',{headers:{authorization:'Bearer test'}}))).status,400);
});

test('BTP reference service validates filters and sends no actor or free SQL input',async()=>{
  const calls:any[]=[];const db={rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:snapshot,error:null};}};
  const service=new BtpReferenceService(db);
  await assert.rejects(()=>service.snapshot('invalid','TN'),/Type de projet/);
  await assert.rejects(()=>service.snapshot(null,'TUN'),/Code pays/);
  await service.snapshot('renovation','TN');
  assert.deepEqual(calls,[{name:'btp_catalog_snapshot',args:{p_project_type:'renovation',p_country_code:'TN'}}]);
});
