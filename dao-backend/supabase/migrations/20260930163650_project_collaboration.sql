begin;

-- Participation is separate from the public account role and the DAO lifecycle.
-- Existing projects keep their real client and their historical snapshots.
alter table public.projects
  add column initiator_id uuid references auth.users,
  add column project_origin text not null default 'client_marketplace'
    check (project_origin in ('client_marketplace','client_existing_team','contractor_existing_client')),
  add column project_stage text not null default 'not_started'
    check (project_stage in ('not_started','started','in_progress','completed')),
  add column payment_status text not null default 'not_set'
    check (payment_status in ('not_set','unpaid','partial','paid')),
  add column confirmed_at timestamptz,
  add column confirmed_by uuid references auth.users;

update public.projects set initiator_id=client_id,confirmed_at=created_at,confirmed_by=client_id;
alter table public.projects
  alter column initiator_id set not null,
  alter column client_id drop not null,
  add constraint project_pending_client_origin check (
    client_id is not null or project_origin='contractor_existing_client'),
  add constraint project_initiator_participation check (
    (project_origin='contractor_existing_client' and client_id is distinct from initiator_id)
    or (project_origin<>'contractor_existing_client' and client_id=initiator_id)),
  add constraint project_client_confirmation check (
    (client_id is null and confirmed_at is null and confirmed_by is null)
    or (client_id is not null and confirmed_at is not null and confirmed_by is not null and confirmed_by=client_id));
create index projects_initiator_idx on public.projects(initiator_id);

create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects,
  user_id uuid not null references auth.users,
  participation_role text not null check (participation_role in ('client','contractor')),
  status text not null default 'accepted' check (status in ('accepted','revoked')),
  can_view_private_details boolean not null default false,
  accepted_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique(id,project_id),
  unique(project_id,user_id),
  check ((status='revoked')=(revoked_at is not null))
);
create unique index project_one_client_member_idx on public.project_members(project_id)
  where participation_role='client' and status='accepted';
create index project_members_user_idx on public.project_members(user_id,project_id) where status='accepted';
insert into public.project_members(project_id,user_id,participation_role,can_view_private_details,accepted_at)
select id,client_id,'client',true,created_at from public.projects;

-- A known participant may be attached to a lot without creating an award, bid,
-- contract or new version. Marketplace lots remain the same attributable unit.
alter table public.project_requests add column contractor_member_id uuid;
alter table public.project_requests add constraint request_contractor_member_project_fk
  foreign key(contractor_member_id,project_id) references public.project_members(id,project_id);
create index project_requests_contractor_member_idx on public.project_requests(contractor_member_id);

create table public.project_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects,
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  expected_role text not null check (expected_role in ('client','contractor')),
  recipient_email text check (recipient_email is null or recipient_email=lower(btrim(recipient_email))),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz not null check (expires_at>created_at),
  status text not null default 'pending'
    check (status in ('pending','accepted','declined','revoked','expired')),
  can_view_private_details boolean not null default false,
  accepted_at timestamptz,
  accepted_by uuid references auth.users,
  declined_at timestamptz,
  declined_by uuid references auth.users,
  revoked_at timestamptz,
  revoked_by uuid references auth.users,
  check ((status='accepted')=(accepted_at is not null and accepted_by is not null)),
  check ((status='declined')=(declined_at is not null and declined_by is not null)),
  check ((status='revoked')=(revoked_at is not null and revoked_by is not null))
);
create index project_invitations_project_idx on public.project_invitations(project_id,created_at);
create index project_invitations_creator_idx on public.project_invitations(created_by);
create index project_invitations_accepted_by_idx on public.project_invitations(accepted_by);
create index project_invitations_declined_by_idx on public.project_invitations(declined_by);
create index project_invitations_revoked_by_idx on public.project_invitations(revoked_by);
create unique index project_one_pending_client_invitation_idx on public.project_invitations(project_id)
  where expected_role='client' and status='pending';

alter table public.documents add column share_scope text not null default 'owner_only'
  check (share_scope in ('owner_only','project_members'));

create function dao_private.project_member(p_project_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1 from public.project_members
    where project_id=p_project_id and user_id=auth.uid() and status='accepted');
$$;
create function dao_private.can_view_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and
    (dao_private.staff() or dao_private.owner(p_project_id) or dao_private.project_member(p_project_id));
$$;
create function dao_private.contractor_initiator(p_project_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and exists(
    select 1 from public.projects p join public.project_members m on m.project_id=p.id
    where p.id=p_project_id and p.initiator_id=auth.uid()
      and p.project_origin='contractor_existing_client'
      and m.user_id=auth.uid() and m.participation_role='contractor' and m.status='accepted');
$$;
create function dao_private.can_prepare_project(p_project_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and
    (dao_private.owner(p_project_id) or dao_private.contractor_initiator(p_project_id));
$$;
create function dao_private.can_view_project_private_details(p_project_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and
    (dao_private.staff() or dao_private.owner(p_project_id) or exists(
      select 1 from public.project_members where project_id=p_project_id and user_id=auth.uid()
      and status='accepted' and can_view_private_details));
$$;
revoke all on function dao_private.project_member(uuid),dao_private.can_view_project(uuid),
  dao_private.contractor_initiator(uuid),dao_private.can_prepare_project(uuid),
  dao_private.can_view_project_private_details(uuid) from public,anon,authenticated;
grant execute on function dao_private.project_member(uuid),dao_private.can_view_project(uuid),
  dao_private.contractor_initiator(uuid),dao_private.can_prepare_project(uuid),
  dao_private.can_view_project_private_details(uuid) to authenticated,service_role;

-- Legacy client commands cannot turn a contractor-only account into a client.
-- The trigger also keeps both old create_project_draft RPC arities compatible.
create function dao_private.initialize_project_participation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  new.initiator_id:=coalesce(new.initiator_id,new.client_id);
  if new.client_id is not null then
    if auth.uid()=new.client_id and not exists(
      select 1 from public.user_roles where user_id=auth.uid() and role='client') then
      raise exception using errcode='42501',message='client account required';
    end if;
    new.confirmed_at:=coalesce(new.confirmed_at,new.created_at);
    new.confirmed_by:=new.client_id;
  end if;
  return new;
end;
$$;
create trigger initialize_project_participation before insert on public.projects
  for each row execute function dao_private.initialize_project_participation();
create function dao_private.add_initial_project_member() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.client_id is not null then
    insert into public.project_members(project_id,user_id,participation_role,can_view_private_details,accepted_at)
    values(new.id,new.client_id,'client',true,new.confirmed_at);
  else
    if not exists(select 1 from public.user_roles where user_id=new.initiator_id and role='contractor')
       or not exists(select 1 from public.contractor_profiles where user_id=new.initiator_id) then
      raise exception using errcode='42501',message='contractor account required';
    end if;
    insert into public.project_members(project_id,user_id,participation_role,can_view_private_details)
    values(new.id,new.initiator_id,'contractor',true);
  end if;
  return new;
end;
$$;
create trigger add_initial_project_member after insert on public.projects
  for each row execute function dao_private.add_initial_project_member();
create function dao_private.preserve_project_identity() returns trigger
language plpgsql set search_path='' as $$
begin
  if new.initiator_id is distinct from old.initiator_id
     or new.project_origin is distinct from old.project_origin
     or (old.client_id is not null and
       row(new.client_id,new.confirmed_at,new.confirmed_by)
       is distinct from row(old.client_id,old.confirmed_at,old.confirmed_by)) then
    raise exception using errcode='23514',message='project identity and confirmation are immutable';
  end if;
  return new;
end;
$$;
create trigger preserve_project_identity before update on public.projects
  for each row execute function dao_private.preserve_project_identity();
revoke all on function dao_private.initialize_project_participation(),
  dao_private.add_initial_project_member(),dao_private.preserve_project_identity() from public,anon,authenticated;

alter table public.project_members enable row level security;
alter table public.project_invitations enable row level security;
revoke all on public.project_members,public.project_invitations from anon,authenticated;
grant select on public.project_members to authenticated;
-- token_hash is never returned by a table query to a public API account.
grant select(id,project_id,created_by,created_at,expected_role,recipient_email,expires_at,status,
  can_view_private_details,accepted_at,accepted_by,declined_at,declined_by,revoked_at,revoked_by)
  on public.project_invitations to authenticated;
grant all on public.project_members,public.project_invitations to service_role;
create policy read_allowed on public.project_members for select to authenticated
  using (dao_private.can_view_project(project_id));
create policy read_allowed on public.project_invitations for select to authenticated
  using (dao_private.staff() or dao_private.owner(project_id) or dao_private.contractor_initiator(project_id));

-- Only shared project workspace tables gain membership reads. Owner, bid,
-- publication, award, contract and AI authorization helpers stay unchanged.
alter policy read_allowed on public.projects to authenticated
  using (dao_private.can_view_project(id));
alter policy read_allowed on public.project_versions to authenticated
  using (dao_private.can_view_project(project_id));
alter policy read_allowed on public.project_requests to authenticated
  using (dao_private.can_view_project(project_id));
alter policy read_allowed on public.project_request_versions to authenticated
  using (dao_private.can_view_project(project_id));
alter policy read_allowed on public.project_version_requests to authenticated
  using (dao_private.can_view_project(project_id));
alter policy read_allowed on public.project_private_details to authenticated
  using (dao_private.can_view_project_private_details(project_id));
alter policy read_allowed on public.documents to authenticated using (
  dao_private.staff() or owner_id=auth.uid() or (status='approved' and (
    (share_scope='project_members' and dao_private.project_member(project_id))
    or exists(select 1 from public.document_grants g where g.document_id=documents.id
      and g.user_id=auth.uid() and g.revoked_at is null))));

notify pgrst, 'reload schema';
commit;
