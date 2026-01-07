-- Migration 0038: History Module
-- Objective: Create backend views and functions for the history module.

-- 1. Create v_inventory_history
-- Joins ledger with item metadata and calculates running balances.

DROP VIEW IF EXISTS public.v_inventory_history CASCADE;

CREATE OR REPLACE VIEW public.v_inventory_history AS
WITH running_ledger AS (
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
    l.submitted_by,
    SUM(l.quantity_change) OVER (
      PARTITION BY l.department, l.item_name 
      ORDER BY l.event_date ASC, l.created_at ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS closing_stock
  FROM public.v_inventory_ledger l
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

-- 2. Create RPC: get_inventory_history
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

-- 3. Create RPC: get_inventory_history_stats
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
