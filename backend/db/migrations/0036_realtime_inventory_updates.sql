-- Migration 0036: Real-time Inventory Updates
-- Addresses:
-- 1. Bar/Kitchen "Opening Stock" must reflect REAL-TIME availability (Current Store Stock) for Today.
-- 2. Removes the logic that added "Dept Restock" to "Store Stock", which caused double counting and confusion.
-- 3. Preserves historical behavior (00:00 Stock) for past dates.

CREATE OR REPLACE FUNCTION public.get_expected_opening_stock(_role text, _item_name text, _report_date date DEFAULT CURRENT_DATE)
RETURNS numeric AS $$
DECLARE
  _val numeric;
BEGIN
  IF _role = 'storekeeper' THEN
    -- Storekeeper always sees 00:00 Opening Stock for the day (Ledger based)
    SELECT opening_stock INTO _val
    FROM public.get_inventory_opening_at_date('STORE', _report_date)
    WHERE item_name = _item_name;
    RETURN COALESCE(_val, 0);
  ELSE
    -- Bar/Kitchen Logic
    IF _report_date >= CURRENT_DATE THEN
       -- REAL-TIME: Return Current Global Stock from Catalog
       -- This ensures that if Storekeeper issues stock NOW, Bar/Kitchen see the change immediately.
       SELECT current_stock INTO _val
       FROM public.inventory_catalog_view
       WHERE item_name = _item_name;
       RETURN COALESCE(_val, 0);
    ELSE
       -- HISTORY: Return Store Opening Stock at that date (Stock at 00:00)
       -- This preserves the "Reference" value for historical reports.
       SELECT opening_stock INTO _val
       FROM public.get_inventory_opening_at_date('STORE', _report_date)
       WHERE item_name = _item_name;
       RETURN COALESCE(_val, 0);
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
