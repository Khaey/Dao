-- Staff assistance alerts: derive unread from requester messages, never from
-- private chantier conversations. This migration is additive and DEV deployment
-- is separately gated; CI applies it only to disposable Supabase.
begin;

create or replace function dao_private.my_support_summary()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); is_admin boolean;
begin
  if actor is null or not dao_private.account_active(actor) then
    raise exception using errcode='42501',message='Compte actif requis';
  end if;
  if dao_private.support_staff() then
    select exists(select 1 from public.user_roles where user_id=actor and role='dao_admin') into is_admin;
    return (
      select jsonb_build_object(
        'open',count(*) filter (where x.status not in ('resolved','closed')),
        'unread',count(*) filter (where x.status not in ('resolved','closed') and x.unread)
      )
      from (
        select t.status,exists(
          select 1 from public.support_messages m
          where m.ticket_id=t.id and m.author_role='requester'
            and m.created_at>coalesce(r.read_at,'-infinity'::timestamptz)
        ) as unread
        from public.support_tickets t
        left join public.support_reads r on r.ticket_id=t.id and r.user_id=actor
        where t.assignee_id is null or t.assignee_id=actor or is_admin
      ) x
    );
  end if;
  -- Preserve requester summary for Client/Artisan (including existing E2E).
  return (
    select jsonb_build_object(
      'open',count(*) filter(where t.status not in ('resolved','closed')),
      'unread',count(*) filter(where t.last_message_at>coalesce(
        (select r.read_at from public.support_reads r where r.ticket_id=t.id and r.user_id=actor),
        t.created_at-interval '1 microsecond'
      ))
    ) from public.support_tickets t where t.requester_id=actor
  );
end;$$;

-- Previous support_queue version supplied a constant unread_count=0.
-- Expose 0/1 only for requester messages not yet read by an eligible staff
-- member. Admin may oversee assigned tickets; other staff only unassigned
-- tickets or those assigned to themselves.
create or replace function dao_private.support_queue(
  p_limit integer default 20,p_before timestamptz default null,p_before_id uuid default null,
  p_status text default null,p_assignee text default 'all'
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,20),1),50);
  is_admin boolean;
begin
  if not dao_private.support_staff()
     or (p_status is not null and p_status not in ('open','waiting_staff','waiting_user','resolved','closed'))
     or p_assignee not in ('me','unassigned','all') then
    raise exception using errcode='42501',message='Accès refusé';
  end if;
  select exists(select 1 from public.user_roles where user_id=auth.uid() and role='dao_admin') into is_admin;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',x.id,'reference','AS-'||lpad(x.ticket_no::text,6,'0'),
      'subject',x.subject,'category',x.category,'status',x.status,'project_id',x.project_id,
      'created_at',x.created_at,'updated_at',x.updated_at,'last_message_at',x.last_message_at,
      'unread_count',case when x.status not in ('resolved','closed')
        and (x.assignee_id is null or x.assignee_id=auth.uid() or is_admin)
        and exists(select 1 from public.support_messages m where m.ticket_id=x.id
          and m.author_role='requester'
          and m.created_at>coalesce(x.read_at,'-infinity'::timestamptz))
        then 1 else 0 end,
      'assignee_label',x.assignee_label,'requester_label',x.requester_label
    ) order by x.last_message_at desc,x.id desc)
    from (
      select t.*,r.read_at,
        case when t.assignee_id is null then null else coalesce(ap.display_name,'Équipe D.A.O.') end as assignee_label,
        coalesce(rp.display_name,'Utilisateur D.A.O.') as requester_label
      from public.support_tickets t
      left join public.support_reads r on r.ticket_id=t.id and r.user_id=auth.uid()
      left join public.profiles ap on ap.user_id=t.assignee_id
      left join public.profiles rp on rp.user_id=t.requester_id
      where (p_status is null or t.status=p_status)
        and (p_assignee='all' or (p_assignee='me' and t.assignee_id=auth.uid())
          or (p_assignee='unassigned' and t.assignee_id is null))
        and (p_before is null or (t.last_message_at,t.id)<(p_before,p_before_id))
      order by t.last_message_at desc,t.id desc limit safe_limit
    ) x
  ),'[]'::jsonb);
end;$$;

-- Existing public wrappers, execution grants and RLS boundaries are unchanged.
notify pgrst,'reload schema';
commit;
