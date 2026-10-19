-- Preserve an actual NULL assignee in the staff queue.  The fallback label is
-- only meaningful when a ticket has an assignee whose profile has no label.
create or replace function dao_private.support_queue(p_limit integer default 20,p_before timestamptz default null,p_before_id uuid default null,
 p_status text default null,p_assignee text default 'all') returns jsonb language plpgsql stable security definer set search_path='' as $$
declare safe_limit integer:=least(greatest(coalesce(p_limit,20),1),50); begin
 if not dao_private.support_staff() or (p_status is not null and p_status not in ('open','waiting_staff','waiting_user','resolved','closed'))
   or p_assignee not in ('me','unassigned','all') then raise exception using errcode='42501',message='Accès refusé'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'reference','AS-'||lpad(x.ticket_no::text,6,'0'),
  'subject',x.subject,'category',x.category,'status',x.status,'project_id',x.project_id,'created_at',x.created_at,
  'updated_at',x.updated_at,'last_message_at',x.last_message_at,'unread_count',0,'assignee_label',x.assignee_label,
  'requester_label',x.requester_label) order by x.last_message_at desc,x.id desc) from (
   select t.*,case when t.assignee_id is null then null else coalesce(ap.display_name,'Équipe D.A.O.') end assignee_label,
    coalesce(rp.display_name,'Utilisateur D.A.O.') requester_label
   from public.support_tickets t left join public.profiles ap on ap.user_id=t.assignee_id left join public.profiles rp on rp.user_id=t.requester_id
   where (p_status is null or t.status=p_status) and (p_assignee='all' or (p_assignee='me' and t.assignee_id=auth.uid())
    or (p_assignee='unassigned' and t.assignee_id is null))
   and (p_before is null or (t.last_message_at,t.id)<(p_before,p_before_id)) order by t.last_message_at desc,t.id desc limit safe_limit
  ) x),'[]'::jsonb); end;$$;
