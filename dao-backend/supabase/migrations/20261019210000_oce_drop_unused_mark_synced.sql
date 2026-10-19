-- OCE (#301) : retire l'ancienne surcharge oce_mark_synced(uuid) (migration 20261019170000), remplacée par
-- oce_mark_synced(uuid,integer) (20261019200000) et plus appelée par le backend. Aucune donnée touchée.
begin;

drop function if exists public.oce_mark_synced(uuid);
drop function if exists dao_private.oce_mark_synced(uuid);

commit;
