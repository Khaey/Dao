begin;

-- Private dossier. Clients receive only an explicit, consent-aware projection.
create table public.contractor_profile_details (
  contractor_id uuid primary key references public.contractor_profiles,
  website_url text not null default '', professional_phone text not null default '',
  whatsapp_phone text not null default '', professional_email text not null default '',
  social_links jsonb not null default '[]'::jsonb,
  office_address text not null default '', city text not null default '',
  governorate_id uuid references public.governorates,
  founded_year integer check(founded_year between 1900 and 2200), specialties text not null default '',
  tax_identifier text not null default '', registration_identifier text not null default '',
  legal_name text not null default '', representative_name text not null default '',
  show_website boolean not null default false, show_phone boolean not null default false,
  show_whatsapp boolean not null default false, show_email boolean not null default false,
  show_social_links boolean not null default false, show_exact_address boolean not null default false,
  review_status text not null default 'draft' check(review_status in ('draft','pending_review','approved','rejected','hidden')),
  review_reason text not null default '', revision integer not null default 1,
  submitted_at timestamptz, reviewed_at timestamptz, reviewed_by uuid references auth.users,
  updated_at timestamptz not null default now(),
  check(length(website_url)<=500 and length(professional_phone)<=30 and length(whatsapp_phone)<=30
    and length(professional_email)<=254 and length(office_address)<=500 and length(city)<=120
    and length(specialties)<=2000 and length(tax_identifier)<=100 and length(registration_identifier)<=100
    and length(legal_name)<=200 and length(representative_name)<=200),
  check(website_url='' or website_url ~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?([/?#][^[:space:]<>]*)?$'),
  check(professional_phone='' or professional_phone ~ '^\+[1-9][0-9]{6,14}$'),
  check(whatsapp_phone='' or whatsapp_phone ~ '^\+[1-9][0-9]{6,14}$'),
  check(professional_email='' or professional_email ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'),
  check(jsonb_typeof(social_links)='array' and jsonb_array_length(social_links)<=5)
);
create table public.contractor_files (
  id uuid primary key default gen_random_uuid(), contractor_id uuid not null references public.contractor_profiles,
  purpose text not null check(purpose in ('logo','tax','registration','insurance','diploma','identity')),
  original_name text not null check(length(original_name) between 1 and 120),
  object_path text not null unique, mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
  size_bytes bigint not null check(size_bytes between 1 and 20971520),
  public_consent boolean not null default false,
  status text not null default 'quarantined' check(status in ('quarantined','ready','approved','rejected','withdrawn')),
  content_sha256 text check(content_sha256 ~ '^[0-9a-f]{64}$'),
  revision integer not null default 1, review_reason text not null default '',
  created_at timestamptz not null default now(), reviewed_at timestamptz, reviewed_by uuid references auth.users,
  check(object_path like 'professional/'||contractor_id::text||'/%'),
  check(purpose='logo' or not public_consent), check(purpose<>'logo' or mime_type<>'application/pdf')
);
create index on public.contractor_files(contractor_id);
alter table public.portfolio_projects
  add column trade_id uuid references public.trades,
  add column approximate_location text not null default '' check(length(approximate_location)<=160),
  add column publication_consent boolean not null default false,
  add column revision integer not null default 1,
  add column review_reason text not null default '',
  add column reviewed_at timestamptz, add column reviewed_by uuid references auth.users;
alter table public.portfolio_assets drop constraint portfolio_assets_mime_type_check;
alter table public.portfolio_assets add constraint portfolio_assets_mime_type_check
  check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp'));
alter table public.portfolio_assets drop constraint portfolio_assets_status_check;
alter table public.portfolio_assets add constraint portfolio_assets_status_check
  check(status in ('quarantined','ready','approved','rejected','withdrawn'));
alter table public.portfolio_assets
  add column original_name text not null default 'media',
  add column asset_kind text not null default 'photo' check(asset_kind in ('photo','before','after','brochure')),
  add column public_consent boolean not null default false,
  add column content_sha256 text check(content_sha256 ~ '^[0-9a-f]{64}$'),
  add column revision integer not null default 1,
  add column review_reason text not null default '',
  add column reviewed_at timestamptz, add column reviewed_by uuid references auth.users;
alter table public.portfolio_assets add constraint portfolio_media_kind
  check((mime_type='application/pdf')=(asset_kind='brochure'));

alter table public.contractor_profile_details enable row level security;
alter table public.contractor_files enable row level security;
revoke all on public.contractor_profile_details,public.contractor_files from anon,authenticated;
grant select on public.contractor_profile_details,public.contractor_files to authenticated;
grant all on public.contractor_profile_details,public.contractor_files to service_role;
create policy dossier_read on public.contractor_profile_details for select to authenticated
  using(dao_private.account_active(auth.uid()) and (dao_private.staff() or dao_private.pro(contractor_id)));
create policy dossier_read on public.contractor_files for select to authenticated
  using(dao_private.account_active(auth.uid()) and (dao_private.staff() or dao_private.pro(contractor_id)));

-- New visibility requires real consent; historical approval is not backfilled
-- into consent, upload inspection or a legal certification.
create or replace function dao_private.portfolio(p uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select dao_private.account_active(auth.uid()) and exists(
    select 1 from public.portfolio_projects x join public.contractor_profiles c on c.id=x.contractor_id
    where x.id=p and (dao_private.staff() or dao_private.pro(x.contractor_id)
      or (x.status='published' and x.publication_consent and c.verification_status='verified'
        and c.public_identity_status='approved' and dao_private.account_active(c.user_id)
        and exists(select 1 from public.contractor_profile_details d where d.contractor_id=c.id and d.review_status='approved')
        and exists(select 1 from public.user_roles where user_id=auth.uid() and role='client'))));
$$;
drop policy read_allowed on public.portfolio_assets;
create policy read_allowed on public.portfolio_assets for select to anon,authenticated using(
  dao_private.account_active(auth.uid()) and (dao_private.staff() or dao_private.pro(contractor_id)
    or (dao_private.portfolio(portfolio_project_id) and status='approved' and public_consent and content_sha256 is not null)));

create function dao_private.professional_content_changed() returns trigger
language plpgsql set search_path='' as $$
begin
  if row(new.business_name,new.contractor_type,new.public_trade_name,new.public_presentation,
         new.years_experience,new.availability,new.available_from)
     is distinct from row(old.business_name,old.contractor_type,old.public_trade_name,old.public_presentation,
         old.years_experience,old.availability,old.available_from) then
    new.public_identity_status:='draft';
    update public.contractor_profile_details set review_status='draft',revision=revision+1,updated_at=now() where contractor_id=new.id;
  end if;
  return new;
end; $$;
create trigger professional_content_changed before update on public.contractor_profiles
  for each row execute function dao_private.professional_content_changed();
revoke all on function dao_private.professional_content_changed() from public,anon,authenticated;

create function dao_private.professional_command(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); cp public.contractor_profiles; d public.contractor_profile_details;
  oldd public.contractor_profile_details; pp public.portfolio_projects; file_row record;
  target uuid; cid uuid; result jsonb; legal_changed boolean:=false; review boolean:=false;
  allowed text[]; area jsonb; changed_fields text[]; kind text; approved boolean;
begin
  if not dao_private.account_active(actor) then raise exception using errcode='42501',message='Session absente ou compte suspendu'; end if;
  if p_input is null or p_action is null or jsonb_typeof(p_input)<>'object' or p_action not in ('details','portfolio_save','portfolio_submit','portfolio_hide',
      'file_create','file_withdraw','profile_submit','profile_hide','review_profile','review_portfolio','review_file') then
    raise exception using errcode='22023',message='Commande professionnelle invalide'; end if;
  review:=p_action like 'review_%'; target:=nullif(p_input->>'id','')::uuid;
  if p_action in ('portfolio_save','portfolio_submit','portfolio_hide','review_portfolio') and target is not null then
    select contractor_id into cid from public.portfolio_projects where id=target;
  elsif p_action in ('file_withdraw','review_file') then
    if p_input->>'kind'='portfolio' then select contractor_id into cid from public.portfolio_assets where id=target;
    elsif p_input->>'kind'='professional' then select contractor_id into cid from public.contractor_files where id=target;
    else raise exception using errcode='22023',message='Type de fichier invalide'; end if;
  elsif review then cid:=target;
  else select id into cid from public.contractor_profiles where user_id=actor; end if;
  select * into cp from public.contractor_profiles where id=cid for update;
  if cp.id is null or not dao_private.account_active(cp.user_id) or
    (review and not dao_private.staff()) or (not review and (cp.user_id<>actor or not exists(select 1 from public.user_roles where user_id=actor and role='contractor')))
  then raise exception using errcode='42501',message='Dossier professionnel non autorisé'; end if;

  if p_action='details' then
    allowed:=array['website_url','professional_phone','whatsapp_phone','professional_email','social_links','office_address','city','governorate_id','founded_year','specialties',
      'tax_identifier','registration_identifier','legal_name','representative_name','show_website','show_phone','show_whatsapp','show_email','show_social_links','show_exact_address','service_areas'];
    if exists(select 1 from jsonb_object_keys(p_input) k where not k=any(allowed)) then
      raise exception using errcode='22023',message='Champ de dossier non autorisé'; end if;
    insert into public.contractor_profile_details(contractor_id) values(cp.id) on conflict do nothing;
    select * into oldd from public.contractor_profile_details where contractor_id=cp.id for update;
    d:=jsonb_populate_record(oldd,p_input-'service_areas');
    if exists(select 1 from jsonb_array_elements(d.social_links) link
      where jsonb_typeof(link)<>'string' or length(link#>>'{}')>500 or (link#>>'{}')!~'^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?([/?#][^[:space:]<>]*)?$') then
      raise exception using errcode='22023',message='Liens officiels HTTPS uniquement'; end if;
    legal_changed:=row(d.tax_identifier,d.registration_identifier,d.legal_name,d.representative_name)
      is distinct from row(oldd.tax_identifier,oldd.registration_identifier,oldd.legal_name,oldd.representative_name);
    select array_agg(key) into changed_fields from jsonb_each(to_jsonb(d))
      where value is distinct from to_jsonb(oldd)->key;
    update public.contractor_profile_details set website_url=d.website_url,professional_phone=d.professional_phone,
      whatsapp_phone=d.whatsapp_phone,professional_email=d.professional_email,social_links=d.social_links,
      office_address=d.office_address,city=d.city,governorate_id=d.governorate_id,founded_year=d.founded_year,specialties=d.specialties,
      tax_identifier=d.tax_identifier,registration_identifier=d.registration_identifier,legal_name=d.legal_name,representative_name=d.representative_name,
      show_website=d.show_website,show_phone=d.show_phone,show_whatsapp=d.show_whatsapp,show_email=d.show_email,
      show_social_links=d.show_social_links,show_exact_address=d.show_exact_address,
      review_status=case when changed_fields is not null or p_input ? 'service_areas' then 'draft' else review_status end,
      revision=revision+1,updated_at=now() where contractor_id=cp.id;
    if p_input ? 'service_areas' then
      if jsonb_typeof(p_input->'service_areas')<>'array' or jsonb_array_length(p_input->'service_areas')>30 then
        raise exception using errcode='22023',message='Zones d’intervention invalides'; end if;
      delete from public.contractor_service_areas where contractor_id=cp.id;
      for area in select * from jsonb_array_elements(p_input->'service_areas') loop
        insert into public.contractor_service_areas(contractor_id,governorate_id,delegation_id)
          values(cp.id,(area->>'governorate_id')::uuid,nullif(area->>'delegation_id','')::uuid);
      end loop;
    end if;
    update public.contractor_profiles set
      verification_status=case when legal_changed and verification_status<>'suspended' then 'pending' else verification_status end,
      public_identity_status=case when changed_fields is not null or p_input ? 'service_areas' then 'draft' else public_identity_status end where id=cp.id;
    result:=jsonb_build_object('id',cp.id,'verification_restarted',legal_changed and cp.verification_status<>'suspended');
  elsif p_action in ('profile_submit','profile_hide','review_profile') then
    insert into public.contractor_profile_details(contractor_id) values(cp.id) on conflict do nothing;
    if p_action='profile_submit' then
      if cp.contractor_type is null or nullif(trim(cp.public_trade_name),'') is null or nullif(trim(cp.public_presentation),'') is null
        or not exists(select 1 from public.contractor_trades where contractor_id=cp.id) then
        raise exception using errcode='22023',message='Complétez la présentation, le type d’activité et les métiers'; end if;
      update public.contractor_profile_details set review_status='pending_review',submitted_at=now(),revision=revision+1 where contractor_id=cp.id;
      update public.contractor_profiles set public_identity_status='draft' where id=cp.id;
    elsif p_action='profile_hide' then
      update public.contractor_profile_details set review_status='hidden',revision=revision+1 where contractor_id=cp.id;
      update public.contractor_profiles set public_identity_status='hidden' where id=cp.id;
    else
      approved:=coalesce((p_input->>'approve')::boolean,false);
      if cp.verification_status='suspended' or (approved and cp.verification_status<>'verified') then
        raise exception using errcode='23514',message='Une fiche suspendue ou non vérifiée ne peut pas être publiée'; end if;
      select * into d from public.contractor_profile_details where contractor_id=cp.id for update;
      if d.review_status<>'pending_review' or d.revision<>coalesce((p_input->>'revision')::integer,-1) then
        raise exception using errcode='23514',message='Dossier modifié : rechargez avant de décider'; end if;
      if not approved and nullif(trim(p_input->>'reason'),'') is null then raise exception using errcode='22023',message='Motif de refus obligatoire'; end if;
      if approved then
        -- Preserve the existing #64 admin-only public-identity decision.
        perform public.backoffice_command('professional',jsonb_build_object('contractor_id',cp.id,'decision','approve_identity'),gen_random_uuid()::text);
      else update public.contractor_profiles set public_identity_status='draft' where id=cp.id; end if;
      update public.contractor_profile_details set review_status=case when approved then 'approved' else 'rejected' end,
        review_reason=coalesce(p_input->>'reason',''),reviewed_at=now(),reviewed_by=actor,revision=revision+1 where contractor_id=cp.id;
    end if;
    result:=jsonb_build_object('id',cp.id);
  elsif p_action in ('portfolio_save','portfolio_submit','portfolio_hide','review_portfolio') then
    if p_action='portfolio_save' then
      if length(trim(coalesce(p_input->>'title',''))) not between 1 and 160
        or length(coalesce(p_input->>'description','')) not between 1 and 3000 then
        raise exception using errcode='22023',message='Titre et description de réalisation obligatoires'; end if;
      if nullif(p_input->>'trade_id','') is not null and not exists(select 1 from public.trades where id=(p_input->>'trade_id')::uuid and active) then
        raise exception using errcode='22023',message='Métier actif requis'; end if;
      if target is null then
        insert into public.portfolio_projects(contractor_id,title,description,completed_year,governorate_id,trade_id,approximate_location,publication_consent)
          values(cp.id,trim(p_input->>'title'),p_input->>'description',nullif(p_input->>'completed_year','')::integer,
            nullif(p_input->>'governorate_id','')::uuid,nullif(p_input->>'trade_id','')::uuid,coalesce(p_input->>'approximate_location',''),coalesce((p_input->>'publication_consent')::boolean,false)) returning * into pp;
      else
        update public.portfolio_projects set title=trim(p_input->>'title'),description=p_input->>'description',completed_year=nullif(p_input->>'completed_year','')::integer,
          governorate_id=nullif(p_input->>'governorate_id','')::uuid,trade_id=nullif(p_input->>'trade_id','')::uuid,approximate_location=coalesce(p_input->>'approximate_location',''),
          publication_consent=coalesce((p_input->>'publication_consent')::boolean,false),status='draft',revision=revision+1 where id=target returning * into pp;
      end if;
    else
      select * into pp from public.portfolio_projects where id=target for update;
      if p_action='portfolio_submit' then
        if not pp.publication_consent then raise exception using errcode='22023',message='Accord de publication de la réalisation requis'; end if;
        update public.portfolio_projects set status='pending_review',revision=revision+1 where id=target;
      elsif p_action='portfolio_hide' then
        update public.portfolio_projects set status='hidden',publication_consent=false,revision=revision+1 where id=target;
      else
        approved:=coalesce((p_input->>'approve')::boolean,false);
        if pp.status<>'pending_review' or pp.revision<>coalesce((p_input->>'revision')::integer,-1) then
          raise exception using errcode='23514',message='Réalisation modifiée : rechargez avant de décider'; end if;
        if approved and (not pp.publication_consent or cp.verification_status<>'verified' or cp.public_identity_status<>'approved') then
          raise exception using errcode='23514',message='Fiche approuvée et consentement requis'; end if;
        if not approved and nullif(trim(p_input->>'reason'),'') is null then raise exception using errcode='22023',message='Motif de refus obligatoire'; end if;
        update public.portfolio_projects set status=case when approved then 'published' else 'hidden' end,review_reason=coalesce(p_input->>'reason',''),
          reviewed_at=now(),reviewed_by=actor,revision=revision+1 where id=target;
      end if;
    end if;
    result:=jsonb_build_object('id',coalesce(pp.id,target));
  elsif p_action='file_create' then
    kind:=p_input->>'kind';
    if p_input->>'mime_type' not in ('application/pdf','image/jpeg','image/png','image/webp')
      or coalesce((p_input->>'size_bytes')::bigint,0) not between 1 and 20971520 then
      raise exception using errcode='22023',message='PDF ou image de 20 Mo maximum requis'; end if;
    if kind='portfolio' then
      select * into pp from public.portfolio_projects where id=(p_input->>'portfolio_project_id')::uuid and contractor_id=cp.id for update;
      if pp.id is null then raise exception using errcode='42501',message='Réalisation non autorisée'; end if;
      insert into public.portfolio_assets(portfolio_project_id,contractor_id,object_path,original_name,mime_type,size_bytes,asset_kind,caption,public_consent)
        values(pp.id,cp.id,p_input->>'object_path',p_input->>'original_name',p_input->>'mime_type',(p_input->>'size_bytes')::bigint,
          coalesce(p_input->>'asset_kind','photo'),coalesce(p_input->>'caption',''),coalesce((p_input->>'public_consent')::boolean,false)) returning to_jsonb(portfolio_assets.*) into result;
    elsif kind='professional' then
      insert into public.contractor_files(contractor_id,purpose,object_path,original_name,mime_type,size_bytes,public_consent)
        values(cp.id,p_input->>'purpose',p_input->>'object_path',p_input->>'original_name',p_input->>'mime_type',(p_input->>'size_bytes')::bigint,
          coalesce((p_input->>'public_consent')::boolean,false)) returning to_jsonb(contractor_files.*) into result;
      if p_input->>'purpose'<>'logo' then
        update public.contractor_profiles set verification_status=case when verification_status='suspended' then 'suspended' else 'pending' end where id=cp.id;
      end if;
    else raise exception using errcode='22023',message='Type de fichier invalide'; end if;
  elsif p_action in ('file_withdraw','review_file') then
    kind:=p_input->>'kind';
    if kind='portfolio' then select * into file_row from public.portfolio_assets where id=target for update;
    else select * into file_row from public.contractor_files where id=target for update; end if;
    if p_action='review_file' then
      approved:=coalesce((p_input->>'approve')::boolean,false);
      if (file_row.status<>'ready' and (approved or file_row.status<>'approved')) or file_row.content_sha256 is null or file_row.revision<>coalesce((p_input->>'revision')::integer,-1) then
        raise exception using errcode='23514',message='Fichier non inspecté ou modifié : rechargez'; end if;
      if not approved and nullif(trim(p_input->>'reason'),'') is null then raise exception using errcode='22023',message='Motif de refus obligatoire'; end if;
      if approved and kind='portfolio' and not file_row.public_consent then
        raise exception using errcode='23514',message='Consentement de publication du média requis'; end if;
      if approved and kind='professional' then
        if file_row.purpose='logo' and not file_row.public_consent then
          raise exception using errcode='23514',message='Consentement de publication du logo requis'; end if;
      end if;
    end if;
    if kind='portfolio' then
      update public.portfolio_assets set status=case when p_action='file_withdraw' then 'withdrawn' when approved then 'approved' else 'rejected' end,
        public_consent=case when p_action='file_withdraw' then false else public_consent end,revision=revision+1,
        review_reason=coalesce(p_input->>'reason',''),reviewed_at=now(),reviewed_by=actor where id=target;
    else
      update public.contractor_files set status=case when p_action='file_withdraw' then 'withdrawn' when approved then 'approved' else 'rejected' end,
        public_consent=case when p_action='file_withdraw' then false else public_consent end,revision=revision+1,
        review_reason=coalesce(p_input->>'reason',''),reviewed_at=now(),reviewed_by=actor where id=target;
      if p_action='file_withdraw' and file_row.purpose<>'logo' then update public.contractor_profiles set
        verification_status=case when verification_status='suspended' then 'suspended' else 'pending' end where id=cp.id; end if;
    end if;
    result:=jsonb_build_object('id',target);
  end if;
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
    values(actor,'professional_'||p_action,'contractor',cp.id,jsonb_build_object('target_id',result->>'id','changed_fields',changed_fields,'verification_restarted',legal_changed));
  return result;
end; $$;
create function public.professional_command(p_action text,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.professional_command($1,$2); $$;

create function dao_private.professional_dossier(p_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare cp public.contractor_profiles;
begin
  if not dao_private.account_active(auth.uid()) then raise exception using errcode='42501',message='Session requise'; end if;
  select * into cp from public.contractor_profiles where id=coalesce(p_id,(select id from public.contractor_profiles where user_id=auth.uid()));
  if cp.id is null or (cp.user_id<>auth.uid() and not dao_private.staff()) then raise exception using errcode='42501',message='Dossier privé'; end if;
  return jsonb_build_object('profile',to_jsonb(cp),'details',(select to_jsonb(d) from public.contractor_profile_details d where contractor_id=cp.id),
    'areas',(select coalesce(jsonb_agg(to_jsonb(a)),'[]') from public.contractor_service_areas a where contractor_id=cp.id),
    'files',(select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc),'[]') from public.contractor_files f where contractor_id=cp.id),
    'portfolio',(select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('assets',(select coalesce(jsonb_agg(to_jsonb(a) order by a.sort_order,a.created_at),'[]') from public.portfolio_assets a where a.portfolio_project_id=p.id)) order by p.created_at desc),'[]') from public.portfolio_projects p where contractor_id=cp.id),
    'staff',dao_private.staff(),'admin',dao_private.admin());
end; $$;
create function public.professional_dossier(p_id uuid default null) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.professional_dossier($1); $$;

create function dao_private.professional_file_access(p_kind text,p_id uuid,p_owner_only boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare f jsonb; cp public.contractor_profiles; allowed boolean:=false;
begin
  if not dao_private.account_active(auth.uid()) then raise exception using errcode='42501',message='Session requise'; end if;
  if p_kind='portfolio' then select to_jsonb(a) into f from public.portfolio_assets a where id=p_id;
  elsif p_kind='professional' then select to_jsonb(a) into f from public.contractor_files a where id=p_id;
  else raise exception using errcode='22023',message='Type de fichier invalide'; end if;
  select * into cp from public.contractor_profiles where id=(f->>'contractor_id')::uuid;
  allowed:=cp.user_id=auth.uid() or (not p_owner_only and dao_private.staff());
  if not p_owner_only and not allowed and exists(select 1 from public.user_roles where user_id=auth.uid() and role='client') then
    allowed:=cp.verification_status='verified' and cp.public_identity_status='approved' and dao_private.account_active(cp.user_id)
      and exists(select 1 from public.contractor_profile_details d where d.contractor_id=cp.id and d.review_status='approved')
      and f->>'status'='approved' and (f->>'public_consent')::boolean and f->>'content_sha256' is not null
      and ((p_kind='professional' and f->>'purpose'='logo') or (p_kind='portfolio' and dao_private.portfolio((f->>'portfolio_project_id')::uuid)));
  end if;
  if cp.id is null or not coalesce(allowed,false) or f->>'status'='withdrawn' then raise exception using errcode='42501',message='Fichier privé ou retiré'; end if;
  return f;
end; $$;
create function public.professional_file_access(p_kind text,p_id uuid,p_owner_only boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.professional_file_access($1,$2,$3); $$;

-- Only the authenticated server's Storage inspection may mark bytes ready.
create function public.professional_confirm_upload(p_kind text,p_id uuid,p_actor uuid,p_sha256 text) returns void
language plpgsql security definer set search_path='' as $$
declare cid uuid;
begin
  if p_sha256 is null or p_sha256!~'^[0-9a-f]{64}$' or not dao_private.account_active(p_actor)
    or not exists(select 1 from public.user_roles where user_id=p_actor and role='contractor') then raise exception using errcode='22023',message='Inspection invalide'; end if;
  if p_kind='portfolio' then select contractor_id into cid from public.portfolio_assets where id=p_id;
  elsif p_kind='professional' then select contractor_id into cid from public.contractor_files where id=p_id;
  else raise exception using errcode='22023',message='Type de fichier invalide'; end if;
  perform 1 from public.contractor_profiles where id=cid and user_id=p_actor for update;
  if not found then raise exception using errcode='42501',message='Upload non autorisé'; end if;
  if p_kind='portfolio' then update public.portfolio_assets set status='ready',content_sha256=p_sha256,revision=revision+1 where id=p_id and status='quarantined';
  else update public.contractor_files set status='ready',content_sha256=p_sha256,revision=revision+1 where id=p_id and status='quarantined'; end if;
  if not found then raise exception using errcode='23514',message='Fichier déjà finalisé ou retiré'; end if;
end; $$;
revoke all on function public.professional_confirm_upload(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.professional_confirm_upload(text,uuid,uuid,text) to service_role;

create function dao_private.professional_public_profile(p_id uuid,p_preview boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare cp public.contractor_profiles; d public.contractor_profile_details; preview boolean;
begin
  if not dao_private.account_active(auth.uid()) then raise exception using errcode='42501',message='Session requise'; end if;
  select * into cp from public.contractor_profiles where id=p_id;
  preview:=p_preview and (cp.user_id=auth.uid() or dao_private.staff());
  select * into d from public.contractor_profile_details where contractor_id=p_id;
  if cp.id is null or not coalesce(preview,false) and (
    not exists(select 1 from public.user_roles where user_id=auth.uid() and role='client') or not dao_private.account_active(cp.user_id)
    or cp.verification_status<>'verified' or cp.public_identity_status<>'approved' or d.review_status is distinct from 'approved') then
    raise exception using errcode='42501',message='Fiche non publiée ou non autorisée'; end if;
  return jsonb_build_object('id',cp.id,'name',coalesce(nullif(cp.public_trade_name,''),cp.business_name),'contractor_type',cp.contractor_type,
    'presentation',cp.public_presentation,'verification_status',cp.verification_status,'preview',coalesce(preview,false),
    'years_experience',cp.years_experience,'availability',cp.availability,'available_from',cp.available_from,
    'city',d.city,'governorate',(select name_fr from public.governorates where id=d.governorate_id),'founded_year',d.founded_year,'specialties',d.specialties,
    'office_address',case when d.show_exact_address then d.office_address else null end,
    'website_url',case when d.show_website then d.website_url else null end,'professional_phone',case when d.show_phone then d.professional_phone else null end,
    'professional_email',case when d.show_email then d.professional_email else null end,'whatsapp_phone',case when d.show_whatsapp then d.whatsapp_phone else null end,
    'social_links',case when d.show_social_links then d.social_links else '[]'::jsonb end,
    'trades',(select coalesce(jsonb_agg(t.name_fr),'[]') from public.contractor_trades ct join public.trades t on t.id=ct.trade_id where ct.contractor_id=cp.id),
    'areas',(select coalesce(jsonb_agg(jsonb_build_object('governorate',g.name_fr,'delegation',de.name_fr)),'[]') from public.contractor_service_areas a join public.governorates g on g.id=a.governorate_id left join public.delegations de on de.id=a.delegation_id where a.contractor_id=cp.id),
    'logo_id',(select id from public.contractor_files where contractor_id=cp.id and purpose='logo' and status='approved' and public_consent and content_sha256 is not null order by created_at desc limit 1),
    'portfolio',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'title',p.title,'description',p.description,'completed_year',p.completed_year,
      'approximate_location',p.approximate_location,'trade',(select name_fr from public.trades where id=p.trade_id),
      'assets',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'caption',a.caption,'mime_type',a.mime_type,'asset_kind',a.asset_kind,'original_name',a.original_name) order by a.sort_order,a.created_at),'[]')
        from public.portfolio_assets a where a.portfolio_project_id=p.id and a.status='approved' and a.public_consent and a.content_sha256 is not null)) order by p.created_at desc),'[]')
      from public.portfolio_projects p where p.contractor_id=cp.id and p.status='published' and p.publication_consent));
end; $$;
create function public.professional_public_profile(p_id uuid,p_preview boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.professional_public_profile($1,$2); $$;
create function dao_private.professional_directory(p_review boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not dao_private.account_active(auth.uid()) or (p_review and not dao_private.staff()) or
    (not p_review and not exists(select 1 from public.user_roles where user_id=auth.uid() and role='client')) then
    raise exception using errcode='42501',message='Annuaire non autorisé'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',coalesce(nullif(c.public_trade_name,''),c.business_name),
    'verification_status',c.verification_status,'review_status',d.review_status,'city',d.city) order by c.created_at desc),'[]')
    from public.contractor_profiles c left join public.contractor_profile_details d on d.contractor_id=c.id
    where p_review or (c.verification_status='verified' and c.public_identity_status='approved' and d.review_status='approved' and dao_private.account_active(c.user_id)));
end; $$;
create function public.professional_directory(p_review boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.professional_directory($1); $$;

revoke all on function dao_private.professional_command(text,jsonb),public.professional_command(text,jsonb),
  dao_private.professional_dossier(uuid),public.professional_dossier(uuid),
  dao_private.professional_file_access(text,uuid,boolean),public.professional_file_access(text,uuid,boolean),
  dao_private.professional_public_profile(uuid,boolean),public.professional_public_profile(uuid,boolean),
  dao_private.professional_directory(boolean),public.professional_directory(boolean) from public,anon,authenticated;
grant execute on function dao_private.professional_command(text,jsonb),public.professional_command(text,jsonb),
  dao_private.professional_dossier(uuid),public.professional_dossier(uuid),
  dao_private.professional_file_access(text,uuid,boolean),public.professional_file_access(text,uuid,boolean),
  dao_private.professional_public_profile(uuid,boolean),public.professional_public_profile(uuid,boolean),
  dao_private.professional_directory(boolean),public.professional_directory(boolean) to authenticated,service_role;
commit;
