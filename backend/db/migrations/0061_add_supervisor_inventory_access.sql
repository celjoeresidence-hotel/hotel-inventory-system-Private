-- Migration 0061: Add Supervisor Access to Inventory and Fix Visibility
-- Ensures supervisors (and storekeepers) can manage inventory structure and items.
-- Updates policies for inventory_categories, inventory_collections, and inventory_items.
-- FIX: Also updates SELECT policies to allow Staff to see deleted records (needed for restore operations).

-- 1. Inventory Items Policies
-- Drop existing write policies (from 0043 or others)
DROP POLICY IF EXISTS "Enable insert for managers/admins" ON public.inventory_items;
DROP POLICY IF EXISTS "Enable update for managers/admins" ON public.inventory_items;
DROP POLICY IF EXISTS "Enable delete for managers/admins" ON public.inventory_items;
DROP POLICY IF EXISTS "Enable write access for staff" ON public.inventory_items;

-- Drop colliding policies if they exist (Fix for ERROR: 42710)
DROP POLICY IF EXISTS "Enable insert for staff" ON public.inventory_items;
DROP POLICY IF EXISTS "Enable update for staff" ON public.inventory_items;
DROP POLICY IF EXISTS "Enable delete for staff" ON public.inventory_items;

-- Drop existing read policy to update visibility
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.inventory_items;

-- Create new policies using app_current_role()

-- READ: Allow everyone to see active, Staff to see all (including deleted)
CREATE POLICY "Enable read access for authenticated users" ON public.inventory_items
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL OR
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  );

-- WRITE: Allow Storekeeper, Supervisor, Manager, Admin
CREATE POLICY "Enable insert for staff" ON public.inventory_items
  FOR INSERT TO authenticated
  WITH CHECK (
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  );

CREATE POLICY "Enable update for staff" ON public.inventory_items
  FOR UPDATE TO authenticated
  USING (
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  )
  WITH CHECK (
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  );

CREATE POLICY "Enable delete for staff" ON public.inventory_items
  FOR DELETE TO authenticated
  USING (
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  );


-- 2. Inventory Categories Policies
DROP POLICY IF EXISTS "Allow insert categories for managers/admins" ON public.inventory_categories;
DROP POLICY IF EXISTS "Allow update categories for managers/admins" ON public.inventory_categories;
DROP POLICY IF EXISTS "Allow delete categories for managers/admins" ON public.inventory_categories;
DROP POLICY IF EXISTS "Enable write access for staff" ON public.inventory_categories;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.inventory_categories;

-- Drop colliding policies if they exist
DROP POLICY IF EXISTS "Allow insert categories for staff" ON public.inventory_categories;
DROP POLICY IF EXISTS "Allow update categories for staff" ON public.inventory_categories;
DROP POLICY IF EXISTS "Allow delete categories for staff" ON public.inventory_categories;

-- READ
CREATE POLICY "Enable read access for authenticated users" ON public.inventory_categories
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL OR
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  );

-- WRITE
CREATE POLICY "Allow insert categories for staff" ON public.inventory_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  );

CREATE POLICY "Allow update categories for staff" ON public.inventory_categories
  FOR UPDATE TO authenticated
  USING (
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  )
  WITH CHECK (
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  );

CREATE POLICY "Allow delete categories for staff" ON public.inventory_categories
  FOR DELETE TO authenticated
  USING (
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  );


-- 3. Inventory Collections Policies
DROP POLICY IF EXISTS "Allow insert collections for managers/admins" ON public.inventory_collections;
DROP POLICY IF EXISTS "Allow update collections for managers/admins" ON public.inventory_collections;
DROP POLICY IF EXISTS "Allow delete collections for managers/admins" ON public.inventory_collections;
DROP POLICY IF EXISTS "Enable write access for staff" ON public.inventory_collections;
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.inventory_collections;

-- Drop colliding policies if they exist
DROP POLICY IF EXISTS "Allow insert collections for staff" ON public.inventory_collections;
DROP POLICY IF EXISTS "Allow update collections for staff" ON public.inventory_collections;
DROP POLICY IF EXISTS "Allow delete collections for staff" ON public.inventory_collections;

-- READ
CREATE POLICY "Enable read access for authenticated users" ON public.inventory_collections
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL OR
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  );

-- WRITE
CREATE POLICY "Allow insert collections for staff" ON public.inventory_collections
  FOR INSERT TO authenticated
  WITH CHECK (
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  );

CREATE POLICY "Allow update collections for staff" ON public.inventory_collections
  FOR UPDATE TO authenticated
  USING (
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  )
  WITH CHECK (
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  );

CREATE POLICY "Allow delete collections for staff" ON public.inventory_collections
  FOR DELETE TO authenticated
  USING (
    app_current_role() IN ('storekeeper', 'supervisor', 'manager', 'admin')
  );
