-- #325 tranche A : contrat des sous-lots proposés par l'Artisan (migration 20261020010000_bid_sub_lots).
-- Exécuté sur une base fraîche (PGlite en CI, psql en local) : toute violation lève une exception.
do $$
declare
  c uuid:=gen_random_uuid(); a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); stf uuid:=gen_random_uuid();
  pa uuid; pb uuid; proj uuid; r1 uuid; r2 uuid; r3 uuid; rv1 uuid; rv2 uuid; rv3 uuid; trade uuid; off uuid;
  bida uuid; bidb uuid; va uuid; vb uuid; ia uuid; ib uuid; n integer; k1 uuid:=gen_random_uuid(); k2 uuid:=gen_random_uuid(); k3 uuid:=gen_random_uuid();
  err text; links integer; gov uuid; pv uuid; pub uuid; pr1 uuid; pr2 uuid; ref_lots integer; ref_subs integer;
begin
  insert into auth.users(id,email) values(c,'c@x.test'),(a,'a@x.test'),(b,'b@x.test'),(stf,'s@x.test');
  insert into public.user_roles(user_id,role) values(c,'client'),(a,'contractor'),(b,'contractor'),(stf,'dao_admin');
  insert into public.contractor_profiles(user_id,business_name,verification_status) values(a,'A','verified') returning id into pa;
  insert into public.contractor_profiles(user_id,business_name,verification_status) values(b,'B','verified') returning id into pb;
  select id into trade from public.trades limit 1;
  insert into public.projects(client_id) values(c) returning id into proj;
  insert into public.project_requests(project_id) values(proj) returning id into r1;
  insert into public.project_requests(project_id) values(proj) returning id into r2;
  insert into public.project_requests(project_id) values(proj) returning id into r3;
  insert into public.project_request_versions(request_id,project_id,version_no,trade_id,title,scope) values(r1,proj,1,trade,'Maçonnerie','m') returning id into rv1;
  insert into public.project_request_versions(request_id,project_id,version_no,trade_id,title,scope) values(r2,proj,1,trade,'Électricité','e') returning id into rv2;
  insert into public.project_request_versions(request_id,project_id,version_no,trade_id,title,scope) values(r3,proj,1,trade,'Peinture','p') returning id into rv3;
  insert into public.request_sub_lots(request_id,project_id) values(r2,proj) returning id into off;
  insert into public.governorates(code,name_fr,name_ar) values('T325','Test','اختبار') returning id into gov;
  insert into public.project_versions(project_id,version_no,title,description,governorate_id) values(proj,1,'P','d',gov) returning id into pv;
  insert into public.publications(project_id,project_version_id,visibility,safe_title,safe_description,governorate_id) values(proj,pv,'public','DAO','d',gov) returning id into pub;
  insert into public.request_sub_lot_versions(sub_lot_id,request_id,project_id,request_version_id,ordinal,title,scope) values(off,r2,proj,rv2,0,'Câblage','c');
  insert into public.publication_requests(publication_id,request_version_id,trade_id,safe_title,safe_scope) values(pub,rv1,trade,'Maçonnerie','m') returning id into pr1;
  insert into public.publication_requests(publication_id,request_version_id,trade_id,safe_title,safe_scope) values(pub,rv2,trade,'Électricité','e') returning id into pr2;
  insert into public.bids(project_id,contractor_id) values(proj,pa) returning id into bida;
  insert into public.bids(project_id,contractor_id) values(proj,pb) returning id into bidb;
  insert into public.bid_versions(bid_id,project_id,contractor_id,version_no,expires_at) values(bida,proj,pa,1,'2099-01-01') returning id into va;
  insert into public.bid_versions(bid_id,project_id,contractor_id,version_no,expires_at) values(bidb,proj,pb,1,'2099-01-01') returning id into vb;
  insert into public.bid_items(bid_version_id,project_id,request_version_id,request_id,contractor_id,price_millimes,duration_days,inclusions)
    values(va,proj,rv1,r1,pa,1000000,20,'tout') returning id into ia;
  insert into public.bid_items(bid_version_id,project_id,request_version_id,request_id,contractor_id,price_millimes,duration_days,inclusions)
    values(vb,proj,rv1,r1,pb,900000,15,'tout') returning id into ib;


  -- Référents officiels : l'Artisan voit les lots et sous-lots officiels de CE DAO, avec l'identifiant stable du lot (project_requests.id).
  perform set_config('request.jwt.claim.sub',a::text,true);
  select count(*) filter (where kind='lot'),count(*) filter (where kind='official_sub_lot') into ref_lots,ref_subs from public.bid_link_referents(pub);
  if ref_lots<>2 or ref_subs<>1 then raise exception 'referents expected 2 lots + 1 sub-lot, got % + %',ref_lots,ref_subs; end if;
  if not exists(select 1 from public.bid_link_referents(pub) where kind='lot' and ref=r2) then raise exception 'lot referent must expose project_requests.id'; end if;
  if (select count(*) from public.bid_link_referents(gen_random_uuid()))<>0 then raise exception 'unknown publication leaked referents'; end if;

  -- Artisan A crée ses sous-lots (dont un qui référence un sous-lot officiel, sur un autre lot) : OK.
  perform set_config('request.jwt.claim.sub',a::text,true);
  select count(*) into n from public.replace_bid_sub_lots(ia,jsonb_build_array(
    jsonb_build_object('node_key',k1,'title','Rainures','start_date','2027-01-10','end_date','2027-01-14','duration_days',5,'budget_millimes',400000),
    jsonb_build_object('node_key',k2,'title','Reprise murs','budget_millimes',600000,'official_sub_lot_id',null)));
  if n<>2 then raise exception 'expected 2 sub-lots, got %',n; end if;

  -- Budget qui dépasse le prix proposé : refusé et rien n'est modifié.
  begin
    perform * from public.replace_bid_sub_lots(ia,jsonb_build_array(jsonb_build_object('title','Trop cher','budget_millimes',1000001)));
    raise exception 'budget over price accepted';
  exception when check_violation then null; end;
  select count(*) into n from public.bid_sub_lots where bid_item_id=ia; if n<>2 then raise exception 'rollback expected, got %',n; end if;

  -- Dates incohérentes / durée incohérente / dates partielles : refusées par contrainte.
  foreach err in array array['{"title":"x","start_date":"2027-02-02","end_date":"2027-02-01"}','{"title":"x","start_date":"2027-02-01"}','{"title":"x","start_date":"2027-02-01","end_date":"2027-02-03","duration_days":9}'] loop
    begin perform * from public.replace_bid_sub_lots(ia,jsonb_build_array(err::jsonb)); raise exception 'invalid dates accepted: %',err;
    exception when check_violation then null; end;
  end loop;

  -- Liens : proposition -> proposition et proposition -> lot officiel du chantier.
  select count(*) into n from public.replace_bid_sub_lot_links(va,jsonb_build_array(
    jsonb_build_object('pred_kind','proposal','pred_ref',k1,'succ_kind','proposal','succ_ref',k2),
    jsonb_build_object('pred_kind','proposal','pred_ref',k2,'succ_kind','lot','succ_ref',r2),
    jsonb_build_object('pred_kind','official_sub_lot','pred_ref',off,'succ_kind','proposal','succ_ref',k1)));
  if n<>3 then raise exception 'expected 3 links, got %',n; end if;

  -- Cycle, auto-lien, doublon, référence introuvable, référent d'un autre chantier : refusés.
  begin perform * from public.replace_bid_sub_lot_links(va,jsonb_build_array(
    jsonb_build_object('pred_kind','proposal','pred_ref',k1,'succ_kind','proposal','succ_ref',k2),
    jsonb_build_object('pred_kind','proposal','pred_ref',k2,'succ_kind','proposal','succ_ref',k1))); raise exception 'cycle accepted';
  exception when check_violation then null; end;
  begin perform * from public.replace_bid_sub_lot_links(va,jsonb_build_array(jsonb_build_object('pred_kind','proposal','pred_ref',k1,'succ_kind','proposal','succ_ref',k1))); raise exception 'self link accepted';
  exception when check_violation then null; end;
  begin perform * from public.replace_bid_sub_lot_links(va,jsonb_build_array(
    jsonb_build_object('pred_kind','proposal','pred_ref',k1,'succ_kind','lot','succ_ref',r2),
    jsonb_build_object('pred_kind','proposal','pred_ref',k1,'succ_kind','lot','succ_ref',r2))); raise exception 'duplicate accepted';
  exception when unique_violation then null; end;
  begin perform * from public.replace_bid_sub_lot_links(va,jsonb_build_array(jsonb_build_object('pred_kind','proposal','pred_ref',k1,'succ_kind','lot','succ_ref',gen_random_uuid()))); raise exception 'unknown ref accepted';
  exception when invalid_parameter_value then null; end;
  begin perform * from public.replace_bid_sub_lot_links(va,jsonb_build_array(jsonb_build_object('pred_kind','lot','pred_ref',r1,'succ_kind','lot','succ_ref',r2))); raise exception 'link without own node accepted';
  exception when check_violation then null; end;
  select count(*) into links from public.bid_sub_lot_links where bid_version_id=va; if links<>3 then raise exception 'links must be unchanged after rejections, got %',links; end if;

  -- Supprimer un sous-lot emporte ses liens ; les autres restent.
  perform * from public.replace_bid_sub_lots(ia,jsonb_build_array(jsonb_build_object('node_key',k1,'title','Rainures')));
  select count(*) into links from public.bid_sub_lot_links where bid_version_id=va; if links<>1 then raise exception 'dangling links not removed, got %',links; end if;

  -- Artisan B ne peut pas toucher l'offre de A, ni la voir.
  perform set_config('request.jwt.claim.sub',b::text,true);
  begin perform * from public.replace_bid_sub_lots(ia,'[]'::jsonb); raise exception 'rival wrote A sub-lots';
  exception when insufficient_privilege then null; end;
  begin perform * from public.replace_bid_sub_lot_links(va,'[]'::jsonb); raise exception 'rival wrote A links';
  exception when insufficient_privilege then null; end;
  set local role authenticated;
  select count(*) into n from public.bid_sub_lots; if n<>0 then raise exception 'rival sees % sub-lots of A',n; end if;
  select count(*) into n from public.bid_sub_lot_links; if n<>0 then raise exception 'rival sees % links of A',n; end if;
  begin insert into public.bid_sub_lots(bid_version_id,bid_item_id,project_id,request_id,contractor_id,node_key,position,title) values(va,ia,proj,r1,pa,gen_random_uuid(),9,'x'); raise exception 'direct insert allowed';
  exception when insufficient_privilege then null; end;
  reset role;

  -- Client : ne voit rien tant que l'offre n'est pas soumise, puis voit les sous-lots de l'offre soumise (et pas ceux d'un autre brouillon).
  perform set_config('request.jwt.claim.sub',c::text,true);
  set local role authenticated;
  select count(*) into n from public.bid_sub_lots; if n<>0 then raise exception 'client sees draft sub-lots (%)',n; end if;
  reset role;
  update public.bid_versions set status='submitted',submitted_at=now() where id=va;
  set local role authenticated;
  select count(*) into n from public.bid_sub_lots; if n<>1 then raise exception 'client must see the submitted sub-lot, got %',n; end if;
  select count(*) into n from public.bid_sub_lot_links; if n<>1 then raise exception 'client must see the submitted link, got %',n; end if;
  reset role;

  -- Offre soumise : contenu immuable (RPC et écriture directe).
  perform set_config('request.jwt.claim.sub',a::text,true);
  begin perform * from public.replace_bid_sub_lots(ia,'[]'::jsonb); raise exception 'submitted offer sub-lots modified';
  exception when insufficient_privilege then null; end;
  begin delete from public.bid_sub_lots where bid_item_id=ia; raise exception 'submitted sub-lots deleted';
  exception when check_violation then null; end;

  -- Aucun effet commercial : ni award ni contrat n'ont été créés par ces écritures.
  select count(*) into n from public.awards where project_id=proj; if n<>0 then raise exception 'sub-lots created an award'; end if;
  select count(*) into n from public.contracts where project_id=proj; if n<>0 then raise exception 'sub-lots created a contract'; end if;

  -- Détection de cycle générique (réutilisée par le graphe global de chantier).
  if dao_private.edges_have_cycle(array['a','b','c'],array['b','c','d']) then raise exception 'chain flagged as cycle'; end if;
  if not dao_private.edges_have_cycle(array['a','b','c'],array['b','c','a']) then raise exception 'triangle not detected'; end if;
  if dao_private.edges_have_cycle(array['a','a','b','c'],array['b','c','d','d']) then raise exception 'diamond flagged as cycle'; end if;
  if dao_private.edges_have_cycle('{}','{}') then raise exception 'empty graph flagged as cycle'; end if;
end $$;
