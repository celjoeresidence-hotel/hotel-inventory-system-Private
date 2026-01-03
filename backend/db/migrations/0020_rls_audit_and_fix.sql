-- Migration 0020: RLS Audit and Fix
-- 1. Enable RLS on public.rooms and add policies
-- 2. Allow departments (Kitchen, Bar, Storekeeper) to view shared records for inventory
-- 3. Fix Manager visibility (allow viewing pending records)
-- 4. Cleanup old/duplicate policies

-- 1. Rooms RLS
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_select_rooms_all ON public.rooms;
CREATE POLICY p_select_rooms_all ON public.rooms
  FOR SELECT
  USING (true); -- Everyone can view rooms

DROP POLICY IF EXISTS p_modify_rooms_admin_manager ON public.rooms;
CREATE POLICY p_modify_rooms_admin_manager ON public.rooms
  FOR ALL
  USING (app_current_role() IN ('admin', 'manager'))
  WITH CHECK (app_current_role() IN ('admin', 'manager'));

-- 2. Departmental Visibility (Inventory Sharing)
-- Kitchen
DROP POLICY IF EXISTS p_select_kitchen_shared ON public.operational_records;
CREATE POLICY p_select_kitchen_shared ON public.operational_records
  FOR SELECT
  USING (
    app_current_role() = 'kitchen'
    AND entity_type = 'kitchen'
    AND status = 'approved'
  );

-- Bar
DROP POLICY IF EXISTS p_select_bar_shared ON public.operational_records;
CREATE POLICY p_select_bar_shared ON public.operational_records
  FOR SELECT
  USING (
    app_current_role() = 'bar'
    AND entity_type = 'bar'
    AND status = 'approved'
  );

-- Storekeeper
DROP POLICY IF EXISTS p_select_storekeeper_shared ON public.operational_records;
CREATE POLICY p_select_storekeeper_shared ON public.operational_records
  FOR SELECT
  USING (
    app_current_role() = 'storekeeper'
    AND entity_type = 'storekeeper'
    AND status = 'approved'
  );

-- 3. Manager Visibility Fix
-- Managers need to see PENDING records to approve them.
-- Previous policy p_select_manager (0004) only allowed 'approved'.
DROP POLICY IF EXISTS p_select_manager ON public.operational_records;
CREATE POLICY p_select_manager ON public.operational_records
  FOR SELECT
  USING (
    app_current_role() = 'manager'
    AND status IN ('approved', 'pending', 'rejected')
  );

-- 4. Cleanup
-- Remove any potential duplicates or obsolete policies if they exist (defensive)
DROP POLICY IF EXISTS p_delete_manager_admin ON public.operational_records;
