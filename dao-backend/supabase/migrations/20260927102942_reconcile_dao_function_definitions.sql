begin;

-- Preserve the four-argument RPC while routing it through the draft checks
-- and insert behavior implemented by the five-argument overload.
CREATE OR REPLACE FUNCTION dao_private.add_project_request(
  p_project_id uuid,
  p_trade_id uuid,
  p_title text,
  p_scope text
)
RETURNS public.project_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=''
AS $$
BEGIN
  RETURN dao_private.add_project_request(
    p_project_id,
    p_trade_id,
    p_title,
    p_scope,
    NULL::bigint
  );
END;
$$;

commit;
