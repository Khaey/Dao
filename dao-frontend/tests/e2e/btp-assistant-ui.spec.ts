import { test, expect } from './support/fixtures';
import { login } from './support/flow';

const proposal={draftId:'54100000-0000-4000-8000-00000000d001',revision:1,projectType:'construction',title:'Construction Villa à Sousse',summary:'Villa R+1 à Sousse, terrasse, sans piscine',facts:[{key:'levels',label:'Configuration',value:'R+1',confidence:'known'}],question:null,engineMode:'deterministic',limitations:['Aucun prix disponible sans source tarifaire vérifiée.'],governorateId:null,items:[
  {id:'lot',code:'btp_lot_outdoor',parent_id:null,item_kind:'lot',label_fr:'Aménagements extérieurs',relevance:'optional',source:{label:'Référentiel éditorial D.A.O.',version:'1',scope:'Taxonomie uniquement'},selected:true},
  {id:'sub',code:'btp_sub_outdoor_spaces',parent_id:'lot',item_kind:'sub_lot',label_fr:'Espaces extérieurs',relevance:'optional',source:{label:'Référentiel éditorial D.A.O.',version:'1'},selected:true},
  {id:'work',code:'btp_work_terrace',parent_id:'sub',item_kind:'work',label_fr:'Terrasse extérieure',relevance:'optional',source:{label:'Référentiel éditorial D.A.O.',version:'1'},selected:true},
]};

test('assistant BTP: proposition immédiate, provenance, correction naturelle et création non dupliquée',async({page,e2eClient})=>{
  test.skip(!e2eClient,'E2E Supabase credentials are not available');
  await login(page,e2eClient!);
  await page.route('**/api/projects/assistant',async route=>{
    if(route.request().method()==='GET') return route.fulfill({json:{data:null}});
    const body=route.request().postDataJSON();
    return route.fulfill({json:{data:{...proposal,revision:body.command?2:1}}});
  });
  let createCalls=0;
  await page.route('**/api/projects/assistant/create',async route=>{createCalls++;await route.fulfill({json:{data:{project_id:'54100000-0000-4000-8000-00000000f001'}}});});
  await page.goto('/app/projects/new');
  await page.getByRole('button',{name:/Je cherche des professionnels/}).click();
  await page.getByLabel('Description libre').fill('Villa R+1 à Sousse, terrasse, sans piscine');
  await page.getByRole('button',{name:'Préparer une proposition'}).click();
  await expect(page.getByText('Construction Villa à Sousse')).toBeVisible();
  await expect(page.getByText('Terrasse extérieure')).toBeVisible();
  await expect(page.getByText(/Aucun prix disponible/)).toBeVisible();
  await page.getByLabel('Modifier avec vos mots').fill('retire terrasse');
  await page.getByRole('button',{name:'Appliquer'}).click();
  await expect(page.getByText(/mise à jour sans perdre/)).toBeVisible();
  await page.getByLabel('Gouvernorat').selectOption({index:1});
  await page.getByRole('button',{name:'Créer mon chantier'}).click();
  await expect(page).toHaveURL(/\/app\/projects\/54100000/);
  expect(createCalls).toBe(1);
});
