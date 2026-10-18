-- Aperçu privé du professionnel (#161 lot B, #211) : le propriétaire de la fiche et le staff voient,
-- en aperçu uniquement, leurs réalisations et médias encore en revue avec leur état et leur consentement.
-- * Les Clients et tiers ne sont pas concernés : sans droit d'aperçu, rien ne change (fonction privée
--   professional_public_profile inchangée, mêmes filtres approved / published / consentement).
-- * Jamais de pièce légale (seul le logo parmi contractor_files), jamais d'object_path ; les médias
--   non inspectés (sans empreinte), retirés ou masqués restent exclus.
-- * Le téléchargement reste contrôlé par professional_file_access (propriétaire ou staff).
begin;

create function dao_private.owner_preview_allowed(p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select dao_private.account_active(auth.uid()) and exists(
    select 1 from public.contractor_profiles cp where cp.id=p_id and (cp.user_id=auth.uid() or dao_private.staff()));
$$;

create function dao_private.professional_owner_preview(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare base jsonb; logo record;
begin
  if not dao_private.owner_preview_allowed(p_id) then
    raise exception using errcode='42501',message='Aperçu réservé au professionnel et à D.A.O.';
  end if;
  base:=dao_private.professional_public_profile(p_id,true);
  select f.id,f.status,f.public_consent,f.mime_type into logo from public.contractor_files f
    where f.contractor_id=p_id and f.purpose='logo' and f.status in ('ready','approved','rejected') and f.content_sha256 is not null
    order by f.created_at desc limit 1;
  return base || jsonb_build_object(
    'preview',true,
    'logo_id',logo.id,'logo_status',logo.status,'logo_public_consent',logo.public_consent,'logo_mime_type',logo.mime_type,
    'portfolio',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',p.id,'title',p.title,'description',p.description,'completed_year',p.completed_year,
        'approximate_location',p.approximate_location,'trade',(select t.name_fr from public.trades t where t.id=p.trade_id),
        'status',p.status,'publication_consent',p.publication_consent,
        'assets',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'caption',a.caption,'mime_type',a.mime_type,
            'asset_kind',a.asset_kind,'original_name',a.original_name,'status',a.status,'public_consent',a.public_consent)
            order by a.sort_order,a.created_at),'[]'::jsonb)
          from public.portfolio_assets a where a.portfolio_project_id=p.id
            and a.status in ('ready','approved','rejected') and a.content_sha256 is not null)
      ) order by p.created_at desc),'[]'::jsonb)
      from public.portfolio_projects p where p.contractor_id=p_id and p.status<>'hidden'));
end;
$$;

-- Public wrapper: owner/staff preview gets the enriched projection; everything else is unchanged.
create or replace function public.professional_public_profile(p_id uuid,p_preview boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
  select case when $2 and dao_private.owner_preview_allowed($1)
           then dao_private.professional_owner_preview($1)
           else dao_private.professional_public_profile($1,$2) end
         || jsonb_build_object('rating',dao_private.contractor_rating($1));
$$;

revoke all on function dao_private.owner_preview_allowed(uuid),dao_private.professional_owner_preview(uuid) from public,anon,authenticated;
grant execute on function dao_private.owner_preview_allowed(uuid),dao_private.professional_owner_preview(uuid) to authenticated,service_role;
commit;
