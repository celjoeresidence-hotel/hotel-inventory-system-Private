-- Migration 0044: Add Soft Delete to Inventory Items
ALTER TABLE public.inventory_items ADD COLUMN deleted_at timestamptz;

-- Update RLS for Soft Delete
DROP POLICY "Enable read access for authenticated users" ON public.inventory_items;
CREATE POLICY "Enable read access for authenticated users" ON public.inventory_items
  FOR SELECT TO authenticated USING (deleted_at IS NULL);
