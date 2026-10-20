-- #325 tranche B : contrat du planning GLOBAL du projet (migration 20261020020000_project_plan).
-- Exécuté sur base fraîche (PGlite en CI, psql en local) dans une transaction annulée : toute violation lève une exception.
do $$
declare
  c uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); stf uuid:=gen_random_uuid();
  pa uuid; pb uuid; proj uuid; r1 uuid; r2 uuid; r3 uuid; rv1 uuid; rv2 uuid; rv3 uuid; trade uuid; off1 uuid; off2 uuid;
  bida uuid; bidb uuid; va uuid; vb uuid; ia uuid; ib uuid; ic uuid; awa uuid; awb uuid;
  s1 uuid:=gen_random_uuid(); s2 uuid:=gen_random_uuid(); t1 uuid:=gen_random_uuid(); u1 uuid:=gen_random_uuid();
  d jsonb; n integer; rev integer; l1 uuid; l2 uuid; l3 uuid; lb uuid; ctx uuid; m uuid;
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

  -- Un lien rejeté peut être reconsidéré (décision la plus récente), les décisions elles-mêmes sont append-only.
  perform public.decide_plan_link(proj,l1,'rejected');
  if (select x->>'state' from jsonb_array_elements(public.get_project_plan(proj)->'links') x where x->>'id'=l1::text)<>'rejected' then raise exception 'latest decision must win'; end if;
  perform public.decide_plan_link(proj,l1,'confirmed');
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
  m:=dao_private.oce_request_mapping(proj,ctx);
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
end $$;
