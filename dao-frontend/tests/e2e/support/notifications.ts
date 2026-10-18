import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import type { TestInfo } from '@playwright/test';
import type { E2EUser } from './fixtures';
import { recordE2EValue } from './state';

/** Per-scenario identities: no notification depends on another test's activity. */
export async function notificationActor(info: TestInfo, role: 'client'|'contractor'='client') {
  const url=process.env.DAO_SUPABASE_URL!,key=process.env.DAO_SUPABASE_PUBLISHABLE_KEY!,secret=process.env.DAO_SUPABASE_SECRET_KEY!;
  if(url!=='http://127.0.0.1:54321'||!key||!secret)throw Error('Notifications E2E require disposable local Supabase');
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(url,secret,options);
  const email=`notice-${info.project.name}-${info.workerIndex}-${randomUUID()}@example.invalid`,password='N!'+randomUUID();
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw Error('Notification fixture Auth failed');
  const user:E2EUser={id:created.data.user!.id,email,password};recordE2EValue(info,'users',user.id);
  const db=createClient(url,key,options);const signed=await db.auth.signInWithPassword({email,password});if(signed.error)throw Error('Notification fixture login failed');
  const initialized=await db.rpc('initialize_my_account',{p_display_name:'Participant synthétique',p_phone_e164:null,p_account_type:role,p_business_name:role==='contractor'?'Atelier synthétique':null});
  if(initialized.error)throw Error('Notification fixture initialization failed');
  return {user,db,admin};
}
