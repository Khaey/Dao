import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectService } from '../src/services/ProjectService.js';
import { DocumentService } from '../src/services/DocumentService.js';
import { createDaoApi } from '../src/server/nextHandlers.js';

function request(input:unknown) {
  return new Request('http://localhost/api/projects',{method:'POST',body:JSON.stringify(input),headers:{'content-type':'application/json',authorization:'Bearer fixture'}});
}
test('collaboration API mutations require an authenticated actor',async()=> {
  let calls=0;
  const db={rpc:async()=>{calls++;return {data:null,error:null};}};
  const api=createDaoApi({projects:new ProjectService(db),documents:new DocumentService(db,{})} as any,async()=>null);
  for(const method of ['issueProjectInvitation','respondProjectInvitation','revokeProjectInvitation','updateProjectMember','updateProjectTracking','assignProjectMember','shareProjectDocument'] as const) {
    const response=await api[method](request({token:'fixture'}));assert.equal(response.status,401);
  }
  assert.equal(calls,0);
});
test('internal and forged invitation roles never reach the RPC',async()=> {
  let calls=0;
  const projects=new ProjectService({rpc:async()=>{calls++;return {data:null,error:null};}});
  const api=createDaoApi({projects} as any,async()=>({id:'authenticated-client'}));
  for(const expected_role of ['dao_admin','dao_reviewer','internal',null]) {
    const response=await api.issueProjectInvitation(request({project_id:'project',expected_role}));assert.equal(response.status,400);
  }
  assert.equal(calls,0);
});
test('invitation response cannot override project, expected role or actor',async()=> {
  const calls:any[]=[];
  const projects=new ProjectService({rpc:async(name:string,input:any)=>{calls.push({name,input});return {data:'project',error:null};}});
  await projects.respondInvitation({token:'opaque-fixture',accept:true,expected_role:'dao_admin',client_id:'forged',project_id:'other',user_id:'forged'});
  assert.deepEqual(calls,[{name:'respond_project_invitation',input:{p_token:'opaque-fixture',p_accept:true}}]);
  await assert.rejects(projects.respondInvitation({token:'opaque-fixture',accept:'true'}),e=>(e as any).code==='BAD_REQUEST');
});
test('collaborative creation never forwards browser client or initiator identities',async()=> {
  let call:any;
  const projects=new ProjectService({rpc:async(name:string,input:any)=>{call={name,input};return {data:{},error:null};}});
  const api=createDaoApi({projects} as any,async()=>({id:'authenticated-contractor'}));
  const response=await api.createProject(request({project_origin:'contractor_existing_client',title:'Chantier',description:'Description',governorate_id:'territory',client_id:'forged',initiator_id:'forged',role:'dao_admin'}));
  assert.equal(response.status,200);assert.equal(call.name,'create_collaborative_project');
  assert.equal('p_client_id' in call.input,false);assert.equal('p_initiator_id' in call.input,false);assert.equal('role' in call.input,false);
  assert.equal(call.input.p_origin,'contractor_existing_client');
});
test('legacy marketplace creation preserves the existing RPC contract',async()=> {
  let call:any;
  const projects=new ProjectService({rpc:async(name:string,input:any)=>{call={name,input};return {data:{},error:null};}});
  await projects.create({project_origin:'client_marketplace',governorate_id:'territory'});
  assert.equal(call.name,'create_project_draft');assert.equal(call.input.p_governorate_id,'territory');
  await assert.rejects(projects.create({project_origin:'internal'}),e=>(e as any).code==='BAD_REQUEST');
});
test('document sharing cannot become public or bypass the controlled RPC',async()=> {
  let calls=0;
  const documents=new DocumentService({rpc:async()=>{calls++;return {data:null,error:null};}},{});
  await assert.rejects(documents.setProjectSharing('document','public'),e=>(e as any).code==='BAD_REQUEST');
  await assert.rejects(documents.signedProjectUpload({projectId:'project',originalName:'plan.pdf',mimeType:'application/pdf',sizeBytes:4,shareScope:'public'}),e=>(e as any).code==='BAD_REQUEST');
  assert.equal(calls,0);
});
test('invalid RPC arguments produce a client validation response',async()=> {
  const projects=new ProjectService({rpc:async()=>({data:null,error:{code:'22023',message:'invalid invitation'}})});
  const api=createDaoApi({projects} as any,async()=>({id:'authenticated-client'}));
  const response=await api.respondProjectInvitation(request({token:'fixture',accept:true}));assert.equal(response.status,400);
});
