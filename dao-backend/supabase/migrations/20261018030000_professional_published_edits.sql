begin;
-- Existing approved professionals must stay visible after editorial or contact
-- edits. Verification-changing identity, legal, and trade changes remain gated.
-- Preserve moderation, consent, suspension and staff-only publication rules.

create or replace function dao_private.professional_content_changed() returns trigger
language plpgsql set search_path='' as $$
begin
  if row(new.business_name,new.contractor_type,new.public_trade_name)
     is distinct from row(old.business_name,old.contractor_type,old.public_trade_name) then
    new.public_identity_status:='draft';
    update public.contractor_profile_details set review_status='draft',revision=revision+1,updated_at=now() where contractor_id=new.id;
  end if;
  return new;
end; $$;
-- The existing trigger remains attached to the replaced function.

create or replace function dao_private.professional_command(p_action text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); cp public.contractor_profiles; d public.contractor_profile_details;
  oldd public.contractor_profile_details; pp public.portfolio_projects; file_row record;
  target uuid; cid uuid; result jsonb; legal_changed boolean:=false; review boolean:=false;
  allowed text[]; area jsonb; changed_fields text[]; kind text; approved boolean;
begin
  if not dao_private.account_active(actor) then raise exception using errcode='42501',message='Session absente ou compte suspendu'; end if;
  if p_input is null or p_action is null or jsonb_typeof(p_input)<>'object' or p_action not in ('details','portfolio_save','portfolio_submit','portfolio_hide',
      'file_create','file_update','file_withdraw','profile_submit','profile_hide','review_profile','review_portfolio','review_file') then
    raise exception using errcode='22023',message='Commande professionnelle invalide'; end if;
  review:=p_action like 'review_%'; target:=nullif(p_input->>'id','')::uuid;
  if p_action in ('portfolio_save','portfolio_submit','portfolio_hide','review_portfolio') and target is not null then
    select contractor_id into cid from public.portfolio_projects where id=target;
  elsif p_action in ('file_update','file_withdraw','review_file') then
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
      review_status=case when legal_changed then 'draft' else review_status end,
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
      public_identity_status=case when legal_changed then 'draft' else public_identity_status end where id=cp.id;
    result:=jsonb_build_object('id',cp.id,'verification_restarted',legal_changed and cp.verification_status<>'suspended');
  elsif p_action in ('profile_submit','profile_hide','review_profile') then
    insert into public.contractor_profile_details(contractor_id) values(cp.id) on conflict do nothing;
    if p_action='profile_submit' then
      -- An already published, still verified dossier requires no resubmission.
      if cp.verification_status='verified' and cp.public_identity_status='approved'
         and exists(select 1 from public.contractor_profile_details
                    where contractor_id=cp.id and review_status='approved') then
        return jsonb_build_object('id',cp.id,'already_published',true);
      end if;
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
    if length(coalesce(p_input->>'original_name','')) not between 1 and 120 or length(coalesce(p_input->>'caption',''))>500 then
      raise exception using errcode='22023',message='Nom ou légende du fichier invalide'; end if;
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
  elsif p_action in ('file_update','file_withdraw','review_file') then
    kind:=p_input->>'kind';
    if kind='portfolio' then select * into file_row from public.portfolio_assets where id=target for update;
    else select * into file_row from public.contractor_files where id=target for update; end if;
    if p_action='file_update' then
      if file_row.status='withdrawn' or exists(select 1 from jsonb_object_keys(p_input) k where k not in ('kind','id','caption','asset_kind','public_consent')) then
        raise exception using errcode='22023',message='Média retiré ou champ non modifiable'; end if;
      if kind='portfolio' then
        if length(coalesce(p_input->>'caption',''))>500 then raise exception using errcode='22023',message='Légende trop longue'; end if;
        update public.portfolio_assets set caption=coalesce(p_input->>'caption',caption),asset_kind=coalesce(p_input->>'asset_kind',asset_kind),
          public_consent=coalesce((p_input->>'public_consent')::boolean,public_consent),
          status=case when content_sha256 is null then 'quarantined' else 'ready' end,revision=revision+1 where id=target;
      else
        if file_row.purpose<>'logo' then raise exception using errcode='22023',message='Une pièce légale ne devient pas un média public'; end if;
        update public.contractor_files set public_consent=coalesce((p_input->>'public_consent')::boolean,public_consent),
          status=case when content_sha256 is null then 'quarantined' else 'ready' end,revision=revision+1 where id=target;
      end if;
    elsif p_action='review_file' then
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
    if p_action='file_update' then null;
    elsif kind='portfolio' then
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


-- Restore only already-reviewed DEV-like profiles accidentally demoted by a
-- presentation/availability edit. No new/unreviewed identity is approved.
-- Fail closed for missing audit metadata, legal/identity edits or explicit hiding.
with previous_approval as (
  select c.id
  from public.contractor_profiles c
  join public.contractor_profile_details d on d.contractor_id=c.id
  where c.verification_status='verified'
    and c.public_identity_status='draft'
    and d.review_status='draft'
    and d.reviewed_at is not null and d.reviewed_by is not null
    and exists(
      select 1 from public.audit_events e
      where e.entity_type='contractor' and e.entity_id=c.id
        and e.action='professional_review_profile' and e.created_at<=d.reviewed_at + interval '1 minute'
    )
    and exists(
      select 1 from public.audit_events e
      where e.entity_id=c.id and e.action='professional_approve_identity'
        and e.created_at<=d.reviewed_at + interval '1 minute'
    )
    and exists(
      select 1 from public.audit_events e
      where e.entity_id=c.id and e.action='contractor_profile_updated'
        and e.created_at>d.reviewed_at
        and jsonb_typeof(e.metadata->'changed_fields')='array'
        and jsonb_array_length(e.metadata->'changed_fields')>0
    )
    and not exists(
      select 1 from public.audit_events e
      where e.entity_id=c.id and e.created_at>d.reviewed_at
        and (
          e.action not in ('contractor_profile_updated')
          or jsonb_typeof(e.metadata->'changed_fields') is distinct from 'array'
          or jsonb_array_length(e.metadata->'changed_fields')=0
          or exists(
            select 1 from jsonb_array_elements_text(
              case when jsonb_typeof(e.metadata->'changed_fields')='array'
                then e.metadata->'changed_fields' else '[]'::jsonb end
            ) changed(key)
            where changed.key not in ('public_presentation','years_experience','availability','available_from')
          )
        )
    )
), restored_profiles as (
  update public.contractor_profiles cp
  set public_identity_status='approved'
  from previous_approval x where cp.id=x.id
  returning cp.id
)
update public.contractor_profile_details d
set review_status='approved',revision=revision+1,updated_at=now()
from restored_profiles r where d.contractor_id=r.id and d.review_status='draft';

commit;
