import test from 'node:test';
import assert from 'node:assert/strict';
import { createBtpReferenceHandler } from '../src/server/btpReferenceHandler.js';
import { BtpReferenceService } from '../src/services/BtpReferenceService.js';
import { guidedFixture } from './fixtures/btp-guided-fixture.js';

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

test('#577 guided catalogue: JWT, server-side published_active attestation and full snapshot only',async()=>{
  const calls:any[]=[];
  const fixture=guidedFixture();
  const service={snapshot:async(type:string|null,country:string)=>{calls.push({type,country});return fixture;}} as any;
  assert.equal((await createBtpReferenceHandler(service,async()=>null).guided(new Request('https://dao.test/api/btp/catalog/guided'))).status,401);
  const handler=createBtpReferenceHandler(service,async()=>actor);
  const auth={headers:{authorization:'Bearer test'}};
  const ok=await handler.guided(new Request('https://dao.test/api/btp/catalog/guided?country=tn',auth));
  assert.equal(ok.status,200);
  const body=await ok.json();
  assert.equal(body.data.contractVersion,1); assert.equal(body.data.state,'available'); assert.equal(body.data.catalogVersion.code,fixture.catalogVersion!.code);
  assert.ok(body.data.groups.flatMap((g:any)=>g.subLots.flatMap((s:any)=>s.works)).every((w:any)=>w.lifecycle==='active'&&w.catalogVersion.id===fixture.catalogVersion!.id));
  assert.deepEqual(calls,[{type:null,country:'TN'}]); // jamais de filtre SQL par nature avant le contrat #578
  for(const forged of ['?kind=published_active','?project_type=renovation','?country=TN&country=FR'])
    assert.equal((await handler.guided(new Request('https://dao.test/api/btp/catalog/guided'+forged,auth))).status,400);
  const broken=createBtpReferenceHandler({snapshot:async()=>({...fixture,units:'x'})} as any,async()=>actor);
  assert.equal((await broken.guided(new Request('https://dao.test/api/btp/catalog/guided',auth))).status,503);
});
