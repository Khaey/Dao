-- Bucket privé. Accès aux octets uniquement par URL signée après autorisation serveur.
begin;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('dao-private','dao-private',false,20971520,array['application/pdf','image/jpeg','image/png','image/webp']);
-- Aucune policy de lecture/écriture anonyme sur storage.objects.
-- Base neuve exigée : auditer les policies Storage préexistantes avant réutilisation.
-- Ni Realtime public ni publication Postgres générale dans ce sprint.
-- Restrictive bucket fence also blocks access through unrelated permissive policies.
create policy dao_no_direct_read on storage.objects as restrictive for select to anon,authenticated using(bucket_id <> 'dao-private');
create policy dao_no_direct_insert on storage.objects as restrictive for insert to anon,authenticated with check(bucket_id <> 'dao-private');
create policy dao_no_direct_update on storage.objects as restrictive for update to anon,authenticated using(bucket_id <> 'dao-private') with check(bucket_id <> 'dao-private');
create policy dao_no_direct_delete on storage.objects as restrictive for delete to anon,authenticated using(bucket_id <> 'dao-private');
commit;
