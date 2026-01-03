-- Migration 0021: Derived Inventory Views (Updated with Dependencies)
-- Provides enhanced views for inventory management and reporting.
-- Includes definitions for dependency views (inventory_catalog_view, v_inventory_ledger) to ensure robustness.

-- ==========================================
-- 0. Dependencies (Ensuring they exist)
-- ==========================================

-- 0.1 Inventory Catalog View (from Migration 0008)
CREATE OR REPLACE VIEW public.inventory_catalog_view AS
WITH categories AS (
  SELECT
    COALESCE(rc.data->>'category_name', rc.data->>'category') AS category_name
  FROM public.canonical_operational_records rc
  WHERE rc.entity_type = 'storekeeper'
    AND lower(COALESCE(rc.data->>'type', rc.data->>'record_type')) = 'config_category'
    AND COALESCE((rc.data->>'active')::boolean, true) = true
),
collections AS (
  SELECT
    rcol.data->>'collection_name' AS collection_name,
    COALESCE(rcol.data->>'category_name', rcol.data->>'category') AS category
  FROM public.canonical_operational_records rcol
  WHERE rcol.entity_type = 'storekeeper'
    AND lower(COALESCE(rcol.data->>'type', rcol.data->>'record_type')) = 'config_collection'
    AND COALESCE((rcol.data->>'active')::boolean, true) = true
),
items AS (
  SELECT
    rit.data->>'item_name' AS item_name,
    rit.data->>'collection_name' AS collection_name,
    COALESCE(rit.data->>'category_name', rit.data->>'category') AS category,
    rit.data->>'unit' AS unit
  FROM public.canonical_operational_records rit
  WHERE rit.entity_type = 'storekeeper'
    AND lower(COALESCE(rit.data->>'type', rit.data->>'record_type')) = 'config_item'
),
opening_stock AS (
  SELECT DISTINCT ON (ros.data->>'item_name')
    ros.data->>'item_name' AS item_name,
    COALESCE((ros.data->>'quantity')::numeric, 0) AS current_stock
  FROM public.operational_records ros
  WHERE ros.status = 'approved'
    AND ros.deleted_at IS NULL
    AND ros.entity_type = 'storekeeper'
    AND lower(COALESCE(ros.data->>'type', ros.data->>'record_type')) = 'opening_stock'
  ORDER BY ros.data->>'item_name', ros.created_at DESC NULLS LAST, ros.reviewed_at DESC NULLS LAST
)
SELECT
  i.category AS category,
  i.collection_name AS collection_name,
  i.item_name AS item_name,
  i.unit AS unit,
  COALESCE(os.current_stock, 0) AS current_stock
FROM items i
JOIN collections c ON c.collection_name = i.collection_name AND lower(c.category) = lower(i.category)
JOIN categories cat ON lower(cat.category_name) = lower(i.category)
LEFT JOIN opening_stock os ON os.item_name = i.item_name;

GRANT SELECT ON public.inventory_catalog_view TO authenticated;

-- 0.2 Inventory Ledger View (from Migration 0016)
CREATE OR REPLACE VIEW public.v_inventory_ledger AS
SELECT
  id AS record_id,
  created_at,
  (data->>'date')::date AS event_date,
  'STORE' AS department,
  data->>'item_name' AS item_name,
  COALESCE((data->>'quantity')::numeric, 0) AS quantity_change,
  'OPENING_STOCK' AS event_type
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'opening_stock'
UNION ALL
SELECT
  id, created_at, (data->>'date')::date, 'STORE', data->>'item_name',
  COALESCE((data->>'quantity')::numeric, 0), 'SUPPLIER_RESTOCK'
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'stock_restock'
UNION ALL
SELECT
  id, created_at, (data->>'date')::date, 'STORE', data->>'item_name',
  -COALESCE((data->>'quantity')::numeric, 0), 'ISSUED_TO_DEPT'
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'stock_issued'
UNION ALL
SELECT
  id, created_at, (data->>'date')::date, 'BAR', data->>'item_name',
  COALESCE((data->>'restocked')::numeric, 0), 'RECEIVED_FROM_STORE'
FROM public.canonical_operational_records
WHERE entity_type = 'bar' AND (data->>'restocked')::numeric > 0
UNION ALL
SELECT
  id, created_at, (data->>'date')::date, 'BAR', data->>'item_name',
  -COALESCE((data->>'sold')::numeric, 0), 'SOLD'
FROM public.canonical_operational_records
WHERE entity_type = 'bar' AND (data->>'sold')::numeric > 0
UNION ALL
SELECT
  id, created_at, (data->>'date')::date, 'KITCHEN', data->>'item_name',
  COALESCE((data->>'restocked')::numeric, 0), 'RECEIVED_FROM_STORE'
FROM public.canonical_operational_records
WHERE entity_type = 'kitchen' AND (data->>'restocked')::numeric > 0
UNION ALL
SELECT
  id, created_at, (data->>'date')::date, 'KITCHEN', data->>'item_name',
  -COALESCE((data->>'sold')::numeric, 0), 'CONSUMED'
FROM public.canonical_operational_records
WHERE entity_type = 'kitchen' AND (data->>'sold')::numeric > 0;

GRANT SELECT ON public.v_inventory_ledger TO authenticated;

-- 0.3 Current Inventory View (from Migration 0016)
CREATE OR REPLACE VIEW public.v_current_inventory AS
SELECT
  department,
  item_name,
  SUM(quantity_change) AS current_stock
FROM public.v_inventory_ledger
GROUP BY department, item_name;

GRANT SELECT ON public.v_current_inventory TO authenticated;

-- 0.4 Helper: Get Inventory Opening at Date (from Migration 0016)
CREATE OR REPLACE FUNCTION public.get_inventory_opening_at_date(_department text, _date date)
RETURNS TABLE (item_name text, opening_stock numeric) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.item_name,
    COALESCE(SUM(l.quantity_change), 0)
  FROM public.v_inventory_ledger l
  WHERE l.department = _department
    AND l.event_date < _date
  GROUP BY l.item_name;
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- 1. Live Inventory View
-- ==========================================
-- Combines the calculated current stock (from ledger) with catalog metadata.
-- This gives a complete picture of stock levels across all departments with item details.
CREATE OR REPLACE VIEW public.v_live_inventory AS
SELECT
  cur.department,
  cur.item_name,
  cur.current_stock,
  cat.unit,
  cat.category,
  cat.collection_name,
  -- Simple status based on stock level (can be enhanced with reorder levels later)
  CASE
    WHEN cur.current_stock <= 0 THEN 'OUT_OF_STOCK'
    WHEN cur.current_stock < 10 THEN 'LOW_STOCK' -- Placeholder threshold
    ELSE 'IN_STOCK'
  END AS stock_status
FROM public.v_current_inventory cur
LEFT JOIN public.inventory_catalog_view cat ON cat.item_name = cur.item_name;

GRANT SELECT ON public.v_live_inventory TO authenticated;

-- ==========================================
-- 2. Inventory History RPC
-- ==========================================
-- Calculates stock levels for each day in a given range for a specific department.
-- Useful for generating charts and historical reports.
CREATE OR REPLACE FUNCTION public.get_inventory_daily_history(
  _department text,
  _start_date date,
  _end_date date
)
RETURNS TABLE (
  date date,
  item_name text,
  stock_level numeric,
  daily_change numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  RETURN QUERY
  WITH date_series AS (
    SELECT d::date AS val
    FROM generate_series(_start_date, _end_date, '1 day'::interval) d
  ),
  -- Get daily changes from the ledger
  daily_changes AS (
    SELECT
      l.event_date,
      l.item_name,
      SUM(l.quantity_change) AS change
    FROM public.v_inventory_ledger l
    WHERE l.department = _department
    GROUP BY l.event_date, l.item_name
  ),
  -- Get list of items that have ever had activity in this department
  dept_items AS (
    SELECT DISTINCT l.item_name
    FROM public.v_inventory_ledger l
    WHERE l.department = _department
  )
  SELECT
    ds.val AS date,
    i.item_name,
    -- Calculate cumulative stock up to the specific date
    (
      SELECT COALESCE(SUM(l2.quantity_change), 0)
      FROM public.v_inventory_ledger l2
      WHERE l2.department = _department
        AND l2.item_name = i.item_name
        AND l2.event_date <= ds.val
    ) AS stock_level,
    COALESCE(dc.change, 0) AS daily_change
  FROM date_series ds
  CROSS JOIN dept_items i
  LEFT JOIN daily_changes dc ON dc.event_date = ds.val AND dc.item_name = i.item_name
  ORDER BY ds.val ASC, i.item_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_inventory_daily_history(text, date, date) TO PUBLIC;
