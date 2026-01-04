-- Migration 0026: Enforce Inventory Rules, Global Catalogue, and History
-- Implements stricter inventory logic, global catalogue aggregation, and history views.

-- 1. Enhance Inventory Ledger View to include Price, Value, and Staff
-- This view remains the source of truth for "What happened to the stock".
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

-- Bar Restock (Received from Store)
SELECT
  id, created_at, (data->>'date')::date, 'BAR', data->>'item_name',
  COALESCE((data->>'restocked')::numeric, 0), 'RECEIVED_FROM_STORE',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric, -- Note: Usually 0 cost for internal transfer if not tracking transfer price
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

-- 1.1 Helper: Get Inventory Opening at Date
-- Calculates stock level strictly BEFORE the given date.
-- EXCEPTION: "OPENING_STOCK" events (Genesis/Reset) occurring ON the date are included,
-- as they represent the starting state for that day.
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_inventory_opening_at_date TO authenticated;

-- 2. Redefine Inventory Catalog View to be Global Aggregate
-- "Inventory Catalogue represents the global, authoritative stock quantity per item"
-- "Inventory Catalogue = Sum of All Ledger Changes"

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

-- 3. Function to Enforce Opening Stock Rules (Rule A & Rule B)
CREATE OR REPLACE FUNCTION public.get_expected_opening_stock(_role text, _item_name text, _report_date date DEFAULT CURRENT_DATE)
RETURNS numeric AS $$
DECLARE
  _last_closing numeric;
  _global_stock numeric;
BEGIN
  -- Rule B: Check for previous approved record for this role BEFORE or ON the report date
  -- We want the latest record that is chronologically before the one we are creating.
  -- Since we only have the date of the new report, we look for records with date < report_date
  -- OR date = report_date (earlier shifts).
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_expected_opening_stock TO authenticated;

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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_expected_opening_stock_batch TO authenticated;

-- 4. History View for UI
-- "History must include: Date, Item, Category, Opening, In, Out, Closing, Price, Value, Staff"
-- Filtered by RLS policies on the underlying table, but we provide a flattened view.

CREATE OR REPLACE VIEW public.v_stock_history AS
SELECT
  r.id,
  r.entity_type AS role,
  (r.data->>'date')::date AS date,
  r.data->>'item_name' AS item_name,
  -- We need category. Join with config_items? Or rely on what's in data if saved?
  -- Assuming frontend might filter by category, but we can try to join.
  -- For performance, let's look up category from the config_item records.
  (
    SELECT COALESCE(data->>'category', data->>'category_name')
    FROM public.canonical_operational_records ci
    WHERE ci.entity_type = 'storekeeper' 
      AND data->>'type' = 'config_item' 
      AND data->>'item_name' = r.data->>'item_name'
    LIMIT 1
  ) AS category,
  (r.data->>'opening_stock')::numeric AS opening_stock,
  -- Quantity In (Restocked)
  CASE 
    WHEN r.entity_type = 'storekeeper' AND r.data->>'type' = 'stock_restock' THEN (r.data->>'quantity')::numeric
    WHEN r.entity_type IN ('kitchen', 'bar') THEN (r.data->>'restocked')::numeric
    ELSE 0
  END AS quantity_in,
  -- Quantity Out (Sold/Issued)
  CASE 
    WHEN r.entity_type = 'storekeeper' AND r.data->>'type' = 'stock_issued' THEN (r.data->>'quantity')::numeric
    WHEN r.entity_type IN ('kitchen', 'bar') THEN (r.data->>'sold')::numeric
    ELSE 0
  END AS quantity_out,
  (r.data->>'closing_stock')::numeric AS closing_stock,
  (r.data->>'unit_price')::numeric AS unit_price,
  (r.data->>'total_amount')::numeric AS total_value,
  COALESCE(r.data->>'staff_name', 'System') AS staff_name,
  r.status,
  r.created_at,
  r.submitted_by
FROM public.operational_records r
WHERE r.entity_type IN ('kitchen', 'bar', 'storekeeper')
  AND r.data->>'item_name' IS NOT NULL; -- Filter out config records

GRANT SELECT ON public.v_stock_history TO authenticated;

-- 5. Trigger to Enforce Opening Stock on Insert (Consistency Hardening)
-- "Submitted quantities must... Be used as opening stock for next record"
-- This trigger ensures that the 'opening_stock' submitted matches the system expectation.
-- However, strict enforcement might block submission if frontend is stale.
-- We will OVERRIDE the opening_stock to be correct, ensuring the chain is unbroken.

CREATE OR REPLACE FUNCTION public.enforce_opening_stock_chain()
RETURNS TRIGGER AS $$
DECLARE
  _expected numeric;
  _role text;
  _item text;
BEGIN
  -- Only apply to stock records (kitchen, bar, storekeeper daily reports)
  IF NEW.entity_type NOT IN ('kitchen', 'bar', 'storekeeper') THEN
    RETURN NEW;
  END IF;
  
  -- Check if it's a stock record (has item_name and numbers)
  _item := NEW.data->>'item_name';
  IF _item IS NULL THEN
    RETURN NEW;
  END IF;

  _role := NEW.entity_type::text;
  
  -- Calculate expected opening stock
  -- Note: We must exclude THIS record if it's an update, but this is INSERT/UPDATE trigger.
  -- For INSERT, no prev record with same ID.
  -- For UPDATE, we might need to be careful.
  -- Ideally, opening stock is fixed at creation.
  
  -- Get expected opening (Rule A/B)
  _expected := public.get_expected_opening_stock(_role, _item, (NEW.data->>'date')::date);
  
  IF _role IN ('kitchen', 'bar') THEN
     NEW.data = jsonb_set(NEW.data, '{opening_stock}', to_jsonb(_expected));
     NEW.data = jsonb_set(NEW.data, '{closing_stock}', to_jsonb(
       _expected + 
       COALESCE((NEW.data->>'restocked')::numeric, 0) - 
       COALESCE((NEW.data->>'sold')::numeric, 0)
     ));
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Register Trigger
DROP TRIGGER IF EXISTS trg_enforce_opening_stock ON public.operational_records;

CREATE TRIGGER trg_enforce_opening_stock
BEFORE INSERT ON public.operational_records
FOR EACH ROW
EXECUTE FUNCTION public.enforce_opening_stock_chain();

-- 3.1 Get Daily Stock Sheet (Optimized)
-- Returns items for a category with their computed opening stock for the given date.
-- Reduces frontend network waterfall.
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_daily_stock_sheet TO authenticated;

