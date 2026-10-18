-- Avis clients vérifiés — suivi COP R2 (#213) : plafond de signalements en attente par compte.
-- Un compte ne peut pas noyer la file de modération : au plus 10 signalements ouverts à la fois
-- (un signalement tranché par le staff libère une place). Modifier son propre signalement ouvert
-- n'est jamais bloqué. Additive : create or replace d'une fonction existante, droits conservés
-- (dao_private.report_contractor_review reste exécutable par authenticated/service_role uniquement).
begin;

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
  -- COP R2: at most 10 open reports per account; editing an already open report on the same review is allowed.
  if not exists(select 1 from public.contractor_review_reports k where k.review_id=r.id and k.reporter_id=auth.uid() and k.status='open')
     and (select count(*) from public.contractor_review_reports k where k.reporter_id=auth.uid() and k.status='open')>=10 then
    raise exception using errcode='53400',message='Trop de signalements en attente : attendez la décision de l’équipe D.A.O.';
  end if;
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

commit;
