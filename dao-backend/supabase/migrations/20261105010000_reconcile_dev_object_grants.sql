-- Reconcile object-level privileges missing from DEV relative to a fresh replay.
-- These grants match the existing Supabase local baseline and remain limited to
-- service_role for tables/functions; sequence grants are limited to the four
-- sequences whose replay baseline includes API-role usage.

-- service_role: backend-only access to application RPCs.
GRANT EXECUTE ON FUNCTION public.abandon_project_assistant_draft_v1(p_draft_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.accept_precontract_agreement(p_agreement_id uuid, p_version_id uuid, p_idempotency_key uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.approve_owned_bid_quote_document(p_document_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.bid_link_referents(p_publication_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_bid_quote_document(p_version_id uuid, p_object_path text, p_original_name text, p_size_bytes bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_native_technical_reserve_v1(p_award_item_id uuid, p_inspection_id uuid, p_title text, p_description text, p_category text, p_severity text, p_location text, p_bid_sub_lot_id uuid, p_native_activity_id uuid, p_due_date date, p_document_ids uuid[], p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_project_from_assistant_draft_v1(p_draft_id uuid, p_creation_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_owned_bid_quote_document(p_document_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.document_dossier_command_v1(p_action text, p_project_id uuid, p_family_id uuid, p_document_id uuid, p_revision_id uuid, p_title text, p_category text, p_visibility text, p_request_ids uuid[], p_note text, p_expected_version integer, p_expected_revision_id uuid, p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.document_dossier_v1(p_project_id uuid, p_request_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.document_file_control_v1(p_document_id uuid, p_decision text, p_reason text, p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_execution_accept_activity_change(p_proposal_id uuid, p_decision text, p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_execution_accept_installment_scope(p_proposal_id uuid, p_decision text, p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_execution_activity_write(p_award_item_id uuid, p_activity_id uuid, p_action text, p_parent_activity_id uuid, p_kind text, p_title text, p_scope text, p_position integer, p_planned_start date, p_planned_end date, p_duration_days integer, p_expected_revision integer, p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_execution_dependencies_v1(p_project_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_execution_plan_v1(p_project_id uuid, p_after_request_id uuid, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_execution_prepare_activity_change(p_award_item_id uuid, p_action text, p_activity_id uuid, p_parent_activity_id uuid, p_kind text, p_title text, p_scope text, p_position integer, p_planned_start date, p_planned_end date, p_duration_days integer, p_expected_revision integer, p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_execution_prepare_installment_scope(p_agreement_version_id uuid, p_installment_no integer, p_scope_type text, p_award_item_id uuid, p_sub_lot_id uuid, p_milestone_key uuid, p_period_start date, p_period_end date, p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_request_sub_lots_v1(p_request_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_technical_inspection_events_v1(p_inspection_id uuid, p_before_created_at timestamp with time zone, p_before_id uuid, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_technical_inspections_v1(p_project_id uuid, p_award_item_id uuid, p_before_created_at timestamp with time zone, p_before_id uuid, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_technical_reserve_events_v1(p_reserve_id uuid, p_before_created_at timestamp with time zone, p_before_id uuid, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_technical_reserves_v1(p_project_id uuid, p_award_item_id uuid, p_inspection_id uuid, p_before_created_at timestamp with time zone, p_before_id uuid, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_work_situation_command_v1(p_action text, p_situation_id uuid, p_project_id uuid, p_contractor_id uuid, p_period_start date, p_period_end date, p_lines jsonb, p_validated_lines jsonb, p_note text, p_expected_revision integer, p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_work_situation_events_v1(p_situation_id uuid, p_before_created_at timestamp with time zone, p_before_id uuid, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.native_work_situations_v1(p_project_id uuid, p_situation_id uuid, p_before_created_at timestamp with time zone, p_before_id uuid, p_limit integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.precontract_agreement_snapshot(p_award_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.precontract_installment_snapshot(p_award_id uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.propose_precontract_agreement(p_award_id uuid, p_base_version_id uuid, p_terms jsonb, p_idempotency_key uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_native_activity_event_v1(p_award_item_id uuid, p_native_activity_id uuid, p_event_kind text, p_status text, p_percent integer, p_work_date date, p_title text, p_target_date date, p_note text, p_quote_line_id uuid, p_executed_quantity_milli bigint, p_quantity_unit text, p_document_ids uuid[], p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_native_technical_inspection_event_v1(p_inspection_id uuid, p_action text, p_note text, p_document_ids uuid[], p_expected_revision integer, p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_native_technical_reserve_event_v1(p_reserve_id uuid, p_action text, p_note text, p_document_ids uuid[], p_expected_revision integer, p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_precontract_installment_event(p_agreement_id uuid, p_version_id uuid, p_installment_no integer, p_event_type text, p_reason text, p_idempotency_key uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.reject_precontract_agreement(p_agreement_id uuid, p_version_id uuid, p_reason text, p_idempotency_key uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_bid_quote_lines(p_bid_item_id uuid, p_lines jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_bid_sub_lot_links(p_version_id uuid, p_links jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_bid_sub_lots(p_bid_item_id uuid, p_sub_lots jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.replace_client_request_sub_lots_v1(p_request_id uuid, p_expected_request_version_id uuid, p_items jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_native_technical_inspection_v1(p_award_item_id uuid, p_note text, p_document_ids uuid[], p_idempotency_key text) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_project_assistant_draft_v1(p_draft_id uuid, p_expected_revision integer, p_kind text, p_command text, p_draft jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_bid_quote_metadata(p_version_id uuid, p_valid_until date, p_terms text, p_material_references text) TO service_role;

-- service_role: backend-only DML on application tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
  public.contract_acceptances,
  public.contract_amendment_acceptances,
  public.contract_amendment_events,
  public.contract_amendment_versions,
  public.contract_amendments,
  public.contract_archives,
  public.contract_events,
  public.contract_items,
  public.contractor_review_reports,
  public.contractor_review_responses,
  public.contractor_reviews,
  public.native_execution_activities,
  public.native_execution_activity_commands,
  public.native_execution_activity_proposal_acceptances,
  public.native_execution_activity_proposals,
  public.native_execution_activity_revisions,
  public.native_installment_scope_acceptances,
  public.native_installment_scope_proposals,
  public.notification_preferences,
  public.oce_lot_plans,
  public.oce_sync_activities,
  public.oce_sync_dependencies,
  public.oce_sync_journal,
  public.oce_sync_mappings,
  public.oce_sync_wbs,
  public.project_plan_contexts,
  public.project_plan_link_decisions,
  public.project_plan_manual_link_removals,
  public.project_plan_manual_links,
  public.project_plan_results,
  public.support_command_receipts,
  public.support_events,
  public.support_messages,
  public.support_reads,
  public.support_tickets
TO service_role;

-- Sequence privileges required by the replayed table defaults.
GRANT SELECT, USAGE, UPDATE ON SEQUENCE public.bid_item_results_id_seq TO anon, authenticated, service_role;
GRANT SELECT, USAGE, UPDATE ON SEQUENCE public.precontract_installment_events_event_seq_seq TO anon, authenticated, service_role;
GRANT SELECT, USAGE, UPDATE ON SEQUENCE public.project_plan_link_decisions_seq_seq TO anon, authenticated, service_role;
GRANT SELECT, USAGE, UPDATE ON SEQUENCE public.support_tickets_ticket_no_seq TO anon, authenticated, service_role;
