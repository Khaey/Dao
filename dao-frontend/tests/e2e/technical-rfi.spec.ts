import type { Page,Route } from '@playwright/test';
import {test,expect} from './support/fixtures';
import {login} from './support/flow';

const questionId='10000000-0000-4000-8000-000000000001';
const lotId='10000000-0000-4000-8000-000000000002';
const now='2026-10-20T10:00:00.000Z';
function question(owner=false){return {id:questionId,created_at:now,project_id:'10000000-0000-4000-8000-000000000003',publication_id:'10000000-0000-4000-8000-000000000004',publication_request_id:lotId,request_id:'10000000-0000-4000-8000-000000000005',project_title:'Rénovation maison',lot_title:'Électricité',body:'Quelle section de câble prévoir ?',status:'published',mine:!owner,owner,author_label:owner?'Artisan test':'Votre question',unread:false,clarifications:[{id:'10000000-0000-4000-8000-000000000006',version_no:1,body:'Prévoir une section de 6 mm².',impacts_scope:true,published_at:now}],documents:[]};}
async function mockRfi(page:Page,owner=false){
 let row=question(owner);const commands:any[]=[];
 await page.route('**/api/rfi**',async(route:Route)=>{const url=new URL(route.request().url());const method=route.request().method();const body=method==='POST'?route.request().postDataJSON():null;commands.push({path:url.pathname,method,body});const ok=(data:unknown)=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data})});
  if(url.pathname==='/api/rfi'&&method==='GET')return ok({items:[row],has_more:false,unread:0});
  if(url.pathname.endsWith('/read'))return ok({acknowledged:true});
  if(url.pathname.endsWith('/clarifications')){row={...row,clarifications:[...row.clarifications,{id:'10000000-0000-4000-8000-000000000007',version_no:2,body:body.body,impacts_scope:body.impacts_scope,published_at:now}]};return ok(row);}
  if(url.pathname==='/api/rfi'&&method==='POST'){row={...question(false),body:body.body,clarifications:[],status:'new'};return ok(row);}
  return route.fulfill({status:404,json:{error:'not found'}});
 });return commands;
}

test('Questions techniques : onglet clavier, historique officiel et correction Client',async({page,e2eClient})=>{
 test.skip(!e2eClient,'E2E Supabase credentials are not available');await login(page,e2eClient!);const commands=await mockRfi(page,true);
 await page.goto(`/app/messages?onglet=rfi&question=${questionId}`);
 await expect(page.getByRole('tab',{name:'Questions techniques'})).toHaveAttribute('aria-selected','true');
 await expect(page.getByText('Prévoir une section de 6 mm².',{exact:true})).toBeVisible();
 await expect(page.getByText(/Impact possible sur le devis/)).toBeVisible();
 await page.getByLabel('Publier une clarification officielle').fill('Correction officielle : prévoir 10 mm².');
 await page.getByRole('checkbox',{name:/modifier le périmètre/}).check();
 await page.getByRole('button',{name:/Publier pour tous/}).click();
 await expect(page.getByText('Correction officielle : prévoir 10 mm².',{exact:true})).toBeVisible();
 expect(commands.find(command=>command.path.endsWith('/clarifications'))?.body).toMatchObject({body:'Correction officielle : prévoir 10 mm².',impacts_scope:true});
 await page.getByRole('tab',{name:'Questions techniques'}).focus();await page.keyboard.press('Home');await expect(page.getByRole('tab',{name:'Conversations'})).toBeFocused();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBe(0);
});

test('Questions techniques : lien lot vers formulaire artisan',async({page,e2eArtisan})=>{
 test.skip(!e2eArtisan,'E2E Supabase credentials are not available');await login(page,e2eArtisan!);const commands=await mockRfi(page,false);
 await page.goto(`/app/messages?onglet=rfi&lot=${lotId}&nouvelle=1`);
 await page.getByLabel('Question technique').fill('Le plan électrique est-il contractuel ?');
 await page.getByRole('button',{name:'Envoyer au Client'}).click();
 await expect(page.getByText('Le plan électrique est-il contractuel ?',{exact:true})).toBeVisible();
 expect(commands.find(command=>command.path==='/api/rfi'&&command.method==='POST')?.body.publication_request_id).toBe(lotId);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBe(0);
});
