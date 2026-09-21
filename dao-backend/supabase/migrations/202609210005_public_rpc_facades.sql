begin;
create or replace function public.submit_bid_version(p_version_id uuid, p_contractor_id uuid)
returns public.bid_versions
language sql security definer set search_path=''
as $$ select dao_private.submit_bid_version(p_version_id, p_contractor_id); $$;
revoke all on function public.submit_bid_version(uuid,uuid) from public, anon;
grant execute on function public.submit_bid_version(uuid,uuid) to authenticated, service_role;

create or replace function public.award_request_atomic(
  p_idempotency_key text, p_award_id uuid, p_project_id uuid, p_contractor_id uuid,
  p_request_id uuid, p_bid_item_id uuid, p_agreed_millimes bigint
)
returns jsonb language sql security definer set search_path=''
as $$ select dao_private.award_request_atomic(p_idempotency_key,p_award_id,p_project_id,p_contractor_id,p_request_id,p_bid_item_id,p_agreed_millimes); $$;
revoke all on function public.award_request_atomic(text,uuid,uuid,uuid,uuid,uuid,bigint) from public, anon;
grant execute on function public.award_request_atomic(text,uuid,uuid,uuid,uuid,uuid,bigint) to authenticated, service_role;
commit;
