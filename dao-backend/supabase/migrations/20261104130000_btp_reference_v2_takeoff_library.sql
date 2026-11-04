-- #561 — Référentiel BTP V2 et bibliothèque de métrés.
-- Additif : crée un brouillon TN-2026.3 dérivé de TN-2026.1.
-- La version reste volontairement non publiée : aucune version publiée existante
-- n'est modifiée et aucun ouvrage n'est rendu visible aux consommateurs publics.
begin;

do $$
declare
  base_id uuid;
  draft_id uuid := '56110000-0000-4000-8000-000000000001';
  lot_id uuid := '56110000-0000-4000-8000-000000000101';
  envelope_id uuid := '56110000-0000-4000-8000-000000000201';
  services_id uuid := '56110000-0000-4000-8000-000000000202';
  masonry_trade uuid;
begin
  select id into base_id
  from public.btp_catalog_versions
  where code='TN-2026.1' and status='published'
  order by effective_from desc
  limit 1;
  if base_id is null then
    raise exception 'TN-2026.1 publiée introuvable';
  end if;

  if exists(select 1 from public.btp_catalog_versions where code='TN-2026.3') then
    return;
  end if;
  if exists(select 1 from public.btp_catalog_versions where country_code='TN' and status='draft') then
    raise exception using errcode='23505', message='Un brouillon TN existe déjà ; publication #561 à préparer via administration';
  end if;
  select id into masonry_trade from public.trades where code='trade_masonry' and active;
  if masonry_trade is null then
    raise exception 'Métier maçonnerie actif introuvable';
  end if;

  insert into public.btp_catalog_versions(
    id,code,country_code,status,effective_from,provenance,based_on_version_id
  ) values (
    draft_id,'TN-2026.3','TN','draft',current_date,
    jsonb_build_object(
      'label','Référentiel BTP D.A.O. V2 — construction et rénovation',
      'scope','Brouillon additif #561 ; ne vaut ni norme, ni étude, ni bordereau de prix',
      'based_on','TN-2026.1',
      'verified_on','2026-11-04',
      'publication','PUBLISH BLOCKED — décision propriétaire requise'
    ),base_id
  );

  -- Keep the draft complete: copy V1 rows first, retaining canonical ids while
  -- isolating every row under the new composite version key.
  insert into public.btp_lots(id,catalog_version_id,code,trade_id,label_fr,description_fr,default_relevance,project_types,position,source_ref,active)
    select id,draft_id,code,trade_id,label_fr,description_fr,default_relevance,project_types,position,source_ref,active from public.btp_lots where catalog_version_id=base_id;
  insert into public.btp_sub_lots(id,catalog_version_id,lot_id,code,label_fr,description_fr,default_relevance,project_types,position,source_ref,active)
    select s.id,draft_id,s.lot_id,s.code,s.label_fr,s.description_fr,s.default_relevance,s.project_types,s.position,s.source_ref,s.active from public.btp_sub_lots s where s.catalog_version_id=base_id;
  insert into public.btp_works(id,catalog_version_id,sub_lot_id,code,label_fr,description_fr,unit_code,default_relevance,project_types,aliases_fr,required_inputs,measurement_note,position,source_ref,active)
    select w.id,draft_id,w.sub_lot_id,w.code,w.label_fr,w.description_fr,w.unit_code,w.default_relevance,w.project_types,w.aliases_fr,w.required_inputs,w.measurement_note,w.position,w.source_ref,w.active from public.btp_works w where w.catalog_version_id=base_id;
  insert into public.btp_rules(id,catalog_version_id,code,rule_type,severity,subject_codes,condition,effect,explanation_fr,source_ref,active)
    select r.id,draft_id,r.code,r.rule_type,r.severity,r.subject_codes,r.condition,r.effect,r.explanation_fr,r.source_ref,r.active from public.btp_rules r where r.catalog_version_id=base_id;
  insert into public.btp_work_dependencies(id,catalog_version_id,predecessor_work_id,successor_work_id,relation_type,applicability,mandatory,explanation_fr,source_ref)
    select id,draft_id,predecessor_work_id,successor_work_id,relation_type,applicability,mandatory,explanation_fr,source_ref from public.btp_work_dependencies where catalog_version_id=base_id;
  insert into public.btp_measurement_templates(id,catalog_version_id,work_id,output_unit_code,input_schema,formula_ast,rounding_scale,assumptions_fr,source_ref,active)
    select id,draft_id,work_id,output_unit_code,input_schema,formula_ast,rounding_scale,assumptions_fr,source_ref,active from public.btp_measurement_templates where catalog_version_id=base_id;

  insert into public.btp_lots(
    id,catalog_version_id,code,trade_id,label_fr,description_fr,default_relevance,
    project_types,position,source_ref,active
  ) values (
    lot_id,draft_id,'btp_lot_complements',masonry_trade,
    'Compléments enveloppe et équipements',
    'Familles complémentaires pour construction et rénovation ; sélection explicite.',
    'conditional',array['construction','renovation','extension','repair']::text[],95,
    'D.A.O. #561 — extension éditoriale V2, à confirmer par professionnel',true
  );
  insert into public.btp_sub_lots(
    id,catalog_version_id,lot_id,code,label_fr,description_fr,default_relevance,
    project_types,position,source_ref,active
  ) values
    (envelope_id,draft_id,lot_id,'btp_sub_envelope_complements',
     'Façades, isolation et supports',
     'Mesures de surfaces déclarées ou relevées ; pas de performance normative déduite.',
     'conditional',array['construction','renovation','extension','repair']::text[],10,
     'D.A.O. #561 — enveloppe à confirmer par professionnel',true),
    (services_id,draft_id,lot_id,'btp_sub_equipment_complements',
     'Équipements et points techniques',
     'Dénombrements et tracés fournis ; aucun dimensionnement technique automatique.',
     'conditional',array['construction','renovation','extension','repair']::text[],20,
     'D.A.O. #561 — équipements à confirmer par professionnel',true);

  insert into public.btp_works(
    id,catalog_version_id,sub_lot_id,code,label_fr,description_fr,unit_code,
    default_relevance,project_types,aliases_fr,required_inputs,measurement_note,
    position,source_ref,active
  ) values
    ('56110000-0000-4000-8000-000000000301',draft_id,envelope_id,'btp_work_facade_render',
     'Enduit ou parement de façade','Surface nette de support confirmée.','m2','conditional',
     array['construction','renovation','extension','repair']::text[],array['façade','enduit'],
     array['surface_area_m2']::text[],'Aucune épaisseur ni perte implicite.',10,
     'D.A.O. #561 — modèle surface nette, source à préciser',true),
    ('56110000-0000-4000-8000-000000000302',draft_id,envelope_id,'btp_work_external_insulation',
     'Isolation extérieure','Surface de paroi relevée ; performance et composition hors calcul.', 'm2','verify',
     array['construction','renovation','extension','repair']::text[],array['ITE','isolation'],
     array['surface_area_m2']::text[],'Confirmer support, système et étude thermique.',20,
     'D.A.O. #561 — mesure géométrique uniquement',true),
    ('56110000-0000-4000-8000-000000000303',draft_id,envelope_id,'btp_work_roof_waterproofing_surface',
     'Étanchéité de toiture ou terrasse','Surface de support mesurée, système à confirmer.', 'm2','verify',
     array['construction','renovation','extension','repair']::text[],array['toiture','terrasse'],
     array['surface_area_m2']::text[],'Aucun recouvrement ni pente inventé.',30,
     'D.A.O. #561 — mesure de surface à confirmer',true),
    ('56110000-0000-4000-8000-000000000304',draft_id,services_id,'btp_work_verified_pipe_route',
     'Tracé vérifié de canalisation','Longueur issue d’un tracé fourni ou relevé.', 'm','conditional',
     array['construction','renovation','extension','repair']::text[],array['réseau','canalisation'],
     array['verified_route_length_m']::text[],'Diamètre, pente et accessoires hors calcul.',10,
     'D.A.O. #561 — longueur de tracé vérifiée',true),
    ('56110000-0000-4000-8000-000000000305',draft_id,services_id,'btp_work_sanitary_fixture_count',
     'Équipements sanitaires dénombrés','Nombre explicitement fourni par le projet.', 'unit','conditional',
     array['construction','renovation','extension','repair']::text[],array['WC','lavabo','douche'],
     array['fixture_count']::text[],'Aucun ratio par surface ou par pièce.',20,
     'D.A.O. #561 — dénombrement déclaré',true),
    ('56110000-0000-4000-8000-000000000306',draft_id,services_id,'btp_work_electrical_point_count',
     'Points électriques dénombrés','Nombre de points fourni par le plan ou le relevé.', 'unit','verify',
     array['construction','renovation','extension','repair']::text[],array['prise','éclairage'],
     array['verified_point_count']::text[],'Aucun dimensionnement électrique ni règle locale déduite.',30,
     'D.A.O. #561 — dénombrement à confirmer par électricien',true),
    ('56110000-0000-4000-8000-000000000307',draft_id,services_id,'btp_work_opening_count',
     'Portes et fenêtres dénombrées','Nombre d’ouvertures fourni ; dimensions et performances séparées.', 'unit','conditional',
     array['construction','renovation','extension','repair']::text[],array['menuiserie','baie'],
     array['opening_count']::text[],'Aucune dimension ni performance inventée.',40,
     'D.A.O. #561 — dénombrement des ouvertures',true),
    ('56110000-0000-4000-8000-000000000308',draft_id,services_id,'btp_work_floor_screed_surface',
     'Chape ou support de sol','Surface de sol confirmée, épaisseur hors moteur.', 'm2','conditional',
     array['construction','renovation','extension','repair']::text[],array['chape','support'],
     array['surface_area_m2']::text[],'Aucune épaisseur ni quantité de matériau déduite.',50,
     'D.A.O. #561 — surface nette confirmée',true),
    ('56110000-0000-4000-8000-000000000309',draft_id,services_id,'btp_work_demolition_surface',
     'Dépose ou démolition de surface','Surface existante mesurée après diagnostic.', 'm2','verify',
     array['renovation','extension','repair']::text[],array['dépose','démolition'],
     array['surface_area_m2']::text[],'Diagnostic et tri des supports requis.',60,
     'D.A.O. #561 — surface de dépose à confirmer',true);

  insert into public.btp_measurement_templates(
    id,catalog_version_id,work_id,output_unit_code,input_schema,formula_ast,
    assumptions_fr,source_ref,active
  )
  select
    x.id,draft_id,w.id,x.unit_code,
    jsonb_build_object(
      'required',jsonb_build_array(x.required_input),
      'properties',jsonb_build_object(x.required_input,jsonb_build_object('type','number','minimum',0)),
      'x-dao',jsonb_build_object(
        'constructionTypes',array['construction','renovation','extension','repair']::text[],
        'support','dimension confirmée ou tracé/relevé fourni',
        'professionalConfirmation',x.professional_confirmation
      )
    ),
    jsonb_build_object('op','identity','arg',x.required_input),
    array[
      'Aucune valeur par défaut ni majoration implicite.',
      x.assumption
    ]::text[],
    x.source_ref,true
  from (values
    ('56110000-0000-4000-8000-000000000601'::uuid,'btp_work_facade_render','m2','surface_area_m2',false,'Surface nette uniquement.','D.A.O. #561 — bibliothèque V2'),
    ('56110000-0000-4000-8000-000000000602'::uuid,'btp_work_external_insulation','m2','surface_area_m2',true,'Support et système à confirmer.','D.A.O. #561 — bibliothèque V2'),
    ('56110000-0000-4000-8000-000000000603'::uuid,'btp_work_roof_waterproofing_surface','m2','surface_area_m2',true,'Pente et système à confirmer.','D.A.O. #561 — bibliothèque V2'),
    ('56110000-0000-4000-8000-000000000604'::uuid,'btp_work_verified_pipe_route','m','verified_route_length_m',true,'Tracé vérifié uniquement.','D.A.O. #561 — bibliothèque V2'),
    ('56110000-0000-4000-8000-000000000605'::uuid,'btp_work_sanitary_fixture_count','unit','fixture_count',false,'Nombre explicitement déclaré.','D.A.O. #561 — bibliothèque V2'),
    ('56110000-0000-4000-8000-000000000606'::uuid,'btp_work_electrical_point_count','unit','verified_point_count',true,'Dénombrement à confirmer par professionnel.','D.A.O. #561 — bibliothèque V2'),
    ('56110000-0000-4000-8000-000000000607'::uuid,'btp_work_opening_count','unit','opening_count',false,'Nombre fourni par le relevé.','D.A.O. #561 — bibliothèque V2'),
    ('56110000-0000-4000-8000-000000000608'::uuid,'btp_work_floor_screed_surface','m2','surface_area_m2',false,'Épaisseur hors métrage de surface.','D.A.O. #561 — bibliothèque V2'),
    ('56110000-0000-4000-8000-000000000609'::uuid,'btp_work_demolition_surface','m2','surface_area_m2',true,'Diagnostic préalable requis.','D.A.O. #561 — bibliothèque V2')
  ) x(id,work_code,unit_code,required_input,professional_confirmation,assumption,source_ref)
  join public.btp_works w on w.catalog_version_id=draft_id and w.code=x.work_code;

  insert into public.btp_rules(
    id,catalog_version_id,code,rule_type,severity,subject_codes,condition,effect,
    explanation_fr,source_ref,active
  ) values
    ('56110000-0000-4000-8000-000000000701',draft_id,'v2_surface_requires_source',
     'validation','blocking',
     array['btp_work_facade_render','btp_work_external_insulation','btp_work_floor_screed_surface'],
     jsonb_build_object('measurement_requested',true),
     jsonb_build_object('requires',array['confirmed_dimension','source']),
     'Une surface ne peut être calculée sans dimension et provenance explicites.',
     'D.A.O. #561 — règle V2 sans valeur implicite',true),
    ('56110000-0000-4000-8000-000000000702',draft_id,'v2_professional_confirmation',
     'prerequisite','warning',
     array['btp_work_external_insulation','btp_work_roof_waterproofing_surface','btp_work_verified_pipe_route','btp_work_electrical_point_count','btp_work_demolition_surface'],
     jsonb_build_object('calculation_requested',true),
     jsonb_build_object('requires','professional_confirmation'),
     'Le résultat géométrique reste à confirmer par le professionnel compétent.',
     'D.A.O. #561 — limite de responsabilité explicite',true),
    ('56110000-0000-4000-8000-000000000703',draft_id,'v2_renovation_no_inference',
     'warning','warning',
     array['btp_work_demolition_surface','btp_work_floor_screed_surface'],
     jsonb_build_object('project_type','renovation'),
     jsonb_build_object('requires',array['existing_condition','measured_scope']),
     'Une rénovation ne déduit jamais une surface à partir de la seule surface habitable.',
     'D.A.O. #561 — rénovation sans inférence',true);

  insert into public.btp_work_dependencies(
    id,catalog_version_id,predecessor_work_id,successor_work_id,relation_type,
    applicability,mandatory,explanation_fr,source_ref
  ) values
    ('56110000-0000-4000-8000-000000000801',draft_id,
     '54110000-0000-4000-8000-000000000313','56110000-0000-4000-8000-000000000309',
     'information',jsonb_build_object('projectTypes',array['renovation','extension']::text[]),true,
     'Le périmètre de dépose doit être établi avant le métrage de la surface concernée.',
     'D.A.O. #561 — dépendance logique à confirmer'),
    ('56110000-0000-4000-8000-000000000802',draft_id,
     '54110000-0000-4000-8000-000000000307','56110000-0000-4000-8000-000000000302',
     'interface',jsonb_build_object('projectTypes',array['construction','renovation','extension']::text[]),false,
     'Le support d’étanchéité doit être connu avant de qualifier une isolation extérieure.',
     'D.A.O. #561 — dépendance logique à confirmer');
end $$;

commit;
