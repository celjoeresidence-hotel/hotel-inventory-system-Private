-- Migration 0035: Auto-Approve Operational Records for Inventory
-- Objective: Ensure Storekeeper, Kitchen, and Bar daily stock records are immediately effective (approved)
-- This fixes the issue where submitted stock reverts after refresh because it was stuck in 'pending'.

CREATE OR REPLACE FUNCTION public.operational_records_before_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  rec_type text;
  prev public.operational_records;
BEGIN
  -- Force submitted_by to be the current authenticated user
  NEW.submitted_by := public.app_current_user_id();

  -- Identify record type
  rec_type := COALESCE(NEW.data->>'type', NEW.data->>'record_type');

  -- Staff logic
  IF public.app_is_staff() THEN
    -- Default to pending
    NEW.status := 'pending';
    
    -- EXCEPTION 1: Frontdesk Operational Actions are auto-approved
    IF public.app_current_role() = 'front_desk' AND rec_type IN ('checkout_record', 'guest_record', 'penalty_fee', 'payment_record') THEN
      NEW.status := 'approved';
      NEW.reviewed_by := public.app_current_user_id();
      NEW.reviewed_at := now();
    END IF;

    -- EXCEPTION 2: Storekeeper Daily Operations (Restock/Issue) are auto-approved
    -- "The Inventory Catalogue must be mutable by the Storekeeper through daily operational records"
    IF public.app_current_role() = 'storekeeper' AND rec_type IN ('stock_restock', 'stock_issued') THEN
      NEW.status := 'approved';
      NEW.reviewed_by := public.app_current_user_id();
      NEW.reviewed_at := now();
    END IF;

    -- EXCEPTION 3: Kitchen/Bar Daily Operations are auto-approved
    -- They don't use 'type' but have 'item_name' and operate on daily stock
    -- We assume if item_name is present and it's kitchen/bar, it's a daily stock entry.
    IF public.app_current_role() IN ('kitchen', 'bar') AND (NEW.data->>'item_name') IS NOT NULL AND rec_type IS NULL THEN
      NEW.status := 'approved';
      NEW.reviewed_by := public.app_current_user_id();
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
    IF public.app_current_role() IN ('manager','admin') THEN
      NEW.status := 'approved';
      NEW.reviewed_by := public.app_current_user_id();
      NEW.reviewed_at := now();
      NEW.rejection_reason := NULL;
    END IF;
  ELSE
    -- If this is the first version, ensure original_id is set
    IF NEW.original_id IS NULL THEN
      NEW.original_id := NEW.id;
    END IF;
  END IF;
 
  -- Ensure entity_type is set
  IF NEW.entity_type IS NULL THEN
     NEW.entity_type := CASE 
       WHEN public.app_current_role() = 'front_desk' THEN 'front_desk'::entity_type
       ELSE 'other'::entity_type
     END;
  END IF;

  RETURN NEW;
END
$$;
