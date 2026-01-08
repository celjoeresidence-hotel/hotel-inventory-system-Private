-- Migration 0043: Dedicated Inventory Tables
-- Implements Phase 1 of the architectural improvements.
-- Moves stock management from unstructured operational_records to dedicated relational tables.

-- 1. Create Inventory Items Table
CREATE TABLE IF NOT EXISTS public.inventory_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  item_name text NOT NULL,
  category text NOT NULL,
  collection text NOT NULL,
  unit text,
  unit_price numeric DEFAULT 0,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  CONSTRAINT inventory_items_name_key UNIQUE (item_name)
);

-- 2. Create Inventory Transactions Table
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  department text NOT NULL CHECK (department IN ('STORE', 'KITCHEN', 'BAR')),
  transaction_type text NOT NULL, -- 'restock', 'issued', 'sold', 'consumed', 'opening', 'adjustment'
  quantity_in numeric DEFAULT 0 CHECK (quantity_in >= 0),
  quantity_out numeric DEFAULT 0 CHECK (quantity_out >= 0),
  unit_price numeric DEFAULT 0,
  total_value numeric DEFAULT 0,
  staff_name text,
  notes text,
  event_date date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz DEFAULT now()
);

-- 3. Create Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON public.inventory_items(category);
CREATE INDEX IF NOT EXISTS idx_inventory_items_collection ON public.inventory_items(collection);

CREATE INDEX IF NOT EXISTS idx_inventory_transactions_item ON public.inventory_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_dept ON public.inventory_transactions(department);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_date ON public.inventory_transactions(event_date);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_type ON public.inventory_transactions(transaction_type);

-- 4. Enable RLS
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;

-- 5. RLS Policies
-- Read: Authenticated users can read
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.inventory_items;
CREATE POLICY "Enable read access for authenticated users" ON public.inventory_items
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.inventory_transactions;
CREATE POLICY "Enable read access for authenticated users" ON public.inventory_transactions
  FOR SELECT TO authenticated USING (true);

-- Write: Managers/Admins can edit items
DROP POLICY IF EXISTS "Enable insert for managers/admins" ON public.inventory_items;
CREATE POLICY "Enable insert for managers/admins" ON public.inventory_items
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = auth.uid() AND role IN ('manager', 'admin'))
  );

DROP POLICY IF EXISTS "Enable update for managers/admins" ON public.inventory_items;
CREATE POLICY "Enable update for managers/admins" ON public.inventory_items
  FOR UPDATE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = auth.uid() AND role IN ('manager', 'admin'))
  );

DROP POLICY IF EXISTS "Enable delete for managers/admins" ON public.inventory_items;
CREATE POLICY "Enable delete for managers/admins" ON public.inventory_items
  FOR DELETE TO authenticated USING (
    EXISTS (SELECT 1 FROM public.staff_profiles WHERE user_id = auth.uid() AND role IN ('manager', 'admin'))
  );

-- Write: Staff can insert transactions (Storekeeper, Bar, Kitchen roles)
DROP POLICY IF EXISTS "Enable insert for staff" ON public.inventory_transactions;
CREATE POLICY "Enable insert for staff" ON public.inventory_transactions
  FOR INSERT TO authenticated WITH CHECK (true);

-- 6. Data Migration: Seed inventory_items from existing configuration
-- We pull distinct item configurations from the catalog view (which comes from operational_records)
INSERT INTO public.inventory_items (item_name, category, collection, unit, unit_price)
SELECT DISTINCT ON (item_name)
  item_name,
  category,
  collection_name,
  unit,
  0 -- Default price, will need update or pull from specific config
FROM public.inventory_catalog_view
ON CONFLICT (item_name) DO NOTHING;

-- 7. Grant Permissions
GRANT ALL ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_transactions TO authenticated;
