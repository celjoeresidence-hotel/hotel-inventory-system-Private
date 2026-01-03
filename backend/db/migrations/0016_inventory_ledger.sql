-- Migration 0016: Inventory Ledger and Views
-- Standardize inventory tracking across Store, Bar, and Kitchen using immutable ledger events.

-- 1. Inventory Ledger View
-- Unifies all stock-affecting events into a single linear history.
CREATE OR REPLACE VIEW public.v_inventory_ledger AS
-- Storekeeper Opening Stock (Genesis)
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

-- Storekeeper Restock (From Supplier)
SELECT
  id, created_at, (data->>'date')::date, 'STORE', data->>'item_name',
  COALESCE((data->>'quantity')::numeric, 0), 'SUPPLIER_RESTOCK'
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'stock_restock'

UNION ALL

-- Storekeeper Issued (To Departments)
SELECT
  id, created_at, (data->>'date')::date, 'STORE', data->>'item_name',
  -COALESCE((data->>'quantity')::numeric, 0), 'ISSUED_TO_DEPT'
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'stock_issued'

UNION ALL

-- Bar Restock (Received from Store)
SELECT
  id, created_at, (data->>'date')::date, 'BAR', data->>'item_name',
  COALESCE((data->>'restocked')::numeric, 0), 'RECEIVED_FROM_STORE'
FROM public.canonical_operational_records
WHERE entity_type = 'bar' AND (data->>'restocked')::numeric > 0

UNION ALL

-- Bar Sold
SELECT
  id, created_at, (data->>'date')::date, 'BAR', data->>'item_name',
  -COALESCE((data->>'sold')::numeric, 0), 'SOLD'
FROM public.canonical_operational_records
WHERE entity_type = 'bar' AND (data->>'sold')::numeric > 0

UNION ALL

-- Kitchen Restock (Received from Store)
SELECT
  id, created_at, (data->>'date')::date, 'KITCHEN', data->>'item_name',
  COALESCE((data->>'restocked')::numeric, 0), 'RECEIVED_FROM_STORE'
FROM public.canonical_operational_records
WHERE entity_type = 'kitchen' AND (data->>'restocked')::numeric > 0

UNION ALL

-- Kitchen Consumed
SELECT
  id, created_at, (data->>'date')::date, 'KITCHEN', data->>'item_name',
  -COALESCE((data->>'sold')::numeric, 0), 'CONSUMED'
FROM public.canonical_operational_records
WHERE entity_type = 'kitchen' AND (data->>'sold')::numeric > 0;

-- 2. Current Inventory View
-- Aggregates the ledger to show current stock levels per department.
CREATE OR REPLACE VIEW public.v_current_inventory AS
SELECT
  department,
  item_name,
  SUM(quantity_change) AS current_stock
FROM public.v_inventory_ledger
GROUP BY department, item_name;

-- 3. Helper Function: Get Inventory at Start of Date (Opening Stock)
-- Returns the stock level strictly BEFORE the given date.
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

-- 4. Grant Permissions
GRANT SELECT ON public.v_inventory_ledger TO authenticated;
GRANT SELECT ON public.v_current_inventory TO authenticated;
