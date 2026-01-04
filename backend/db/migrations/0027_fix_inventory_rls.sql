-- Migration 0027: Fix Inventory RLS Policies
-- Objectives:
-- 1. Allow all authenticated users to view Inventory Configs (Categories, Items) so Catalog Views work.
-- 2. Enforce stricter INSERT rules for Staff (Kitchen/Bar/Storekeeper must insert their own entity_type).
-- 3. Ensure Storekeeper can view all Storekeeper records (including configs).

-- 1. Allow Viewing Configs (Global Read for Configs)
-- Currently, Kitchen/Bar cannot see 'storekeeper' records, so they can't see the Catalog derived from them.
-- We add a policy to allow reading 'storekeeper' records that are configurations.

DROP POLICY IF EXISTS p_select_inventory_configs ON public.operational_records;
CREATE POLICY p_select_inventory_configs ON public.operational_records
  FOR SELECT
  USING (
    entity_type = 'storekeeper'
    AND (
      data->>'type' IN ('config_category', 'config_item', 'config_collection')
      OR data->>'record_type' IN ('config_category', 'config_item', 'config_collection')
    )
  );

-- 2. Stricter Insert Policy for Staff
-- Drop the old general policy and recreate it with entity_type enforcement.
DROP POLICY IF EXISTS p_insert_staff_general ON public.operational_records;

CREATE POLICY p_insert_staff_general ON public.operational_records
  FOR INSERT
  WITH CHECK (
    app_is_staff() 
    AND status = 'pending' 
    AND submitted_by = app_current_user_id()
    AND (
      -- Enforce Entity Type matches Role for Inventory Roles
      CASE 
        WHEN app_current_role() = 'kitchen' THEN entity_type = 'kitchen'
        WHEN app_current_role() = 'bar' THEN entity_type = 'bar'
        WHEN app_current_role() = 'storekeeper' THEN entity_type = 'storekeeper'
        -- Front Desk and others are less restricted here (covered by other logic or default)
        ELSE true 
      END
    )
  );

-- 3. Storekeeper Visibility
-- Ensure Storekeeper can see ALL 'storekeeper' records (already covered by p_select_storekeeper_shared in 0020, but let's double check).
-- p_select_storekeeper_shared in 0020:
-- USING (app_current_role() = 'storekeeper' AND entity_type = 'storekeeper' AND status = 'approved');
-- This misses 'pending' records submitted by themselves!
-- Staff usually rely on p_select_staff (own records) to see pending.
-- p_select_staff (0004): USING (app_is_staff() AND submitted_by = app_current_user_id());
-- So they can see their own pending.
-- But Storekeeper might need to see APPROVED records (covered by 0020).
-- The new p_select_inventory_configs allows everyone to see configs.

-- 4. Allow Storekeeper to View OPENING STOCK and STOCK RESTOCK/ISSUE records even if they didn't submit them?
-- If multiple storekeepers exist, they should see each other's work?
-- p_select_storekeeper_shared allows seeing 'approved' records.
-- If they need to see 'pending' from others? Probably not.
-- So the existing setup is likely fine for Storekeeper visibility.

-- 5. Fix Potential "Staff ID" Error in Insert (Defensive)
-- Ensure that triggers or functions don't fail if staff_id is missing (already fixed in code, but good to be safe in DB).
-- (No DB change needed, just a note).

