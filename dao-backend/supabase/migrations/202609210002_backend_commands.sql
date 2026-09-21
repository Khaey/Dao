-- Transactional server commands. The existing FK, trigger and partial unique index
-- remain authoritative; these functions only make retries atomic and idempotent.
begin;
create or replace function dao_private.award_request_atomic(
  p_idempotency_key text,
  p_award_id uuid,
  p_project_id uuid,
  p_contractor_id uuid,
  p_request_id uuid,
  p_bid_item_id uuid,
  p_agreed_millimes bigint
) returns jsonb
language plpgsql security definer set search_path=''
as $$
declare v_actor uuid := auth.uid(); v_receipt jsonb; v_item uuid;
begin
  if v_actor is null then raise exception using errcode='42501', message='authentication required'; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) < 8 then raise exception using errcode='22023', message='idempotency key required'; end if;
  select cr.result into v_receipt from public.command_receipts cr where cr.actor_id=v_actor and cr.idempotency_key=p_idempotency_key and cr.command='award_request';
  if v_receipt is not null then return v_receipt; end if;
  insert into public.award_items(award_id,project_id,contractor_id,request_id,bid_item_id,agreed_millimes)
    values(p_award_id,p_project_id,p_contractor_id,p_request_id,p_bid_item_id,p_agreed_millimes)
    returning id into v_item;
  v_receipt := jsonb_build_object('award_item_id',v_item,'request_id',p_request_id);
  insert into public.command_receipts(actor_id,idempotency_key,command,result) values(v_actor,p_idempotency_key,'award_request',v_receipt);
  return v_receipt;
exception when unique_violation then
  if exists(select 1 from public.command_receipts cr where cr.actor_id=v_actor and cr.idempotency_key=p_idempotency_key and cr.command='award_request') then
    select cr.result into v_receipt from public.command_receipts cr where cr.actor_id=v_actor and cr.idempotency_key=p_idempotency_key and cr.command='award_request'; return v_receipt;
  end if;
  raise;
end; $$;
revoke all on function dao_private.award_request_atomic(text,uuid,uuid,uuid,uuid,uuid,bigint) from public, anon, authenticated;
grant execute on function dao_private.award_request_atomic(text,uuid,uuid,uuid,uuid,uuid,bigint) to authenticated, service_role;
commit;
