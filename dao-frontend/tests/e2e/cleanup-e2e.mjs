import { existsSync, readFileSync, unlinkSync } from 'node:fs';
const url=process.env.DAO_SUPABASE_URL;const secret=process.env.DAO_SUPABASE_SECRET_KEY;const stateFile=process.env.DAO_E2E_STATE_FILE||'/tmp/dao-e2e-state.json';
if(!url||!secret) process.exit(0);
const headers={apikey:secret,Authorization:`Bearer ${secret}`,'Content-Type':'application/json'};
async function api(path,options={}){try{await fetch(url+path,{...options,headers:{...headers,...(options.headers||{})}})}catch{}}
if(!existsSync(stateFile)) process.exit(0);
const state=JSON.parse(readFileSync(stateFile,'utf8'));
for(const id of [...new Set(state.publications||[])]){for(const table of ['publication_requests','publication_recipients'])await api(`/rest/v1/${table}?publication_id=eq.${id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});await api(`/rest/v1/publications?id=eq.${id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});}
for(const id of [...new Set(state.projects||[])]){for(const table of ['project_version_requests','project_request_versions','project_requests','project_versions'])await api(`/rest/v1/${table}?project_id=eq.${id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});await api(`/rest/v1/projects?id=eq.${id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});}
for(const user of state.users||[]){await api(`/rest/v1/user_roles?user_id=eq.${user.id}`,{method:'DELETE',headers:{Prefer:'return=minimal'}});await api(`/auth/v1/admin/users/${user.id}`,{method:'DELETE'});}
try{unlinkSync(stateFile)}catch{}
