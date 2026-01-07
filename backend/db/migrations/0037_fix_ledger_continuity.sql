-- Migration 0037: Fix Daily Ledger Continuity
-- Objective: Ensure "Opening Stock (Day N) = Closing Stock (Day N-1)" for ALL departments.
-- This removes any reliance on "Store Stock" for Bar/Kitchen opening balances, 
-- enforcing independent ledgers for Bar and Kitchen that persist across days.

-- 1. Update Inventory Ledger View to explicitly include Opening Stock events for Bar and Kitchen
-- Previously, only Storekeeper had 'OPENING_STOCK'. Now we allow all entities to have genesis events.
DROP VIEW IF EXISTS public.v_inventory_ledger CASCADE; 

CREATE OR REPLACE VIEW public.v_inventory_ledger AS
-- Storekeeper Opening Stock (Genesis)
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
  submitted_by
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'opening_stock'

UNION ALL

-- Storekeeper Restock (From Supplier)
SELECT
  id, created_at, (data->>'date')::date, 'STORE', data->>'item_name',
  COALESCE((data->>'quantity')::numeric, 0), 'SUPPLIER_RESTOCK',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'stock_restock'

UNION ALL

-- Storekeeper Issued (To Departments)
SELECT
  id, created_at, (data->>'date')::date, 'STORE', data->>'item_name',
  -COALESCE((data->>'quantity')::numeric, 0), 'ISSUED_TO_DEPT',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'stock_issued'

UNION ALL

-- Bar Opening Stock (Genesis/Reset)
SELECT
  id, created_at, (data->>'date')::date, 'BAR', data->>'item_name',
  COALESCE((data->>'opening_stock')::numeric, 0), 'OPENING_STOCK',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by
FROM public.canonical_operational_records
WHERE entity_type = 'bar' AND data->>'type' = 'opening_stock'

UNION ALL

-- Bar Restock (Received from Store)
SELECT
  id, created_at, (data->>'date')::date, 'BAR', data->>'item_name',
  COALESCE((data->>'restocked')::numeric, 0), 'RECEIVED_FROM_STORE',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by
FROM public.canonical_operational_records
WHERE entity_type = 'bar' AND (data->>'restocked')::numeric > 0

UNION ALL

-- Bar Sold
SELECT
  id, created_at, (data->>'date')::date, 'BAR', data->>'item_name',
  -COALESCE((data->>'sold')::numeric, 0), 'SOLD',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by
FROM public.canonical_operational_records
WHERE entity_type = 'bar' AND (data->>'sold')::numeric > 0

UNION ALL

-- Kitchen Opening Stock (Genesis/Reset)
SELECT
  id, created_at, (data->>'date')::date, 'KITCHEN', data->>'item_name',
  COALESCE((data->>'opening_stock')::numeric, 0), 'OPENING_STOCK',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by
FROM public.canonical_operational_records
WHERE entity_type = 'kitchen' AND data->>'type' = 'opening_stock'

UNION ALL

-- Kitchen Restock (Received from Store)
SELECT
  id, created_at, (data->>'date')::date, 'KITCHEN', data->>'item_name',
  COALESCE((data->>'restocked')::numeric, 0), 'RECEIVED_FROM_STORE',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by
FROM public.canonical_operational_records
WHERE entity_type = 'kitchen' AND (data->>'restocked')::numeric > 0

UNION ALL

-- Kitchen Consumed
SELECT
  id, created_at, (data->>'date')::date, 'KITCHEN', data->>'item_name',
  -COALESCE((data->>'sold')::numeric, 0), 'CONSUMED',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by
FROM public.canonical_operational_records
WHERE entity_type = 'kitchen' AND (data->>'sold')::numeric > 0;

GRANT SELECT ON public.v_inventory_ledger TO authenticated;

-- 2. Re-create Helper: Get Inventory Opening at Date
-- (Definition remains same, but now it queries the expanded v_inventory_ledger)
CREATE OR REPLACE FUNCTION public.get_inventory_opening_at_date(_department text, _date date)
RETURNS TABLE (item_name text, opening_stock numeric) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.item_name,
    COALESCE(SUM(l.quantity_change), 0)
  FROM public.v_inventory_ledger l
  WHERE l.department = _department
    AND (
      l.event_date < _date
      OR (l.event_type = 'OPENING_STOCK' AND l.event_date = _date)
    )
  GROUP BY l.item_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_inventory_opening_at_date TO authenticated;

-- 3. Update get_expected_opening_stock to use strict ledger continuity for ALL roles
-- This replaces the logic that forced Bar/Kitchen to view Store Stock.
-- Now, Bar/Kitchen Opening Stock is purely the result of their own historical transactions.
CREATE OR REPLACE FUNCTION public.get_expected_opening_stock(_role text, _item_name text, _report_date date DEFAULT CURRENT_DATE)
RETURNS numeric AS $$
DECLARE
  _val numeric;
  _dept text;
BEGIN
  -- Map Role to Department
  IF _role = 'storekeeper' THEN
    _dept := 'STORE';
  ELSIF _role = 'bar' THEN
    _dept := 'BAR';
  ELSIF _role = 'kitchen' THEN
    _dept := 'KITCHEN';
  ELSE
    _dept := 'STORE';
  END IF;

  -- Calculate Opening Stock from Ledger
  -- This sums all events strictly BEFORE the report date (plus any genesis events on that date).
  -- This guarantees: Opening(T) = Closing(T-1)
  SELECT opening_stock INTO _val
  FROM public.get_inventory_opening_at_date(_dept, _report_date)
  WHERE item_name = _item_name;

  RETURN COALESCE(_val, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 4. Batch function update
CREATE OR REPLACE FUNCTION public.get_expected_opening_stock_batch(_role text, _report_date date DEFAULT CURRENT_DATE)
RETURNS TABLE (item_name text, opening_stock numeric) AS $$
DECLARE
  _dept text;
BEGIN
  IF _role = 'storekeeper' THEN _dept := 'STORE';
  ELSIF _role = 'bar' THEN _dept := 'BAR';
  ELSIF _role = 'kitchen' THEN _dept := 'KITCHEN';
  ELSE _dept := 'STORE';
  END IF;

  RETURN QUERY SELECT * FROM public.get_inventory_opening_at_date(_dept, _report_date);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5. Restore Inventory Catalog View to be Global Store Stock (Standard)
-- This view is used for "Availability", not for "My Current Stock".
-- We need to ensure it uses the 'STORE' ledger.
-- (This was already doing so in 0026, but we confirm here to be safe)
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

GRANT SELECT ON public.inventory_catalog_view TO authenticated;
