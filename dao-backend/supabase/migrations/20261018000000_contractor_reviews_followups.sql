-- Avis clients vérifiés — suivis de la revue DAO COP de #214 (#213) :
-- * R2 : tout Client autorisé à lire les avis peut en signaler un (pas l'auteur) ;
-- * R3 : file de modération paginée et filtrable (review_moderation_page) ;
-- * R5 : un avis masqué puis modifié par son auteur est marqué « à relire » ;
-- * R6 : suppression de compte — l'avis reste, anonymisé (« Client D.A.O. ») ; signalements de l'utilisateur supprimés ;
-- * réserve : nommer un réseau (« WhatsApp ») n'est plus refusé ; les liens courts wa.me / t.me le restent.
-- Additive : colonnes / contraintes de clé étrangère / create or replace ; aucune donnée supprimée.
begin;

alter table public.contractor_reviews add column edited_since_hidden boolean not null default false;
alter table public.contractor_reviews alter column author_id drop not null;
alter table public.contractor_reviews drop constraint contractor_reviews_author_id_fkey,
  add constraint contractor_reviews_author_id_fkey foreign key (author_id) references auth.users on delete set null;
alter table public.contractor_reviews drop constraint contractor_reviews_hidden_by_fkey,
  add constraint contractor_reviews_hidden_by_fkey foreign key (hidden_by) references auth.users on delete set null;
alter table public.contractor_review_responses alter column author_id drop not null;
alter table public.contractor_review_responses drop constraint contractor_review_responses_author_id_fkey,
  add constraint contractor_review_responses_author_id_fkey foreign key (author_id) references auth.users on delete set null;
alter table public.contractor_review_responses drop constraint contractor_review_responses_hidden_by_fkey,
  add constraint contractor_review_responses_hidden_by_fkey foreign key (hidden_by) references auth.users on delete set null;
alter table public.contractor_review_reports drop constraint contractor_review_reports_reporter_id_fkey,
  add constraint contractor_review_reports_reporter_id_fkey foreign key (reporter_id) references auth.users on delete cascade;
alter table public.contractor_review_reports drop constraint contractor_review_reports_resolved_by_fkey,
  add constraint contractor_review_reports_resolved_by_fkey foreign key (resolved_by) references auth.users on delete set null;

-- Any moderation decision (hide or restore) clears the « edited since hidden » marker.
create function dao_private.review_moderation_reset() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.status is distinct from old.status and (new.status='published' and old.status='hidden' or new.status='hidden' and old.status='published') then
    new.edited_since_hidden:=false;
  end if;
  return new;
end;
$$;
create trigger contractor_review_moderation_reset before update of status on public.contractor_reviews
  for each row execute function dao_private.review_moderation_reset();

create or replace function dao_private.contains_contact(p_text text)
returns boolean language sql immutable set search_path='' as $$
  with n as (
    select regexp_replace(
      lower(translate(coalesce(p_text,''),
        '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹０１２３４５６７８９' || chr(160) || chr(8239) || chr(8199) || '＠．',
        '012345678901234567890123456789   @.')),
      '[​-‍⁠﻿­]','','g') as t)
  select t ~ '[0-9]{8,}'                                                   -- 8+ digits in a row
      or t ~ '(^|[^0-9])[0-9]{2}[ .()_-]*[0-9]{3}[ .()_-]*[0-9]{3}([^0-9]|$)'  -- 20 123 456 / 20-123-456
      or t ~ '(^|[^0-9])[0-9]{2}([ .()_-]+[0-9]{2}){3}([^0-9]|$)'              -- 20 12 34 56
      or t ~ '(\+|(^|[^0-9])00)[ ]*[0-9][0-9 .()_-]{6,}'                       -- +216…, 00216…
      or t ~ '[^[:space:]@]+[ ]*@[ ]*[^[:space:]@]+\.[a-z]{2,}'                -- email
      or t ~ '(^|[[:space:](])@[a-z0-9_.]{3,}'                                 -- @pseudo
      or t ~ '(https?:|www\.|\marobase\M)'
      or t ~ '[a-z0-9-]{2,}[ ]*\.[ ]*(tn|com|net|org|fr|me|io|info|biz|co|app|site|online|shop|store|pro|tech|link|ly)([^a-z0-9]|$)'
      -- Short links only: naming a network (« photos envoyées sur WhatsApp ») is not a contact detail (COP reserve).
      or t ~ '(^|[^a-z0-9])(wa|t)[ ]*\.[ ]*me([^a-z0-9]|$)'
  from n;
$$;

create or replace function dao_private.submit_contractor_review(p_project_id uuid,p_contractor_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); existing public.contractor_reviews; saved public.contractor_reviews;
  v_rating smallint; v_quality smallint; v_deadlines smallint; v_budget smallint; v_communication smallint; v_cleanliness smallint; v_comment text;
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception using errcode='22023',message='Avis invalide'; end if;
  if not dao_private.review_pair(p_project_id,p_contractor_id,actor) then
    raise exception using errcode='42501',message='Avis réservé au Client d’un chantier démarré avec ce professionnel';
  end if;
  v_rating:=dao_private.review_score(p_input,'rating',true);
  v_quality:=dao_private.review_score(p_input,'quality',false);
  v_deadlines:=dao_private.review_score(p_input,'deadlines',false);
  v_budget:=dao_private.review_score(p_input,'budget',false);
  v_communication:=dao_private.review_score(p_input,'communication',false);
  v_cleanliness:=dao_private.review_score(p_input,'cleanliness',false);
  v_comment:=dao_private.review_text(p_input->>'comment',30,2000,'Commentaire');
  select * into existing from public.contractor_reviews
    where project_id=p_project_id and contractor_id=p_contractor_id for update;
  if existing.id is null then
    insert into public.contractor_reviews(project_id,contractor_id,author_id,rating,rating_quality,rating_deadlines,rating_budget,
      rating_communication,rating_cleanliness,comment)
    values(p_project_id,p_contractor_id,actor,v_rating,v_quality,v_deadlines,v_budget,v_communication,v_cleanliness,v_comment)
    returning * into saved;
    perform dao_private.review_audit('review_published',saved.id,jsonb_build_object('rating',v_rating));
  else
    if existing.author_id is distinct from actor then raise exception using errcode='42501',message='Avis non modifiable'; end if;
    update public.contractor_reviews set rating=v_rating,rating_quality=v_quality,rating_deadlines=v_deadlines,
      rating_budget=v_budget,rating_communication=v_communication,rating_cleanliness=v_cleanliness,comment=v_comment,
      updated_at=now(),edited_at=now(),
      -- A withdrawn review comes back as it was: published, or hidden if staff had hidden it.
      status=case when existing.status='withdrawn' then case when existing.hidden_at is null then 'published' else 'hidden' end
                  else existing.status end,
      withdrawn_at=case when existing.status='withdrawn' then null else existing.withdrawn_at end,
      -- A hidden review edited by its author must be read again before any restore (COP R5).
      edited_since_hidden=existing.hidden_at is not null
    where id=existing.id returning * into saved;
    perform dao_private.review_audit('review_updated',saved.id,jsonb_build_object('rating',v_rating,'status',saved.status));
  end if;
  return jsonb_build_object('id',saved.id,'status',saved.status,'edited',saved.edited_at is not null);
end;
$$;

create or replace function dao_private.withdraw_contractor_review(p_review_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.contractor_reviews;
begin
  if not dao_private.account_active(auth.uid()) then raise exception using errcode='42501',message='Compte actif requis'; end if;
  select * into r from public.contractor_reviews where id=p_review_id for update;
  if r.id is null or r.author_id is distinct from auth.uid() then raise exception using errcode='42501',message='Avis introuvable'; end if;
  if r.status<>'withdrawn' then
    update public.contractor_reviews set status='withdrawn',withdrawn_at=now(),updated_at=now() where id=r.id;
    perform dao_private.review_audit('review_withdrawn',r.id);
  end if;
  return jsonb_build_object('id',r.id,'status','withdrawn');
end;
$$;

create or replace function dao_private.report_contractor_review(p_review_id uuid,p_reason text,p_details text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.contractor_reviews; owner_id uuid; report_id uuid;
begin
  select * into r from public.contractor_reviews where id=p_review_id;
  select user_id into owner_id from public.contractor_profiles where id=r.contractor_id;
  -- The reviewed professional, or any Client allowed to read these reviews (COP R2), except the author.
  if r.id is null or r.status<>'published' or not dao_private.account_active(auth.uid())
     or r.author_id is not distinct from auth.uid()
     or not (owner_id=auth.uid() or (dao_private.can_read_contractor_reviews(r.contractor_id)
       and exists(select 1 from public.user_roles x where x.user_id=auth.uid() and x.role='client'))) then
    raise exception using errcode='42501',message='Signalement non autorisé pour cet avis';
  end if;
  if p_reason is null or p_reason not in ('insult','personal_data','off_topic','fake','other') then
    raise exception using errcode='22023',message='Motif de signalement invalide';
  end if;
  if char_length(coalesce(p_details,''))>1000 then raise exception using errcode='22023',message='Précisions : 1000 caractères maximum'; end if;
  insert into public.contractor_review_reports(review_id,reporter_id,reason,details)
  values(r.id,auth.uid(),p_reason,btrim(coalesce(p_details,'')))
  -- A report already decided by staff is not reopened by the same reporter.
  on conflict(review_id,reporter_id) do update set reason=excluded.reason,details=excluded.details,created_at=now()
    where public.contractor_review_reports.status='open'
  returning id into report_id;
  if report_id is null then return jsonb_build_object('status','already_reviewed'); end if;
  perform dao_private.review_audit('review_reported',r.id,jsonb_build_object('reason',p_reason));
  return jsonb_build_object('id',report_id,'status','open');
end;
$$;

-- Paged staff queue (COP R3): filter reported / hidden / all, most urgent first, with a total for paging.
create function dao_private.review_moderation_page(p_filter text default 'reported',p_limit integer default 30,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_limit integer:=least(greatest(coalesce(p_limit,30),1),100); v_offset integer:=greatest(coalesce(p_offset,0),0);
begin
  if not dao_private.staff() then raise exception using errcode='42501',message='Modération réservée à D.A.O.'; end if;
  if p_filter is null or p_filter not in ('reported','hidden','edited','all') then raise exception using errcode='22023',message='Filtre inconnu'; end if;
  return (with base as (
      select r.*,(select count(*) from public.contractor_review_reports k where k.review_id=r.id and k.status='open') as open_count
      from public.contractor_reviews r),
    filtered as (
      select * from base b where p_filter='all'
        or (p_filter='reported' and b.open_count>0)
        or (p_filter='hidden' and b.status='hidden')
        or (p_filter='edited' and b.edited_since_hidden))
    select jsonb_build_object(
      'total',(select count(*) from filtered),
      'items',coalesce((select jsonb_agg(q.item order by q.ord) from (
        select row_number() over (order by f.open_count desc, f.edited_since_hidden desc, f.created_at desc, f.id) as ord,
          dao_private.review_public_json(r) || jsonb_build_object(
        'status',r.status,'edited_since_hidden',r.edited_since_hidden,'open_reports',(select count(*) from public.contractor_review_reports k where k.review_id=r.id and k.status='open'),'hidden_reason',r.hidden_reason,'project_id',r.project_id,'contractor_id',r.contractor_id,
        'contractor_name',(select coalesce(nullif(cp.public_trade_name,''),cp.business_name) from public.contractor_profiles cp where cp.id=r.contractor_id),
        -- Fraud indicators for staff: chantier created by the professional, recent author account.
        'project_origin',(select p.project_origin from public.projects p where p.id=r.project_id),
        'author_since',(select pr.created_at from public.profiles pr where pr.user_id=r.author_id),
        'author_name',(select pr.display_name from public.profiles pr where pr.user_id=r.author_id),
        'response_status',(select x.status from public.contractor_review_responses x where x.review_id=r.id),
        'reports',(select coalesce(jsonb_agg(jsonb_build_object('reason',k.reason,'details',k.details,'status',k.status,'created_at',k.created_at)
          order by k.created_at desc),'[]'::jsonb) from public.contractor_review_reports k where k.review_id=r.id)) as item
        from filtered f join public.contractor_reviews r on r.id=f.id
        order by f.open_count desc, f.edited_since_hidden desc, f.created_at desc, f.id
        limit v_limit offset v_offset) q),'[]'::jsonb)));
end;
$$;

create function public.review_moderation_page(p_filter text default 'reported',p_limit integer default 30,p_offset integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.review_moderation_page($1,$2,$3); $$;

revoke all on function dao_private.review_moderation_reset(),dao_private.review_moderation_page(text,integer,integer),
  public.review_moderation_page(text,integer,integer) from public,anon,authenticated;
grant execute on function dao_private.review_moderation_page(text,integer,integer),public.review_moderation_page(text,integer,integer)
  to authenticated,service_role;
commit;
