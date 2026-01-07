-- Migration 0039: Unified Inventory Source & Snapshot Enforcement
-- Objective: 
-- 1. Revert "Independent Ledger" logic (from 0037) for Bar/Kitchen.
-- 2. Establish Storekeeper Closing Stock as the SINGLE Source of Truth.
-- 3. Backfill initial snapshots to ensure data continuity.

-- =================================================================
-- 1. REVERT INDEPENDENT LEDGER LOGIC
-- =================================================================

-- 1.1 Update v_inventory_ledger to EXCLUDE Bar/Kitchen Opening Stock events.
-- We only want to track their *movements* (Restock/Sold), not their "Opening" state,
-- because their Opening Stock is now derived dynamically from the Store.
-- DROP VIEW IF EXISTS public.v_inventory_ledger CASCADE; -- Removed to protect dependent views (History, etc.)

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

-- 1.2 Update get_expected_opening_stock to use STORE ledger for EVERYONE
CREATE OR REPLACE FUNCTION public.get_expected_opening_stock(_role text, _item_name text, _report_date date DEFAULT CURRENT_DATE)
RETURNS numeric AS $$
DECLARE
  _val numeric;
BEGIN
  -- Always calculate based on STORE ledger, regardless of role.
  -- This ensures Bar/Kitchen "Opening Stock" is always derived from the Store's history.
  SELECT COALESCE(SUM(quantity_change), 0)
  INTO _val
  FROM public.v_inventory_ledger
  WHERE department = 'STORE'
    AND event_date < _report_date
    AND item_name = _item_name;

  RETURN COALESCE(_val, 0);
END;
$$ LANGUAGE plpgsql;


-- =================================================================
-- 2. BACKFILL CLOSING STOCK SNAPSHOTS
-- =================================================================
-- Create an initial "Daily Closing Stock" snapshot for ALL Store items
-- based on the current calculated ledger sum.

DO $$
DECLARE
  r RECORD;
  _system_user_id uuid;
  _count int := 0;
BEGIN
  -- Find system/admin user
  SELECT id INTO _system_user_id FROM public.profiles WHERE role = 'admin' LIMIT 1;
  IF _system_user_id IS NULL THEN
    SELECT id INTO _system_user_id FROM public.profiles LIMIT 1;
  END IF;

  -- Disable triggers to prevent auto-calculations and 'submitted_by' errors
  ALTER TABLE public.operational_records DISABLE TRIGGER trg_operational_records_before_insert;
  ALTER TABLE public.operational_records DISABLE TRIGGER trg_enforce_opening_stock;

  FOR r IN 
    SELECT 
      item_name, 
      SUM(quantity_change) as current_qty
    FROM public.v_inventory_ledger
    WHERE department = 'STORE'
    GROUP BY item_name
  LOOP
    INSERT INTO public.operational_records (
      entity_type,
      created_at,
      status,
      submitted_by,
      version_no,
      financial_amount,
      data
    ) VALUES (
      'storekeeper',
      NOW(),
      'approved',
      _system_user_id,
      1,
      0,
      jsonb_build_object(
        'type', 'daily_closing_stock',
        'date', to_char(NOW(), 'YYYY-MM-DD'),
        'item_name', r.item_name,
        'quantity', r.current_qty,
        'closing_stock', r.current_qty,
        'unit', (SELECT data->>'unit' FROM public.canonical_operational_records WHERE entity_type='storekeeper' AND data->>'item_name' = r.item_name LIMIT 1),
        'notes', 'System Migration: Solidified Source of Truth'
      )
    );
    _count := _count + 1;
  END LOOP;

  -- Re-enable triggers
  ALTER TABLE public.operational_records ENABLE TRIGGER trg_operational_records_before_insert;
  ALTER TABLE public.operational_records ENABLE TRIGGER trg_enforce_opening_stock;

  RAISE NOTICE 'Backfilled closing stock snapshots for % items.', _count;
END $$;


-- =================================================================
-- 3. UPDATE INVENTORY CATALOG VIEW
-- =================================================================
-- Inventory Catalog now reads SOLELY from the latest 'daily_closing_stock'

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
latest_snapshot AS (
  SELECT DISTINCT ON (data->>'item_name')
    data->>'item_name' AS item_name,
    (data->>'closing_stock')::numeric AS current_stock
  FROM public.operational_records
  WHERE entity_type = 'storekeeper'
    AND data->>'type' = 'daily_closing_stock'
    AND status = 'approved'
    AND deleted_at IS NULL
  ORDER BY data->>'item_name', (data->>'date')::date DESC, created_at DESC
),
ledger_fallback AS (
  -- Fallback for items that haven't had a snapshot yet
  SELECT 
    item_name,
    SUM(quantity_change) as current_stock
  FROM public.v_inventory_ledger
  WHERE department = 'STORE'
  GROUP BY item_name
)
SELECT
  i.category AS category,
  i.collection_name AS collection_name,
  i.item_name AS item_name,
  i.unit AS unit,
  COALESCE(ls.current_stock, lf.current_stock, 0) AS current_stock
FROM items i
JOIN collections c ON c.collection_name = i.collection_name AND lower(c.category) = lower(i.category)
JOIN categories cat ON lower(cat.category_name) = lower(i.category)
LEFT JOIN latest_snapshot ls ON ls.item_name = i.item_name
LEFT JOIN ledger_fallback lf ON lf.item_name = i.item_name;

GRANT SELECT ON public.inventory_catalog_view TO authenticated;
