-- Migration 0012: Fix Audit Logs RLS and Secure RPC
-- Objectives:
-- 1. Make log_audit SECURITY DEFINER to bypass RLS on audit_logs.
-- 2. Restrict direct access to audit_logs (only via function).
-- 3. Cleanup any loose or debug policies.

-- 1. Update log_audit to be SECURITY DEFINER
--    This ensures it runs with the privileges of the function owner (postgres/admin),
--    bypassing RLS checks on the target table (audit_logs).
CREATE OR REPLACE FUNCTION public.log_audit(action_type text, _entity_id uuid, _entity_type entity_type, details jsonb, diffs jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.audit_logs(actor_id, action_type, entity_type, entity_id, details, diffs)
  VALUES (app_current_user_id(), action_type, _entity_type, _entity_id, COALESCE(details, '{}'::jsonb), diffs);
END$$;

-- 2. Revoke direct INSERT permission on audit_logs for authenticated users
--    Now that we have a secure RPC/Trigger, frontend should never insert directly.
--    We drop the policy that allowed 'authenticated' to insert.
DROP POLICY IF EXISTS p_insert_audit_logs_authenticated ON public.audit_logs;

-- 3. Security Cleanup: Remove loose/debug policies
-- Remove Debug Policy on operational_records if it exists
DROP POLICY IF EXISTS p_insert_debug_authenticated ON public.operational_records;

-- Remove other loose insert policies on audit_logs
DROP POLICY IF EXISTS p_insert_audit_logs_public ON public.audit_logs;
DROP POLICY IF EXISTS p_insert_audit_logs_staff ON public.audit_logs;

-- 4. Re-assert strict SELECT policies for Audit Logs (Admin/Manager only)
--    (These ensure no public/staff visibility)
DROP POLICY IF EXISTS p_select_audit_logs_public ON public.audit_logs;
DROP POLICY IF EXISTS p_select_audit_logs_staff ON public.audit_logs;

--    (Existing admin/manager policies from 0007/0011 remain in effect)
