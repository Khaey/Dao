-- Non-destructive canonical normalization for direct RPC callers.
-- Existing E.164 CHECK constraints remain in force as the storage boundary.
begin;
create or replace function dao_private.normalize_professional_phone(p_value text) returns text
language plpgsql immutable set search_path='' as $$
declare v text:=btrim(p_value); open_count integer; close_count integer;
begin
  if v='' then return ''; end if;
  open_count:=length(v)-length(replace(v,'(','')); close_count:=length(v)-length(replace(v,')',''));
  if left(v,1)<>'+' or v !~ '^[+][0-9[:space:]().-]+$' or v ~ '[(][[:space:]]*0[[:space:]]*[)]' or open_count<>close_count then
    raise exception using errcode='22023',message='Numéro international invalide : utilisez +indicatif pays, sans extension ni zéro de tronc';
  end if;
  v:=regexp_replace(v,'[[:space:]().-]','','g');
  if v !~ '^[+][1-9][0-9]{6,14}$' then
    raise exception using errcode='22023',message='Numéro international invalide : 7 à 15 chiffres après +, indicatif compris';
  end if;
  return v;
end; $$;

create or replace function dao_private.normalize_contractor_contact_phones() returns trigger
language plpgsql set search_path='' as $$
begin
  new.professional_phone:=dao_private.normalize_professional_phone(new.professional_phone);
  new.whatsapp_phone:=dao_private.normalize_professional_phone(new.whatsapp_phone);
  return new;
end; $$;
create trigger normalize_contractor_contact_phones_before_save
before insert or update of professional_phone,whatsapp_phone on public.contractor_profile_details
for each row execute function dao_private.normalize_contractor_contact_phones();
revoke all on function dao_private.normalize_professional_phone(text) from public,anon,authenticated;
revoke all on function dao_private.normalize_contractor_contact_phones() from public,anon,authenticated;
commit;
