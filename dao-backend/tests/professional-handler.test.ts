import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createProfessionalHandler,inspectProfessionalBytes } from '../src/server/professionalHandler.js';
const png=Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
const request=(action:string,input:any)=>new Request('https://dao.invalid/api/professionals',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({action,input})});
test('PRO inspector rejects spoofed formats, size mismatches, active PDFs and SVG',()=>{
  assert.match(inspectProfessionalBytes(png,'image/png',png.length),/^[a-f0-9]{64}$/);
  for(const [bytes,mime,size] of [[png,'image/jpeg',png.length],[png,'image/png',1],[Buffer.from('%PDF-1.7 /JavaScript()'),'application/pdf',26],[Buffer.from('<svg/>'),'image/svg+xml',6]])
    assert.throws(()=>inspectProfessionalBytes(bytes as Buffer,mime as string,size as number));
});
test('PRO unauthenticated/unauthorized downloads never instantiate privileged Storage',async()=>{
  let calls=0; const admin=()=>{calls++;throw Error('Unexpected Storage');};
  const unauth=createProfessionalHandler({},async()=>null,admin);
  assert.equal((await unauth(request('download',{kind:'professional',id:'private'}))).status,401);
  const denied=createProfessionalHandler({rpc:async()=>({error:{code:'42501',message:'Privé'}})},async()=>({id:'pro'}),admin);
  assert.equal((await denied(request('download',{kind:'professional',id:'private'}))).status,403);assert.equal(calls,0);
});
test('PRO mediated download never exposes signed read URL and rechecks revoked access',async()=>{
  let revoked=false; const file={id:'photo',object_path:'portfolio/project/photo',mime_type:'image/png',original_name:'photo.png',size_bytes:png.length,status:'approved',revision:2,content_sha256:createHash('sha256').update(png).digest('hex')};
  const db={rpc:async()=>revoked?{error:{code:'42501',message:'Retiré'}}:{data:file}};
  delete (file as any).object_path;
  let pathLookups=0;
  const admin=()=>({from:()=>({select:()=>({eq:()=>({single:async()=>{pathLookups++;return {data:{object_path:'portfolio/project/photo'}};}})})}),storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://storage.invalid/private-capability'}})})}});
  const handler=createProfessionalHandler(db,async()=>({id:'client'}),admin,async()=>new Response(png));
  const response=await handler(request('download',{kind:'portfolio',id:'photo'}));
  assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(Buffer.from(await response.arrayBuffer()),png);
  assert.equal(pathLookups,1);revoked=true; assert.equal((await handler(request('download',{kind:'portfolio',id:'photo'}))).status,403);assert.equal(pathLookups,1);
  revoked=false;const racing=createProfessionalHandler(db,async()=>({id:'client'}),admin,async()=>{revoked=true;return new Response(png);});
  assert.equal((await racing(request('download',{kind:'portfolio',id:'photo'}))).status,403);
});
test('PRO finalize computes hash on the server; a tampered approved object is refused',async()=>{
  let confirmation:any;const file={object_path:'professional/pro/logo',mime_type:'image/png',size_bytes:png.length,status:'quarantined'};
  const db={rpc:async()=>({data:file})};
  const admin=()=>({storage:{from:()=>({createSignedUrl:async()=>({data:{signedUrl:'https://storage.invalid/file'}})})},rpc:async(name:string,input:any)=>{confirmation={name,input};return {};}});
  const handler=createProfessionalHandler(db,async()=>({id:'owner'}),admin,async()=>new Response(png));
  assert.equal((await handler(request('finalize_upload',{kind:'professional',id:'logo',sha256:'forged'}))).status,200);
  assert.equal(confirmation.input.p_actor,'owner');assert.equal(confirmation.input.p_sha256,createHash('sha256').update(png).digest('hex'));
  Object.assign(file,{status:'approved',content_sha256:'a'.repeat(64),revision:2});
  assert.equal((await handler(request('download',{kind:'professional',id:'logo'}))).status,403);
});
