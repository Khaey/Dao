import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export async function collaborationCommands({ db, as, client, other, contractor }) {
  let passed=0;
  async function check(name,fn) {
    try { await fn(); passed++; }
    catch(e) { console.error('collaboration RPC: '+name,e.code ?? '',e.message); throw e; }
  }
  async function rpc(name,values) {
    const types=name==='create_project_draft'?['text','numeric','date','bigint','uuid','uuid','uuid']:[];
    const args=values.map((_,i)=>'$'+(i+1)+(types[i]?'::'+types[i]:'')).join(',');
    try { return (await db.query(`select to_jsonb(public.${name}(${args})) as result`,values)).rows[0].result; }
    catch(e) {
      // PGlite errors include query parameters. Never print opaque invitation
      // tokens in a failed test's assertion stack.
      throw Object.assign(new Error(e.message),{code:e.code});
    }
  }
  async function deny(name,values,code) {
    await assert.rejects(rpc(name,values),e=>e.code===code);
  }
  await db.exec('alter table auth.users add column email text,add column email_confirmed_at timestamptz');
  for (const [id,email] of [[client,'client@fixture.invalid'],[other,'other@fixture.invalid'],[contractor,'pro@fixture.invalid']]) {
    await db.query('update auth.users set email=$2,email_confirmed_at=now() where id=$1',[id,email]);
  }
  const gov=(await db.query("select id from public.governorates where code='E2E_TEST'")).rows[0].id;
  const trade=(await db.query("select id from public.trades where code='plumbing'")).rows[0].id;
  const create=origin=>rpc('create_collaborative_project',[origin,'Chantier RPC','Description sûre',gov,null,null,'in_progress','partial']);
  const invite=(project,role,email=null,privateDetails=false)=>rpc('issue_project_invitation',[project,role,email,privateDetails]);
  const project=await as(contractor,()=>create('contractor_existing_client'));
  const clientProject=await as(client,()=>create('client_existing_team'));
  await check('strict origin and matching global role',async()=> {
    await as(contractor,()=>deny('create_collaborative_project',['client_existing_team','x','',gov,null,null,'not_started','not_set'],'42501'));
    await as(client,()=>deny('create_collaborative_project',['contractor_existing_client','x','',gov,null,null,'not_started','not_set'],'42501'));
    await as(contractor,()=>deny('create_collaborative_project',['internal','x','',gov,null,null,'not_started','not_set'],'22023'));
  });
  await check('legacy create does not silently make a contractor a client',()=>as(contractor,()=>deny('create_project_draft',['other',null,null,null,gov,null,null],'42501')));
  await check('client and contractor origins preserve their real participation',async()=> {
    assert.equal(project.client_id,null);assert.equal(project.initiator_id,contractor);
    assert.equal(clientProject.client_id,client);assert.equal(clientProject.initiator_id,client);
    assert.equal((await db.query('select verification_status from public.contractor_profiles where user_id=$1',[contractor])).rows[0].verification_status,'pending');
  });
  const lot=await as(contractor,()=>rpc('add_project_request',[project.id,trade,'Plomberie','Travaux plomberie',1000]));
  await check('contractor initiator can prepare actual lots and tracking, but cannot submit DAO',async()=> {
    assert.ok(lot.id);
    const versions=(await db.query('select version_no from public.project_request_versions where request_id=$1',[lot.id])).rows;
    assert.deepEqual(versions.map(v=>v.version_no),[1]);
    await as(contractor,()=>rpc('update_project_tracking',[project.id,'started','unpaid']));
    await as(contractor,()=>deny('submit_project_for_review',[project.id],'42501'));
    assert.equal((await db.query('select status from public.project_versions where project_id=$1',[project.id])).rows[0].status,'draft');
  });
  await check('forged internal invitation roles are rejected',()=>as(contractor,async()=> {
    for(const role of ['dao_admin','dao_reviewer','service_role']) await deny('issue_project_invitation',[project.id,role,null,false],'22023');
    await deny('issue_project_invitation',[project.id,'contractor',null,false],'42501');
  }));
  const invitation=await as(contractor,()=>invite(project.id,'client'));
  await check('token is returned once and only its hash is stored',async()=> {
    assert.match(invitation.token,/^[a-f0-9]{64}$/);
    const stored=(await db.query('select token_hash from public.project_invitations where id=$1',[invitation.id])).rows[0].token_hash;
    assert.equal(stored===invitation.token,false);
    await as(contractor,async()=> {
      const dto=await rpc('project_team',[project.id]);
      assert.equal(JSON.stringify(dto).includes(invitation.token),false);
      assert.equal(JSON.stringify(dto).includes(stored),false);
    });
  });
  await check('exactly one pending client invitation',()=>as(contractor,()=>deny('issue_project_invitation',[project.id,'client',null,false],'23505')));
  await check('anonymous preview contains only the safe summary',async()=> {
    await db.exec("set role anon;select set_config('request.jwt.claim.sub','',false)");
    try {
      const preview=await rpc('preview_project_invitation',[invitation.token]);
      assert.equal(preview.title,'Chantier RPC');assert.equal(preview.expected_role,'client');
      assert.equal(preview.lots[0].title,'Plomberie');
      for(const key of ['token','token_hash','recipient_email','contact_email','exact_address','bids','budget_millimes']) assert.equal(key in preview,false);
      assert.equal(await rpc('preview_project_invitation',['invalid']),null);
      await deny('respond_project_invitation',[invitation.token,true],'42501');
    } finally {await db.exec('reset role');}
  });
  await check('wrong role cannot accept or override the stored role',()=>as(contractor,()=>deny('respond_project_invitation',[invitation.token,true],'42501')));
  await db.query("insert into public.user_roles(user_id,role) values($1,'client')",[contractor]);
  await check('dual-role initiator still cannot confirm as their own client',()=>as(contractor,()=>deny('respond_project_invitation',[invitation.token,true],'42501')));
  await db.query("delete from public.user_roles where user_id=$1 and role='client'",[contractor]);
  await check('client confirmation is atomic, auditable and distinct from review',async()=> {
    assert.equal(await as(client,()=>rpc('respond_project_invitation',[invitation.token,true])),project.id);
    const p=(await db.query('select * from public.projects where id=$1',[project.id])).rows[0];
    assert.equal(p.client_id,client);assert.equal(p.confirmed_by,client);assert.ok(p.confirmed_at);
    assert.equal(p.initiator_id,contractor);assert.equal(p.status,'draft');
    assert.equal((await db.query('select status from public.project_versions where project_id=$1',[project.id])).rows[0].status,'draft');
    const members=(await db.query("select participation_role from public.project_members where project_id=$1 and status='accepted' order by participation_role",[project.id])).rows;
    assert.deepEqual(members.map(m=>m.participation_role),['client','contractor']);
    assert.equal((await db.query("select count(*)::int as n from public.audit_events where entity_id=$1 and action='client_confirmed'",[project.id])).rows[0].n,1);
  });
  await check('one-shot invitation cannot be replayed by another client',()=>as(other,()=>deny('respond_project_invitation',[invitation.token,true],'23514')));
  await check('confirmed contractor remains a participant without client rights',()=>as(contractor,async()=> {
    const rights=await rpc('project_team',[project.id]);assert.equal(rights.is_client,false);assert.equal(rights.can_prepare,true);
    await deny('submit_project_for_review',[project.id],'42501');
    await deny('issue_project_invitation',[project.id,'contractor',null,false],'42501');
    await deny('issue_project_invitation',[project.id,'client',null,false],'42501');
  }));
  const recipientProject=await as(contractor,()=>create('contractor_existing_client'));
  const emailInvite=await as(contractor,()=>invite(recipientProject.id,'client','client@fixture.invalid'));
  await check('recipient email is enforced against confirmed Auth email',async()=> {
    await as(other,()=>deny('respond_project_invitation',[emailInvite.token,true],'42501'));
    await as(client,()=>rpc('respond_project_invitation',[emailInvite.token,true]));
  });
  const revokedProject=await as(contractor,()=>create('contractor_existing_client'));
  const revokedInvite=await as(contractor,()=>invite(revokedProject.id,'client'));
  await check('revocation invalidates preview and acceptance',async()=> {
    await as(other,()=>deny('revoke_project_invitation',[revokedInvite.id],'42501'));
    await as(contractor,()=>rpc('revoke_project_invitation',[revokedInvite.id]));
    assert.equal(await rpc('preview_project_invitation',[revokedInvite.token]),null);
    await as(client,()=>deny('respond_project_invitation',[revokedInvite.token,true],'23514'));
  });
  const expiryInvite=await as(contractor,()=>invite(revokedProject.id,'client'));
  await db.query("update public.project_invitations set created_at=now()-interval '2 days',expires_at=now()-interval '1 day' where id=$1",[expiryInvite.id]);
  await check('expiry is enforced without sleep and replacement can be issued',async()=> {
    assert.equal(await rpc('preview_project_invitation',[expiryInvite.token]),null);
    await as(client,()=>deny('respond_project_invitation',[expiryInvite.token,true],'23514'));
    const replacement=await as(contractor,()=>invite(revokedProject.id,'client'));
    await as(client,()=>rpc('respond_project_invitation',[replacement.token,false]));
    assert.equal((await db.query('select client_id from public.projects where id=$1',[revokedProject.id])).rows[0].client_id,null);
    assert.equal(await rpc('preview_project_invitation',[replacement.token]),null);
  });
  const competitor=randomUUID();
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())',[competitor,'competitor@fixture.invalid']);
  await db.query("insert into public.user_roles(user_id,role) values($1,'contractor')",[competitor]);
  const competitorProfile=(await db.query("insert into public.contractor_profiles(user_id,business_name,verification_status) values($1,'Competitor fixture','verified') returning id",[competitor])).rows[0].id;
  const memberInvite=await as(client,()=>invite(project.id,'contractor'));
  await as(competitor,()=>rpc('respond_project_invitation',[memberInvite.token,true]));
  const member=(await db.query('select * from public.project_members where project_id=$1 and user_id=$2',[project.id,competitor])).rows[0];
  await check('invited contractor is read-only and cannot escalate private permission',()=>as(competitor,async()=> {
    const team=await rpc('project_team',[project.id]);assert.equal(team.can_prepare,false);assert.equal(team.can_view_private_details,false);
    await deny('add_project_request',[project.id,trade,'Forged','Scope',null],'42501');
    await deny('update_project_member',[member.id,false,true],'42501');
    await deny('update_project_tracking',[project.id,'completed','paid'],'42501');
  }));
  await check('lot assignment stays project-bound and separate from awards',async()=> {
    await as(client,()=>rpc('assign_project_request_member',[lot.id,member.id]));
    assert.equal((await db.query('select status from public.project_requests where id=$1',[lot.id])).rows[0].status,'open');
    assert.equal((await db.query('select count(*)::int as n from public.awards where project_id=$1',[project.id])).rows[0].n,0);
    const another=await as(client,()=>rpc('add_project_request',[clientProject.id,trade,'Other','Other',null]));
    await as(client,()=>deny('assign_project_request_member',[another.id,member.id],'23514'));
  });
  const privateDetails=await as(contractor,()=>rpc('upsert_project_private_details',[project.id,'Exact private address',null,null,null]));
  await check('permission explicitly grants reads without private edits to invited contractor',async()=> {
    await as(competitor,async()=>assert.equal((await db.query('select id from public.project_private_details where id=$1',[privateDetails.id])).rows.length,0));
    await as(client,()=>rpc('update_project_member',[member.id,false,true]));
    await as(competitor,async()=> {
      assert.equal((await db.query('select id from public.project_private_details where id=$1',[privateDetails.id])).rows.length,1);
      await deny('upsert_project_private_details',[project.id,'Forged',null,null,null],'42501');
    });
  });
  const ownDoc=await as(client,()=>rpc('create_project_document',[project.id,`project/${project.id}/client.pdf`,'client.pdf','application/pdf',4]));
  await check('sharing does not bypass quarantine or allow editing someone else’s file',async()=> {
    await as(client,()=>rpc('set_project_document_sharing',[ownDoc.id,'project_members']));
    await as(competitor,async()=> {
      assert.equal((await db.query('select id from public.documents where id=$1',[ownDoc.id])).rows.length,0);
      await deny('set_project_document_sharing',[ownDoc.id,'project_members'],'42501');
    });
    await db.query("update public.documents set status='approved' where id=$1",[ownDoc.id]);
    await as(competitor,async()=>assert.equal((await db.query('select id from public.documents where id=$1',[ownDoc.id])).rows.length,1));
  });
  const bid=(await db.query('insert into public.bids(project_id,contractor_id) values($1,$2) returning id',[project.id,competitorProfile])).rows[0].id;
  const bidVersion=(await db.query("insert into public.bid_versions(bid_id,project_id,contractor_id,version_no,expires_at,submitted_at,status) values($1,$2,$3,1,'2099-01-01',now(),'submitted') returning id",[bid,project.id,competitorProfile])).rows[0].id;
  await check('contractor initiator and project membership never grant competitor bid access',()=>as(contractor,async()=> {
    assert.equal((await db.query('select id from public.bids where id=$1',[bid])).rows.length,0);
    assert.equal((await db.query('select id from public.bid_versions where id=$1',[bidVersion])).rows.length,0);
  }));
  const pv=(await db.query('select id from public.project_versions where project_id=$1',[project.id])).rows[0].id;
  const publication=(await db.query("insert into public.publications(project_id,project_version_id,visibility,safe_title,safe_description,governorate_id) values($1,$2,'invite_only','Private DAO','safe',$3) returning id",[project.id,pv,gov])).rows[0].id;
  await check('accepted participant is not an invite_only marketplace recipient',()=>as(competitor,async()=> {
    assert.equal((await db.query('select id from public.publications where id=$1',[publication])).rows.length,0);
  }));
  await check('membership revocation removes data, permissions and existing-team lot assignment',async()=> {
    await db.query('insert into public.document_grants(document_id,user_id) values($1,$2)',[ownDoc.id,competitor]);
    await as(client,()=>rpc('update_project_member',[member.id,true,null]));
    await as(competitor,async()=> {
      for(const table of ['projects','project_private_details','documents']) {
        const id=table==='projects'?project.id:table==='documents'?ownDoc.id:privateDetails.id;
        assert.equal((await db.query(`select id from public.${table} where id=$1`,[id])).rows.length,0);
      }
      await deny('project_team',[project.id],'42501');
    });
    assert.equal((await db.query('select contractor_member_id from public.project_requests where id=$1',[lot.id])).rows[0].contractor_member_id,null);
    assert.ok((await db.query('select revoked_at from public.document_grants where document_id=$1 and user_id=$2',[ownDoc.id,competitor])).rows[0].revoked_at);
  });
  await check('client membership cannot be reassigned or revoked',async()=> {
    const clientMember=(await db.query("select id from public.project_members where project_id=$1 and participation_role='client'",[project.id])).rows[0].id;
    await as(client,()=>deny('update_project_member',[clientMember,true,null],'23514'));
    await assert.rejects(db.query('update public.project_members set user_id=$1 where id=$2',[other,clientMember]),e=>e.code==='23514');
  });
  console.log(JSON.stringify({suite:'collaboration RPC/RLS lifecycle',passed,failed:0}));
}
