-- Migration 0014: Security Hardening & Frontdesk Visibility
-- 1. Remove debug policies
-- 2. Restrict DELETE to admin only
-- 3. Allow Frontdesk to view shared operational records (bookings, guests, etc.)
-- 4. Ensure audit_logs are immutable

-- 1. Remove debug policy
DROP POLICY IF EXISTS p_insert_debug_authenticated ON public.operational_records;

-- 2. Restrict DELETE
DROP POLICY IF EXISTS p_delete_manager_admin ON public.operational_records;

CREATE POLICY p_delete_admin_only ON public.operational_records
  FOR DELETE
  USING (app_current_role() = 'admin');

-- 3. Frontdesk Shared Visibility
-- Allow front_desk to see all front_desk related records, regardless of who submitted them.
-- This is crucial for shift handovers and checking status of guests checked in by others.
CREATE POLICY p_select_frontdesk_shared ON public.operational_records
  FOR SELECT
  USING (
    app_current_role() = 'front_desk'
    AND (
      entity_type = 'front_desk'
      OR data->>'type' IN ('room_booking', 'guest_record', 'checkout_record', 'stay_cancellation', 'penalty_fee', 'payment_record')
    )
  );

-- 4. Audit Logs Immutability
-- Ensure no one can update or delete audit logs (RLS default deny if no policy exists)
-- We explicitly drop any such policies if they were accidentally created
DROP POLICY IF EXISTS p_update_audit_logs ON public.audit_logs;
DROP POLICY IF EXISTS p_delete_audit_logs ON public.audit_logs;
