-- Migration 0028: Fix Staff Creation RLS and Update Helpers
-- 1. Update app_current_role to check staff_profiles first (source of truth)
-- 2. Ensure log_audit is SECURITY DEFINER
-- 3. Fix staff_profiles policies

-- 1. Update app_current_role to check staff_profiles first, then fallback to profiles
CREATE OR REPLACE FUNCTION public.app_current_role()
RETURNS role_type STABLE LANGUAGE sql AS $$
  SELECT role::role_type FROM public.staff_profiles WHERE user_id = auth.uid()
  UNION ALL
  SELECT role::role_type FROM public.profiles WHERE id = auth.uid()
  LIMIT 1;
$$;

-- 2. Ensure log_audit is SECURITY DEFINER (re-apply from 0012 to guarantee bypass)
CREATE OR REPLACE FUNCTION public.log_audit(action_type text, _entity_id uuid, _entity_type entity_type, details jsonb, diffs jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO public.audit_logs(actor_id, action_type, entity_type, entity_id, details, diffs)
  VALUES (app_current_user_id(), action_type, _entity_type, _entity_id, COALESCE(details, '{}'::jsonb), diffs);
END$$;

-- 3. Ensure staff_profiles policies allow Admin/Manager to insert
-- Drop existing insert policies to be safe and re-define
DROP POLICY IF EXISTS p_insert_staff_profiles_admin ON public.staff_profiles;
DROP POLICY IF EXISTS p_insert_staff_profiles_manager ON public.staff_profiles;

CREATE POLICY p_insert_staff_profiles_admin ON public.staff_profiles
  FOR INSERT
  WITH CHECK (app_current_role() = 'admin');

CREATE POLICY p_insert_staff_profiles_manager ON public.staff_profiles
  FOR INSERT
  WITH CHECK (app_current_role() = 'manager');

-- Ensure Admin/Manager can UPDATE/DELETE as well (refreshing these policies)
DROP POLICY IF EXISTS p_update_staff_profiles_admin ON public.staff_profiles;
CREATE POLICY p_update_staff_profiles_admin ON public.staff_profiles
  FOR UPDATE
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

DROP POLICY IF EXISTS p_delete_staff_profiles_admin ON public.staff_profiles;
CREATE POLICY p_delete_staff_profiles_admin ON public.staff_profiles
  FOR DELETE
  USING (app_current_role() = 'admin');

-- 4. Grant necessary permissions (defensive)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_profiles TO authenticated;
GRANT SELECT ON public.staff_profiles TO anon; -- Or restrict? Usually anon shouldn't see staff.
-- Revert anon grant if it was mistake. Default is denied.
REVOKE SELECT ON public.staff_profiles FROM anon;
