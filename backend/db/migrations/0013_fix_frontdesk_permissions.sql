-- Migration 0013: Fix Frontdesk Permissions and Workflow
-- 1. Updates operational_records_before_insert to allow auto-approval for frontdesk operational actions
-- 2. Updates RLS policies to permit these actions
-- 3. Hardens submitted_by enforcement

-- Update the trigger function
CREATE OR REPLACE FUNCTION public.operational_records_before_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rec_type text;
  prev public.operational_records;
BEGIN
  -- Force submitted_by to be the current authenticated user to prevent spoofing/errors
  -- This fixes "Staff can only submit records for themselves" by ensuring they match.
  NEW.submitted_by := app_current_user_id();

  -- Identify record type
  rec_type := COALESCE(NEW.data->>'type', NEW.data->>'record_type');

  -- Staff logic
  IF app_is_staff() THEN
    -- Default to pending
    NEW.status := 'pending';
    
    -- EXCEPTION: Frontdesk Operational Actions are auto-approved
    -- Checkouts, bookings, and guest records are facts, not proposals.
    IF app_current_role() = 'front_desk' AND rec_type IN ('checkout_record', 'room_booking', 'guest_record', 'penalty_fee', 'payment_record') THEN
      NEW.status := 'approved';
      NEW.reviewed_by := app_current_user_id(); -- Auto-reviewed by self (system action)
      NEW.reviewed_at := now();
    END IF;
  END IF;

  -- If inserting a correction/override referencing a previous version, propagate chain
  IF NEW.previous_version_id IS NOT NULL THEN
    SELECT * INTO prev FROM public.operational_records WHERE id = NEW.previous_version_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'previous_version_id % does not exist', NEW.previous_version_id;
    END IF;
    NEW.original_id := prev.original_id;
    NEW.version_no := prev.version_no + 1;
    NEW.entity_type := prev.entity_type;

    -- Admin/Manager overrides are inserted as approved with reviewer metadata
    IF app_current_role() IN ('manager','admin') THEN
      NEW.status := 'approved';
      NEW.reviewed_by := app_current_user_id();
      NEW.reviewed_at := now();
      NEW.rejection_reason := NULL;
    END IF;
  ELSE
    -- If this is the first version, ensure original_id is set
    IF NEW.original_id IS NULL THEN
      NEW.original_id := NEW.id;
    END IF;
  END IF;
 
  -- Ensure entity_type is set (default to role if missing, though frontend should send it)
  IF NEW.entity_type IS NULL THEN
     -- Infer from role or data
     NEW.entity_type := CASE 
       WHEN app_current_role() = 'front_desk' THEN 'front_desk'
       ELSE 'other'
     END;
  END IF;

  RETURN NEW;
END
$$;

-- Update RLS Policy for Staff Insert
-- We need to split or modify p_insert_staff to allow approved records for front_desk in specific cases
DROP POLICY IF EXISTS p_insert_staff ON public.operational_records;

-- 1. General Staff Policy (Pending only) - for roles other than front_desk performing standard submissions, or front_desk doing non-operational things
CREATE POLICY p_insert_staff_general ON public.operational_records
  FOR INSERT
  WITH CHECK (
    app_is_staff() 
    AND status = 'pending' 
    AND submitted_by = app_current_user_id()
  );

-- 2. Frontdesk Operational Policy (Approved allowed)
CREATE POLICY p_insert_frontdesk_ops ON public.operational_records
  FOR INSERT
  WITH CHECK (
    app_current_role() = 'front_desk'
    AND status = 'approved'
    AND submitted_by = app_current_user_id()
    AND (data->>'type' IN ('checkout_record', 'room_booking', 'guest_record', 'penalty_fee', 'payment_record'))
  );

-- Ensure Supervisors/Managers/Admins can also submit these if they act as frontdesk
CREATE POLICY p_insert_privileged_ops ON public.operational_records
  FOR INSERT
  WITH CHECK (
    app_current_role() IN ('supervisor', 'manager', 'admin')
    AND status = 'approved'
    AND submitted_by = app_current_user_id()
  );

