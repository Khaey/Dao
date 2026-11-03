import { createClient } from '@supabase/supabase-js';
import { test, expect } from './support/fixtures';

async function token(email:string,password:string) {
  const url=process.env.DAO_SUPABASE_URL;
  const key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key) throw new Error('Disposable Supabase configuration is required');
  const auth=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await auth.auth.signInWithPassword({email,password});
  if(error||!data.session) throw new Error('BTP catalogue test authentication failed');
  return data.session.access_token;
}

test('référentiel BTP réel : API authentifiée, filtrée et sans prix implicite',async({request,e2eClient})=>{
  expect(e2eClient).toBeTruthy();
  const accessToken=await token(e2eClient!.email,e2eClient!.password);
  const response=await request.get('/api/btp/catalog?project_type=renovation&country=TN',{headers:{Authorization:`Bearer ${accessToken}`}});
  expect(response.ok()).toBeTruthy();
  expect(response.headers()['cache-control']).toContain('private');
  const {data}=await response.json();
  expect(data.catalogVersion.code).toBe('TN-2026.1');
  expect(data.units).toHaveLength(7);
  expect(data.rules).toHaveLength(5);
  expect(data.priceSources).toEqual([]);
  const works=data.lots.flatMap((lot:any)=>lot.subLots.flatMap((subLot:any)=>subLot.works));
  expect(works.some((work:any)=>work.code==='btp_work_selective_demolition')).toBeTruthy();
  expect(works.some((work:any)=>work.code==='btp_work_foundations')).toBeFalsy();
});

test('référentiel BTP : JWT et paramètres allowlistés',async({request,e2eClient})=>{
  const anonymous=await request.get('/api/btp/catalog');
  expect(anonymous.status()).toBe(401);
  expect(e2eClient).toBeTruthy();
  const accessToken=await token(e2eClient!.email,e2eClient!.password);
  const invalid=await request.get('/api/btp/catalog?project_type=construction&unexpected=true',{headers:{Authorization:`Bearer ${accessToken}`}});
  expect(invalid.status()).toBe(400);
});
