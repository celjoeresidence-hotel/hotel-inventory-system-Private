-- Migration 0011: Security Hardening & Access Control Tightening
-- Objectives:
-- 1. Remove debug/insecure policies.
-- 2. Enforce strict role-based data isolation (Kitchen see Kitchen, Bar see Bar, etc.).
-- 3. Fix RPC permissions (Manager/Admin should be able to approve/reject).
-- 4. Ensure Audit Logs are secure.
-- 5. Secure Rooms table.

-- 1. Remove Debug Policy (CRITICAL FIX)
DROP POLICY IF EXISTS p_insert_debug_authenticated ON public.operational_records;

-- 2. Implement Role-Specific Read Policies
--    Currently, 'staff' policy is too restrictive (only own records).
--    We need to allow viewing department-specific history.

-- Kitchen: See all APPROVED records related to Kitchen
DROP POLICY IF EXISTS p_select_kitchen ON public.operational_records;
CREATE POLICY p_select_kitchen ON public.operational_records
  FOR SELECT
  USING (
    app_current_role() = 'kitchen'
    AND status = 'approved'
    AND (
      entity_type = 'kitchen'
      OR data->>'type' LIKE 'kitchen_%'
    )
  );

-- Bar: See all APPROVED records related to Bar
DROP POLICY IF EXISTS p_select_bar ON public.operational_records;
CREATE POLICY p_select_bar ON public.operational_records
  FOR SELECT
  USING (
    app_current_role() = 'bar'
    AND status = 'approved'
    AND (
      entity_type = 'bar'
      OR data->>'type' LIKE 'bar_%'
    )
  );

-- Front Desk: See all APPROVED records related to Front Desk
DROP POLICY IF EXISTS p_select_front_desk ON public.operational_records;
CREATE POLICY p_select_front_desk ON public.operational_records
  FOR SELECT
  USING (
    app_current_role() = 'front_desk'
    AND status = 'approved'
    AND (
      entity_type = 'front_desk'
      OR data->>'type' IN ('check_in', 'check_out', 'room_booking')
    )
  );

-- Supervisor: Tighten visibility
-- Supervisors should see operational records, but we ensure they don't see purely system/admin records if possible.
-- For now, we keep p_select_supervisor but we could restrict it. 
-- Existing policy: app_current_role() = 'supervisor' AND status IN ('pending','rejected','approved')
-- This is acceptable as Supervisors need broad oversight.

-- 3. Fix RPC Permissions
-- api.approve_record and api.reject_record currently restrict to 'supervisor' only.
-- Managers and Admins should also be able to approve/reject.

CREATE OR REPLACE FUNCTION api.approve_record(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Allow Supervisor, Manager, Admin
  IF app_current_role() NOT IN ('supervisor', 'manager', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: only supervisor/manager/admin can approve records.';
  END IF;

  UPDATE public.operational_records
  SET status = 'approved',
      reviewed_by = app_current_user_id(),
      reviewed_at = now(),
      rejection_reason = NULL
  WHERE id = _id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found or not pending.';
  END IF;
END$$;

CREATE OR REPLACE FUNCTION api.reject_record(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Allow Supervisor, Manager, Admin
  IF app_current_role() NOT IN ('supervisor', 'manager', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: only supervisor/manager/admin can reject records.';
  END IF;
  IF COALESCE(_reason, '') = '' THEN
    RAISE EXCEPTION 'Rejection requires a non-empty reason.';
  END IF;

  UPDATE public.operational_records
  SET status = 'rejected',
      rejection_reason = _reason,
      reviewed_by = app_current_user_id(),
      reviewed_at = now()
  WHERE id = _id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found or not pending.';
  END IF;
END$$;

-- 4. Audit Log Security
-- Ensure RLS is enabled and strictly limited to Admin/Manager
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Ensure no loose policies exist (drop if exists)
DROP POLICY IF EXISTS p_select_audit_logs_public ON public.audit_logs;
DROP POLICY IF EXISTS p_select_audit_logs_staff ON public.audit_logs;

-- Re-assert Admin/Manager policies (idempotent)
DROP POLICY IF EXISTS p_select_audit_logs_admin ON public.audit_logs;
CREATE POLICY p_select_audit_logs_admin ON public.audit_logs
  FOR SELECT USING (app_current_role() = 'admin');

DROP POLICY IF EXISTS p_select_audit_logs_manager ON public.audit_logs;
CREATE POLICY p_select_audit_logs_manager ON public.audit_logs
  FOR SELECT USING (app_current_role() = 'manager');

-- 5. Secure Rooms Table (if not already secured)
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_select_rooms_auth ON public.rooms;
CREATE POLICY p_select_rooms_auth ON public.rooms
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS p_all_rooms_admin_manager ON public.rooms;
CREATE POLICY p_all_rooms_admin_manager ON public.rooms
  FOR ALL
  USING (app_current_role() IN ('admin', 'manager'));

-- 6. Rate Limiting / Abuse Protection (Backend)
-- While we cannot easily rate-limit SQL calls, we can prevent common abuse patterns.
-- Ensure staff cannot soft-delete records that are already approved (Already covered in guard_update).
-- Ensure staff cannot update records that are not theirs (Already covered in guard_update).

-- Double check 'public.soft_delete_record' uses SECURITY DEFINER and checks role.
-- It calls 'api.soft_delete_record'.
-- 'api.soft_delete_record' checks 'app_is_staff()'.
-- This is secure.
