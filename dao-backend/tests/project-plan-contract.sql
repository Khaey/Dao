-- #325 tranche B : contrat du planning GLOBAL du projet (migration 20261020020000_project_plan).
-- Exécuté sur base fraîche (PGlite en CI, psql en local) dans une transaction annulée : toute violation lève une exception.
do $$
declare
  c uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); stf uuid:=gen_random_uuid();
  pa uuid; pb uuid; proj uuid; r1 uuid; r2 uuid; r3 uuid; rv1 uuid; rv2 uuid; rv3 uuid; trade uuid; off1 uuid; off2 uuid;
  plain_proj uuid; plain_request uuid; plain_rv uuid; plain_bid uuid; plain_bv uuid; plain_item uuid; plain_award uuid; plain_award_item uuid;
  bida uuid; bidb uuid; va uuid; vb uuid; ia uuid; ib uuid; ic uuid; awa uuid; awb uuid;
  s1 uuid:=gen_random_uuid(); s2 uuid:=gen_random_uuid(); t1 uuid:=gen_random_uuid(); u1 uuid:=gen_random_uuid();
  d jsonb; n integer; rev integer; l1 uuid; l2 uuid; l3 uuid; lb uuid; ctx uuid; m uuid; m0 uuid; lm uuid; tf text; td text; tt text; tp text;
  native_activity uuid; native_child uuid; native_proposal uuid; native_result jsonb;
begin
  insert into auth.users(id,email) values(c,'c@pp.test'),(c2,'c2@pp.test'),(a,'a@pp.test'),(b,'b@pp.test'),(stf,'s@pp.test');
  insert into public.user_roles(user_id,role) values(c,'client'),(c2,'client'),(a,'contractor'),(b,'contractor'),(stf,'dao_admin');
  insert into public.contractor_profiles(user_id,business_name,verification_status) values(a,'Artisan A','verified') returning id into pa;
  insert into public.contractor_profiles(user_id,business_name,verification_status) values(b,'Artisan B','verified') returning id into pb;
  select id into trade from public.trades limit 1;
  insert into public.projects(client_id) values(c) returning id into proj;
  insert into public.project_requests(project_id) values(proj) returning id into r1;
  insert into public.project_requests(project_id) values(proj) returning id into r2;
  insert into public.project_requests(project_id) values(proj) returning id into r3;
  insert into public.project_request_versions(request_id,project_id,version_no,trade_id,title,scope) values(r1,proj,1,trade,'Maçonnerie','m') returning id into rv1;
  insert into public.project_request_versions(request_id,project_id,version_no,trade_id,title,scope) values(r2,proj,1,trade,'Électricité','e') returning id into rv2;
  insert into public.project_request_versions(request_id,project_id,version_no,trade_id,title,scope) values(r3,proj,1,trade,'Peinture','p') returning id into rv3;
  insert into public.request_sub_lots(request_id,project_id) values(r1,proj) returning id into off1;
  insert into public.request_sub_lots(request_id,project_id) values(r2,proj) returning id into off2;
  insert into public.request_sub_lot_versions(sub_lot_id,request_id,project_id,request_version_id,ordinal,title,scope) values(off1,r1,proj,rv1,0,'Gros œuvre','g');
  insert into public.request_sub_lot_versions(sub_lot_id,request_id,project_id,request_version_id,ordinal,title,scope) values(off2,r2,proj,rv2,0,'Câblage','c');
  insert into public.bids(project_id,contractor_id) values(proj,pa) returning id into bida;
  insert into public.bids(project_id,contractor_id) values(proj,pb) returning id into bidb;
  insert into public.bid_versions(bid_id,project_id,contractor_id,version_no,expires_at) values(bida,proj,pa,1,'2099-01-01') returning id into va;
  insert into public.bid_versions(bid_id,project_id,contractor_id,version_no,expires_at) values(bidb,proj,pb,1,'2099-01-01') returning id into vb;
  insert into public.bid_items(bid_version_id,project_id,request_version_id,request_id,contractor_id,price_millimes,duration_days,inclusions) values(va,proj,rv1,r1,pa,1000000,20,'t') returning id into ia;
  insert into public.bid_items(bid_version_id,project_id,request_version_id,request_id,contractor_id,price_millimes,duration_days,inclusions) values(va,proj,rv3,r3,pa,500000,10,'t') returning id into ic;
  insert into public.bid_items(bid_version_id,project_id,request_version_id,request_id,contractor_id,price_millimes,duration_days,inclusions) values(vb,proj,rv2,r2,pb,900000,15,'t') returning id into ib;

  -- Offres : A décompose les lots 1 et 3, B le lot 2 ; liens intra-lot, inter-lot (vers le sous-lot officiel du lot 2) et vers le lot 2.
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform * from public.replace_bid_sub_lots(ia,jsonb_build_array(
    jsonb_build_object('node_key',s1,'title','Fondations','start_date','2027-01-10','end_date','2027-01-14','duration_days',5,'official_sub_lot_id',off1),
    jsonb_build_object('node_key',s2,'title','Dalle','start_date','2027-01-15','end_date','2027-01-20','duration_days',6)));
  perform * from public.replace_bid_sub_lots(ic,jsonb_build_array(jsonb_build_object('node_key',u1,'title','Peinture finale','start_date','2027-02-01','end_date','2027-02-10','duration_days',10)));
  perform * from public.replace_bid_sub_lot_links(va,jsonb_build_array(
    jsonb_build_object('pred_kind','proposal','pred_ref',s1,'succ_kind','proposal','succ_ref',s2),
    jsonb_build_object('pred_kind','proposal','pred_ref',s2,'succ_kind','official_sub_lot','succ_ref',off2),
    jsonb_build_object('pred_kind','lot','pred_ref',r2,'succ_kind','proposal','succ_ref',u1)));
  perform set_config('request.jwt.claim.sub',b::text,true);
  perform * from public.replace_bid_sub_lots(ib,jsonb_build_array(
    jsonb_build_object('node_key',t1,'title','Tirage de câbles','start_date','2027-01-21','end_date','2027-01-31','duration_days',11,'official_sub_lot_id',off2)));
  -- Lien de B qui fermera une boucle inter-lots une fois les autres confirmés : T1 -> sous-lot officiel du lot 1 (= Fondations de A).
  perform * from public.replace_bid_sub_lot_links(vb,jsonb_build_array(jsonb_build_object('pred_kind','proposal','pred_ref',t1,'succ_kind','official_sub_lot','succ_ref',off1)));
  update public.bid_versions set status='submitted',submitted_at=now() where id in (va,vb);

  -- Sans attribution, rien n'est effectif : aucun nœud, aucun lien (l'attribution reste par lot).
  perform set_config('request.jwt.claim.sub',c::text,true);
  d:=public.get_project_plan(proj);
  if jsonb_array_length(d->'nodes')<>0 or jsonb_array_length(d->'links')<>0 then raise exception 'plan must be empty before any award: %',d; end if;
  if jsonb_array_length(d->'lots')<>3 then raise exception 'plan must list the 3 lots'; end if;
  if d#>>'{sync,state}'<>'none' then raise exception 'nothing schedulable must read none: %',d->'sync'; end if;

  -- Attribution PAR LOT (lots 1 et 3 à A, lot 2 à B) : la révision du plan commun avance.
  insert into public.awards(project_id,contractor_id) values(proj,pa) returning id into awa;
  insert into public.awards(project_id,contractor_id) values(proj,pb) returning id into awb;
  insert into public.award_items(award_id,project_id,request_id,bid_item_id,agreed_millimes,contractor_id) values(awa,proj,r1,ia,1000000,pa);
  select revision into rev from public.project_plan_contexts where project_id=proj;
  if rev is null or rev<2 then raise exception 'award must bump the plan revision, got %',rev; end if;
  insert into public.award_items(award_id,project_id,request_id,bid_item_id,agreed_millimes,contractor_id) values(awa,proj,r3,ic,500000,pa);
  insert into public.award_items(award_id,project_id,request_id,bid_item_id,agreed_millimes,contractor_id) values(awb,proj,r2,ib,900000,pb);
  update public.project_requests set status='awarded' where id in(r1,r2,r3);

  -- P10-N1: native read projection is independent of OCE and scopes a contractor to own active lots.
  perform set_config('request.jwt.claim.sub',c::text,true);
  d:=public.native_execution_plan_v1(proj,null,50);
  if (d->>'schemaVersion')::integer<>1 or d->'viewer'->>'workspace'<>'client'
    or jsonb_array_length(d->'lots')<>3 then raise exception 'native client projection incomplete: %',d; end if;
  if d->'activities'->>'supported'<>'true' or jsonb_array_length(d->'activities'->'items')<>0
    or d->'forecast'<>'null'::jsonb then
    raise exception 'native activities must be supported and an empty graph must remain explicit'; end if;
  if d::text like '%1000000%' or d::text like '%900000%' then
    raise exception 'native projection leaked a quote/award price'; end if;
  if not exists(select 1 from jsonb_array_elements(d->'lots') x
      where x->>'requestId'=r1::text and jsonb_array_length(x->'executionSubLots')=2
        and x->'permissions'->>'canReviewProgress'='true') then
    raise exception 'native winning sub-lots/lot permissions missing'; end if;

  perform set_config('request.jwt.claim.sub',a::text,true);
  d:=public.native_execution_plan_v1(proj,null,50);
  if d->'viewer'->>'workspace'<>'contractor' or jsonb_array_length(d->'lots')<>2
    or exists(select 1 from jsonb_array_elements(d->'lots') x where x->>'requestId'=r2::text)
    or exists(select 1 from jsonb_array_elements(d->'lots') x where x->'permissions'->>'canDeclareProgress'<>'true') then
    raise exception 'native contractor projection is not scoped to own awarded lots: %',d; end if;

  perform set_config('request.jwt.claim.sub',c2::text,true);
  begin
    perform public.native_execution_plan_v1(proj,null,50);
    raise exception 'unrelated client unexpectedly read native tracking';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub',stf::text,true);
  d:=public.native_execution_plan_v1(proj,null,1);
  if d->'viewer'->>'workspace'<>'dao_manager' or jsonb_array_length(d->'lots')<>1
    or d->'page'->>'nextCursor' is null then raise exception 'manager scope or bounded pagination missing: %',d; end if;

  perform set_config('request.jwt.claim.sub',c::text,true);
  d:=public.get_project_plan(proj);
  if jsonb_array_length(d->'nodes')<>4 then raise exception 'expected 4 awarded nodes, got %',jsonb_array_length(d->'nodes'); end if;
  if jsonb_array_length(d->'links')<>4 then raise exception 'expected 4 proposed links'; end if;
  select x->>'id' into l1 from jsonb_array_elements(d->'links') x where x->>'pred_label'='Fondations';
  select x->>'id' into l2 from jsonb_array_elements(d->'links') x where x->>'pred_label'='Dalle';
  select x->>'id' into l3 from jsonb_array_elements(d->'links') x where x->>'pred_label'='Électricité';
  if (select x->>'state' from jsonb_array_elements(d->'links') x where x->>'id'=l1::text)<>'awaiting_confirmation' then raise exception 'intra-lot link must await confirmation'; end if;
  if (select x->>'state' from jsonb_array_elements(d->'links') x where x->>'id'=l2::text)<>'awaiting_confirmation' then raise exception 'inter-lot link must resolve to B''s sub-lot and await confirmation'; end if;
  if (select x->>'state' from jsonb_array_elements(d->'links') x where x->>'id'=l3::text)<>'unresolved' then raise exception 'link to a lot without ready plan must be unresolved'; end if;

  -- Le Client renseigne le planning du lot 2 (prêt) : le lien vers ce lot devient résoluble ; révision +1.
  select revision into rev from public.project_plan_contexts where project_id=proj;
  perform public.oce_save_lot_plan(proj,r2,'2027-01-21'::date,'2027-01-31'::date,true);
  if (select revision from public.project_plan_contexts where project_id=proj)<>rev+1 then raise exception 'lot plan change must bump revision'; end if;
  perform public.oce_save_lot_plan(proj,r2,'2027-01-21'::date,'2027-01-31'::date,true);
  if (select revision from public.project_plan_contexts where project_id=proj)<>rev+1 then raise exception 'identical lot plan must not bump revision'; end if;
  d:=public.get_project_plan(proj);
  if (select x->>'state' from jsonb_array_elements(d->'links') x where x->>'id'=l3::text)<>'awaiting_confirmation' then raise exception 'lot link must now await confirmation'; end if;

  -- Confirmation par le Client : les trois liens deviennent effectifs.
  perform public.decide_plan_link(proj,l1,'confirmed');
  perform public.decide_plan_link(proj,l2,'confirmed');
  d:=public.decide_plan_link(proj,l3,'confirmed');
  select count(*) into n from jsonb_array_elements(d->'links') x where x->>'state'='effective';
  if n<>3 then raise exception 'expected 3 effective links, got %',n; end if;

  -- Cycle inter-lots : confirmer T1 -> Fondations alors que Fondations -> Dalle -> T1 est effectif est refusé.
  select x->>'id' into lb from jsonb_array_elements(public.get_project_plan(proj)->'links') x where x->>'pred_label'='Tirage de câbles';
  if lb is null then raise exception 'B''s link must be visible to the Client'; end if;
  begin perform public.decide_plan_link(proj,lb,'confirmed'); raise exception 'cycle confirmed';
  exception when check_violation then if sqlerrm<>'dependency_cycle' then raise; end if; end;
  perform public.decide_plan_link(proj,lb,'rejected');
  if (select x->>'state' from jsonb_array_elements(public.get_project_plan(proj)->'links') x where x->>'id'=lb::text)<>'rejected' then raise exception 'rejected link must read rejected'; end if;

  -- Aucun lien n'est irréversible (#325) : un lien effectif peut être rejeté puis reconfirmé ; les décisions restent append-only.
  perform public.decide_plan_link(proj,l1,'rejected');
  if (select x->>'state' from jsonb_array_elements(public.get_project_plan(proj)->'links') x where x->>'id'=l1::text)<>'rejected' then raise exception 'effective link must be retirable'; end if;
  perform public.decide_plan_link(proj,l1,'confirmed');
  if (select x->>'state' from jsonb_array_elements(public.get_project_plan(proj)->'links') x where x->>'id'=l1::text)<>'effective' then raise exception 'link must be reconfirmable'; end if;
  begin update public.project_plan_link_decisions set decision='rejected'; raise exception 'decision updated';
  exception when check_violation then null; end;
  begin delete from public.project_plan_link_decisions; raise exception 'decision deleted';
  exception when check_violation then null; end;

  -- Confidentialité : ni Artisan, ni autre Client ne lit ni ne décide ; la gestion D.A.O le peut.
  foreach m in array array[a,b,c2] loop
    perform set_config('request.jwt.claim.sub',m::text,true);
    begin perform public.get_project_plan(proj); raise exception 'unauthorised read';
    exception when insufficient_privilege then null; end;
    begin perform public.decide_plan_link(proj,l1,'confirmed'); raise exception 'unauthorised decision';
    exception when insufficient_privilege then null; end;
  end loop;
  perform set_config('request.jwt.claim.sub',stf::text,true);
  perform public.get_project_plan(proj);

  -- Entrée de synchronisation : liens effectifs et lots prêts seulement, contexte stable ; null sans plan prêt.
  d:=dao_private.oce_project_plan_for_sync(proj);
  if d is null or d->>'context_id' is null then raise exception 'sync source missing'; end if;
  ctx:=(d->>'context_id')::uuid;
  select count(*) into n from jsonb_array_elements(d->'links') x where x->>'state'='effective';
  if n<>3 then raise exception 'sync source must carry 3 effective links, got %',n; end if;
  if dao_private.oce_project_plan_for_sync(gen_random_uuid()) is not null then raise exception 'unknown project must yield nothing'; end if;

  -- La correspondance OCE accepte le contexte du projet (pas un identifiant au hasard).
  m:=dao_private.oce_request_mapping(proj,ctx); m0:=m;
  if m is null then raise exception 'context mapping expected'; end if;
  begin perform dao_private.oce_request_mapping(proj,gen_random_uuid()); raise exception 'random mapping accepted';
  exception when invalid_parameter_value then null; end;

  -- Rattachement du contexte à un lot du projet (recette) : refusé pour un identifiant étranger au projet.
  perform dao_private.oce_plan_context_bind(proj,r1);
  if (select context_id from public.project_plan_contexts where project_id=proj)<>r1 then raise exception 'context must be bound to the lot'; end if;
  begin perform dao_private.oce_plan_context_bind(proj,gen_random_uuid()); raise exception 'foreign context accepted';
  exception when invalid_parameter_value then null; end;

  -- Résultat OCE : lu par l'écran uniquement s'il correspond à la révision courante.
  select revision into rev from public.project_plan_contexts where project_id=proj;
  perform dao_private.oce_record_project_plan_result(proj,rev,40,array['LOT-1'],null);
  perform set_config('request.jwt.claim.sub',c::text,true);
  d:=public.get_project_plan(proj);
  if d#>>'{sync,state}'<>'synced' or (d#>>'{sync,duration_days}')::int<>40 then raise exception 'result of current revision must read synced: %',d->'sync'; end if;
  perform dao_private.oce_record_project_plan_result(proj,rev-1,1,'{}',null);
  if (public.get_project_plan(proj)#>>'{sync,duration_days}')::int<>40 then raise exception 'older result must not overwrite'; end if;
  perform public.oce_save_lot_plan(proj,r2,'2027-01-21'::date,'2027-02-05'::date,true);
  if public.get_project_plan(proj)#>>'{sync,state}'<>'pending' then raise exception 'a change must make the result stale'; end if;

  -- ===== Modifier / retirer / remplacer un lien (migration 20261021030000) =====
  perform set_config('request.jwt.claim.sub',c::text,true);
  d:=public.get_project_plan(proj);
  select 'node:'||(nd.value->>'id') into tf from jsonb_array_elements(d->'nodes') nd where nd.value->>'title'='Fondations';
  select 'node:'||(nd.value->>'id') into td from jsonb_array_elements(d->'nodes') nd where nd.value->>'title'='Dalle';
  select 'node:'||(nd.value->>'id') into tt from jsonb_array_elements(d->'nodes') nd where nd.value->>'title'='Tirage de câbles';
  select 'node:'||(nd.value->>'id') into tp from jsonb_array_elements(d->'nodes') nd where nd.value->>'title'='Peinture finale';
  if tf is null or td is null or tt is null or tp is null then raise exception 'plan nodes missing'; end if;
  select revision into rev from public.project_plan_contexts where project_id=proj;

  -- Ajout par le Client : Tirage -> Peinture devient effectif et révise le plan.
  d:=public.add_plan_link(proj,tt,tp);
  select x->>'id' into lm from jsonb_array_elements(d->'links') x where (x->>'manual')::boolean and x->>'pred_target'=tt and x->>'succ_target'=tp;
  if lm is null or (select x->>'state' from jsonb_array_elements(d->'links') x where x->>'id'=lm::text)<>'effective' then raise exception 'added link must be effective: %',d->'links'; end if;
  if (select revision from public.project_plan_contexts where project_id=proj)<=rev then raise exception 'added link must bump the revision'; end if;
  if (select count(*) from jsonb_array_elements(dao_private.oce_project_plan_for_sync(proj)->'links') x where x->>'state'='effective')<>4 then raise exception 'sync source must carry the added link'; end if;
  begin perform public.add_plan_link(proj,tt,tp); raise exception 'duplicate accepted';
  exception when invalid_parameter_value then if sqlerrm<>'link_duplicate' then raise; end if; end;
  begin perform public.add_plan_link(proj,tp,tf); raise exception 'cycle accepted';
  exception when check_violation then if sqlerrm<>'dependency_cycle' then raise; end if; end;
  begin perform public.add_plan_link(proj,tf,'node:'||gen_random_uuid()::text); raise exception 'unknown target accepted';
  exception when invalid_parameter_value then null; end;
  begin perform public.add_plan_link(proj,tf,tf); raise exception 'self link accepted';
  exception when invalid_parameter_value then null; end;

  -- Remplacement en une action : Dalle -> Tirage (proposé par l'Artisan) devient Dalle -> Peinture ; un remplacement qui ferme une boucle ne change rien.
  begin perform public.replace_plan_link(proj,l2,td,tf); raise exception 'cyclic replacement accepted';
  exception when check_violation then if sqlerrm<>'dependency_cycle' then raise; end if; end;
  if (select x->>'state' from jsonb_array_elements(public.get_project_plan(proj)->'links') x where x->>'id'=l2::text)<>'effective' then raise exception 'failed replacement must change nothing'; end if;
  d:=public.replace_plan_link(proj,l2,td,tp);
  if (select x->>'state' from jsonb_array_elements(d->'links') x where x->>'id'=l2::text)<>'rejected' then raise exception 'old link must be retired by a replacement'; end if;
  if not exists(select 1 from jsonb_array_elements(d->'links') x where (x->>'manual')::boolean and x->>'pred_target'=td and x->>'succ_target'=tp and x->>'state'='effective') then raise exception 'new link must be effective'; end if;

  -- Retrait d'un lien ajouté : il sort du plan ; retirer deux fois est refusé.
  d:=public.remove_plan_link(proj,lm);
  if exists(select 1 from jsonb_array_elements(d->'links') x where x->>'id'=lm::text) then raise exception 'removed added link must leave the plan'; end if;
  begin perform public.remove_plan_link(proj,lm); raise exception 'double removal accepted';
  exception when invalid_parameter_value then null; end;
  d:=public.remove_plan_link(proj,l3);
  if (select x->>'state' from jsonb_array_elements(d->'links') x where x->>'id'=l3::text)<>'rejected' then raise exception 'proposed link removal must reject it'; end if;

  -- Historique append-only des liens ajoutés et de leurs retraits.
  begin update public.project_plan_manual_links set pred_target=succ_target; raise exception 'manual link updated';
  exception when check_violation then null; end;
  begin delete from public.project_plan_manual_link_removals; raise exception 'removal deleted';
  exception when check_violation then null; end;

  -- Confidentialité : ni Artisan ni autre Client ne modifie le plan ; la gestion D.A.O le peut.
  foreach m in array array[a,b,c2] loop
    perform set_config('request.jwt.claim.sub',m::text,true);
    begin perform public.add_plan_link(proj,tf,td); raise exception 'unauthorised add';
    exception when insufficient_privilege then null; end;
    begin perform public.remove_plan_link(proj,l1); raise exception 'unauthorised removal';
    exception when insufficient_privilege then null; end;
    begin perform public.replace_plan_link(proj,l1,tf,tp); raise exception 'unauthorised replacement';
    exception when insufficient_privilege then null; end;
  end loop;
  perform set_config('request.jwt.claim.sub',stf::text,true);
  perform public.remove_plan_link(proj,l1);

  -- Un lot dont l'attribution est annulée sort du plan : ses liens ajoutés deviennent « non résolus » (donc retirés d'OCE par la réconciliation).
  perform set_config('request.jwt.claim.sub',c::text,true);
  perform public.cancel_award_item_atomic('plan-cancel-0001',(select id from public.award_items where award_id=awb and request_id=r2),'award_error',null);
  d:=public.get_project_plan(proj);
  if (select count(*) from jsonb_array_elements(dao_private.oce_project_plan_for_sync(proj)->'nodes') x where x->>'title'='Tirage de câbles')<>0 then raise exception 'cancelled award must remove its sub-lots from the plan'; end if;

  -- Suivi des objets OCE appliqués (serveur) : liste puis oubli ; seuls activités et dépendances sont oubliables.
  perform dao_private.oce_record_object(m0,'activity','A1',null,repeat('1',64));
  perform dao_private.oce_record_object(m0,'activity','A2',null,repeat('2',64));
  perform dao_private.oce_record_object(m0,'dependency','A1','A2',repeat('3',64));
  if dao_private.oce_list_objects(m0)<>jsonb_build_object('activities',jsonb_build_array('A1','A2'),'dependencies',jsonb_build_array(jsonb_build_array('A1','A2'))) then raise exception 'objects list mismatch: %',dao_private.oce_list_objects(m0); end if;
  perform dao_private.oce_forget_object(m0,'dependency','A1','A2');
  perform dao_private.oce_forget_object(m0,'activity','A2',null);
  if dao_private.oce_list_objects(m0)<>jsonb_build_object('activities',jsonb_build_array('A1'),'dependencies','[]'::jsonb) then raise exception 'forget mismatch'; end if;
  begin perform dao_private.oce_forget_object(m0,'wbs','X',null); raise exception 'wbs forgotten';
  exception when invalid_parameter_value then null; end;

  -- P10-N1 simple project: active lot is trackable without sub-lots, dates,
  -- agreement, contract settings, or an OCE context.
  insert into public.projects(client_id) values(c) returning id into plain_proj;
  insert into public.project_requests(project_id) values(plain_proj) returning id into plain_request;
  insert into public.project_request_versions(request_id,project_id,version_no,trade_id,title,scope)
    values(plain_request,plain_proj,1,trade,'Lot simple','Travaux sans détail facultatif') returning id into plain_rv;
  insert into public.bids(project_id,contractor_id) values(plain_proj,pa) returning id into plain_bid;
  insert into public.bid_versions(bid_id,project_id,contractor_id,version_no,expires_at)
    values(plain_bid,plain_proj,pa,1,'2099-01-01') returning id into plain_bv;
  insert into public.bid_items(bid_version_id,project_id,request_version_id,request_id,contractor_id,price_millimes,duration_days,inclusions)
    values(plain_bv,plain_proj,plain_rv,plain_request,pa,123456,1,'Travaux attribués') returning id into plain_item;
  update public.bid_versions set status='submitted',submitted_at=now() where id=plain_bv;
  insert into public.awards(project_id,contractor_id) values(plain_proj,pa) returning id into plain_award;
  insert into public.award_items(award_id,project_id,request_id,bid_item_id,agreed_millimes,contractor_id)
    values(plain_award,plain_proj,plain_request,plain_item,123456,pa) returning id into plain_award_item;
  perform set_config('request.jwt.claim.sub',c::text,true);
  d:=public.native_execution_plan_v1(plain_proj,null,50);
  if jsonb_array_length(d->'lots')<>1
    or jsonb_array_length(d->'lots'->0->'executionSubLots')<>0
    or d->'lots'->0->'dates'->'plan'<>'null'::jsonb
    or d->'lots'->0->'dates'->'agreed'<>'null'::jsonb
    or d->'lots'->0->'modalities'<>'null'::jsonb
    or d->'lots'->0->'progress'<>'null'::jsonb
    or exists(select 1 from public.project_contract_settings where project_id=plain_proj)
    or exists(select 1 from public.oce_sync_mappings where project_id=plain_proj) then
    raise exception 'simple native tracking must not require optional configuration: %',d; end if;

  -- P10-N2: editable activities are separate from the awarded bid and have immutable history.
  update public.project_requests set status='awarded' where id=plain_request;
  perform set_config('request.jwt.claim.sub',a::text,true);
  native_result:=public.native_execution_activity_write(plain_award_item, null,'create',null,'sub_lot',
    'Sous-lot opérationnel',null,1,null,null,null,null,'native-create-0001');
  native_activity:=(native_result->>'id')::uuid;
  if native_result->>'revision'<>'1' or not (native_result->>'active')::boolean then raise exception 'native sub-lot create failed: %',native_result; end if;
  if public.native_execution_activity_write(plain_award_item,null,'create',null,'sub_lot',
      'Sous-lot opérationnel',null,1,null,null,null,null,'native-create-0001')<>native_result then
    raise exception 'native create idempotency mismatch'; end if;
  begin perform public.native_execution_activity_write(plain_award_item,null,'create',null,'sub_lot',
      'Different payload',null,1,null,null,null,null,'native-create-0001'); raise exception 'idempotency key accepted for changed payload';
  exception when invalid_parameter_value then null; end;
  native_result:=public.native_execution_activity_write(plain_award_item,null,'create',native_activity,'activity',
    'Pose',null,1,null,null,null,null,'native-create-0002');
  native_child:=(native_result->>'id')::uuid;
  begin perform public.native_execution_activity_write(plain_award_item,null,'create',native_activity,'activity',
      'Périmètre ajouté seul','Travail engageant',2,null,null,null,null,'native-create-scope-0001');
    raise exception 'direct scoped activity create bypassed bilateral acceptance'; exception when check_violation then null; end;
  native_result:=public.native_execution_activity_write(plain_award_item,native_child,'update',native_activity,'activity',
    'Pose préparée',null,2,null,null,null,1,'native-update-0001');
  if native_result->>'revision'<>'2' then raise exception 'native activity revision did not advance'; end if;
  begin perform public.native_execution_activity_write(plain_award_item,native_child,'update',native_activity,'activity',
      'Pose élargie','Périmètre augmenté',2,null,null,null,2,'native-update-scope-0001');
    raise exception 'direct scope change bypassed bilateral acceptance'; exception when check_violation then null; end;
  begin perform public.native_execution_activity_write(plain_award_item,native_child,'update',native_activity,'activity',
      'Stale title',null,2,null,null,null,1,'native-update-0002'); raise exception 'stale activity revision accepted';
  exception when serialization_failure then null; end;

  insert into public.review_assignments(project_id,reviewer_id,assigned_at) values(plain_proj,stf,now());
  perform set_config('request.jwt.claim.sub',stf::text,true);
  native_result:=public.native_execution_prepare_activity_change(plain_award_item,'update',native_child,native_activity,
    'activity','Pose confirmée','Périmètre accepté',3,null,null,null,2,'native-proposal-0001');
  native_proposal:=(native_result->>'proposalId')::uuid;
  begin perform public.native_execution_accept_activity_change(native_proposal,'accepted','manager-accept-0001');
    raise exception 'manager accepted a bilateral change'; exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',c::text,true);
  native_result:=public.native_execution_accept_activity_change(native_proposal,'accepted','client-accept-0001');
  if native_result->>'state'<>'pending_acceptance' then raise exception 'first party must leave proposal pending'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  native_result:=public.native_execution_accept_activity_change(native_proposal,'accepted','artisan-accept-0001');
  if native_result->>'state'<>'accepted' then raise exception 'bilateral activity proposal did not apply'; end if;
  if public.native_execution_accept_activity_change(native_proposal,'accepted','artisan-accept-0001')->>'state'<>'accepted' then
    raise exception 'accepted party retry must replay idempotently after proposal completion'; end if;
  if (select title from public.native_execution_activities where id=native_child)<>'Pose confirmée'
    or (select scope from public.native_execution_activities where id=native_child)<>'Périmètre accepté'
    or (select revision from public.native_execution_activities where id=native_child)<>3
    or (select count(*) from public.native_execution_activity_revisions where activity_id=native_child)<>3 then
    raise exception 'accepted activity revision was not applied with history'; end if;

  perform set_config('request.jwt.claim.sub',c::text,true);
  d:=public.native_execution_plan_v1(plain_proj,null,50);
  if d->'activities'->>'supported'<>'true'
    or not exists(select 1 from jsonb_array_elements(d->'activities'->'items') x where x->>'id'=native_child::text and x->>'title'='Pose confirmée')
    or d->'lots'->0->'permissions'->>'canEditActivities'<>'false' then
    raise exception 'native activities not present in shared DTO or permission false: %',d; end if;

  perform set_config('request.jwt.claim.sub',a::text,true);
  begin perform public.native_execution_activity_write(plain_award_item,native_activity,'retire',null,'sub_lot',
      'ignored',null,1,null,null,null,1,'native-retire-sub-0001'); raise exception 'parent sub-lot retired with active child';
  exception when check_violation then null; end;
  begin perform public.native_execution_activity_write(plain_award_item,native_child,'retire',native_activity,'activity',
      'ignored',null,1,null,null,null,3,'native-retire-scoped-child-0001'); raise exception 'scoped activity retired without bilateral acceptance';
  exception when check_violation then null; end;
  perform set_config('request.jwt.claim.sub',stf::text,true);
  native_result:=public.native_execution_prepare_activity_change(plain_award_item,'retire',native_child,native_activity,
    'activity',null,null,3,null,null,null,3,'native-retire-proposal-0001');
  native_proposal:=(native_result->>'proposalId')::uuid;
  perform set_config('request.jwt.claim.sub',c::text,true);
  native_result:=public.native_execution_accept_activity_change(native_proposal,'accepted','native-retire-client-0001');
  if native_result->>'state'<>'pending_acceptance' then raise exception 'retire proposal must wait for both parties'; end if;
  perform set_config('request.jwt.claim.sub',a::text,true);
  native_result:=public.native_execution_accept_activity_change(native_proposal,'accepted','native-retire-artisan-0001');
  if native_result->>'state'<>'accepted' then raise exception 'bilateral retire proposal did not apply'; end if;
  perform public.native_execution_activity_write(plain_award_item,native_activity,'retire',null,'sub_lot',
    'ignored',null,1,null,null,null,1,'native-retire-sub-0002');
end $$;
