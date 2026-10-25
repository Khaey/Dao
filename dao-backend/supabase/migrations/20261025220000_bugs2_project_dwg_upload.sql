-- BUGS2-04 (#464) : plans DWG acceptés pour les documents de chantier uniquement.
-- Stockage privé (bucket dao-private), téléchargement par URL signée après contrôle
-- JWT/RLS, aucun aperçu ni interprétation du contenu. Devis, RFI et profils restent
-- PDF/JPG/PNG/WebP. Plafond inchangé : 20 Mo physiques, abaissable par
-- uploads.max_file_mb (trigger settings_guard_upload_size, S2).
begin;

update storage.buckets
set allowed_mime_types = array['application/pdf','image/jpeg','image/png','image/webp','image/vnd.dwg']
where id = 'dao-private';

create or replace function dao_private.create_project_document(
  p_project_id uuid,p_object_path text,p_original_name text,p_mime_type text,p_size_bytes bigint
) returns public.documents language plpgsql security definer set search_path=''
as $$
declare v public.documents;
begin
  if auth.uid() is null or not dao_private.project_member(p_project_id) then raise exception using errcode='42501',message='project ownership required'; end if;
  if p_object_path is null or p_object_path not like ('project/'||p_project_id::text||'/%') then raise exception using errcode='23514',message='invalid project document path'; end if;
  if p_mime_type not in ('application/pdf','image/jpeg','image/png','image/webp','image/vnd.dwg') then raise exception using errcode='23514',message='unsupported document type'; end if;
  if p_mime_type='image/vnd.dwg' and lower(coalesce(p_original_name,'')) !~ '\.dwg$' then raise exception using errcode='23514',message='unsupported document type'; end if;
  if p_size_bytes < 1 or p_size_bytes > 20971520 then raise exception using errcode='23514',message='document size must be at most 20 MB'; end if;
  insert into public.documents(project_id,owner_id,object_path,original_name,mime_type,size_bytes)
  values(p_project_id,auth.uid(),p_object_path,p_original_name,p_mime_type,p_size_bytes)
  returning * into v;
  return v;
end;
$$;

commit;
