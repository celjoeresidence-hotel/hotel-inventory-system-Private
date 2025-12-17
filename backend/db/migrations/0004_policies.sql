-- Migration 0004: Row-Level Security policies (Supabase-native)
-- Enforces visibility and action constraints using helper functions

-- Lock down default privileges (optional defensive)
REVOKE ALL ON TABLE public.operational_records FROM PUBLIC;
REVOKE ALL ON TABLE public.canonical_operational_records FROM PUBLIC;

-- Enable and force RLS
ALTER TABLE public.operational_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operational_records FORCE ROW LEVEL SECURITY;

-- SELECT policies
-- Staff: own records only
DROP POLICY IF EXISTS p_select_staff ON public.operational_records;
CREATE POLICY p_select_staff ON public.operational_records
  FOR SELECT
  USING (app_is_staff() AND submitted_by = app_current_user_id());

-- Supervisor: pending + rejected
DROP POLICY IF EXISTS p_select_supervisor ON public.operational_records;
CREATE POLICY p_select_supervisor ON public.operational_records
  FOR SELECT
  USING (app_current_role() = 'supervisor' AND status IN ('pending','rejected','approved'));

-- Manager: approved only
DROP POLICY IF EXISTS p_select_manager ON public.operational_records;
CREATE POLICY p_select_manager ON public.operational_records
  FOR SELECT
  USING (app_current_role() = 'manager' AND status = 'approved');

-- Admin: all records
DROP POLICY IF EXISTS p_select_admin ON public.operational_records;
CREATE POLICY p_select_admin ON public.operational_records
  FOR SELECT
  USING (app_current_role() = 'admin');

-- INSERT policies
-- Staff: insert only pending submissions as themselves
DROP POLICY IF EXISTS p_insert_staff ON public.operational_records;
CREATE POLICY p_insert_staff ON public.operational_records
  FOR INSERT
  WITH CHECK (app_is_staff() AND status = 'pending' AND submitted_by = app_current_user_id());

-- Manager/Admin: insert correction/override versions (must belong to a version chain)
DROP POLICY IF EXISTS p_insert_manager_admin ON public.operational_records;
CREATE POLICY p_insert_manager_admin ON public.operational_records
  FOR INSERT
  WITH CHECK (
    app_current_role() IN ('manager','admin')
    AND (
      (previous_version_id IS NOT NULL AND original_id IS NOT NULL)
      OR version_no > 1
    )
  );

-- Admin/Manager/Supervisor: allow base inserts for inventory structure configs (categories/collections)
DROP POLICY IF EXISTS p_insert_config_roles ON public.operational_records;
CREATE POLICY p_insert_config_roles ON public.operational_records
  FOR INSERT
  WITH CHECK (
    app_current_role() IN ('admin','manager','supervisor')
    AND lower(COALESCE(data->>'type', data->>'record_type')) IN ('config_category','config_collection')
  );

-- DEBUG: Temporary policy to allow all authenticated users to INSERT for debugging
DROP POLICY IF EXISTS p_insert_debug_authenticated ON public.operational_records;
CREATE POLICY p_insert_debug_authenticated ON public.operational_records
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- UPDATE policies
-- Staff: may soft delete their own pending/rejected submissions (deleted_at only)
DROP POLICY IF EXISTS p_update_staff_soft_delete ON public.operational_records;
CREATE POLICY p_update_staff_soft_delete ON public.operational_records
  FOR UPDATE
  USING (
    app_is_staff()
    AND submitted_by = app_current_user_id()
    AND status IN ('pending','rejected')
  )
  WITH CHECK (
    app_is_staff()
    AND submitted_by = app_current_user_id()
    AND status IN ('pending','rejected')
  );

-- Supervisor: may transition status from pending -> approved/rejected and set review metadata
DROP POLICY IF EXISTS p_update_supervisor_approve_reject ON public.operational_records;
CREATE POLICY p_update_supervisor_approve_reject ON public.operational_records
  FOR UPDATE
  USING (app_current_role() = 'supervisor' AND status = 'pending')
  WITH CHECK (
    app_current_role() = 'supervisor'
    AND status IN ('approved','rejected')
    AND reviewed_by = app_current_user_id()
  );

-- Manager/Admin: administrative updates only (no direct data/financial changes; enforced by triggers)
DROP POLICY IF EXISTS p_update_manager_admin ON public.operational_records;
CREATE POLICY p_update_manager_admin ON public.operational_records
  FOR UPDATE
  USING (app_current_role() IN ('manager','admin'))
  WITH CHECK (app_current_role() IN ('manager','admin'));

-- DELETE policies
-- Manager/Admin only (hard delete restricted via RPC + audit)
DROP POLICY IF EXISTS p_delete_manager_admin ON public.operational_records;
CREATE POLICY p_delete_manager_admin ON public.operational_records
  FOR DELETE
  USING (app_current_role() IN ('manager','admin'));