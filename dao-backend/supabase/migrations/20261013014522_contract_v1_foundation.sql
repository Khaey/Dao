begin;

-- P2.2-A is a non-engaging technical foundation. It deliberately exposes no
-- authenticated command: preparation remains service-side only until the DAO
-- legal identity and the controlled draft-exit path are approved.
alter table public.contracts drop constraint contracts_status_check;
alter table public.contracts add constraint contracts_status_check
  check(status in ('draft','review','ready','awaiting_signatures','signed'));
alter table public.contracts
  add column prepared_by uuid references auth.users,
  add column total_millimes bigint check(total_millimes>=0),
  add column current_version_id uuid,
  add column locked_at timestamptz,
  add column updated_at timestamptz not null default now();

create table public.contract_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  contract_id uuid not null references public.contracts,
  award_item_id uuid not null references public.award_items,
  request_id uuid not null references public.project_requests,
  bid_item_id uuid not null references public.bid_items,
  agreed_millimes bigint not null check(agreed_millimes>=0),
  title text not null,
  scope text not null,
  duration_days integer not null check(duration_days>0),
  inclusions text not null,
  exclusions text,
  unique(contract_id,award_item_id),
  unique(contract_id,request_id)
);

create table public.contract_events (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  contract_id uuid not null references public.contracts,
  actor_id uuid not null references auth.users,
  event_type text not null check(event_type in ('foundation_prepared','version_created','status_changed')),
  from_status text,
  to_status text,
  reason text,
  metadata jsonb not null default '{}'::jsonb
);

create table public.contract_archives (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  contract_id uuid not null references public.contracts,
  contract_version_id uuid not null references public.contract_versions,
  object_path text not null unique,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check(size_bytes between 1 and 20971520),
  content_hash text not null check(content_hash~'^[0-9a-f]{64}$'),
  unique(contract_version_id,content_hash)
);

alter table public.contract_versions
  add column created_by uuid references auth.users,
  add constraint contract_versions_hash_format check(content_hash~'^[0-9a-f]{64}$');
alter table public.contracts add constraint contracts_current_version_fkey
  foreign key(current_version_id) references public.contract_versions(id);

create or replace function dao_private.contract(c uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and dao_private.account_active(auth.uid()) and exists(
    select 1 from public.contracts ct
    where ct.id=c and (
      exists(select 1 from public.contract_parties cp where cp.contract_id=ct.id and cp.user_id=auth.uid())
      or (dao_private.staff() and exists(
        select 1 from public.user_roles ur where ur.user_id=auth.uid() and ur.role='dao_admin'
      ))
    )
  );
$$;

create or replace function dao_private.contract_version_hash(p_content jsonb)
returns text language sql immutable set search_path='' as $$
  select encode(sha256(convert_to(p_content::text,'UTF8')),'hex');
$$;

create function dao_private.contract_append_only() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception using errcode='23514',message='Archive contractuelle immuable';
end;
$$;

create function dao_private.contract_version_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.content_hash<>dao_private.contract_version_hash(new.content) then
    raise exception using errcode='23514',message='Empreinte de version invalide';
  end if;
  return new;
end;
$$;

create trigger contract_versions_hash before insert on public.contract_versions
for each row execute function dao_private.contract_version_guard();
create trigger immutable_contract_versions before update or delete on public.contract_versions
for each row execute function dao_private.contract_append_only();
create trigger immutable_contract_parties before update or delete on public.contract_parties
for each row execute function dao_private.contract_append_only();
create trigger immutable_contract_items before update or delete on public.contract_items
for each row execute function dao_private.contract_append_only();
create trigger immutable_contract_events before update or delete on public.contract_events
for each row execute function dao_private.contract_append_only();
create trigger immutable_contract_archives before update or delete on public.contract_archives
for each row execute function dao_private.contract_append_only();

create function dao_private.contract_state_guard() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.status='draft' and old.current_version_id is null
     and new.current_version_id is not null and old.locked_at is null and new.locked_at is not null
     and new.award_id=old.award_id and new.project_id=old.project_id
     and new.prepared_by is not distinct from old.prepared_by
     and new.total_millimes is not distinct from old.total_millimes then
    new.updated_at:=now();
    return new;
  end if;
  if new.award_id<>old.award_id or new.project_id<>old.project_id
     or new.prepared_by is distinct from old.prepared_by
     or new.total_millimes is distinct from old.total_millimes
     or new.current_version_id is distinct from old.current_version_id
     or new.status<>old.status then
    raise exception using errcode='23514',message='Transition contractuelle réservée aux commandes contrôlées';
  end if;
  new.updated_at:=now();
  return new;
end;
$$;
create trigger controlled_contract_update before update on public.contracts
for each row execute function dao_private.contract_state_guard();
create trigger immutable_contract_delete before delete on public.contracts
for each row execute function dao_private.contract_append_only();

create function dao_private.prepare_contract_foundation(
  p_actor_id uuid,p_award_id uuid,p_dao_user_id uuid,p_dao_legal_name text,
  p_idempotency_key uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.awards; award_project_id uuid; project_client uuid; contractor_user uuid;
  client_name text; contractor_name text; cid uuid; vid uuid; body jsonb; result jsonb;
  expected_count integer; inserted_count integer; total bigint;
begin
  if p_actor_id is null or p_idempotency_key is null then
    raise exception using errcode='22023',message='Acteur et clé idempotente requis';
  end if;
  if not dao_private.account_active(p_actor_id) or not exists(
    select 1 from public.user_roles where user_id=p_actor_id and role='dao_admin'
  ) then raise exception using errcode='42501',message='Administrateur actif requis'; end if;
  if p_dao_user_id is null or not dao_private.account_active(p_dao_user_id)
     or not exists(select 1 from public.user_roles where user_id=p_dao_user_id and role='dao_admin')
     or btrim(coalesce(p_dao_legal_name,''))='' then
    raise exception using errcode='22023',message='Identité D.A.O habilitée requise';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_actor_id::text||':'||p_idempotency_key::text,0));
  select cr.result into result from public.command_receipts cr
   where cr.actor_id=p_actor_id and cr.idempotency_key=p_idempotency_key::text
     and cr.command='prepare_contract_foundation';
  if result is not null then return result; end if;
  if exists(select 1 from public.command_receipts where actor_id=p_actor_id and idempotency_key=p_idempotency_key::text) then
    raise exception using errcode='23505',message='Clé idempotente déjà utilisée';
  end if;
  select project_id into award_project_id from public.awards where id=p_award_id;
  if award_project_id is null then raise exception using errcode='23514',message='Attribution active confirmée requise'; end if;
  -- Serialize with award cancellation, which locks the project before reading the
  -- award items. This makes preparation/cancellation a single-winner race.
  perform 1 from public.projects where id=award_project_id for update;
  select * into a from public.awards where id=p_award_id for update;
  if not found or a.status<>'confirmed' then raise exception using errcode='23514',message='Attribution active confirmée requise'; end if;
  if exists(select 1 from public.contracts where award_id=a.id) then
    raise exception using errcode='23505',message='Un contrat existe déjà pour cette attribution';
  end if;
  select p.client_id,coalesce(pr.display_name,'Client D.A.O'),cp.user_id,cp.business_name
    into project_client,client_name,contractor_user,contractor_name
  from public.projects p join public.contractor_profiles cp on cp.id=a.contractor_id
  left join public.profiles pr on pr.user_id=p.client_id where p.id=a.project_id;
  if project_client is null or contractor_user is null
     or not dao_private.account_active(project_client) or not dao_private.account_active(contractor_user) then
    raise exception using errcode='23514',message='Parties actives requises';
  end if;
  select count(*),sum(agreed_millimes) into expected_count,total
    from public.award_items where award_id=a.id and active;
  if expected_count=0 then raise exception using errcode='23514',message='Périmètre actif vide'; end if;
  insert into public.contracts(award_id,project_id,status,prepared_by,total_millimes)
    values(a.id,a.project_id,'draft',p_actor_id,total) returning id into cid;
  insert into public.contract_items(contract_id,award_item_id,request_id,bid_item_id,
    agreed_millimes,title,scope,duration_days,inclusions,exclusions)
  select cid,ai.id,ai.request_id,ai.bid_item_id,ai.agreed_millimes,prv.title,prv.scope,
    bi.duration_days,bi.inclusions,bi.exclusions
  from public.award_items ai join public.bid_items bi on bi.id=ai.bid_item_id
  join public.project_request_versions prv on prv.id=bi.request_version_id
  where ai.award_id=a.id and ai.active order by ai.id;
  get diagnostics inserted_count=row_count;
  if inserted_count<>expected_count then raise exception using errcode='23514',message='Périmètre incomplet'; end if;
  insert into public.contract_parties(contract_id,role,user_id,legal_name) values
    (cid,'client',project_client,client_name),(cid,'contractor',contractor_user,contractor_name),
    (cid,'dao',p_dao_user_id,btrim(p_dao_legal_name));
  select jsonb_build_object('schema','dao-contract-foundation-v1','contract_id',cid,
    'award_id',a.id,'project_id',a.project_id,'currency','TND','total_millimes',total,
    'non_engaging',true,'items',jsonb_agg(jsonb_build_object('award_item_id',ci.award_item_id,
      'request_id',ci.request_id,'bid_item_id',ci.bid_item_id,'agreed_millimes',ci.agreed_millimes,
      'title',ci.title,'scope',ci.scope,'duration_days',ci.duration_days,
      'inclusions',ci.inclusions,'exclusions',ci.exclusions) order by ci.award_item_id),
    'parties',(select jsonb_agg(jsonb_build_object('role',cp.role,'user_id',cp.user_id,
      'legal_name',cp.legal_name) order by cp.role) from public.contract_parties cp where cp.contract_id=cid))
    into body from public.contract_items ci where ci.contract_id=cid;
  insert into public.contract_versions(contract_id,version_no,content,content_hash,created_by)
    values(cid,1,body,dao_private.contract_version_hash(body),p_actor_id) returning id into vid;
  update public.contracts set current_version_id=vid,locked_at=now() where id=cid;
  insert into public.contract_events(contract_id,actor_id,event_type,to_status,metadata)
    values(cid,p_actor_id,'foundation_prepared','draft',jsonb_build_object('version_id',vid,'non_engaging',true));
  result:=jsonb_build_object('contract_id',cid,'version_id',vid,'status','draft',
    'total_millimes',total,'item_count',expected_count,'non_engaging',true);
  insert into public.command_receipts(actor_id,idempotency_key,command,result)
    values(p_actor_id,p_idempotency_key::text,'prepare_contract_foundation',result);
  return result;
end;
$$;

create function public.prepare_contract_foundation(
  p_actor_id uuid,p_award_id uuid,p_dao_user_id uuid,p_dao_legal_name text,p_idempotency_key uuid
) returns jsonb language sql security definer set search_path='' as $$
  select dao_private.prepare_contract_foundation($1,$2,$3,$4,$5);
$$;

revoke all on function public.prepare_contract_foundation(uuid,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_contract_foundation(uuid,uuid,uuid,text,uuid) to service_role;
revoke all on function dao_private.prepare_contract_foundation(uuid,uuid,uuid,text,uuid),
  dao_private.contract_version_hash(jsonb),dao_private.contract_append_only(),
  dao_private.contract_version_guard(),dao_private.contract_state_guard() from public,anon,authenticated;
grant execute on function dao_private.contract_version_hash(jsonb) to authenticated,service_role;

alter table public.contract_items enable row level security;
alter table public.contract_events enable row level security;
alter table public.contract_archives enable row level security;
revoke all on public.contract_items,public.contract_events,public.contract_archives from anon,authenticated;
grant select on public.contract_items,public.contract_events,public.contract_archives to authenticated;
create policy read_allowed on public.contract_items for select to authenticated using(dao_private.contract(contract_id));
create policy read_allowed on public.contract_events for select to authenticated using(dao_private.contract(contract_id));
create policy read_allowed on public.contract_archives for select to authenticated using(dao_private.contract(contract_id));

-- Existing contract policies allowed all staff and the project owner. Contract
-- V1 narrows access to actual parties and active DAO administrators only.
drop policy read_allowed on public.contracts;
create policy read_allowed on public.contracts for select to authenticated
  using(dao_private.contract(id));
drop policy read_allowed on public.contract_versions;
create policy read_allowed on public.contract_versions for select to authenticated
  using(dao_private.contract(contract_id));
drop policy read_allowed on public.contract_parties;
create policy read_allowed on public.contract_parties for select to authenticated
  using(dao_private.contract(contract_id));

create index contract_items_contract_idx on public.contract_items(contract_id);
create index contract_events_contract_created_idx on public.contract_events(contract_id,created_at,id);
create index contract_archives_contract_idx on public.contract_archives(contract_id,contract_version_id);

commit;
