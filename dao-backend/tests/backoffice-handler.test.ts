import test from 'node:test';
import assert from 'node:assert/strict';
import { createBackofficeHandler } from '../src/server/backofficeHandler.js';
import { ReviewNotificationWorker, reviewMessage } from '../src/services/ReviewNotificationWorker.js';
const config={apiKey:'server-only',from:'D.A.O <team@example.invalid>',publicUrl:'https://dao.example.invalid'};
const request=(body:any)=>new Request('https://dao.example.invalid/api/dao/backoffice',{method:'POST',headers:{authorization:'Bearer actor','content-type':'application/json'},body:JSON.stringify(body)});
test('Backoffice denies anonymous and reviewer Auth administration before secret factory',async()=>{let secrets=0;const factory=()=>{secrets++;throw Error('secret should not be read');};const db={rpc:async()=>({error:{code:'42501',message:'Admin requis'}})};const anonymous=createBackofficeHandler(db,async()=>null,factory);assert.equal((await anonymous(request({action:'invite_staff'}))).status,401);const reviewer=createBackofficeHandler(db,async()=>({id:'reviewer'}),factory);assert.equal((await reviewer(request({action:'invite_staff',input:{email:'user@example.invalid'},idempotency_key:'repeat-safe'}))).status,403);assert.equal(secrets,0);});
test('Backoffice writes keep the actor JWT, ignore forged actor identities, and require valid JSON',async()=>{const calls:any[]=[];const handler=createBackofficeHandler({rpc:async(name:string,args:any)=>{calls.push({name,args});return {data:{ok:true}};}},async()=>({id:'real'}),()=>{throw Error('unexpected privileged client');});assert.equal((await handler(request({action:'claim',input:{project_id:'project',actor_id:'forged'},idempotency_key:'safe-key-001'}))).status,200);assert.deepEqual(calls[0],{name:'backoffice_command',args:{p_action:'claim',p_input:{project_id:'project',actor_id:'forged'},p_key:'safe-key-001'}});const invalid=new Request('https://dao.example.invalid',{method:'POST',body:'bad-json'});assert.equal((await handler(invalid)).status,400);});
test('Staff invitation saga resolves existing Auth identity without duplicate invite or custom password',async()=>{const calls:any[]=[];const db={rpc:async(name:string,args:any)=>{calls.push({name,args});if(args.p_action==='prepare_staff_invitation')return{data:{id:'invitation',email:'known@example.invalid',display_name:'Known',role:'dao_reviewer',status:'pending'}};if(name==='backoffice_read')return{data:{rows:[{id:'existing-auth-user',email:'known@example.invalid'}]}};return{data:{status:'completed'}};}};const handler=createBackofficeHandler(db,async()=>({id:'admin'}),()=>{throw Error('existing user needs no Auth API');});assert.equal((await handler(request({action:'invite_staff',input:{email:'known@example.invalid',display_name:'Known',role:'dao_reviewer'},idempotency_key:'invite-key'}))).status,200);assert.equal(calls[2].args.p_input.user_id,'existing-auth-user');assert.equal(calls[2].args.p_key,'invite-key:complete');});
test('Staff invitation sends Supabase Auth to the dedicated activation URL',async()=>{
  const previous=process.env.DAO_PUBLIC_URL;
  process.env.DAO_PUBLIC_URL='https://dao-dev.logiclab.fr';
  try {
    const calls:any[]=[];
    const db={rpc:async(name:string,args:any)=>{
      calls.push({name,args});
      if(args.p_action==='prepare_staff_invitation')return{data:{id:'invitation',email:'new@example.invalid',display_name:'New Staff',role:'dao_reviewer',status:'pending'}};
      if(name==='backoffice_read')return{data:{rows:[]}};
      return{data:{status:'completed'}};
    }};
    let invited:any;
    const handler=createBackofficeHandler(db,async()=>({id:'admin'}),()=>({auth:{admin:{inviteUserByEmail:async(email:string,options:any)=>{invited={email,options};return{data:{user:{id:'new-auth-user'}},error:null};}}}}));
    const response=await handler(request({action:'invite_staff',input:{email:'new@example.invalid',display_name:'New Staff',role:'dao_reviewer'},idempotency_key:'invite-new'}));
    assert.equal(response.status,200);
    assert.deepEqual(invited,{email:'new@example.invalid',options:{data:{display_name:'New Staff'},redirectTo:'https://dao-dev.logiclab.fr/auth/activate-staff'}});
    assert.equal(calls.at(-1).args.p_input.user_id,'new-auth-user');
  } finally {
    if(previous===undefined)delete process.env.DAO_PUBLIC_URL;else process.env.DAO_PUBLIC_URL=previous;
  }
});
const notice:any={id:'event-uuid',project_id:'project',kind:'review_rejected',payload:{title:'<script>unsafe</script>',reason:'Change the scope'},delivery_email:'client@example.invalid',lease_token:'lease-uuid'};
test('Transactional review email escapes input, includes reason/action, and never includes competitors',()=>{const result=reviewMessage(notice,config);assert.ok(result.html.includes('&lt;script&gt;'));assert.ok(!result.html.includes('<script>'));assert.ok(result.text.includes('Change the scope'));assert.ok(result.text.includes('https://dao.example.invalid/app/projects/project'));const professional=reviewMessage({...notice,kind:'lot_withdrawn_professional',payload:{lot:'Lot A'}},config);assert.ok(professional.text.includes('conservée'));assert.ok(professional.text.includes('/app/artisan'));});
test('Resend failure records delivery error after business commit; retry freezes payload/key',async()=>{const calls:any[]=[];let prepared:any;const db={rpc:async(name:string,args:any)=>{calls.push({name,args});if(name==='claim_notification_outbox')return{data:[notice]};if(name==='prepare_notification_delivery'){prepared??=args.p_message;return{data:prepared};}return{data:true};}};const sent:any[]=[];let fail=true;const sender:any=async(url:any,input:any)=>{sent.push({url,input});return new Response('',{status:fail?503:200});};const worker=new ReviewNotificationWorker(db,()=>config,sender);await worker.drain();assert.equal(calls.at(-1).args.p_success,false);assert.equal(calls.at(-1).args.p_code,'RESEND_HTTP_503');fail=false;await worker.drain();assert.equal(calls.at(-1).args.p_success,true);assert.equal(sent[0].input.headers['Idempotency-Key'],sent[1].input.headers['Idempotency-Key']);assert.equal(sent[0].input.body,sent[1].input.body);assert.ok(calls.every(c=>!['backoffice_command','review_project'].includes(c.name)));});
test('Unconfigured email does not consume retries; invalid recipient never reaches provider',async()=>{let calls=0;const db={rpc:async(name:string)=>{calls++;return name==='claim_notification_outbox'?{data:[{...notice,delivery_email:null}]}:{data:true};}};await assert.rejects(new ReviewNotificationWorker(db,()=>{throw Error('missing configuration');}).drain());assert.equal(calls,0);let sent=false;await new ReviewNotificationWorker(db,()=>config,(async()=>{sent=true;throw Error('unexpected');}) as any).drain();assert.equal(sent,false);});

