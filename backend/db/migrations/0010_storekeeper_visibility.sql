-- Migration 0010: Fix Storekeeper visibility
-- Storekeepers need to see all inventory configuration and stock records regardless of creator or assignment
-- This fixes the issue where Storekeepers see no items or categories because they were created by Admin/Manager

-- Drop existing policy if it conflicts or is insufficient (though we are creating a new specific one)
DROP POLICY IF EXISTS p_select_storekeeper ON public.operational_records;

CREATE POLICY p_select_storekeeper ON public.operational_records
  FOR SELECT
  USING (
    app_current_role() = 'storekeeper'
    AND status = 'approved'
    AND (
      -- Config records (created by Admin/Manager)
      data->>'type' IN ('config_category', 'config_collection', 'config_item')
      OR
      -- Stock records (opening stock from setup, and transactions from any staff)
      data->>'type' IN ('opening_stock', 'stock_restock', 'stock_issued')
    )
  );
