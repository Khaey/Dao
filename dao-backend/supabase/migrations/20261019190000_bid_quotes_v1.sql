begin;

alter table public.bid_versions
  add column quote_valid_until date,
  add column quote_terms text,
  add column material_references text;

create table public.bid_quote_lines (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bid_version_id uuid not null references public.bid_versions,
  bid_item_id uuid not null,
  position integer not null check(position between 1 and 200),
  section text not null default 'other' check(section in ('materials','labor','other')),
  designation text not null check(length(trim(designation)) between 1 and 240),
  unit text not null check(length(trim(unit)) between 1 and 40),
  quantity_milli bigint not null check(quantity_milli between 1 and 1000000000000),
  unit_price_millimes bigint not null check(unit_price_millimes between 0 and 1000000000000),
  -- Half-up to the nearest millime; floor prevents a second numeric-to-bigint rounding.
  total_millimes bigint generated always as (floor((quantity_milli::numeric * unit_price_millimes::numeric + 500) / 1000)::bigint) stored,
  foreign key(bid_item_id,bid_version_id) references public.bid_items(id,bid_version_id) on delete cascade,
  unique(bid_item_id,position)
);
create index on public.bid_quote_lines(bid_version_id);
create index on public.bid_quote_lines(bid_item_id);

alter table public.bid_quote_lines enable row level security;
revoke all on public.bid_quote_lines from public,anon,authenticated;
grant select on public.bid_quote_lines to authenticated;
grant all on public.bid_quote_lines to service_role;
create policy read_allowed on public.bid_quote_lines for select to authenticated
using (dao_private.staff() or dao_private.bid_version(bid_version_id));

create trigger immutable_bid_quote_lines before insert or update or delete on public.bid_quote_lines
for each row execute function dao_private.lock_bid_children();

drop trigger immutable_bid_document on public.bid_documents;
create or replace function dao_private.lock_bid_document() returns trigger language plpgsql set search_path='' as $$
declare version_id uuid;
begin
  version_id:=case when TG_OP='INSERT' then NEW.bid_version_id else OLD.bid_version_id end;
  if TG_OP in ('INSERT','DELETE') and exists(select 1 from public.bid_versions where id=version_id and submitted_at is not null)
  then raise exception 'submitted_bid_content_immutable' using errcode='23514'; end if;
  if TG_OP='UPDATE' and (to_jsonb(NEW)-'status') is distinct from (to_jsonb(OLD)-'status')
  then raise exception 'bid_document_identity_immutable' using errcode='23514'; end if;
  if TG_OP='DELETE' then return OLD; end if;
  return NEW;
end $$;
create trigger immutable_bid_document before insert or update or delete on public.bid_documents
for each row execute function dao_private.lock_bid_document();

create or replace function dao_private.update_bid_quote_metadata(
  p_version_id uuid,
  p_valid_until date,
  p_terms text,
  p_material_references text
) returns public.bid_versions
language plpgsql security definer set search_path='' as $$
declare v public.bid_versions;
begin
  select * into v from public.bid_versions
  where id=p_version_id and status='draft' and dao_private.pro(contractor_id) for update;
  if v.id is null then raise exception using errcode='42501',message='bid is not an owned draft'; end if;
  if p_valid_until is not null and p_valid_until<current_date then raise exception using errcode='22023',message='quote validity cannot be in the past'; end if;
  if length(coalesce(p_terms,''))>4000 or length(coalesce(p_material_references,''))>4000 then raise exception using errcode='22023',message='quote metadata too long'; end if;
  update public.bid_versions set quote_valid_until=p_valid_until,quote_terms=nullif(trim(p_terms),''),material_references=nullif(trim(p_material_references),'') where id=v.id returning * into v;
  return v;
end $$;

create or replace function dao_private.replace_bid_quote_lines(p_bid_item_id uuid,p_lines jsonb)
returns setof public.bid_quote_lines
language plpgsql security definer set search_path='' as $$
declare v_item public.bid_items; entry jsonb; n integer; pos integer:=0; qty bigint; price bigint;
begin
  if jsonb_typeof(p_lines)<>'array' then raise exception using errcode='22023',message='quote lines must be an array'; end if;
  n:=jsonb_array_length(p_lines);
  if n>200 then raise exception using errcode='22023',message='too many quote lines'; end if;
  select bi.* into v_item from public.bid_items bi join public.bid_versions bv on bv.id=bi.bid_version_id
  where bi.id=p_bid_item_id and bv.status='draft' and dao_private.pro(bv.contractor_id) for update of bv;
  if v_item.id is null then raise exception using errcode='42501',message='bid item is not an owned draft'; end if;
  delete from public.bid_quote_lines where bid_item_id=v_item.id;
  for entry in select value from jsonb_array_elements(p_lines) loop
    pos:=pos+1;
    begin qty:=(entry->>'quantity_milli')::bigint; price:=(entry->>'unit_price_millimes')::bigint;
    exception when others then raise exception using errcode='22023',message='invalid quote amount'; end;
    insert into public.bid_quote_lines(bid_version_id,bid_item_id,position,section,designation,unit,quantity_milli,unit_price_millimes)
    values(v_item.bid_version_id,v_item.id,pos,coalesce(nullif(entry->>'section',''),'other'),trim(entry->>'designation'),trim(entry->>'unit'),qty,price);
  end loop;
  return query select * from public.bid_quote_lines where bid_item_id=v_item.id order by position;
end $$;

create or replace function dao_private.create_bid_quote_document(
  p_version_id uuid,p_object_path text,p_original_name text,p_size_bytes bigint
) returns public.bid_documents
language plpgsql security definer set search_path='' as $$
declare v public.bid_versions; d public.bid_documents;
begin
  select * into v from public.bid_versions where id=p_version_id and status='draft' and dao_private.pro(contractor_id) for update;
  if v.id is null then raise exception using errcode='42501',message='bid is not an owned draft'; end if;
  if p_object_path not like 'bid/'||v.id::text||'/%' then raise exception using errcode='22023',message='invalid storage namespace'; end if;
  if lower(p_original_name) not like '%.pdf' or length(p_original_name)>200 then raise exception using errcode='22023',message='a PDF quote is required'; end if;
  if p_size_bytes<1 or p_size_bytes>20971520 then raise exception using errcode='22023',message='invalid PDF size'; end if;
  insert into public.bid_documents(bid_version_id,project_id,contractor_id,object_path,original_name,mime_type,size_bytes,status)
  values(v.id,v.project_id,v.contractor_id,p_object_path,p_original_name,'application/pdf',p_size_bytes,'quarantined') returning * into d;
  return d;
end $$;

create or replace function dao_private.approve_owned_bid_quote_document(p_document_id uuid)
returns public.bid_documents language plpgsql security definer set search_path='' as $$
declare d public.bid_documents;
begin
  select bd.* into d from public.bid_documents bd join public.bid_versions bv on bv.id=bd.bid_version_id
  where bd.id=p_document_id and bd.status='quarantined' and bv.status='draft' and dao_private.pro(bv.contractor_id) for update of bd;
  if d.id is null then raise exception using errcode='42501',message='document is not an owned draft'; end if;
  update public.bid_documents set status='approved' where id=d.id returning * into d;
  return d;
end $$;

create or replace function dao_private.delete_owned_bid_quote_document(p_document_id uuid)
returns public.bid_documents language plpgsql security definer set search_path='' as $$
declare d public.bid_documents;
begin
  select bd.* into d from public.bid_documents bd join public.bid_versions bv on bv.id=bd.bid_version_id
  where bd.id=p_document_id and bv.status='draft' and dao_private.pro(bv.contractor_id) for update of bv;
  if d.id is null then raise exception using errcode='42501',message='document is not an owned draft'; end if;
  delete from public.bid_documents where id=d.id;
  return d;
end $$;

create or replace function dao_private.submit_bid_version(p_version_id uuid)
returns public.bid_versions language plpgsql security definer set search_path='' as $$
declare v public.bid_versions; v_item_count integer;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  perform 1 from public.projects where id=(select project_id from public.bid_versions where id=p_version_id) for update;
  select bv.* into v from public.bid_versions bv where bv.id=p_version_id and bv.status='draft'
    and exists(select 1 from public.contractor_profiles cp where cp.id=bv.contractor_id and cp.verification_status='verified') and dao_private.pro(bv.contractor_id)
    and exists(select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role='contractor');
  if v.id is null then raise exception using errcode='42501',message='bid is not an owned draft'; end if;
  select count(*) into v_item_count from public.bid_items where bid_version_id=v.id;
  if v_item_count=0 then raise exception using errcode='23514',message='at least one bid item required'; end if;
  if exists(select 1 from public.bid_items bi where bi.bid_version_id=v.id and exists(select 1 from public.bid_quote_lines q where q.bid_item_id=bi.id)
    and bi.price_millimes<>(select coalesce(sum(q.total_millimes),0) from public.bid_quote_lines q where q.bid_item_id=bi.id))
  then raise exception using errcode='23514',message='detailed quote total must equal offer price'; end if;
  if exists(select 1 from public.bid_documents where bid_version_id=v.id and status<>'approved')
  then raise exception using errcode='23514',message='quote PDF validation is incomplete'; end if;
  if not exists(select 1 from public.publications p where p.project_id=v.project_id and p.id=v.publication_id and p.status='published'
    and (p.submission_deadline is null or p.submission_deadline>now()) and dao_private.publication(p.id)
    and not exists(select 1 from public.bid_items bi where bi.bid_version_id=v.id and not exists(select 1 from public.publication_requests pr where pr.publication_id=p.id and pr.request_version_id=bi.request_version_id and not exists(select 1 from public.publication_lot_withdrawals w where w.publication_request_id=pr.id))))
  then raise exception using errcode='42501',message='bid requests are not published'; end if;
  if exists(select 1 from public.bid_items bi join public.project_requests r on r.id=bi.request_id where bi.bid_version_id=v.id and (r.status not in ('open','reserved') or exists(select 1 from public.award_items ai where ai.request_id=r.id and ai.active)))
  then raise exception using errcode='23514',message='lot fermé aux nouvelles offres'; end if;
  update public.bid_versions set status='superseded',validity='obsolete' where bid_id=v.bid_id and id<>v.id and status='submitted' and submitted_at is not null;
  update public.bid_versions set status='submitted',submitted_at=now(),validity='current' where id=v.id and status='draft' returning * into v;
  if not found then raise exception using errcode='42501',message='bid is not an owned draft'; end if;
  return v;
end $$;

create function public.update_bid_quote_metadata(p_version_id uuid,p_valid_until date,p_terms text,p_material_references text)
returns public.bid_versions language sql security definer set search_path='' as $$select dao_private.update_bid_quote_metadata($1,$2,$3,$4)$$;
create function public.replace_bid_quote_lines(p_bid_item_id uuid,p_lines jsonb)
returns setof public.bid_quote_lines language sql security definer set search_path='' as $$select * from dao_private.replace_bid_quote_lines($1,$2)$$;
create function public.create_bid_quote_document(p_version_id uuid,p_object_path text,p_original_name text,p_size_bytes bigint)
returns public.bid_documents language sql security definer set search_path='' as $$select dao_private.create_bid_quote_document($1,$2,$3,$4)$$;
create function public.approve_owned_bid_quote_document(p_document_id uuid)
returns public.bid_documents language sql security definer set search_path='' as $$select dao_private.approve_owned_bid_quote_document($1)$$;
create function public.delete_owned_bid_quote_document(p_document_id uuid)
returns public.bid_documents language sql security definer set search_path='' as $$select dao_private.delete_owned_bid_quote_document($1)$$;

revoke all on function dao_private.update_bid_quote_metadata(uuid,date,text,text),dao_private.replace_bid_quote_lines(uuid,jsonb),dao_private.create_bid_quote_document(uuid,text,text,bigint),dao_private.approve_owned_bid_quote_document(uuid),dao_private.delete_owned_bid_quote_document(uuid) from public,anon,authenticated;
revoke all on function public.update_bid_quote_metadata(uuid,date,text,text),public.replace_bid_quote_lines(uuid,jsonb),public.create_bid_quote_document(uuid,text,text,bigint),public.approve_owned_bid_quote_document(uuid),public.delete_owned_bid_quote_document(uuid) from public,anon;
grant execute on function public.update_bid_quote_metadata(uuid,date,text,text),public.replace_bid_quote_lines(uuid,jsonb),public.create_bid_quote_document(uuid,text,text,bigint),public.approve_owned_bid_quote_document(uuid),public.delete_owned_bid_quote_document(uuid) to authenticated;

commit;
