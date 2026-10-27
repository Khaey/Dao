-- BUGS2-05 (#465) : référentiel métiers administrable, sans second catalogue.
-- * Référentiel initial élargi (clés stables `trade_*`, lignes existantes préservées).
-- * Admin : ajouter / renommer un métier (audité dans setting_events, motif obligatoire) ;
--   l'activation existante (admin_set_trade_active) reste la seule façon de retirer un
--   métier des nouveaux dossiers, sans suppression ni réécriture de l'historique.
-- * Client / Artisan : « proposer un métier » = proposition textuelle privée, revue par
--   l'Admin ; aucune catégorie publique n'est créée automatiquement.
begin;

insert into public.trades(code,name_fr,active) values
  ('trade_masonry','Maçonnerie et gros œuvre',true),
  ('trade_tiling','Carrelage et faïence',true),
  ('trade_painting','Peinture',true),
  ('trade_plaster','Plâtrerie et faux plafonds',true),
  ('trade_waterproofing','Étanchéité',true),
  ('trade_wood_joinery','Menuiserie bois',true),
  ('trade_alu_joinery','Menuiserie aluminium et PVC',true),
  ('trade_metalwork','Ferronnerie et serrurerie',true),
  ('trade_hvac','Climatisation et ventilation',true),
  ('trade_heating','Chauffage',true),
  ('trade_earthworks','Terrassement',true),
  ('trade_demolition','Démolition',true),
  ('trade_roofing','Charpente et couverture',true),
  ('trade_insulation','Isolation',true),
  ('trade_marble','Marbre et pierre',true),
  ('trade_glazing','Vitrerie',true),
  ('trade_sanitation','Assainissement',true),
  ('trade_solar','Énergie solaire et photovoltaïque',true),
  ('trade_pool','Piscine',true),
  ('trade_landscaping','Aménagement extérieur et jardin',true),
  ('trade_kitchen','Cuisine et agencement',true),
  ('trade_flooring','Revêtements de sols',true),
  ('trade_low_voltage','Domotique et courants faibles',true),
  ('trade_facade','Façades et ravalement',true),
  ('trade_cleaning','Nettoyage de fin de chantier',true)
on conflict(code) do nothing;

alter table dao_private.setting_events drop constraint setting_events_action_check;
alter table dao_private.setting_events add constraint setting_events_action_check
  check (action in ('set','clear','trade_active','trade_create','trade_rename','trade_proposal'));

-- Normalised label used to refuse visual duplicates (case, spaces, common accents).
create function dao_private.trade_label_key(p_label text) returns text
language sql immutable set search_path='' as $$
  select translate(lower(regexp_replace(btrim(coalesce(p_label,'')),'\s+',' ','g')),
    'àâäáãçéèêëíìîïñóòôöõúùûüýÿœ','aaaaaceeeeiiiinooooouuuuyyo');
$$;

create function dao_private.admin_save_trade(p_trade_id uuid, p_name_fr text, p_name_ar text, p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=dao_private.settings_require_admin(); t public.trades; clean text:=btrim(regexp_replace(coalesce(p_name_fr,''),'\s+',' ','g'));
  clean_ar text:=nullif(btrim(coalesce(p_name_ar,'')),''); ver bigint;
begin
  if length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception using errcode='22023', message='Motif obligatoire (5 à 500 caractères)';
  end if;
  if length(clean) not between 2 and 80 or clean ~ '[<>{}]' or (clean_ar is not null and length(clean_ar) > 80) then
    raise exception using errcode='22023', message='Nom de métier invalide (2 à 80 caractères)';
  end if;
  if exists(select 1 from public.trades x where dao_private.trade_label_key(x.name_fr)=dao_private.trade_label_key(clean)
      and x.id is distinct from p_trade_id) then
    raise exception using errcode='23505', message='Un métier portant ce nom existe déjà';
  end if;
  if p_trade_id is null then
    insert into public.trades(code,name_fr,name_ar,active)
    values('trade_'||substr(replace(gen_random_uuid()::text,'-',''),1,12),clean,clean_ar,true) returning * into t;
    ver:=dao_private.settings_bump_version();
    insert into dao_private.setting_events(actor_id,action,key,scope_type,target_ref,old_value,new_value,reason,settings_version)
    values(actor,'trade_create','catalog.trades.active','global',t.code,null,to_jsonb(clean),btrim(p_reason),ver);
  else
    select * into t from public.trades where id=p_trade_id for update;
    if not found then raise exception using errcode='22023', message='Métier introuvable'; end if;
    if t.name_fr=clean and t.name_ar is not distinct from clean_ar then return jsonb_build_object('trade_id',t.id,'changed',false); end if;
    ver:=dao_private.settings_bump_version();
    insert into dao_private.setting_events(actor_id,action,key,scope_type,target_ref,old_value,new_value,reason,settings_version)
    values(actor,'trade_rename','catalog.trades.active','global',t.code,to_jsonb(t.name_fr),to_jsonb(clean),btrim(p_reason),ver);
    -- Rename only: id and code stay, so every lot, offer and profile keeps its link.
    update public.trades set name_fr=clean,name_ar=clean_ar where id=t.id returning * into t;
  end if;
  return jsonb_build_object('trade_id',t.id,'code',t.code,'name',t.name_fr,'changed',true,'version',ver);
end;
$$;

create table public.trade_proposals (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  proposer_id uuid not null references auth.users,
  label text not null check (length(label) between 2 and 80),
  context text not null check (context in ('project','profile')),
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  trade_id uuid references public.trades,
  reviewed_by uuid references auth.users,
  reviewed_at timestamptz,
  review_reason text check (review_reason is null or length(review_reason) between 5 and 500),
  check ((status='pending') = (reviewed_at is null)),
  check (status<>'accepted' or trade_id is not null)
);
create index trade_proposals_pending on public.trade_proposals(created_at) where status='pending';
create index trade_proposals_proposer on public.trade_proposals(proposer_id,created_at desc);
alter table public.trade_proposals enable row level security;
revoke all on public.trade_proposals from anon,authenticated;
grant select on public.trade_proposals to authenticated;
grant all on public.trade_proposals to service_role;
create policy trade_proposals_own on public.trade_proposals for select to authenticated
  using (proposer_id=auth.uid() or dao_private.admin());

create function dao_private.propose_trade(p_label text, p_context text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); clean text:=btrim(regexp_replace(coalesce(p_label,''),'\s+',' ','g')); p public.trade_proposals; existing public.trades;
begin
  if actor is null or not dao_private.account_active(actor) then raise exception using errcode='42501', message='Compte actif requis'; end if;
  if p_context not in ('project','profile') then raise exception using errcode='22023', message='Contexte invalide'; end if;
  if length(clean) not between 2 and 80 or clean ~ '[<>{}]' then
    raise exception using errcode='22023', message='Indiquez le métier en 2 à 80 caractères';
  end if;
  select * into existing from public.trades t where t.active and dao_private.trade_label_key(t.name_fr)=dao_private.trade_label_key(clean) limit 1;
  if found then return jsonb_build_object('status','exists','trade_id',existing.id,'name',existing.name_fr); end if;
  select * into p from public.trade_proposals x where x.proposer_id=actor and x.status='pending'
    and dao_private.trade_label_key(x.label)=dao_private.trade_label_key(clean) limit 1;
  if found then return jsonb_build_object('status','pending','proposal_id',p.id); end if;
  if (select count(*) from public.trade_proposals x where x.proposer_id=actor and x.created_at>now()-interval '1 day') >= 5 then
    raise exception using errcode='P0001', message='Trop de propositions aujourd’hui. Réessayez demain.';
  end if;
  insert into public.trade_proposals(proposer_id,label,context) values(actor,clean,p_context) returning * into p;
  return jsonb_build_object('status','pending','proposal_id',p.id);
end;
$$;

create function dao_private.admin_trade_proposals() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform dao_private.settings_require_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'created_at',x.created_at,'label',x.label,'context',x.context,
      'proposer',coalesce(pr.display_name,'Utilisateur D.A.O.')) order by x.created_at)
    from public.trade_proposals x left join public.profiles pr on pr.user_id=x.proposer_id where x.status='pending'),'[]'::jsonb);
end;
$$;

-- accept: map to an existing trade (p_trade_id) or create one named p_name; reject: reason only.
create function dao_private.admin_review_trade_proposal(p_proposal_id uuid, p_decision text, p_trade_id uuid, p_name text, p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=dao_private.settings_require_admin(); p public.trade_proposals; target uuid:=p_trade_id; ver bigint;
begin
  if p_decision not in ('accept','reject') or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception using errcode='22023', message='Décision et motif (5 à 500 caractères) obligatoires';
  end if;
  select * into p from public.trade_proposals where id=p_proposal_id for update;
  if not found or p.status<>'pending' then raise exception using errcode='22023', message='Proposition introuvable ou déjà traitée'; end if;
  if p_decision='accept' then
    if target is null then
      target:=(dao_private.admin_save_trade(null,coalesce(nullif(btrim(p_name),''),p.label),null,p_reason)->>'trade_id')::uuid;
    elsif not exists(select 1 from public.trades where id=target and active) then
      raise exception using errcode='22023', message='Métier cible introuvable ou inactif';
    end if;
  end if;
  update public.trade_proposals set status=case when p_decision='accept' then 'accepted' else 'rejected' end,
    trade_id=case when p_decision='accept' then target end, reviewed_by=actor, reviewed_at=now(), review_reason=btrim(p_reason)
  where id=p.id;
  ver:=dao_private.settings_bump_version();
  insert into dao_private.setting_events(actor_id,action,key,scope_type,target_ref,old_value,new_value,reason,settings_version)
  values(actor,'trade_proposal','catalog.trades.active','global',p.id::text,to_jsonb(p.label),
    jsonb_build_object('decision',p_decision,'trade_id',target),btrim(p_reason),ver);
  return jsonb_build_object('proposal_id',p.id,'status',case when p_decision='accept' then 'accepted' else 'rejected' end,'trade_id',target);
end;
$$;

create function public.admin_save_trade(p_trade_id uuid, p_name_fr text, p_name_ar text, p_reason text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.admin_save_trade($1,$2,$3,$4); $$;
create function public.propose_trade(p_label text, p_context text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.propose_trade($1,$2); $$;
create function public.admin_trade_proposals() returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.admin_trade_proposals(); $$;
create function public.admin_review_trade_proposal(p_proposal_id uuid, p_decision text, p_trade_id uuid, p_name text, p_reason text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.admin_review_trade_proposal($1,$2,$3,$4,$5); $$;

revoke all on function dao_private.trade_label_key(text) from public,anon,authenticated;
revoke all on function dao_private.admin_save_trade(uuid,text,text,text), dao_private.propose_trade(text,text),
  dao_private.admin_trade_proposals(), dao_private.admin_review_trade_proposal(uuid,text,uuid,text,text),
  public.admin_save_trade(uuid,text,text,text), public.propose_trade(text,text),
  public.admin_trade_proposals(), public.admin_review_trade_proposal(uuid,text,uuid,text,text)
  from public, anon;
grant execute on function dao_private.trade_label_key(text) to authenticated, service_role;
grant execute on function dao_private.admin_save_trade(uuid,text,text,text), dao_private.propose_trade(text,text),
  dao_private.admin_trade_proposals(), dao_private.admin_review_trade_proposal(uuid,text,uuid,text,text),
  public.admin_save_trade(uuid,text,text,text), public.propose_trade(text,text),
  public.admin_trade_proposals(), public.admin_review_trade_proposal(uuid,text,uuid,text,text)
  to authenticated, service_role;

commit;
