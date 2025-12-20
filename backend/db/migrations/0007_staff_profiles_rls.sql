-- Migration 0007: Staff profiles RLS, audit, and enum extension
-- Implements staff visibility rules, instant activation/deactivation, and audit logging

-- 1) Extend entity_type enum to include 'staff' for audit entries
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'entity_type' AND e.enumlabel = 'staff'
  ) THEN
    ALTER TYPE entity_type ADD VALUE 'staff';
  END IF;
END$$;

-- 2) Create staff_profiles table if missing (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role role_type NOT NULL,
  department text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_staff_profiles_user_id ON public.staff_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_role ON public.staff_profiles(role);
CREATE INDEX IF NOT EXISTS idx_staff_profiles_active ON public.staff_profiles(is_active);

-- 3) Helpers
CREATE OR REPLACE FUNCTION public.staff_profiles_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END$$;

-- Guard updates by role: only admin can edit role/department; manager can only toggle is_active; others blocked
CREATE OR REPLACE FUNCTION public.staff_profiles_guard_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF app_current_role() = 'admin' THEN
    RETURN NEW;
  ELSIF app_current_role() = 'manager' THEN
    -- Managers can edit role, department, and is_active instantly; but cannot change user_id or full_name
    IF NEW.user_id <> OLD.user_id OR NEW.full_name <> OLD.full_name THEN
      RAISE EXCEPTION 'Managers may not edit full_name or user_id.';
    END IF;
    RETURN NEW;
  ELSE
    RAISE EXCEPTION 'Permission denied: updates are restricted to admin/manager.';
  END IF;
END$$;

-- Audit staff profile changes (activation/deactivation/profile edits)
CREATE OR REPLACE FUNCTION public.staff_profiles_after_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  diffs jsonb;
BEGIN
  diffs := jsonb_build_object(
    'is_active', CASE WHEN NEW.is_active <> OLD.is_active THEN jsonb_build_object('old', to_jsonb(OLD.is_active), 'new', to_jsonb(NEW.is_active)) END,
    'role', CASE WHEN NEW.role <> OLD.role THEN jsonb_build_object('old', to_jsonb(OLD.role), 'new', to_jsonb(NEW.role)) END,
    'department', CASE WHEN NEW.department IS DISTINCT FROM OLD.department THEN jsonb_build_object('old', COALESCE(to_jsonb(OLD.department), 'null'::jsonb), 'new', COALESCE(to_jsonb(NEW.department), 'null'::jsonb)) END
  );

  IF NEW.is_active = TRUE AND OLD.is_active = FALSE THEN
    PERFORM public.log_audit('staff_activation', NEW.id, 'staff', jsonb_build_object('full_name', NEW.full_name, 'role', NEW.role), diffs);
  ELSIF NEW.is_active = FALSE AND OLD.is_active = TRUE THEN
    PERFORM public.log_audit('staff_deactivation', NEW.id, 'staff', jsonb_build_object('full_name', NEW.full_name, 'role', NEW.role), diffs);
  ELSE
    PERFORM public.log_audit('staff_profile_edits', NEW.id, 'staff', jsonb_build_object('full_name', NEW.full_name, 'role', NEW.role), diffs);
  END IF;
  RETURN NEW;
END$$;

-- Optional: audit creation events
CREATE OR REPLACE FUNCTION public.staff_profiles_after_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.log_audit('staff_profile_created', NEW.id, 'staff', jsonb_build_object('full_name', NEW.full_name, 'role', NEW.role), NULL);
  RETURN NEW;
END$$;

-- Install triggers idempotently
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE t.tgname = 'trg_staff_profiles_set_updated_at' AND c.relname = 'staff_profiles' AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_staff_profiles_set_updated_at
    BEFORE UPDATE ON public.staff_profiles
    FOR EACH ROW EXECUTE FUNCTION public.staff_profiles_set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE t.tgname = 'trg_staff_profiles_guard_update' AND c.relname = 'staff_profiles' AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_staff_profiles_guard_update
    BEFORE UPDATE ON public.staff_profiles
    FOR EACH ROW EXECUTE FUNCTION public.staff_profiles_guard_update();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE t.tgname = 'trg_staff_profiles_after_update' AND c.relname = 'staff_profiles' AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_staff_profiles_after_update
    AFTER UPDATE ON public.staff_profiles
    FOR EACH ROW EXECUTE FUNCTION public.staff_profiles_after_update();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE t.tgname = 'trg_staff_profiles_after_insert' AND c.relname = 'staff_profiles' AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_staff_profiles_after_insert
    AFTER INSERT ON public.staff_profiles
    FOR EACH ROW EXECUTE FUNCTION public.staff_profiles_after_insert();
  END IF;
END$$;

-- 4) Enable and enforce RLS on staff_profiles
ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_profiles FORCE ROW LEVEL SECURITY;

-- SELECT policies
DROP POLICY IF EXISTS p_select_staff_profiles_admin ON public.staff_profiles;
CREATE POLICY p_select_staff_profiles_admin ON public.staff_profiles
  FOR SELECT USING (app_current_role() = 'admin');

DROP POLICY IF EXISTS p_select_staff_profiles_manager ON public.staff_profiles;
CREATE POLICY p_select_staff_profiles_manager ON public.staff_profiles
  FOR SELECT USING (app_current_role() = 'manager');

DROP POLICY IF EXISTS p_select_staff_profiles_supervisor ON public.staff_profiles;
CREATE POLICY p_select_staff_profiles_supervisor ON public.staff_profiles
  FOR SELECT USING (app_current_role() = 'supervisor');

-- INSERT policy (Admin and Manager)
DROP POLICY IF EXISTS p_insert_staff_profiles_admin ON public.staff_profiles;
CREATE POLICY p_insert_staff_profiles_admin ON public.staff_profiles
  FOR INSERT
  WITH CHECK (app_current_role() = 'admin');

DROP POLICY IF EXISTS p_insert_staff_profiles_manager ON public.staff_profiles;
CREATE POLICY p_insert_staff_profiles_manager ON public.staff_profiles
  FOR INSERT
  WITH CHECK (app_current_role() = 'manager');

-- UPDATE policies (Admin + Manager)
DROP POLICY IF EXISTS p_update_staff_profiles_admin ON public.staff_profiles;
CREATE POLICY p_update_staff_profiles_admin ON public.staff_profiles
  FOR UPDATE
  USING (app_current_role() = 'admin')
  WITH CHECK (app_current_role() = 'admin');

DROP POLICY IF EXISTS p_update_staff_profiles_manager ON public.staff_profiles;
CREATE POLICY p_update_staff_profiles_manager ON public.staff_profiles
  FOR UPDATE
  USING (app_current_role() = 'manager')
  WITH CHECK (app_current_role() = 'manager');

-- DELETE policy (Admin and Manager)
DROP POLICY IF EXISTS p_delete_staff_profiles_admin ON public.staff_profiles;
CREATE POLICY p_delete_staff_profiles_admin ON public.staff_profiles
  FOR DELETE
  USING (app_current_role() = 'admin');

DROP POLICY IF EXISTS p_delete_staff_profiles_manager ON public.staff_profiles;
CREATE POLICY p_delete_staff_profiles_manager ON public.staff_profiles
  FOR DELETE
  USING (app_current_role() = 'manager');

-- Additional SELECT policy for other staff to view only their own profile
DROP POLICY IF EXISTS p_select_staff_profiles_self ON public.staff_profiles;
CREATE POLICY p_select_staff_profiles_self ON public.staff_profiles
  FOR SELECT USING (app_is_staff() AND user_id = app_current_user_id());

-- 5) Enable and enforce RLS on audit_logs; allow inserts by authenticated (for triggers) and reads by admin/manager
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_insert_audit_logs_authenticated ON public.audit_logs;
CREATE POLICY p_insert_audit_logs_authenticated ON public.audit_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS p_select_audit_logs_admin ON public.audit_logs;
CREATE POLICY p_select_audit_logs_admin ON public.audit_logs
  FOR SELECT USING (app_current_role() = 'admin');

DROP POLICY IF EXISTS p_select_audit_logs_manager ON public.audit_logs;
CREATE POLICY p_select_audit_logs_manager ON public.audit_logs
  FOR SELECT USING (app_current_role() = 'manager');