-- Migration 0059: Migrate Legacy Storekeeper Records to Inventory Transactions
-- This fixes the issue where Storekeeper form shows incorrect values (or 0) because:
-- 1. The previous migration (0056) only took a snapshot of 'current_stock' which might have been drifted/incorrect.
-- 2. It ignored the actual history of restocks and issues.
--
-- We will:
-- 1. Remove the 'snapshot' opening_stock records created by 0056.
-- 2. Import the actual history of 'stock_restock' and 'stock_issued' from operational_records.

-- 1. Cleanup: Remove the snapshot records from 0056 to avoid double counting
DELETE FROM public.inventory_transactions 
WHERE department = 'STORE' 
  AND transaction_type = 'opening_stock'
  AND notes = 'Migrated from legacy current_stock';

-- 2. Migrate Restock Records (Actual History)
INSERT INTO public.inventory_transactions (
    item_id, department, transaction_type, quantity_in, quantity_out, 
    unit_price, total_value, staff_name, notes, event_date, status, created_at
)
SELECT 
    i.id as item_id,
    'STORE' as department,
    'stock_restock' as transaction_type,
    (r.data->>'restocked')::numeric as quantity_in,
    0 as quantity_out,
    COALESCE((r.data->>'unit_price')::numeric, i.unit_price, 0) as unit_price,
    (COALESCE((r.data->>'restocked')::numeric, 0) * COALESCE((r.data->>'unit_price')::numeric, i.unit_price, 0)) as total_value,
    COALESCE(r.data->>'staff_name', 'Legacy Migration') as staff_name,
    'Migrated from legacy operational_records' as notes,
    COALESCE((r.data->>'date')::date, r.created_at::date) as event_date,
    'approved' as status,
    r.created_at
FROM public.operational_records r
JOIN public.inventory_items i ON i.item_name = r.data->>'item_name'
WHERE r.entity_type = 'storekeeper'
  AND (r.data->>'restocked')::numeric > 0
  AND r.deleted_at IS NULL
  AND r.status = 'approved'
  -- Avoid duplicates (idempotency)
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_transactions t 
    WHERE t.item_id = i.id 
      AND t.created_at = r.created_at
      AND t.transaction_type = 'stock_restock'
  );

-- 3. Migrate Issued Records (Actual History)
INSERT INTO public.inventory_transactions (
    item_id, department, transaction_type, quantity_in, quantity_out, 
    unit_price, total_value, staff_name, notes, event_date, status, created_at
)
SELECT 
    i.id as item_id,
    'STORE' as department,
    'stock_issued' as transaction_type,
    0 as quantity_in,
    (r.data->>'issued')::numeric as quantity_out,
    COALESCE((r.data->>'unit_price')::numeric, i.unit_price, 0) as unit_price,
    0 as total_value,
    COALESCE(r.data->>'staff_name', 'Legacy Migration') as staff_name,
    'Migrated from legacy operational_records' as notes,
    COALESCE((r.data->>'date')::date, r.created_at::date) as event_date,
    'approved' as status,
    r.created_at
FROM public.operational_records r
JOIN public.inventory_items i ON i.item_name = r.data->>'item_name'
WHERE r.entity_type = 'storekeeper'
  AND (r.data->>'issued')::numeric > 0
  AND r.deleted_at IS NULL
  AND r.status = 'approved'
  AND NOT EXISTS (
    SELECT 1 FROM public.inventory_transactions t 
    WHERE t.item_id = i.id 
      AND t.created_at = r.created_at
      AND t.transaction_type = 'stock_issued'
  );
