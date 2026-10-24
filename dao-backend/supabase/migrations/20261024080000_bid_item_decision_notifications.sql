-- #175 BUG-12: each award decision concerns one lot. Keep submitted bids and amounts immutable.
begin;
CREATE OR REPLACE FUNCTION dao_private.my_bid_summaries()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_contractor uuid; v_result jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select id into v_contractor from public.contractor_profiles where user_id=auth.uid();
  if v_contractor is null then raise exception using errcode='42501',message='contractor profile required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',bv.id,'publication_id',bv.publication_id,'project_id',bv.project_id,'version_no',bv.version_no,
    'status',bv.status,'validity',bv.validity,'created_at',bv.created_at,'submitted_at',bv.submitted_at,
    'withdrawn_at',bv.withdrawn_at,'expires_at',bv.expires_at,'publication_title',coalesce(pub.safe_title,'DAO'),
    'publication_status',pub.status,'submission_deadline',pub.submission_deadline,
    'lot_count',(select count(*) from public.bid_items bi where bi.bid_version_id=bv.id),
    'total_millimes',(select coalesce(sum(bi.price_millimes),0) from public.bid_items bi where bi.bid_version_id=bv.id),
    'pending_items',(
      select coalesce(jsonb_agg(jsonb_build_object('title',coalesce(rv.title,'Lot'),'price_millimes',bi.price_millimes) order by bi.created_at,bi.id),'[]'::jsonb)
      from public.bid_items bi
      left join public.project_request_versions rv on rv.id=bi.request_version_id
      where bi.bid_version_id=bv.id
      and coalesce((select r.status from public.bid_item_results r where r.bid_item_id=bi.id order by r.id desc limit 1),'available')='available'
      and not exists (
        select 1 from public.bid_group_items own_group
        join public.bid_groups bg on bg.id=own_group.group_id and bg.indivisible
        join public.bid_group_items sibling on sibling.group_id=bg.id
        where own_group.bid_item_id=bi.id
          and (select r.status from public.bid_item_results r where r.bid_item_id=sibling.bid_item_id order by r.id desc limit 1)='not_selected'
      )
    ),
    'selected_count',(select count(*) from public.bid_items bi where bi.bid_version_id=bv.id and (select bir.status from public.bid_item_results bir where bir.bid_item_id=bi.id order by bir.id desc limit 1)='selected'),
    'not_selected_count',(select count(*) from public.bid_items bi where bi.bid_version_id=bv.id and (select bir.status from public.bid_item_results bir where bir.bid_item_id=bi.id order by bir.id desc limit 1)='not_selected')
  ) order by coalesce(bv.submitted_at,bv.created_at) desc),'[]'::jsonb) into v_result
  from public.bid_versions bv left join public.publications pub on pub.id=bv.publication_id
  where bv.contractor_id=v_contractor;
  return v_result;
end;
$function$


CREATE OR REPLACE FUNCTION dao_private.notification_visible(n notifications)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare workspace text; pid uuid; iid uuid; cid uuid; qid uuid;
begin
  if auth.uid() is null or n.user_id is distinct from auth.uid() or not dao_private.account_active(auth.uid()) then return false; end if;
  workspace:=dao_private.notification_workspace(); if workspace='staff' then return false; end if;
  pid:=dao_private.notification_uuid(n.payload->>'project_id');
  if not exists(select 1 from public.projects where id=pid and status<>'archived') then return false; end if;
  if n.kind='project_message' then cid:=dao_private.notification_uuid(n.payload->>'conversation_id'); return exists(select 1 from public.conversations c join public.projects p on p.id=c.project_id where c.id=cid and c.project_id=pid and dao_private.conversation(c.id) and workspace=case when p.client_id=auth.uid() then 'client' else 'contractor' end); end if;
  if n.payload->>'workspace' is distinct from workspace then return false; end if;
  qid:=dao_private.notification_uuid(n.payload->>'question_id');
  if n.kind='rfi_question' then return workspace='client' and exists(select 1 from public.technical_questions q where q.id=qid and q.project_id=pid and dao_private.rfi_request_owner(q.publication_request_id)); end if;
  if n.kind='rfi_clarification' then return workspace='contractor' and exists(select 1 from public.technical_questions q where q.id=qid and q.project_id=pid and q.status='published' and dao_private.rfi_request_eligible(q.publication_request_id)); end if;
  if n.kind in ('review_approved','review_rejected') then return workspace='client' and dao_private.owner(pid) and exists(select 1 from public.project_versions v where v.id=dao_private.notification_uuid(n.payload->>'version_id') and v.project_id=pid and v.status=case when n.kind='review_approved' then 'approved' else 'rejected' end); end if;
  if n.kind='bid_result' then
    return workspace='contractor' and exists(
      select 1 from public.bid_item_results r
      join public.bid_items bi on bi.id=r.bid_item_id
      join public.contractor_profiles cp on cp.id=bi.contractor_id
      where bi.id=dao_private.notification_uuid(n.payload->>'bid_item_id')
        and bi.project_id=pid and cp.user_id=auth.uid()
        and r.id::text=n.payload->>'result_id' and r.status=n.payload->>'result'
    );
  end if;
  iid:=dao_private.notification_uuid(n.payload->>'invitation_id');
  if n.kind='invitation_expiring' then return exists(select 1 from public.project_invitations i where i.id=iid and i.project_id=pid and i.expected_role=workspace and dao_private.invitation_expiry_reminder_allowed(i,auth.uid(),now()));
  elsif n.kind='invitation_received' then return exists(select 1 from public.project_invitations i join auth.users u on u.id=auth.uid()
    join public.project_members sender on sender.project_id=i.project_id and sender.user_id=i.created_by and sender.status='accepted'
    where i.id=iid and i.project_id=pid and i.expected_role=workspace and i.status='pending' and i.expires_at>now()
      and u.email_confirmed_at is not null and lower(u.email)=i.recipient_email and dao_private.account_active(i.created_by)
      and (sender.participation_role<>'contractor' or not exists(select 1 from public.contractor_profiles where user_id=i.created_by and verification_status='suspended')));
  elsif n.kind='invitation_accepted' then return exists(select 1 from public.project_invitations i join public.projects p on p.id=i.project_id join public.project_members recipient on recipient.project_id=p.id and recipient.user_id=auth.uid() and recipient.status='accepted' and recipient.participation_role=workspace join public.project_members joined on joined.project_id=p.id and joined.user_id=i.accepted_by and joined.status='accepted' and joined.participation_role=i.expected_role where i.id=iid and p.id=pid and i.status='accepted' and p.initiator_id=auth.uid() and i.accepted_by<>auth.uid() and dao_private.account_active(i.accepted_by) and exists(select 1 from public.user_roles where user_id=i.accepted_by and role=i.expected_role) and (i.expected_role<>'contractor' or not exists(select 1 from public.contractor_profiles where user_id=i.accepted_by and verification_status='suspended'))); end if;
  return false;
end $function$


create or replace function dao_private.emit_bid_item_decision()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_item public.bid_items; v_version public.bid_versions; v_recipient uuid; v_lot text; v_payload jsonb;
begin
  select * into v_item from public.bid_items where id=new.bid_item_id;
  if not found then return new; end if;
  select * into v_version from public.bid_versions where id=v_item.bid_version_id;
  if v_version.status is distinct from 'submitted' then return new; end if;
  select cp.user_id into v_recipient from public.contractor_profiles cp
    where cp.id=v_item.contractor_id and cp.verification_status<>'suspended';
  if v_recipient is null or not dao_private.account_active(v_recipient) then return new; end if;
  select coalesce(rv.title,'Lot') into v_lot from public.project_request_versions rv where rv.id=v_item.request_version_id;
  v_payload:=jsonb_build_object(
    'project_id',v_item.project_id,'workspace','contractor','bid_item_id',v_item.id,
    'bid_version_id',v_item.bid_version_id,'result_id',new.id,'result',new.status,
    'lot',coalesce(v_lot,'Lot'));
  perform dao_private.emit_internal_notification(v_recipient,'bid_result','bid_result:'||new.id::text,v_payload);
  perform dao_private.queue_project_notice('bid_result:'||new.id::text,v_item.project_id,
    'bid_result',jsonb_build_object('lot',coalesce(v_lot,'Lot'),'decision',new.status),v_recipient);
  return new;
end;
$$;
revoke all on function dao_private.emit_bid_item_decision() from public,anon,authenticated;
drop trigger if exists bid_item_result_notify on public.bid_item_results;
create trigger bid_item_result_notify after insert on public.bid_item_results
for each row execute function dao_private.emit_bid_item_decision();
commit;
