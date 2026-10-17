-- Avis clients vérifiés (issue #213, lot R1 — décisions du propriétaire du 17/10).
-- * Un avis = un Client réellement lié au professionnel sur un chantier D.A.O. démarré
--   (project_stage started / in_progress / completed), un seul avis par chantier × professionnel.
-- * Publication immédiate ; signalement par le professionnel ; masquage staff avec motif.
-- * Les tables sont fermées (RLS sans politique, aucun droit anon/authenticated) :
--   toute lecture et écriture passe par les RPC ci-dessous, qui revérifient l'accès.
-- * Lectures publiques : projection minimale (ni author_id, ni project_id, ni titre de chantier).
begin;

create table public.contractor_reviews (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  project_id uuid not null references public.projects,
  contractor_id uuid not null references public.contractor_profiles,
  author_id uuid not null references auth.users,
  rating smallint not null check (rating between 1 and 5),
  rating_quality smallint check (rating_quality between 1 and 5),
  rating_deadlines smallint check (rating_deadlines between 1 and 5),
  rating_budget smallint check (rating_budget between 1 and 5),
  rating_communication smallint check (rating_communication between 1 and 5),
  rating_cleanliness smallint check (rating_cleanliness between 1 and 5),
  comment text not null check (char_length(comment) between 30 and 2000),
  status text not null default 'published' check (status in ('published','hidden','withdrawn')),
  hidden_reason text,
  hidden_at timestamptz,
  hidden_by uuid references auth.users,
  withdrawn_at timestamptz,
  unique (project_id, contractor_id),
  -- hidden_* survive a withdrawal so that a hidden review cannot be republished by withdraw + resubmit.
  check (status<>'hidden' or (hidden_at is not null and char_length(btrim(coalesce(hidden_reason,''))) between 5 and 500)),
  check (status<>'published' or hidden_at is null),
  check ((status='withdrawn') = (withdrawn_at is not null))
);
create index contractor_reviews_published on public.contractor_reviews(contractor_id, created_at desc) where status='published';
create index contractor_reviews_author on public.contractor_reviews(author_id);

create table public.contractor_review_responses (
  review_id uuid primary key references public.contractor_reviews,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  author_id uuid not null references auth.users,
  body text not null check (char_length(body) between 2 and 1500),
  status text not null default 'published' check (status in ('published','hidden')),
  hidden_reason text,
  hidden_at timestamptz,
  hidden_by uuid references auth.users,
  check ((status='hidden') = (hidden_at is not null)),
  check (status<>'hidden' or char_length(btrim(coalesce(hidden_reason,''))) between 5 and 500)
);

create table public.contractor_review_reports (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  review_id uuid not null references public.contractor_reviews,
  reporter_id uuid not null references auth.users,
  reason text not null check (reason in ('insult','personal_data','off_topic','fake','other')),
  details text not null default '' check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open','dismissed','actioned')),
  resolved_at timestamptz,
  resolved_by uuid references auth.users,
  unique (review_id, reporter_id),
  check ((status='open') = (resolved_at is null))
);
create index contractor_review_reports_open on public.contractor_review_reports(review_id) where status='open';

alter table public.contractor_reviews enable row level security;
alter table public.contractor_review_responses enable row level security;
alter table public.contractor_review_reports enable row level security;
revoke all on public.contractor_reviews from anon,authenticated;
revoke all on public.contractor_review_responses from anon,authenticated;
revoke all on public.contractor_review_reports from anon,authenticated;

-- Eligibility: the author is the confirmed Client (accepted client member) of a started chantier,
-- and the professional really works on it (accepted contractor member or live award).
-- Excluded: self-review, inactive accounts, and chantiers initiated by that same professional
-- (contractor_existing_client), where the professional chose who the "Client" is.
create function dao_private.review_pair(p_project_id uuid,p_contractor_id uuid,p_author uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select p_author is not null and exists(
    select 1
    from public.projects p
    join public.contractor_profiles cp on cp.id=p_contractor_id
    where p.id=p_project_id
      and p.client_id=p_author and p.confirmed_at is not null
      and p.project_stage in ('started','in_progress','completed')
      and cp.user_id<>p_author
      and not (p.project_origin='contractor_existing_client' and p.initiator_id=cp.user_id)
      and dao_private.account_active(p_author) and dao_private.account_active(cp.user_id)
      and exists(select 1 from public.user_roles r where r.user_id=p_author and r.role='client')
      and exists(select 1 from public.project_members m where m.project_id=p.id and m.user_id=p_author
        and m.participation_role='client' and m.status='accepted')
      and (exists(select 1 from public.project_members m where m.project_id=p.id and m.user_id=cp.user_id
            and m.participation_role='contractor' and m.status='accepted')
        or exists(select 1 from public.awards a where a.project_id=p.id and a.contractor_id=cp.id
            and a.status in ('confirmed','contracting','contracted')))
  );
$$;

-- Same publication gate as professional_public_profile, plus the professional himself and staff.
create function dao_private.can_read_contractor_reviews(p_contractor_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select dao_private.account_active(auth.uid()) and exists(
    select 1 from public.contractor_profiles cp
    where cp.id=p_contractor_id and (
      dao_private.staff() or cp.user_id=auth.uid() or (
        exists(select 1 from public.user_roles r where r.user_id=auth.uid() and r.role='client')
        and cp.verification_status='verified' and cp.public_identity_status='approved'
        and dao_private.account_active(cp.user_id)
        and exists(select 1 from public.contractor_profile_details d where d.contractor_id=cp.id and d.review_status='approved'))));
$$;

-- Public text must not carry contact details (contact goes through D.A.O.).
create function dao_private.review_text(p_text text,p_min integer,p_max integer,p_label text)
returns text language plpgsql immutable set search_path='' as $$
declare v text:=btrim(coalesce(p_text,''));
begin
  if char_length(v)<p_min or char_length(v)>p_max then
    raise exception using errcode='22023',message=format('%s : entre %s et %s caractères',p_label,p_min,p_max);
  end if;
  if v ~* '[^[:space:]@]+@[^[:space:]@]+\.[a-z]{2,}' or v ~ '\+[0-9][0-9 .()-]{7,}' or v ~ '(^|[^0-9])[0-9]{8,}([^0-9]|$)'
     or v ~* '(https?://|www\.)' then
    raise exception using errcode='22023',message=format('%s : retirez les coordonnées, liens ou numéros de téléphone',p_label);
  end if;
  return v;
end;
$$;

create function dao_private.review_score(p_input jsonb,p_key text,p_required boolean)
returns smallint language plpgsql immutable set search_path='' as $$
declare raw jsonb:=p_input->p_key;
begin
  if raw is null or raw='null'::jsonb then
    if p_required then raise exception using errcode='22023',message='Note globale requise (1 à 5)'; end if;
    return null;
  end if;
  if jsonb_typeof(raw)<>'number' or (raw#>>'{}')::numeric not in (1,2,3,4,5) then
    raise exception using errcode='22023',message='Les notes vont de 1 à 5';
  end if;
  return (raw#>>'{}')::smallint;
end;
$$;

-- "Prénom N." from the profile display name; never the full name.
create function dao_private.review_author_label(p_user_id uuid)
returns text language sql stable security definer set search_path='' as $$
  select coalesce((
    select case when array_length(parts,1)>=2
      then parts[1]||' '||upper(left(parts[array_length(parts,1)],1))||'.'
      else parts[1] end
    from (select regexp_split_to_array(btrim(display_name),'\s+') as parts
          from public.profiles where user_id=p_user_id and btrim(display_name)<>'') s), 'Client D.A.O.');
$$;

create function dao_private.contractor_rating(p_contractor_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when dao_private.can_read_contractor_reviews(p_contractor_id) then jsonb_build_object(
    'average', round(avg(r.rating)::numeric,1),
    'count', count(*),
    'distribution', jsonb_build_object(
      '5',count(*) filter (where r.rating=5),'4',count(*) filter (where r.rating=4),'3',count(*) filter (where r.rating=3),
      '2',count(*) filter (where r.rating=2),'1',count(*) filter (where r.rating=1)),
    'criteria', jsonb_build_object(
      'quality',round(avg(r.rating_quality)::numeric,1),'deadlines',round(avg(r.rating_deadlines)::numeric,1),
      'budget',round(avg(r.rating_budget)::numeric,1),'communication',round(avg(r.rating_communication)::numeric,1),
      'cleanliness',round(avg(r.rating_cleanliness)::numeric,1))) end
  from public.contractor_reviews r where r.contractor_id=p_contractor_id and r.status='published';
$$;

-- Minimal public projection of one review (no author_id, no project_id, no chantier title).
create function dao_private.review_public_json(r public.contractor_reviews)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'id',r.id,'rating',r.rating,
    'criteria',jsonb_build_object('quality',r.rating_quality,'deadlines',r.rating_deadlines,'budget',r.rating_budget,
      'communication',r.rating_communication,'cleanliness',r.rating_cleanliness),
    'comment',r.comment,'author',dao_private.review_author_label(r.author_id),
    'governorate',(select g.name_fr from public.project_versions v join public.governorates g on g.id=v.governorate_id
      where v.project_id=r.project_id order by v.version_no desc limit 1),
    'month',to_char(r.created_at at time zone 'Africa/Tunis','YYYY-MM'),
    'edited',r.edited_at is not null,
    'response',(select jsonb_build_object('body',x.body,'created_at',x.created_at)
      from public.contractor_review_responses x where x.review_id=r.id and x.status='published'));
$$;

create function dao_private.review_audit(p_action text,p_review_id uuid,p_metadata jsonb default '{}'::jsonb)
returns void language sql security definer set search_path='' as $$
  insert into public.audit_events(actor_id,action,entity_type,entity_id,metadata)
  values(auth.uid(),p_action,'contractor_review',p_review_id,coalesce(p_metadata,'{}'::jsonb));
$$;

-- Client: chantiers × professionnels I can review, with my existing review if any.
create function dao_private.my_review_opportunities()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(row_data order by row_data->>'project_title',row_data->>'contractor_name'),'[]'::jsonb) from (
    select distinct on (p.id,cp.id) jsonb_build_object(
      'project_id',p.id,
      'project_title',(select v.title from public.project_versions v where v.project_id=p.id order by v.version_no desc limit 1),
      'project_stage',p.project_stage,
      'contractor_id',cp.id,
      'contractor_name',coalesce(nullif(cp.public_trade_name,''),cp.business_name),
      'review',(select jsonb_build_object('id',r.id,'status',r.status,'rating',r.rating,
          'criteria',jsonb_build_object('quality',r.rating_quality,'deadlines',r.rating_deadlines,'budget',r.rating_budget,
            'communication',r.rating_communication,'cleanliness',r.rating_cleanliness),
          'comment',r.comment,'created_at',r.created_at,'edited_at',r.edited_at,
          'hidden_reason',case when r.status='hidden' then r.hidden_reason end)
        from public.contractor_reviews r where r.project_id=p.id and r.contractor_id=cp.id and r.author_id=auth.uid())
    ) as row_data
    from public.projects p
    join public.contractor_profiles cp on
      exists(select 1 from public.project_members m where m.project_id=p.id and m.user_id=cp.user_id
        and m.participation_role='contractor' and m.status='accepted')
      or exists(select 1 from public.awards a where a.project_id=p.id and a.contractor_id=cp.id
        and a.status in ('confirmed','contracting','contracted'))
    where p.client_id=auth.uid() and dao_private.review_pair(p.id,cp.id,auth.uid())
  ) s;
$$;

create function dao_private.submit_contractor_review(p_project_id uuid,p_contractor_id uuid,p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); existing public.contractor_reviews; saved public.contractor_reviews;
  v_rating smallint; v_quality smallint; v_deadlines smallint; v_budget smallint; v_communication smallint; v_cleanliness smallint; v_comment text;
begin
  if p_input is null or jsonb_typeof(p_input)<>'object' then raise exception using errcode='22023',message='Avis invalide'; end if;
  if not dao_private.review_pair(p_project_id,p_contractor_id,actor) then
    raise exception using errcode='42501',message='Avis réservé au Client d’un chantier démarré avec ce professionnel';
  end if;
  v_rating:=dao_private.review_score(p_input,'rating',true);
  v_quality:=dao_private.review_score(p_input,'quality',false);
  v_deadlines:=dao_private.review_score(p_input,'deadlines',false);
  v_budget:=dao_private.review_score(p_input,'budget',false);
  v_communication:=dao_private.review_score(p_input,'communication',false);
  v_cleanliness:=dao_private.review_score(p_input,'cleanliness',false);
  v_comment:=dao_private.review_text(p_input->>'comment',30,2000,'Commentaire');
  select * into existing from public.contractor_reviews
    where project_id=p_project_id and contractor_id=p_contractor_id for update;
  if existing.id is null then
    insert into public.contractor_reviews(project_id,contractor_id,author_id,rating,rating_quality,rating_deadlines,rating_budget,
      rating_communication,rating_cleanliness,comment)
    values(p_project_id,p_contractor_id,actor,v_rating,v_quality,v_deadlines,v_budget,v_communication,v_cleanliness,v_comment)
    returning * into saved;
    perform dao_private.review_audit('review_published',saved.id,jsonb_build_object('rating',v_rating));
  else
    if existing.author_id<>actor then raise exception using errcode='42501',message='Avis non modifiable'; end if;
    update public.contractor_reviews set rating=v_rating,rating_quality=v_quality,rating_deadlines=v_deadlines,
      rating_budget=v_budget,rating_communication=v_communication,rating_cleanliness=v_cleanliness,comment=v_comment,
      updated_at=now(),edited_at=now(),
      -- A withdrawn review comes back as it was: published, or hidden if staff had hidden it.
      status=case when existing.status='withdrawn' then case when existing.hidden_at is null then 'published' else 'hidden' end
                  else existing.status end,
      withdrawn_at=case when existing.status='withdrawn' then null else existing.withdrawn_at end
    where id=existing.id returning * into saved;
    perform dao_private.review_audit('review_updated',saved.id,jsonb_build_object('rating',v_rating,'status',saved.status));
  end if;
  return jsonb_build_object('id',saved.id,'status',saved.status,'edited',saved.edited_at is not null);
end;
$$;

create function dao_private.withdraw_contractor_review(p_review_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.contractor_reviews;
begin
  if not dao_private.account_active(auth.uid()) then raise exception using errcode='42501',message='Compte actif requis'; end if;
  select * into r from public.contractor_reviews where id=p_review_id for update;
  if r.id is null or r.author_id<>auth.uid() then raise exception using errcode='42501',message='Avis introuvable'; end if;
  if r.status<>'withdrawn' then
    update public.contractor_reviews set status='withdrawn',withdrawn_at=now(),updated_at=now() where id=r.id;
    perform dao_private.review_audit('review_withdrawn',r.id);
  end if;
  return jsonb_build_object('id',r.id,'status','withdrawn');
end;
$$;

create function dao_private.respond_to_contractor_review(p_review_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.contractor_reviews; owner_id uuid; existing public.contractor_review_responses; v_body text;
begin
  select * into r from public.contractor_reviews where id=p_review_id;
  select user_id into owner_id from public.contractor_profiles where id=r.contractor_id;
  if r.id is null or owner_id is distinct from auth.uid() or not dao_private.account_active(auth.uid()) or r.status<>'published' then
    raise exception using errcode='42501',message='Réponse réservée au professionnel concerné, sur un avis publié';
  end if;
  v_body:=dao_private.review_text(p_body,2,1500,'Réponse');
  select * into existing from public.contractor_review_responses where review_id=r.id for update;
  if existing.review_id is null then
    insert into public.contractor_review_responses(review_id,author_id,body) values(r.id,auth.uid(),v_body);
    perform dao_private.review_audit('review_response_published',r.id);
  else
    if existing.status='hidden' then raise exception using errcode='42501',message='Réponse masquée par D.A.O.'; end if;
    if existing.created_at < now()-interval '30 days' then
      raise exception using errcode='23514',message='La réponse n’est plus modifiable après 30 jours';
    end if;
    update public.contractor_review_responses set body=v_body,updated_at=now() where review_id=r.id;
    perform dao_private.review_audit('review_response_updated',r.id);
  end if;
  return jsonb_build_object('review_id',r.id,'status','published');
end;
$$;

create function dao_private.report_contractor_review(p_review_id uuid,p_reason text,p_details text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.contractor_reviews; owner_id uuid; report_id uuid;
begin
  select * into r from public.contractor_reviews where id=p_review_id;
  select user_id into owner_id from public.contractor_profiles where id=r.contractor_id;
  if r.id is null or owner_id is distinct from auth.uid() or not dao_private.account_active(auth.uid()) or r.status<>'published' then
    raise exception using errcode='42501',message='Signalement réservé au professionnel concerné';
  end if;
  if p_reason is null or p_reason not in ('insult','personal_data','off_topic','fake','other') then
    raise exception using errcode='22023',message='Motif de signalement invalide';
  end if;
  if char_length(coalesce(p_details,''))>1000 then raise exception using errcode='22023',message='Précisions : 1000 caractères maximum'; end if;
  insert into public.contractor_review_reports(review_id,reporter_id,reason,details)
  values(r.id,auth.uid(),p_reason,btrim(coalesce(p_details,'')))
  on conflict(review_id,reporter_id) do update set reason=excluded.reason,details=excluded.details,
    status='open',resolved_at=null,resolved_by=null,created_at=now()
  returning id into report_id;
  perform dao_private.review_audit('review_reported',r.id,jsonb_build_object('reason',p_reason));
  return jsonb_build_object('id',report_id,'status','open');
end;
$$;

-- Staff moderation. A review is never hidden for being negative: a reason is mandatory and audited.
create function dao_private.moderate_contractor_review(p_review_id uuid,p_action text,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.contractor_reviews; v_reason text:=btrim(coalesce(p_reason,''));
begin
  if not dao_private.staff() then raise exception using errcode='42501',message='Modération réservée à D.A.O.'; end if;
  select * into r from public.contractor_reviews where id=p_review_id for update;
  if r.id is null then raise exception using errcode='42501',message='Avis introuvable'; end if;
  if p_action in ('hide','hide_response') and char_length(v_reason) not between 5 and 500 then
    raise exception using errcode='22023',message='Motif de modération requis (5 à 500 caractères)';
  end if;
  if p_action='hide' then
    if r.status<>'published' then raise exception using errcode='23514',message='Seul un avis publié peut être masqué'; end if;
    update public.contractor_reviews set status='hidden',hidden_reason=v_reason,hidden_at=now(),hidden_by=auth.uid(),updated_at=now() where id=r.id;
    update public.contractor_review_reports set status='actioned',resolved_at=now(),resolved_by=auth.uid() where review_id=r.id and status='open';
  elsif p_action='restore' then
    if r.status<>'hidden' then raise exception using errcode='23514',message='Seul un avis masqué peut être rétabli'; end if;
    update public.contractor_reviews set status='published',hidden_reason=null,hidden_at=null,hidden_by=null,updated_at=now() where id=r.id;
  elsif p_action='dismiss_reports' then
    update public.contractor_review_reports set status='dismissed',resolved_at=now(),resolved_by=auth.uid() where review_id=r.id and status='open';
  elsif p_action='hide_response' then
    update public.contractor_review_responses set status='hidden',hidden_reason=v_reason,hidden_at=now(),hidden_by=auth.uid(),updated_at=now()
      where review_id=r.id and status='published';
    if not found then raise exception using errcode='23514',message='Aucune réponse publiée à masquer'; end if;
  elsif p_action='restore_response' then
    update public.contractor_review_responses set status='published',hidden_reason=null,hidden_at=null,hidden_by=null,updated_at=now()
      where review_id=r.id and status='hidden';
    if not found then raise exception using errcode='23514',message='Aucune réponse masquée à rétablir'; end if;
  else
    raise exception using errcode='22023',message='Action de modération inconnue';
  end if;
  perform dao_private.review_audit('review_moderated',r.id,jsonb_build_object('action',p_action,'reason',nullif(v_reason,'')));
  return jsonb_build_object('id',r.id,'action',p_action);
end;
$$;

-- Public read (Clients on a published profile, the professional himself, staff): published reviews only.
create function dao_private.professional_reviews(p_contractor_id uuid,p_limit integer default 10,p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not dao_private.can_read_contractor_reviews(p_contractor_id) then
    raise exception using errcode='42501',message='Avis non accessibles';
  end if;
  return jsonb_build_object(
    'summary',dao_private.contractor_rating(p_contractor_id),
    'items',(select coalesce(jsonb_agg(dao_private.review_public_json(r) order by r.created_at desc, r.id),'[]'::jsonb)
      from (select * from public.contractor_reviews where contractor_id=p_contractor_id and status='published'
            order by created_at desc, id limit least(greatest(coalesce(p_limit,10),1),50) offset greatest(coalesce(p_offset,0),0)) r));
end;
$$;

-- Professional: reviews received (published and hidden), with my response and report state.
create function dao_private.my_received_reviews()
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(dao_private.review_public_json(r)
      || jsonb_build_object('status',r.status,
        'response_status',(select x.status from public.contractor_review_responses x where x.review_id=r.id),
        'response_editable_until',(select x.created_at+interval '30 days' from public.contractor_review_responses x where x.review_id=r.id),
        'report_status',(select k.status from public.contractor_review_reports k where k.review_id=r.id and k.reporter_id=auth.uid()))
      order by r.created_at desc),'[]'::jsonb)
  from public.contractor_reviews r join public.contractor_profiles cp on cp.id=r.contractor_id
  where cp.user_id=auth.uid() and dao_private.account_active(auth.uid()) and r.status in ('published','hidden');
$$;

-- Staff queue: reported first, then the most recent reviews.
create function dao_private.review_moderation_queue()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not dao_private.staff() then raise exception using errcode='42501',message='Modération réservée à D.A.O.'; end if;
  return (select coalesce(jsonb_agg(q.item order by q.open_reports desc, q.created_at desc),'[]'::jsonb) from (
    select r.created_at,(select count(*) from public.contractor_review_reports k where k.review_id=r.id and k.status='open') as open_reports,
      dao_private.review_public_json(r) || jsonb_build_object(
        'status',r.status,'hidden_reason',r.hidden_reason,'project_id',r.project_id,'contractor_id',r.contractor_id,
        'contractor_name',(select coalesce(nullif(cp.public_trade_name,''),cp.business_name) from public.contractor_profiles cp where cp.id=r.contractor_id),
        'author_name',(select pr.display_name from public.profiles pr where pr.user_id=r.author_id),
        'response_status',(select x.status from public.contractor_review_responses x where x.review_id=r.id),
        'reports',(select coalesce(jsonb_agg(jsonb_build_object('reason',k.reason,'details',k.details,'status',k.status,'created_at',k.created_at)
          order by k.created_at desc),'[]'::jsonb) from public.contractor_review_reports k where k.review_id=r.id)) as item
    from public.contractor_reviews r
    order by (select count(*) from public.contractor_review_reports k where k.review_id=r.id and k.status='open') desc, r.created_at desc
    limit 200) q);
end;
$$;

-- Directory: same access, publication gates and card fields as 20261017140000, plus rating aggregates.
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
        and p.status='published' and p.publication_consent),
      'rating_average',(select round(avg(r.rating)::numeric,1) from public.contractor_reviews r where r.contractor_id=c.id and r.status='published'),
      'rating_count',(select count(*) from public.contractor_reviews r where r.contractor_id=c.id and r.status='published')
    ) order by c.created_at desc),'[]')
    from public.contractor_profiles c left join public.contractor_profile_details d on d.contractor_id=c.id
    where p_review or (c.verification_status='verified' and c.public_identity_status='approved' and d.review_status='approved' and dao_private.account_active(c.user_id)));
end; $$;

-- Public profile: unchanged private function (it performs the access check and raises first),
-- the public wrapper appends the rating summary of published reviews.
create or replace function public.professional_public_profile(p_id uuid,p_preview boolean default false) returns jsonb
language sql stable security invoker set search_path='' as $$
  select dao_private.professional_public_profile($1,$2) || jsonb_build_object('rating',dao_private.contractor_rating($1));
$$;

create function public.my_review_opportunities() returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.my_review_opportunities(); $$;
create function public.submit_contractor_review(p_project_id uuid,p_contractor_id uuid,p_input jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.submit_contractor_review($1,$2,$3); $$;
create function public.withdraw_contractor_review(p_review_id uuid) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.withdraw_contractor_review($1); $$;
create function public.respond_to_contractor_review(p_review_id uuid,p_body text) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.respond_to_contractor_review($1,$2); $$;
create function public.report_contractor_review(p_review_id uuid,p_reason text,p_details text default '') returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.report_contractor_review($1,$2,$3); $$;
create function public.moderate_contractor_review(p_review_id uuid,p_action text,p_reason text default null) returns jsonb
language sql security invoker set search_path='' as $$ select dao_private.moderate_contractor_review($1,$2,$3); $$;
create function public.professional_reviews(p_contractor_id uuid,p_limit integer default 10,p_offset integer default 0) returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.professional_reviews($1,$2,$3); $$;
create function public.my_received_reviews() returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.my_received_reviews(); $$;
create function public.review_moderation_queue() returns jsonb
language sql stable security invoker set search_path='' as $$ select dao_private.review_moderation_queue(); $$;

revoke all on function
  dao_private.review_pair(uuid,uuid,uuid),dao_private.can_read_contractor_reviews(uuid),
  dao_private.review_text(text,integer,integer,text),dao_private.review_score(jsonb,text,boolean),
  dao_private.review_author_label(uuid),dao_private.contractor_rating(uuid),
  dao_private.review_public_json(public.contractor_reviews),dao_private.review_audit(text,uuid,jsonb),
  dao_private.my_review_opportunities(),dao_private.submit_contractor_review(uuid,uuid,jsonb),
  dao_private.withdraw_contractor_review(uuid),dao_private.respond_to_contractor_review(uuid,text),
  dao_private.report_contractor_review(uuid,text,text),dao_private.moderate_contractor_review(uuid,text,text),
  dao_private.professional_reviews(uuid,integer,integer),dao_private.my_received_reviews(),
  dao_private.review_moderation_queue(),
  public.my_review_opportunities(),public.submit_contractor_review(uuid,uuid,jsonb),
  public.withdraw_contractor_review(uuid),public.respond_to_contractor_review(uuid,text),
  public.report_contractor_review(uuid,text,text),public.moderate_contractor_review(uuid,text,text),
  public.professional_reviews(uuid,integer,integer),public.my_received_reviews(),public.review_moderation_queue()
  from public,anon,authenticated;
-- Internal helpers stay callable only through the commands above (definer chain) and by service_role.
grant execute on function
  dao_private.review_pair(uuid,uuid,uuid),dao_private.can_read_contractor_reviews(uuid),
  dao_private.review_text(text,integer,integer,text),dao_private.review_score(jsonb,text,boolean),
  dao_private.review_author_label(uuid),dao_private.review_public_json(public.contractor_reviews),
  dao_private.review_audit(text,uuid,jsonb)
  to service_role;
grant execute on function
  dao_private.contractor_rating(uuid),
  dao_private.my_review_opportunities(),dao_private.submit_contractor_review(uuid,uuid,jsonb),
  dao_private.withdraw_contractor_review(uuid),dao_private.respond_to_contractor_review(uuid,text),
  dao_private.report_contractor_review(uuid,text,text),dao_private.moderate_contractor_review(uuid,text,text),
  dao_private.professional_reviews(uuid,integer,integer),dao_private.my_received_reviews(),
  dao_private.review_moderation_queue(),
  public.my_review_opportunities(),public.submit_contractor_review(uuid,uuid,jsonb),
  public.withdraw_contractor_review(uuid),public.respond_to_contractor_review(uuid,text),
  public.report_contractor_review(uuid,text,text),public.moderate_contractor_review(uuid,text,text),
  public.professional_reviews(uuid,integer,integer),public.my_received_reviews(),public.review_moderation_queue()
  to authenticated,service_role;
commit;
