-- Migration 0003: Helper functions (Supabase-aware)
-- Provides app_current_user_id, app_current_role, and app_is_staff helpers

-- Current user id based on Supabase Auth
CREATE OR REPLACE FUNCTION public.app_current_user_id()
RETURNS uuid STABLE LANGUAGE sql AS $$
  SELECT auth.uid();
$$;

-- Current user role from profiles
CREATE OR REPLACE FUNCTION public.app_current_role()
RETURNS role_type STABLE LANGUAGE sql AS $$
  SELECT p.role FROM public.profiles p WHERE p.id = auth.uid();
$$;

-- Staff predicate: front_desk, kitchen, bar, storekeeper
CREATE OR REPLACE FUNCTION public.app_is_staff()
RETURNS boolean STABLE LANGUAGE sql AS $$
  SELECT app_current_role() IN ('front_desk','kitchen','bar','storekeeper');
$$;

GRANT EXECUTE ON FUNCTION public.app_current_user_id() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_current_role() TO PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_is_staff() TO PUBLIC;