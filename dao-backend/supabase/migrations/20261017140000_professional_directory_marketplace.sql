-- Annuaire professionnels « marketplace » (décision propriétaire 17/10, DOW).
-- Remplace uniquement le contenu renvoyé par dao_private.professional_directory :
--   * mêmes contrôles d'accès (compte actif ; Client pour l'annuaire public ; staff pour p_review) ;
--   * mêmes conditions de publication (vérifié, identité publique approuvée, fiche approuvée, compte actif) ;
--   * champs ajoutés = sous-ensemble de ce que dao_private.professional_public_profile expose déjà
--     aux mêmes Clients et dans les mêmes conditions (aucune donnée privée : ni coordonnées, ni
--     adresse, ni identifiants fiscaux, ni fichiers non approuvés ou sans consentement).
-- Signature, propriétaire, SECURITY DEFINER, search_path et droits (GRANT) inchangés.
begin;
create or replace function dao_private.professional_directory(p_review boolean default false) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not dao_private.account_active(auth.uid()) or (p_review and not dao_private.staff()) or
    (not p_review and not exists(select 1 from public.user_roles where user_id=auth.uid() and role='client')) then
    raise exception using errcode='42501',message='Annuaire non autorisé'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,
      'name',coalesce(nullif(c.public_trade_name,''),c.business_name),
      'verification_status',c.verification_status,
      'review_status',d.review_status,
      'city',d.city,
      'contractor_type',c.contractor_type,
      'governorate',(select g.name_fr from public.governorates g where g.id=d.governorate_id),
      'presentation',left(coalesce(c.public_presentation,''),220),
      'years_experience',c.years_experience,
      'availability',c.availability,
      'available_from',c.available_from,
      'trades',(select coalesce(jsonb_agg(t.name_fr order by t.name_fr),'[]') from public.contractor_trades ct
        join public.trades t on t.id=ct.trade_id where ct.contractor_id=c.id),
      'areas',(select coalesce(jsonb_agg(distinct g.name_fr),'[]') from public.contractor_service_areas a
        join public.governorates g on g.id=a.governorate_id where a.contractor_id=c.id),
      'logo_id',(select f.id from public.contractor_files f where f.contractor_id=c.id and f.purpose='logo'
        and f.status='approved' and f.public_consent and f.content_sha256 is not null order by f.created_at desc limit 1),
      'portfolio_count',(select count(*) from public.portfolio_projects p where p.contractor_id=c.id
        and p.status='published' and p.publication_consent)
    ) order by c.created_at desc),'[]')
    from public.contractor_profiles c left join public.contractor_profile_details d on d.contractor_id=c.id
    where p_review or (c.verification_status='verified' and c.public_identity_status='approved' and d.review_status='approved' and dao_private.account_active(c.user_id)));
end; $$;
commit;
