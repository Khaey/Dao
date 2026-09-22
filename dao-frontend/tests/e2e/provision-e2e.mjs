import { randomBytes } from 'node:crypto';
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const url=process.env.DAO_SUPABASE_URL;
const secret=process.env.DAO_SUPABASE_SECRET_KEY;
const runId=process.env.GITHUB_RUN_ID||String(Date.now());
const stateFile=process.env.DAO_E2E_STATE_FILE||'/tmp/dao-e2e-state.json';
if(!url||!secret) throw new Error('E2E provisioning configuration is missing');
const headers={apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json'};
async function api(path,options={}){const response=await fetch(url+path,{...options,headers:{...headers,...(options.headers||{})}});if(!response.ok) throw new Error('E2E provisioning request failed');return response.status===204?null:response.json();}
function password(){return `E2e-${randomBytes(18).toString('base64url')}-A9!`;}
function saveState(state){writeFileSync(stateFile,JSON.stringify(state),'utf8');chmodSync(stateFile,0o600);}
const state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):{users:[],projects:[]};
async function create(email,role){const pwd=password();const user=await api('/auth/v1/admin/users',{method:'POST',body:JSON.stringify({email,password:pwd,email_confirm:true})});await api('/rest/v1/user_roles',{method:'POST',headers:{Prefer:'return=minimal'},body:JSON.stringify([{user_id:user.id,role}])});process.stdout.write(`::add-mask::${pwd}\n::add-mask::${email}\n`);state.users.push({id:user.id});saveState(state);appendFileSync(process.env.GITHUB_ENV,`PLAYWRIGHT_${role==='client'?'CLIENT':'REVIEWER'}_EMAIL=${email}\nPLAYWRIGHT_${role==='client'?'CLIENT':'REVIEWER'}_PASSWORD=${pwd}\n`);}
await create(`dao-e2e-client-${runId}@logiclab.invalid`,'client');
await create(`dao-e2e-reviewer-${runId}@logiclab.invalid`,'dao_reviewer');
