-- Migration 0033: Performance Optimization
-- optimizing inventory views to prevent timeouts by reducing table scans and adding targeted indexes.

-- 1. Performance Index for Canonical View
-- This index matches the DISTINCT ON (original_id) ORDER BY ... pattern used in canonical_operational_records,
-- combined with the common filter (entity_type).
CREATE INDEX IF NOT EXISTS idx_operational_records_canonical_perf 
ON public.operational_records (entity_type, original_id, reviewed_at DESC, created_at DESC)
WHERE status = 'approved' AND deleted_at IS NULL;

-- 2. Optimized Inventory Ledger (Reduced Scans)
-- Previously performed 7 scans. Now reduced to 3 scans (Storekeeper combined, Bar/Kitchen split only for restock/sold).
CREATE OR REPLACE VIEW public.v_inventory_ledger AS
-- Group 1: Storekeeper Events (Mutually Exclusive Types) - Single Scan
SELECT
  id AS record_id,
  created_at,
  (data->>'date')::date AS event_date,
  'STORE' AS department,
  data->>'item_name' AS item_name,
  CASE
    WHEN data->>'type' = 'stock_issued' THEN -COALESCE((data->>'quantity')::numeric, 0)
    ELSE COALESCE((data->>'quantity')::numeric, 0)
  END AS quantity_change,
  CASE
    WHEN data->>'type' = 'opening_stock' THEN 'OPENING_STOCK'
    WHEN data->>'type' = 'stock_restock' THEN 'SUPPLIER_RESTOCK'
    WHEN data->>'type' = 'stock_issued' THEN 'ISSUED_TO_DEPT'
    ELSE 'UNKNOWN'
  END AS event_type,
  (data->>'unit_price')::numeric AS unit_price,
  (data->>'total_amount')::numeric AS total_value,
  COALESCE(data->>'staff_name', 'System') AS staff_name,
  submitted_by
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' 
  AND data->>'type' IN ('opening_stock', 'stock_restock', 'stock_issued')

UNION ALL

-- Group 2: Bar/Kitchen Restock (Received from Store)
SELECT
  id, created_at, (data->>'date')::date, 
  CASE WHEN entity_type = 'bar' THEN 'BAR' ELSE 'KITCHEN' END,
  data->>'item_name',
  COALESCE((data->>'restocked')::numeric, 0), 
  'RECEIVED_FROM_STORE',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by
FROM public.canonical_operational_records
WHERE entity_type IN ('bar', 'kitchen') 
  AND (data->>'restocked')::numeric > 0

UNION ALL

-- Group 3: Bar/Kitchen Sold/Consumed
SELECT
  id, created_at, (data->>'date')::date, 
  CASE WHEN entity_type = 'bar' THEN 'BAR' ELSE 'KITCHEN' END,
  data->>'item_name',
  -COALESCE((data->>'sold')::numeric, 0), 
  CASE WHEN entity_type = 'kitchen' THEN 'CONSUMED' ELSE 'SOLD' END,
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by
FROM public.canonical_operational_records
WHERE entity_type IN ('bar', 'kitchen') 
  AND (data->>'sold')::numeric > 0;

-- 3. Optimized Inventory Catalog View (Single Config Scan)
CREATE OR REPLACE VIEW public.inventory_catalog_view AS
WITH config_data AS (
  -- Fetch all config records in one pass
  SELECT 
    data, 
    lower(COALESCE(data->>'type', data->>'record_type')) as record_type
  FROM public.canonical_operational_records
  WHERE entity_type = 'storekeeper'
    AND lower(COALESCE(data->>'type', data->>'record_type')) IN ('config_category', 'config_collection', 'config_item')
    AND COALESCE((data->>'active')::boolean, true) = true
),
categories AS (
  SELECT
    COALESCE(data->>'category_name', data->>'category') AS category_name
  FROM config_data
  WHERE record_type = 'config_category'
),
collections AS (
  SELECT
    data->>'collection_name' AS collection_name,
    COALESCE(data->>'category_name', data->>'category') AS category
  FROM config_data
  WHERE record_type = 'config_collection'
),
items AS (
  SELECT
    data->>'item_name' AS item_name,
    data->>'collection_name' AS collection_name,
    COALESCE(data->>'category_name', data->>'category') AS category,
    data->>'unit' AS unit
  FROM config_data
  WHERE record_type = 'config_item'
),
global_stock AS (
  SELECT
    item_name,
    SUM(quantity_change) AS current_stock
  FROM public.v_inventory_ledger
  WHERE department = 'STORE'
  GROUP BY item_name
)
SELECT
  i.category AS category,
  i.collection_name AS collection_name,
  i.item_name AS item_name,
  i.unit AS unit,
  COALESCE(gs.current_stock, 0) AS current_stock
FROM items i
JOIN collections c ON c.collection_name = i.collection_name AND lower(c.category) = lower(i.category)
JOIN categories cat ON lower(cat.category_name) = lower(i.category)
LEFT JOIN global_stock gs ON gs.item_name = i.item_name;

-- Ensure permissions
GRANT SELECT ON public.v_inventory_ledger TO authenticated;
GRANT SELECT ON public.inventory_catalog_view TO authenticated;
