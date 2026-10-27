import { randomUUID } from 'node:crypto';
import { test,expect } from './support/fixtures';
import { login } from './support/flow';
import { createCollaborative,signOut } from './support/collaboration';
import { notificationActor } from './support/notifications';
import { recordE2EValue } from './support/state';

test('Notifications : invitation réelle, acceptation, lecture et nouveau message privé',async({page},info)=>{
  const client=await notificationActor(info),pro=await notificationActor(info,'contractor');
  await login(page,client.user);await page.getByRole('link',{name:'Ouvrir mes notifications',exact:true}).click();
  await expect(page).toHaveURL(/\/app\/notifications$/);
  await expect(page.getByRole('heading',{name:'Aucune notification pour le moment'})).toBeVisible();
  await expect(page.getByLabel('0 notifications non lues',{exact:true})).toBeVisible();
  const project=await createCollaborative(page,info,false,pro.user.email);await signOut(page);
  await login(page,pro.user);await page.goto('/app/notifications');
  await expect(page.getByRole('heading',{name:'Invitation reçue',exact:true})).toBeVisible();
  await expect(page.getByLabel('1 notifications non lues',{exact:true})).toBeVisible();
  // This event is an internal invitation, not Support: the global bell must include it.
  await expect(page.getByTestId('support-bell-count')).toHaveText('1');
  await expect(page.getByRole('list',{name:'Notifications personnelles'})).not.toContainText(project.title);
  await page.getByRole('link',{name:'Consulter : Invitation reçue'}).click();await expect(page).toHaveURL(/\/app\/invitations$/);
  await page.getByRole('button',{name:'Accepter',exact:true}).click();await expect(page).toHaveURL(new RegExp('/app/projects/'+project.projectId+'$'));
  await page.goto('/app/notifications');await expect(page.getByRole('heading',{name:'Aucune notification pour le moment'})).toBeVisible();
  await signOut(page);await login(page,client.user);await page.goto('/app/notifications');
  await expect(page.getByRole('heading',{name:'Invitation acceptée',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Marquer comme lue : Invitation acceptée'}).click();
  await expect(page.getByLabel('0 notifications non lues',{exact:true})).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Notification marquée comme lue.');
  await page.getByRole('button',{name:'Non lues',exact:true}).click();await expect(page.getByRole('heading',{name:'Vous êtes à jour'})).toBeVisible();
  await page.getByRole('button',{name:'Toutes',exact:true}).click();await page.getByRole('link',{name:'Consulter : Invitation acceptée'}).click();
  await expect(page).toHaveURL(new RegExp('/app/projects/'+project.projectId+'$'));
  await page.getByRole('button',{name:/Écrire à/}).click();await page.getByLabel('Votre message').fill('Texte privé jamais exposé dans les notifications');
  await page.getByRole('button',{name:'Envoyer le message',exact:true}).click();await expect(page.getByText('Texte privé jamais exposé dans les notifications',{exact:true})).toBeVisible();
  await signOut(page);await login(page,pro.user);await page.goto('/app/notifications');
  await expect(page.getByRole('heading',{name:'Nouveau message',exact:true})).toBeVisible();
  await expect(page.getByRole('list',{name:'Notifications personnelles'})).not.toContainText('Texte privé');
  await page.getByRole('link',{name:'Consulter : Nouveau message'}).click();await expect(page).toHaveURL(/\/app\/messages\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Texte privé jamais exposé dans les notifications',{exact:true})).toBeVisible();
  await page.goto('/app/notifications');await expect(page.getByLabel('0 notifications non lues',{exact:true})).toBeVisible();
});

const at='2026-10-18T00:00:00.123456Z';
function item(id=randomUUID(),read=false){return {id,kind:'review_rejected',title:'Dossier à corriger',created_at:at,read_at:read?at:null,href:'/app/projects/'+id+'/review',action_required:false,expires_at:null};}

test('Notifications #522 : Consulter acquitte avant navigation, sauf si le serveur refuse',async({page},info)=>{
  const {user}=await notificationActor(info);
  await login(page,user);
  const row={...item(),kind:'invitation_received',title:'Invitation reçue',href:'/app/invitations'};
  let marked=false, fail=false, patches=0;
  await page.route('**/api/notifications*',async route=>{
    const request=route.request();
    if(request.method()==='PATCH'){
      patches++;
      if(fail){await route.abort('failed');return;}
      expect(JSON.parse(request.postData()||'{}')).toEqual({id:row.id});
      marked=true;
      await route.fulfill({json:{data:{acknowledged:true}}});
      return;
    }
    const q=new URL(request.url()).searchParams;
    const unreadCount=marked?0:1;
    await route.fulfill({json:{data:{workspace:'client',rows:q.get('limit')==='1'?[]:[{...row,read_at:marked?at:null}],
      unread_count:unreadCount,next_cursor:null}}});
  });
  await page.goto('/app/notifications');
  await expect(page.getByLabel('1 notifications non lues',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Consulter : Invitation reçue'}).click();
  await expect.poll(()=>page.url()).toContain('/app/invitations');
  await page.goto('/app/notifications');
  await expect(page.getByLabel('0 notifications non lues',{exact:true})).toBeVisible();
  await expect(page.getByRole('list',{name:'Notifications personnelles'})).toContainText('Lue');
  expect(patches).toBe(1);

  // Failure must not fake a read, but consultation must remain possible.
  fail=true;marked=false;
  await page.reload();
  await expect(page.getByLabel('1 notifications non lues',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Consulter : Invitation reçue'}).click();
  await expect.poll(()=>page.url()).toContain('/app/invitations');
  await page.goto('/app/notifications');
  await expect(page.getByLabel('1 notifications non lues',{exact:true})).toBeVisible();
  expect(patches).toBe(2);
});

test('Notifications : erreur réseau, retry et échec de marquage sans faux succès',async({page},info)=>{
  const {user}=await notificationActor(info);await login(page,user);
  const row=item();let failGet=true,failMark=true,read=false;
  await page.route('**/api/notifications*',async route=>{
    if(route.request().method()==='PATCH'){
      if(failMark){await route.abort('failed');return;}read=true;await route.fulfill({json:{data:{acknowledged:true}}});return;
    }
    // The global bell asks for a count using limit=1. Do not consume the
    // list-page's deliberate first network failure with that separate request.
    if(new URL(route.request().url()).searchParams.get('limit')==='1'){
      await route.fulfill({json:{data:{rows:[],workspace:'client',unread_count:0,next_cursor:null}}});return;
    }
    if(failGet){failGet=false;await route.abort('failed');return;}
    await route.fulfill({json:{data:{rows:[{...row,read_at:read?at:null}],workspace:'client',unread_count:read?0:1,next_cursor:null}}});
  });
  await page.goto('/app/notifications');await expect(page.locator('section[aria-labelledby="notifications-title"]').getByRole('alert')).toContainText('Impossible de charger vos notifications');
  await expect(page.getByLabel('0 notifications non lues',{exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Réessayer',exact:true}).click();await expect(page.getByRole('heading',{name:'Dossier à corriger',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Marquer comme lue : Dossier à corriger'}).click();await expect(page.locator('section[aria-labelledby="notifications-title"]').getByRole('alert')).toContainText('Lecture non enregistrée');
  await expect(page.getByLabel('1 notifications non lues',{exact:true})).toBeVisible();
  await expect(page.getByRole('status')).not.toContainText('Notification marquée comme lue.');
  failMark=false;await page.getByRole('button',{name:'Marquer comme lue : Dossier à corriger'}).click();await expect(page.getByLabel('0 notifications non lues',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Marquer comme lue : Dossier à corriger'})).toHaveCount(0);
});

test('Notifications : pagination, filtre, sécurité des liens, clavier et 375/390/1440',async({page},info)=>{
  const {user}=await notificationActor(info);await login(page,user);
  const rows=Array.from({length:21},()=>item(randomUUID(),true));const cursor=at+'~'+rows[19].id;
  let corrupt=false;
  await page.route('**/api/notifications*',async route=>{
    const q=new URL(route.request().url()).searchParams;
    if(corrupt){await route.fulfill({json:{data:{rows:[{...rows[0],href:'https://evil.invalid/private',title:'PRIVATE'}],workspace:'client',unread_count:1,next_cursor:null}}});return;}
    const unread=q.get('unread')==='true',more=q.get('cursor');
    if(more)expect(more).toBe(cursor);
    await route.fulfill({json:{data:{rows:unread?[]:more?rows.slice(20):rows.slice(0,20),workspace:'client',unread_count:0,next_cursor:unread||more?null:cursor}}});
  });
  await page.goto('/app/notifications');await expect(page.getByRole('list',{name:'Notifications personnelles'}).getByRole('listitem')).toHaveCount(20);
  const more=page.getByRole('button',{name:'Charger plus',exact:true});await more.focus();await page.keyboard.press('Enter');
  await expect(page.getByRole('list',{name:'Notifications personnelles'}).getByRole('listitem')).toHaveCount(21);await expect(more).toHaveCount(0);
  await page.getByRole('button',{name:'Non lues',exact:true}).click();await expect(page.getByRole('heading',{name:'Vous êtes à jour'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Non lues',exact:true})).toHaveAttribute('aria-pressed','true');
  await page.getByRole('button',{name:'Toutes',exact:true}).click();
  await expect(page.getByRole('list',{name:'Notifications personnelles'}).getByRole('listitem')).toHaveCount(20);
  if(info.project.name==='mobile')await page.setViewportSize({width:375,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBe(0);
  for(const button of await page.locator('section[aria-labelledby="notifications-title"]').getByRole('button').all()){
    const box=await button.boundingBox();expect(box?.height).toBeGreaterThanOrEqual(44);
  }
  const link=page.getByRole('link',{name:'Consulter : Dossier à corriger'}).first();await link.focus();await expect(link).toBeFocused();
  expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  corrupt=true;await page.getByRole('button',{name:'Actualiser les notifications'}).click();await expect(page.locator('section[aria-labelledby="notifications-title"]').getByRole('alert')).toBeVisible();
  await expect(page.locator('a[href^="https://evil.invalid"]')).toHaveCount(0);await expect(page.getByText('PRIVATE',{exact:true})).toHaveCount(0);
});

test('Notifications : compte suspendu et déconnexion effacent les données affichées',async({page},info)=>{
  const actor=await notificationActor(info),pro=await notificationActor(info,'contractor'),operator=await notificationActor(info,'dao_admin');
  const gov=await actor.admin.from('governorates').select('id').eq('code','E2E_TEST').single();expect(gov.error).toBeNull();
  const project=await pro.db.rpc('create_collaborative_project',{p_origin:'contractor_existing_client',p_title:'Invitation synthétique',p_description:'',
    p_governorate_id:gov.data!.id,p_delegation_id:null,p_locality_id:null,p_stage:'not_started',p_payment_status:'not_set'});expect(project.error).toBeNull();
  recordE2EValue(info,'projects',project.data.id);
  const invitation=await pro.db.rpc('issue_project_invitation',{p_project_id:project.data.id,p_expected_role:'client',p_recipient_email:actor.user.email,
    p_recipient_name:null,p_principal_request_id:null,p_can_view_private_details:false});expect(invitation.error).toBeNull();
  await login(page,actor.user);await page.goto('/app/notifications');await expect(page.getByRole('heading',{name:'Invitation reçue',exact:true})).toBeVisible();
  expect((await operator.db.rpc('backoffice_command',{p_action:'account',p_input:{user_id:actor.user.id,status:'suspended',reason:'Synthetic S1 suspension'},p_key:randomUUID()})).error).toBeNull();
  await page.getByRole('button',{name:'Actualiser les notifications'}).click();await expect(page.locator('section[aria-labelledby="notifications-title"]').getByRole('alert')).toContainText('Votre compte ne permet pas');
  await expect(page.getByRole('list',{name:'Notifications personnelles'})).toHaveCount(0);
  await signOut(page);await expect(page.getByRole('heading',{name:'Mes notifications',exact:true})).toHaveCount(0);
  await page.goto('/app/notifications');await expect(page).toHaveURL(/\/auth\/login/);
});

test('Notifications : double rôle, changement réel de workspace sans conserver les événements Client',async({page},info)=>{
  const client=await notificationActor(info),pro=await notificationActor(info,'contractor');
  expect((await client.admin.from('user_roles').insert({user_id:client.user.id,role:'contractor'})).error).toBeNull();
  const gov=await client.admin.from('governorates').select('id').eq('code','E2E_TEST').single();expect(gov.error).toBeNull();
  const project=await pro.db.rpc('create_collaborative_project',{p_origin:'contractor_existing_client',p_title:'Double rôle synthétique',p_description:'',
    p_governorate_id:gov.data!.id,p_delegation_id:null,p_locality_id:null,p_stage:'not_started',p_payment_status:'not_set'});expect(project.error).toBeNull();
  recordE2EValue(info,'projects',project.data.id);
  const invitation=await pro.db.rpc('issue_project_invitation',{p_project_id:project.data.id,p_expected_role:'client',p_recipient_email:client.user.email,
    p_recipient_name:null,p_principal_request_id:null,p_can_view_private_details:false});expect(invitation.error).toBeNull();
  await login(page,client.user);await page.goto('/app/notifications');await expect(page.getByRole('heading',{name:'Invitation reçue',exact:true})).toBeVisible();
  async function switchWorkspace(name:'Client'|'Artisan'){
    if(info.project.name==='mobile')await page.getByRole('button',{name:'Ouvrir le menu',exact:true}).click();
    await page.getByRole('button',{name,exact:true}).click();await expect(page).toHaveURL(/\/app$/);
    await page.goto('/app/notifications');
  }
  await switchWorkspace('Artisan');await expect(page.getByRole('heading',{name:'Aucune notification pour le moment'})).toBeVisible();
  await expect(page.getByLabel('0 notifications non lues',{exact:true})).toBeVisible();
  await switchWorkspace('Client');await expect(page.getByRole('heading',{name:'Invitation reçue',exact:true})).toBeVisible();
  await expect(page.getByLabel('1 notifications non lues',{exact:true})).toBeVisible();

  // Regression #302: an Artisan has an unread Assistance response in the left menu,
  // and the same alert must be reachable via the global bell.
  await switchWorkspace('Artisan');
  const staff=await notificationActor(info,'dao_admin');
  const created=await client.db.rpc('create_support_ticket',{
    p_subject:'Assistance artisan dans la cloche',p_category:'technical',
    p_body:'Problème synthétique',p_project_id:null,p_origin_route:'/app/messages',
    p_origin_faq_id:null,p_idempotency_key:randomUUID(),
  });
  expect(created.error).toBeNull();
  const response=await staff.db.rpc('reply_support_ticket',{
    p_ticket_id:created.data.id,p_body:'Réponse synthétique D.A.O.',
    p_idempotency_key:randomUUID(),
  });
  expect(response.error).toBeNull();
  await page.reload();
  await expect(page.getByTestId('support-bell-count')).toHaveText('1');
  await expect(page.getByRole('heading',{name:'Assistance D.A.O. — 1 réponse non lue'})).toBeVisible();
  await expect(page.getByLabel('1 notifications non lues',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Voir mes demandes d’assistance'}).click();
  await expect(page).toHaveURL(/\/app\/messages\?onglet=assistance/);
});
