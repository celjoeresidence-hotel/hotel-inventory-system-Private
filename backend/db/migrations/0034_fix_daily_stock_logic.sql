-- Migration 0034: Fix Daily Stock Logic and Forms
-- Addresses:
-- 1. Bar/Kitchen Opening = Storekeeper Closing + Dept Restock
-- 2. Exposes daily totals to frontend to allow "Delta Input" mode (clearing inputs after submit)

-- 1. Helper to get daily totals for an item
CREATE OR REPLACE FUNCTION public.get_daily_item_totals(_department text, _item_name text, _date date)
RETURNS TABLE (total_in numeric, total_out numeric) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE 
      WHEN event_type IN ('SUPPLIER_RESTOCK', 'RECEIVED_FROM_STORE') THEN quantity_change 
      ELSE 0 
    END), 0) AS total_in,
    COALESCE(ABS(SUM(CASE 
      WHEN event_type IN ('ISSUED_TO_DEPT', 'SOLD', 'CONSUMED') THEN quantity_change 
      ELSE 0 
    END)), 0) AS total_out
  FROM public.v_inventory_ledger
  WHERE department = _department
    AND item_name = _item_name
    AND event_date = _date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 2. Updated Expected Opening Stock Logic
-- Bar/Kitchen Opening = Storekeeper Current Stock (Global Availability) + Respective Dept Restock (Today)
CREATE OR REPLACE FUNCTION public.get_expected_opening_stock(_role text, _item_name text, _report_date date DEFAULT CURRENT_DATE)
RETURNS numeric AS $$
DECLARE
  _store_stock numeric;
  _dept_restock numeric;
BEGIN
  IF _role = 'storekeeper' THEN
    -- Storekeeper Opening is simply the ledger opening at date
    SELECT opening_stock INTO _store_stock
    FROM public.get_inventory_opening_at_date('STORE', _report_date)
    WHERE item_name = _item_name;
    RETURN COALESCE(_store_stock, 0);
  ELSE
    -- Bar/Kitchen Rule: Opening = Storekeeper Closing + Dept Restock
    -- 1. Get Storekeeper Current Stock (from Catalog View which is Store Stock)
    SELECT current_stock INTO _store_stock
    FROM public.inventory_catalog_view
    WHERE item_name = _item_name;
    
    -- 2. Get Dept Restock for Today
    -- Note: We use the _role to determine department ('bar' -> 'BAR', 'kitchen' -> 'KITCHEN')
    SELECT total_in INTO _dept_restock
    FROM public.get_daily_item_totals(
      CASE WHEN _role = 'bar' THEN 'BAR' ELSE 'KITCHEN' END,
      _item_name,
      _report_date
    );

    RETURN COALESCE(_store_stock, 0) + COALESCE(_dept_restock, 0);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 3. Updated Daily Stock Sheet to include DB Totals
DROP FUNCTION IF EXISTS public.get_daily_stock_sheet(text, text, date);

CREATE OR REPLACE FUNCTION public.get_daily_stock_sheet(_role text, _category text, _report_date date DEFAULT CURRENT_DATE)
RETURNS TABLE(
  item_name text, 
  unit text, 
  unit_price numeric, 
  opening_stock numeric, 
  stock_in_db numeric, 
  stock_out_db numeric, 
  collection_name text
) AS $$
DECLARE
  _dept text;
BEGIN
  _dept := CASE 
    WHEN _role = 'storekeeper' THEN 'STORE'
    WHEN _role = 'bar' THEN 'BAR'
    WHEN _role = 'kitchen' THEN 'KITCHEN'
    ELSE 'STORE'
  END;

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
    COALESCE(dt.total_in, 0) AS stock_in_db,
    COALESCE(dt.total_out, 0) AS stock_out_db,
    i.collection_name::text
  FROM public.inventory_catalog_view i
  LEFT JOIN LATERAL public.get_daily_item_totals(_dept, i.item_name, _report_date) dt ON true
  WHERE lower(i.category) = lower(_category)
  ORDER BY i.item_name;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Grant permissions
GRANT EXECUTE ON FUNCTION public.get_daily_item_totals TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_expected_opening_stock TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_stock_sheet TO authenticated;
