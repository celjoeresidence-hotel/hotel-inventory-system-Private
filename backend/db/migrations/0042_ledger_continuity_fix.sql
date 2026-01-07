-- Migration 0042: Daily Ledger Continuity Fix
-- Objective: Implement the "True Ledger Chain" where:
-- 1. Opening Stock (Day N) = Closing Stock (Day N-1)
-- 2. Current Stock = Latest Closing Snapshot + Subsequent Movements
-- 3. Eliminates "Midnight Reset" by anchoring calculations to the latest confirmed snapshot.

-- =================================================================
-- 1. Helper Function: Get Latest Snapshot for Item
-- =================================================================
CREATE OR REPLACE FUNCTION public.get_latest_snapshot(_item_name text)
RETURNS TABLE (snapshot_date date, snapshot_qty numeric) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    (data->>'date')::date AS snapshot_date,
    (data->>'closing_stock')::numeric AS snapshot_qty
  FROM public.operational_records
  WHERE entity_type = 'storekeeper'
    AND data->>'type' = 'daily_closing_stock'
    AND status = 'approved'
    AND deleted_at IS NULL
    AND data->>'item_name' = _item_name
  ORDER BY (data->>'date')::date DESC, created_at DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql STABLE;

-- =================================================================
-- 2. Update 'get_expected_opening_stock'
-- =================================================================
-- Calculates Opening Stock for a specific date by starting from the nearest
-- past snapshot and adding intervening movements.
CREATE OR REPLACE FUNCTION public.get_expected_opening_stock(_role text, _item_name text, _report_date date DEFAULT CURRENT_DATE)
RETURNS numeric AS $$
DECLARE
  _snapshot_date date;
  _snapshot_qty numeric;
  _movements numeric;
BEGIN
  -- 1. Get Baseline (Latest Snapshot strictly BEFORE report date)
  SELECT 
    (data->>'date')::date,
    (data->>'closing_stock')::numeric
  INTO _snapshot_date, _snapshot_qty
  FROM public.operational_records
  WHERE entity_type = 'storekeeper'
    AND data->>'type' = 'daily_closing_stock'
    AND status = 'approved'
    AND deleted_at IS NULL
    AND data->>'item_name' = _item_name
    AND (data->>'date')::date < _report_date -- Strictly before
  ORDER BY (data->>'date')::date DESC, created_at DESC
  LIMIT 1;

  -- 2. Default if no snapshot exists
  IF _snapshot_date IS NULL THEN
    _snapshot_date := '2000-01-01'; -- Genesis
    _snapshot_qty := 0;
  END IF;

  -- 3. Sum Movements between Snapshot and Report Date
  -- (Snapshot Date < Event Date < Report Date)
  SELECT COALESCE(SUM(quantity_change), 0)
  INTO _movements
  FROM public.v_inventory_ledger
  WHERE department = 'STORE'
    AND item_name = _item_name
    AND event_date > _snapshot_date 
    AND event_date < _report_date;

  RETURN _snapshot_qty + _movements;
END;
$$ LANGUAGE plpgsql;

-- =================================================================
-- 3. Update Inventory Catalog View (The "Live" View)
-- =================================================================
-- This view feeds the frontend. It must show "Current Live Stock".
-- Logic: Latest Snapshot (whenever it was) + Movements SINCE then.

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
live_stock AS (
  SELECT 
    i.item_name,
    COALESCE(snap.snapshot_qty, 0) + COALESCE(
      (SELECT SUM(l.quantity_change) 
       FROM public.v_inventory_ledger l 
       WHERE l.department = 'STORE' 
         AND l.item_name = i.item_name 
         AND l.event_date > COALESCE(snap.snapshot_date, '2000-01-01')
      ), 0
    ) AS current_stock
  FROM items i
  LEFT JOIN LATERAL public.get_latest_snapshot(i.item_name) snap ON true
)
SELECT
  i.category AS category,
  i.collection_name AS collection_name,
  i.item_name AS item_name,
  i.unit AS unit,
  ls.current_stock AS current_stock
FROM items i
JOIN collections c ON c.collection_name = i.collection_name AND lower(c.category) = lower(i.category)
JOIN categories cat ON lower(cat.category_name) = lower(i.category)
JOIN live_stock ls ON ls.item_name = i.item_name;

GRANT SELECT ON public.inventory_catalog_view TO authenticated;
