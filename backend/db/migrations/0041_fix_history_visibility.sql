-- Migration 0041: Fix History Visibility for Bar/Kitchen
-- Objective: Ensure Bar/Kitchen History reflects the "Store Source of Truth" logic.
-- Since Bar/Kitchen Opening Stock is now derived dynamically from Store, 
-- their history view must explicitly include this "derived" starting point
-- so that the history list is not empty or misleading.

-- 1. Redefine v_inventory_history to inject the "Starting Point" for Bar/Kitchen
-- We do this by unioning the Store's Closing Stock (as of yesterday/genesis) 
-- into the Bar/Kitchen history as a virtual 'OPENING_STOCK' event.

DROP VIEW IF EXISTS public.v_inventory_history CASCADE;

CREATE OR REPLACE VIEW public.v_inventory_history AS
WITH 
-- 1. Standard Ledger (Store Events + Bar/Kitchen Movements)
base_ledger AS (
  SELECT
    l.record_id,
    l.created_at,
    l.event_date,
    l.department,
    l.item_name,
    l.event_type,
    l.quantity_change,
    l.unit_price,
    l.total_value,
    l.staff_name,
    l.submitted_by
  FROM public.v_inventory_ledger l
),
-- 2. Virtual Opening Stock for Bar/Kitchen (Derived from Store)
-- We calculate the "Initial State" for Bar/Kitchen as the current Store Stock.
-- To make it appear correctly in history, we give it a very old date (Genesis)
-- or simply treat it as the "Base" for the window function.
virtual_opening AS (
  SELECT
    gen_random_uuid() AS record_id,
    '2024-01-01 00:00:00+00'::timestamptz AS created_at,
    '2024-01-01'::date AS event_date,
    dept AS department,
    gs.item_name,
    'OPENING_STOCK' AS event_type,
    gs.current_stock AS quantity_change, -- The "Opening" amount
    (SELECT (data->>'unit_price')::numeric FROM public.canonical_operational_records WHERE data->>'item_name' = gs.item_name LIMIT 1) AS unit_price,
    0 AS total_value, -- Informational only
    'System' AS staff_name,
    NULL::uuid AS submitted_by
  FROM (
    -- Get current store stock per item
    SELECT item_name, SUM(quantity_change) as current_stock
    FROM public.v_inventory_ledger
    WHERE department = 'STORE'
    GROUP BY item_name
  ) gs
  CROSS JOIN (VALUES ('BAR'), ('KITCHEN')) AS d(dept)
  WHERE gs.current_stock > 0 -- Only show if there is stock
),
-- 3. Combine Real + Virtual
combined_ledger AS (
  SELECT * FROM base_ledger
  UNION ALL
  SELECT * FROM virtual_opening
),
-- 4. Calculate Running Totals
running_ledger AS (
  SELECT
    cl.record_id,
    cl.created_at,
    cl.event_date,
    cl.department,
    cl.item_name,
    cl.event_type,
    cl.quantity_change,
    COALESCE(cl.unit_price, 0) as unit_price,
    COALESCE(cl.total_value, 0) as total_value,
    cl.staff_name,
    cl.submitted_by,
    SUM(cl.quantity_change) OVER (
      PARTITION BY cl.department, cl.item_name 
      ORDER BY cl.event_date ASC, cl.created_at ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS closing_stock
  FROM combined_ledger cl
),
item_meta AS (
  -- Reusing logic from inventory_catalog_view for metadata
  SELECT DISTINCT
    rit.data->>'item_name' AS item_name,
    rit.data->>'collection_name' AS collection,
    COALESCE(rit.data->>'category_name', rit.data->>'category') AS category,
    rit.data->>'unit' AS unit
  FROM public.canonical_operational_records rit
  WHERE rit.entity_type = 'storekeeper'
    AND lower(COALESCE(rit.data->>'type', rit.data->>'record_type')) = 'config_item'
)
SELECT
  rl.record_id,
  rl.created_at,
  rl.event_date,
  rl.department,
  rl.item_name,
  COALESCE(im.category, 'Uncategorized') AS category,
  COALESCE(im.collection, 'General') AS collection,
  COALESCE(im.unit, 'Unit') AS unit,
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


-- 2. Restore RPC Functions (dropped by CASCADE)

-- 2.1 get_inventory_history
CREATE OR REPLACE FUNCTION public.get_inventory_history(
  _role text,
  _start_date text DEFAULT NULL,
  _end_date text DEFAULT NULL,
  _search text DEFAULT NULL,
  _category text DEFAULT NULL,
  _event_type text DEFAULT NULL,
  _page int DEFAULT 1,
  _page_size int DEFAULT 50
)
RETURNS TABLE (
  record_id text,
  created_at timestamptz,
  event_date date,
  department text,
  item_name text,
  category text,
  collection text,
  unit text,
  event_type text,
  quantity_change numeric,
  opening_stock numeric,
  closing_stock numeric,
  unit_price numeric,
  total_value numeric,
  staff_name text,
  submitted_by text,
  total_count bigint
) AS $$
DECLARE
  _dept text;
  _offset int;
BEGIN
  -- RBAC / Department Mapping
  IF _role = 'storekeeper' THEN _dept := 'STORE';
  ELSIF _role = 'bar' THEN _dept := 'BAR';
  ELSIF _role = 'kitchen' THEN _dept := 'KITCHEN';
  ELSE RAISE EXCEPTION 'Invalid Role';
  END IF;

  _offset := (_page - 1) * _page_size;

  RETURN QUERY
  WITH filtered AS (
    SELECT *
    FROM public.v_inventory_history h
    WHERE h.department = _dept
      AND (_start_date IS NULL OR h.event_date >= _start_date::date)
      AND (_end_date IS NULL OR h.event_date <= _end_date::date)
      AND (_category IS NULL OR h.category = _category)
      AND (_event_type IS NULL OR h.event_type = _event_type)
      AND (_search IS NULL OR 
           h.item_name ILIKE '%' || _search || '%' OR 
           h.staff_name ILIKE '%' || _search || '%')
  )
  SELECT
    f.record_id::text,
    f.created_at,
    f.event_date,
    f.department,
    f.item_name,
    f.category,
    f.collection,
    f.unit,
    f.event_type,
    f.quantity_change,
    f.opening_stock,
    f.closing_stock,
    f.unit_price,
    f.total_value,
    f.staff_name,
    f.submitted_by,
    (SELECT COUNT(*) FROM filtered)::bigint AS total_count
  FROM filtered f
  ORDER BY f.event_date DESC, f.created_at DESC
  LIMIT _page_size OFFSET _offset;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_inventory_history TO authenticated;

-- 2.2 get_inventory_history_stats
CREATE OR REPLACE FUNCTION public.get_inventory_history_stats(
  _role text,
  _start_date text DEFAULT NULL,
  _end_date text DEFAULT NULL,
  _search text DEFAULT NULL,
  _category text DEFAULT NULL,
  _event_type text DEFAULT NULL
)
RETURNS TABLE (
  total_restocked numeric,
  total_issued_sold numeric,
  net_value_change numeric
) AS $$
DECLARE
  _dept text;
BEGIN
  IF _role = 'storekeeper' THEN _dept := 'STORE';
  ELSIF _role = 'bar' THEN _dept := 'BAR';
  ELSIF _role = 'kitchen' THEN _dept := 'KITCHEN';
  ELSE RAISE EXCEPTION 'Invalid Role';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(SUM(CASE WHEN h.quantity_change > 0 THEN h.quantity_change ELSE 0 END), 0) AS total_restocked,
    COALESCE(ABS(SUM(CASE WHEN h.quantity_change < 0 THEN h.quantity_change ELSE 0 END)), 0) AS total_issued_sold,
    COALESCE(SUM(h.total_value), 0) AS net_value_change
  FROM public.v_inventory_history h
  WHERE h.department = _dept
    AND (_start_date IS NULL OR h.event_date >= _start_date::date)
    AND (_end_date IS NULL OR h.event_date <= _end_date::date)
    AND (_category IS NULL OR h.category = _category)
    AND (_event_type IS NULL OR h.event_type = _event_type)
    AND (_search IS NULL OR 
         h.item_name ILIKE '%' || _search || '%' OR 
         h.staff_name ILIKE '%' || _search || '%');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION public.get_inventory_history_stats TO authenticated;
