-- Migration 0049: Update Inventory Ledger View
-- Refactors v_inventory_ledger to union legacy operational_records and new inventory_transactions.
-- This ensures the History Module displays both historical data and new Phase 2 transactions.

DROP VIEW IF EXISTS public.v_live_inventory;
DROP VIEW IF EXISTS public.inventory_catalog_view;
DROP VIEW IF EXISTS public.v_inventory_history;
DROP VIEW IF EXISTS public.v_current_inventory;
DROP VIEW IF EXISTS public.v_inventory_ledger;

CREATE OR REPLACE VIEW public.v_inventory_ledger AS
-- 1. Legacy Data (from canonical_operational_records)
-- Storekeeper Opening Stock
SELECT
  id AS record_id,
  created_at,
  (data->>'date')::date AS event_date,
  'STORE' AS department,
  data->>'item_name' AS item_name,
  COALESCE((data->>'quantity')::numeric, 0) AS quantity_change,
  'OPENING_STOCK' AS event_type,
  (data->>'unit_price')::numeric AS unit_price,
  (data->>'total_amount')::numeric AS total_value,
  COALESCE(data->>'staff_name', 'System') AS staff_name,
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'opening_stock'

UNION ALL

-- Storekeeper Restock
SELECT
  id, created_at, (data->>'date')::date, 'STORE', data->>'item_name',
  COALESCE((data->>'quantity')::numeric, 0), 'SUPPLIER_RESTOCK',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'stock_restock'

UNION ALL

-- Storekeeper Issued
SELECT
  id, created_at, (data->>'date')::date, 'STORE', data->>'item_name',
  -COALESCE((data->>'quantity')::numeric, 0), 'ISSUED_TO_DEPT',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'stock_issued'

UNION ALL

-- Bar Restock (Received)
SELECT
  id, created_at, (data->>'date')::date, 'BAR', data->>'item_name',
  COALESCE((data->>'restocked')::numeric, 0), 'RECEIVED_FROM_STORE',
  (data->>'unit_price')::numeric,
  0 AS total_value,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'bar' AND (data->>'restocked')::numeric > 0

UNION ALL

-- Bar Sold
SELECT
  id, created_at, (data->>'date')::date, 'BAR', data->>'item_name',
  -COALESCE((data->>'sold')::numeric, 0), 'SOLD',
  (data->>'unit_price')::numeric,
  (data->>'total_sales_value')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'bar' AND (data->>'sold')::numeric > 0

UNION ALL

-- Kitchen Restock
SELECT
  id, created_at, (data->>'date')::date, 'KITCHEN', data->>'item_name',
  COALESCE((data->>'restocked')::numeric, 0), 'RECEIVED_FROM_STORE',
  (data->>'unit_price')::numeric,
  0 AS total_value,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'kitchen' AND (data->>'restocked')::numeric > 0

UNION ALL

-- Kitchen Consumed
SELECT
  id, created_at, (data->>'date')::date, 'KITCHEN', data->>'item_name',
  -COALESCE((data->>'sold')::numeric, 0), 'CONSUMED',
  (data->>'unit_price')::numeric,
  0 AS total_value,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'kitchen' AND (data->>'sold')::numeric > 0

UNION ALL

-- 2. New Data (from inventory_transactions)
SELECT
  t.id AS record_id,
  t.created_at,
  t.event_date,
  t.department,
  i.item_name,
  (t.quantity_in - t.quantity_out) AS quantity_change,
  CASE
    WHEN t.transaction_type = 'opening_stock' THEN 'OPENING_STOCK'
    WHEN t.department = 'STORE' AND t.transaction_type = 'stock_restock' THEN 'SUPPLIER_RESTOCK'
    WHEN t.department = 'STORE' AND t.transaction_type = 'stock_issued' THEN 'ISSUED_TO_DEPT'
    WHEN t.department IN ('BAR', 'KITCHEN') AND t.transaction_type = 'stock_restock' THEN 'RECEIVED_FROM_STORE'
    WHEN t.transaction_type = 'sold' THEN 'SOLD'
    WHEN t.transaction_type = 'consumed' THEN 'CONSUMED'
    ELSE UPPER(t.transaction_type)
  END AS event_type,
  t.unit_price,
  t.total_value,
  t.staff_name,
  t.staff_name AS submitted_by
FROM public.inventory_transactions t
JOIN public.inventory_items i ON t.item_id = i.id
WHERE t.status = 'approved';

GRANT SELECT ON public.v_inventory_ledger TO authenticated;
