-- Migration 0050: Fix Inventory Items Schema
-- Ensures deleted_at column exists on inventory_items to prevent RPC errors.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'inventory_items'
        AND column_name = 'deleted_at'
    ) THEN
        ALTER TABLE public.inventory_items ADD COLUMN deleted_at timestamptz;
    END IF;
END $$;

-- Ensure the RLS policy uses the soft delete column
DROP POLICY IF EXISTS "Enable read access for authenticated users" ON public.inventory_items;

CREATE POLICY "Enable read access for authenticated users" ON public.inventory_items
  FOR SELECT TO authenticated USING (deleted_at IS NULL);
