-- Migration 0051: Phase 3 - Update Inventory Catalog View and Logic
-- Switches inventory_catalog_view to use inventory_items and v_inventory_ledger.
-- Updates get_daily_stock_sheet to use inventory_items for pricing.

-- 1. Drop dependent views
DROP VIEW IF EXISTS public.v_live_inventory;
DROP VIEW IF EXISTS public.inventory_catalog_view;

-- 2. Recreate Inventory Catalog View
-- Uses inventory_items for metadata and v_current_inventory (STORE department) for stock.
-- This view represents the "Master Catalog" with Store stock levels.
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

-- 2.5 Recreate Current Inventory View
-- Ensures v_current_inventory exists and is up-to-date with v_inventory_ledger changes
CREATE OR REPLACE VIEW public.v_current_inventory AS
SELECT
  department,
  item_name,
  SUM(quantity_change) AS current_stock
FROM public.v_inventory_ledger
GROUP BY department, item_name;

GRANT SELECT ON public.v_current_inventory TO authenticated;

-- 3. Recreate Live Inventory View
-- Combines current inventory (per department) with catalog metadata.
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

-- 4. Update get_daily_stock_sheet to use new view and unit_price
-- This removes dependency on legacy operational_records for item pricing.
DROP FUNCTION IF EXISTS public.get_daily_stock_sheet(text, text, date);
CREATE OR REPLACE FUNCTION public.get_daily_stock_sheet(_role text, _category text, _report_date date DEFAULT CURRENT_DATE)
RETURNS TABLE(item_name text, unit text, unit_price numeric, opening_stock numeric, collection_name text) AS $$
BEGIN
  IF _role = 'storekeeper' THEN
    -- For Storekeeper, opening stock comes from the Ledger
    RETURN QUERY
    SELECT 
      i.item_name::text,
      i.unit::text,
      i.unit_price::numeric,
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
      i.unit_price::numeric,
      public.get_expected_opening_stock(_role, i.item_name, _report_date) AS opening_stock,
      i.collection_name::text
    FROM public.inventory_catalog_view i
    WHERE lower(i.category) = lower(_category)
    ORDER BY i.item_name;
  END IF;
END;
$$ LANGUAGE plpgsql;
