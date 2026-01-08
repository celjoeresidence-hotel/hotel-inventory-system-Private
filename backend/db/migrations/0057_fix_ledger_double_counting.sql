-- Migration 0057: Fix Ledger Double Counting
-- Removes Legacy Storekeeper records from v_inventory_ledger.
-- Since we migrated legacy stock to inventory_transactions (via 0056), keeping legacy records in the view causes double counting.

DROP VIEW IF EXISTS public.v_live_inventory;
DROP VIEW IF EXISTS public.inventory_catalog_view;
DROP VIEW IF EXISTS public.v_inventory_history;
DROP VIEW IF EXISTS public.v_current_inventory;
DROP VIEW IF EXISTS public.v_inventory_ledger;

CREATE OR REPLACE VIEW public.v_inventory_ledger AS
-- 1. Legacy Data (Kitchen/Bar ONLY)
-- We exclude Storekeeper legacy data because it has been migrated to inventory_transactions (opening_stock)

-- Bar Restock (Received)
SELECT
  id AS record_id,
  created_at,
  (data->>'date')::date AS event_date,
  'BAR' AS department,
  data->>'item_name' AS item_name,
  COALESCE((data->>'restocked')::numeric, 0) AS quantity_change,
  'RECEIVED_FROM_STORE' AS event_type,
  (data->>'unit_price')::numeric AS unit_price,
  0 AS total_value,
  COALESCE(data->>'staff_name', 'System') AS staff_name,
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
  (data->>'total_sales_value')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'kitchen' AND (data->>'sold')::numeric > 0

UNION ALL

-- 2. New Inventory Transactions (All Departments)
SELECT
  t.id,
  t.created_at,
  t.event_date,
  t.department,
  i.item_name,
  CASE 
    WHEN transaction_type IN ('stock_restock', 'opening_stock') THEN quantity_in
    WHEN transaction_type IN ('stock_issued', 'sold', 'consumed') THEN -quantity_out
    WHEN transaction_type = 'adjustment' THEN 
       CASE WHEN quantity_in > 0 THEN quantity_in ELSE -quantity_out END
    ELSE 0
  END AS quantity_change,
  transaction_type AS event_type,
  t.unit_price,
  total_value,
  staff_name,
  'system' -- placeholder for submitted_by as we don't have it in transactions yet (or use auth.uid if we added it)
FROM public.inventory_transactions t
JOIN public.inventory_items i ON i.id = t.item_id
WHERE t.status = 'approved';

GRANT SELECT ON public.v_inventory_ledger TO authenticated;

-- Restore dependent views (same as 0051)

-- v_current_inventory
CREATE OR REPLACE VIEW public.v_current_inventory AS
SELECT
  department,
  item_name,
  SUM(quantity_change) AS current_stock
FROM public.v_inventory_ledger
GROUP BY department, item_name;

GRANT SELECT ON public.v_current_inventory TO authenticated;

-- inventory_catalog_view
CREATE OR REPLACE VIEW public.inventory_catalog_view AS
SELECT
  i.category,
  i.collection AS collection_name,
  i.item_name,
  i.unit,
  COALESCE(i.unit_price, 0) AS unit_price,
  COALESCE(s.current_stock, 0) AS current_stock
FROM public.inventory_items i
LEFT JOIN (
  SELECT item_name, SUM(quantity_change) AS current_stock
  FROM public.v_inventory_ledger
  WHERE department = 'STORE'
  GROUP BY item_name
) s ON s.item_name = i.item_name
WHERE i.deleted_at IS NULL;

GRANT SELECT ON public.inventory_catalog_view TO authenticated;

-- v_live_inventory
CREATE OR REPLACE VIEW public.v_live_inventory AS
SELECT
  cur.department,
  cur.item_name,
  cur.current_stock,
  cat.unit,
  cat.category,
  cat.collection_name,
  CASE
    WHEN cur.current_stock <= 0 THEN 'OUT_OF_STOCK'
    WHEN cur.current_stock < 10 THEN 'LOW_STOCK'
    ELSE 'IN_STOCK'
  END AS stock_status
FROM public.v_current_inventory cur
LEFT JOIN public.inventory_catalog_view cat ON cat.item_name = cur.item_name;

GRANT SELECT ON public.v_live_inventory TO authenticated;

-- v_inventory_history (same as 0038 but using new ledger)
CREATE OR REPLACE VIEW public.v_inventory_history AS
WITH running_ledger AS (
  SELECT
    record_id,
    created_at,
    event_date,
    department,
    item_name,
    quantity_change,
    event_type,
    unit_price,
    total_value,
    staff_name,
    submitted_by,
    SUM(quantity_change) OVER (
      PARTITION BY department, item_name 
      ORDER BY event_date ASC, created_at ASC
    ) AS closing_stock
  FROM public.v_inventory_ledger
),
item_meta AS (
  SELECT DISTINCT ON (item_name) item_name, category, collection AS collection_name, unit
  FROM public.inventory_items
)
SELECT
  rl.record_id,
  rl.created_at,
  rl.event_date,
  rl.department,
  rl.item_name,
  im.category,
  im.collection_name AS collection,
  im.unit,
  rl.event_type,
  rl.quantity_change,
  (rl.closing_stock - rl.quantity_change) AS opening_stock,
  rl.closing_stock,
  rl.unit_price,
  rl.total_value,
  rl.staff_name,
  rl.submitted_by
FROM running_ledger rl
LEFT JOIN item_meta im ON im.item_name = rl.item_name;

GRANT SELECT ON public.v_inventory_history TO authenticated;
