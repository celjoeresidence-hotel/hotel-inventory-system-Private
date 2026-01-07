-- Migration 0032: Fix Inventory Source of Truth and Search Paths
-- Consolidates fixes for inventory catalogue source of truth and mutable search paths.

-- 1. Helper: Get Inventory Opening at Date
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

-- 2. Redefine Inventory Catalog View to be Global Aggregate (STORE ONLY)
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

-- 3. Function to Enforce Opening Stock Rules (Rule A & Rule B)
CREATE OR REPLACE FUNCTION public.get_expected_opening_stock(_role text, _item_name text, _report_date date DEFAULT CURRENT_DATE)
RETURNS numeric AS $$
DECLARE
  _last_closing numeric;
  _global_stock numeric;
BEGIN
  -- Rule B: Check for previous approved record for this role BEFORE or ON the report date
  SELECT (data->>'closing_stock')::numeric
  INTO _last_closing
  FROM public.canonical_operational_records
  WHERE entity_type::text = _role
    AND data->>'item_name' = _item_name
    AND (data->>'date')::date <= _report_date
  ORDER BY (data->>'date')::date DESC, created_at DESC
  LIMIT 1;

  IF _last_closing IS NOT NULL THEN
    RETURN _last_closing;
  END IF;

  SELECT current_stock
  INTO _global_stock
  FROM public.inventory_catalog_view
  WHERE item_name = _item_name
  LIMIT 1;

  RETURN COALESCE(_global_stock, 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3.1 Batch Function for Frontend Efficiency
CREATE OR REPLACE FUNCTION public.get_expected_opening_stock_batch(_role text, _report_date date DEFAULT CURRENT_DATE)
RETURNS TABLE (item_name text, opening_stock numeric) AS $$
BEGIN
  IF _role = 'storekeeper' THEN
    -- For Storekeeper, use the Ledger (accumulated history) for efficiency
    RETURN QUERY SELECT * FROM public.get_inventory_opening_at_date('STORE', _report_date);
  ELSE
    -- For Kitchen/Bar, use the Rule A/B logic per item
    RETURN QUERY
    SELECT
      i.item_name::text,
      public.get_expected_opening_stock(_role, i.item_name, _report_date)
    FROM public.inventory_catalog_view i;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3.1 Get Daily Stock Sheet (Optimized)
CREATE OR REPLACE FUNCTION public.get_daily_stock_sheet(_role text, _category text, _report_date date DEFAULT CURRENT_DATE)
RETURNS TABLE(item_name text, unit text, unit_price numeric, opening_stock numeric, collection_name text) AS $$
BEGIN
  IF _role = 'storekeeper' THEN
    -- For Storekeeper, opening stock comes from the Ledger
    RETURN QUERY
    SELECT 
      i.item_name::text,
      i.unit::text,
      (
        SELECT (data->>'unit_price')::numeric 
        FROM public.canonical_operational_records ci
        WHERE ci.entity_type = 'storekeeper' 
        AND ci.data->>'type' = 'config_item' 
        AND ci.data->>'item_name' = i.item_name
        LIMIT 1
      ) AS unit_price,
      COALESCE(os.opening_stock, 0) AS opening_stock,
      i.collection_name::text
    FROM public.inventory_catalog_view i
    LEFT JOIN public.get_inventory_opening_at_date('STORE', _report_date) os ON os.item_name = i.item_name
    WHERE lower(i.category) = lower(_category)
    ORDER BY i.item_name;
  ELSE
    -- For Kitchen/Bar, opening stock comes from previous closing (Rule B)
    RETURN QUERY
    SELECT 
      i.item_name::text,
      i.unit::text,
      (
        SELECT (data->>'unit_price')::numeric 
        FROM public.canonical_operational_records ci
        WHERE ci.entity_type = 'storekeeper' 
        AND ci.data->>'type' = 'config_item' 
        AND ci.data->>'item_name' = i.item_name
        LIMIT 1
      ) AS unit_price,
      public.get_expected_opening_stock(_role, i.item_name, _report_date) AS opening_stock,
      i.collection_name::text
    FROM public.inventory_catalog_view i
    WHERE lower(i.category) = lower(_category)
    ORDER BY i.item_name;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Ensure permissions
GRANT SELECT ON public.inventory_catalog_view TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_inventory_opening_at_date TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_expected_opening_stock TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_expected_opening_stock_batch TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_stock_sheet TO authenticated;
