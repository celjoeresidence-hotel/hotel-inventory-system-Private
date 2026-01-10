-- Migration 0063: Fix missing profiles to resolve foreign key constraints
-- This ensures all auth.users have a corresponding public.profile, preventing FK errors on operational_records.submitted_by

INSERT INTO public.profiles (id, email, full_name, role)
SELECT
  u.id,
  u.email,
  COALESCE(u.raw_user_meta_data->>'full_name', u.email),
  'front_desk' -- Default role, can be updated by admin later
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
