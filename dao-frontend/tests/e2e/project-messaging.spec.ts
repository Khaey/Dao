import { test, expect } from './support/fixtures';
import { login } from './support/flow';
import { acceptWithLogin, createCollaborative, signOut } from './support/collaboration';

test('Messagerie chantier : client et artisan échangent dans un fil privé persistant',async({page,e2eClient,e2eArtisan},info)=>{
 test.skip(!e2eClient||!e2eArtisan,'Disposable E2E credentials are not available');
 await login(page,e2eClient!);const project=await createCollaborative(page,info,false,e2eArtisan!.email);await signOut(page);await acceptWithLogin(page,project.link,e2eArtisan!);
 await expect(page.getByRole('button',{name:/Écrire à/})).toBeVisible();await signOut(page);await login(page,e2eClient!);await page.goto(`/app/projects/${project.projectId}`);
 await page.getByRole('button',{name:/Écrire à/}).click();await expect(page).toHaveURL(/\/app\/messages\/[0-9a-f-]{36}$/);await page.getByLabel('Votre message').fill('Bonjour, pouvons-nous confirmer le démarrage ?');await page.getByRole('button',{name:'Envoyer le message'}).click();await expect(page.getByText('Bonjour, pouvons-nous confirmer le démarrage ?',{exact:true})).toBeVisible();await page.reload();await expect(page.getByText('Bonjour, pouvons-nous confirmer le démarrage ?',{exact:true})).toBeVisible();
 await signOut(page);await login(page,e2eArtisan!);await page.goto('/app/messages');await expect(page.getByText(project.title,{exact:true})).toBeVisible();await expect(page.getByText('Bonjour, pouvons-nous confirmer le démarrage ?',{exact:true})).toBeVisible();await page.getByRole('link').filter({hasText:project.title}).click();await page.getByLabel('Votre message').fill('Oui, le chantier peut démarrer lundi.');await page.getByRole('button',{name:'Envoyer le message'}).click();await expect(page.getByText('Oui, le chantier peut démarrer lundi.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBe(0);
});
