-- Migration 0043: Global Ledger & History Fix
-- Objective: 
-- 1. Fix "reverting stock" by including ALL department movements in calculations.
-- 2. Fix "empty history" by correctly handling Bar/Kitchen roles in history RPCs.

-- =================================================================
-- 1. Update 'get_expected_opening_stock' (Global)
-- =================================================================
CREATE OR REPLACE FUNCTION public.get_expected_opening_stock(_role text, _item_name text, _report_date date DEFAULT CURRENT_DATE)
RETURNS numeric AS $$
DECLARE
  _snapshot_date date;
  _snapshot_qty numeric;
  _movements numeric;
BEGIN
  -- 1. Get Baseline (Latest Storekeeper Snapshot strictly BEFORE report date)
  -- This remains the anchor.
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
    AND (data->>'date')::date < _report_date
  ORDER BY (data->>'date')::date DESC, created_at DESC
  LIMIT 1;

  IF _snapshot_date IS NULL THEN
    _snapshot_date := '2000-01-01';
    _snapshot_qty := 0;
  END IF;

  -- 2. Sum Movements from ALL departments
  -- We REMOVED "AND department = 'STORE'"
  -- Store Issued (-), Bar Received (+), Bar Sold (-) -> Net effect is correct.
  SELECT COALESCE(SUM(quantity_change), 0)
  INTO _movements
  FROM public.v_inventory_ledger
  WHERE item_name = _item_name
    AND event_date > _snapshot_date 
    AND event_date < _report_date;

  RETURN _snapshot_qty + _movements;
END;
$$ LANGUAGE plpgsql;

-- =================================================================
-- 2. Update Inventory Catalog View (Global Live Stock)
-- =================================================================
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
       WHERE l.item_name = i.item_name 
         -- REMOVED "AND department = 'STORE'"
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

-- =================================================================
-- 3. Update 'get_daily_stock_sheet' to use Global Logic for ALL Roles
-- =================================================================
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
    -- CHANGED: Use get_expected_opening_stock for EVERYONE (Global Logic)
    -- This ensures Storekeeper also sees stock depleted by Bar/Kitchen sales if no snapshot exists.
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

GRANT EXECUTE ON FUNCTION public.get_daily_stock_sheet TO authenticated;

-- =================================================================
-- 4. FIX: Update 'get_inventory_history' to SHOW ALL HISTORY for everyone
-- =================================================================
-- The issue: "Bar" and "Kitchen" roles were filtering history by their department ONLY.
-- But since we are now a "Single Source of Truth", they should see the GLOBAL history
-- or at least the relevant parts. For simplicity and transparency, we allow them to see
-- the global ledger history for items.

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
  _offset int;
  _dept_filter text;
BEGIN
  _offset := (_page - 1) * _page_size;

  RETURN QUERY
  WITH filtered AS (
    SELECT
      h.record_id::text AS record_id,
      h.created_at,
      h.event_date,
      h.department,
      h.item_name,
      h.category,
      h.collection,
      h.unit,
      h.event_type,
      h.quantity_change,
      h.opening_stock,
      h.closing_stock,
      h.unit_price,
      h.total_value,
      h.staff_name,
      h.submitted_by::text AS submitted_by
    FROM public.v_inventory_history h
    WHERE 
      (_start_date IS NULL OR h.event_date >= _start_date::date)
      AND (_end_date IS NULL OR h.event_date <= _end_date::date)
      AND (_category IS NULL OR h.category = _category)
      AND (_event_type IS NULL OR h.event_type = _event_type)
      AND (_search IS NULL OR 
           h.item_name ILIKE '%' || _search || '%' OR 
           h.staff_name ILIKE '%' || _search || '%')
  )
  SELECT
    f.record_id,
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

-- =================================================================
-- 5. Continuity Enforcement: Auto-approve Storekeeper daily_closing_stock
-- =================================================================
-- History restructuring made snapshots essential for continuity.
-- If these remain pending, canonical_operational_records will ignore them,
-- causing next-day openings to anchor to older baselines (perceived "revert").
-- This trigger approves storekeeper closing snapshots immediately under the
-- current staff context, preserving the established workflow elsewhere.

CREATE OR REPLACE FUNCTION public.operational_records_auto_approve_closing_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  rec_type text;
BEGIN
  rec_type := lower(COALESCE(NEW.data->>'type', NEW.data->>'record_type'));
  IF NEW.entity_type = 'storekeeper'::public.entity_type AND rec_type = 'daily_closing_stock' THEN
    UPDATE public.operational_records
    SET status = 'approved',
        reviewed_by = public.app_current_user_id(),
        reviewed_at = now(),
        rejection_reason = NULL
    WHERE id = NEW.id AND status = 'pending';
  END IF;
  RETURN NEW;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE t.tgname = 'trg_operational_records_auto_approve_closing_snapshot'
      AND c.relname = 'operational_records'
      AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_operational_records_auto_approve_closing_snapshot
    AFTER INSERT ON public.operational_records
    FOR EACH ROW EXECUTE FUNCTION public.operational_records_auto_approve_closing_snapshot();
  END IF;
END
$$;

-- =================================================================
-- 6. Performance: Bulk Submit RPC for Storekeeper Daily Records
-- =================================================================
-- Accepts an array of storekeeper record objects and inserts them
-- in a single transaction to reduce roundtrips and trigger overhead.
CREATE OR REPLACE FUNCTION public.submit_storekeeper_daily(_records jsonb)
RETURNS TABLE (id uuid) AS $$
DECLARE
  rec jsonb;
  v_id uuid;
  v_status public.approval_status;
  v_amount numeric;
  v_data jsonb;
BEGIN
  IF _records IS NULL OR jsonb_typeof(_records) <> 'array' THEN
    RAISE EXCEPTION 'Payload must be a JSON array';
  END IF;

  FOR rec IN SELECT jsonb_array_elements(_records)
  LOOP
    v_data := rec->'data';
    v_status := COALESCE((rec->>'status')::public.approval_status, 'pending');
    v_amount := COALESCE((rec->>'financial_amount')::numeric, 0);

    INSERT INTO public.operational_records(entity_type, data, financial_amount, submitted_by, status)
    VALUES ('storekeeper', v_data, v_amount, public.app_current_user_id(), v_status)
    RETURNING id INTO v_id;

    RETURN QUERY SELECT v_id;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

GRANT EXECUTE ON FUNCTION public.submit_storekeeper_daily(jsonb) TO authenticated;

-- Also approve in BEFORE INSERT to avoid a follow-up UPDATE per row
-- This reduces write amplification and avoids timeouts for bulk submissions.
CREATE OR REPLACE FUNCTION public.operational_records_before_insert_auto_approve_closing_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  rec_type text;
BEGIN
  rec_type := lower(COALESCE(NEW.data->>'type', NEW.data->>'record_type'));
  IF NEW.entity_type = 'storekeeper'::public.entity_type AND rec_type = 'daily_closing_stock' THEN
    NEW.status := 'approved';
    NEW.reviewed_by := public.app_current_user_id();
    NEW.reviewed_at := now();
    NEW.rejection_reason := NULL;
  END IF;
  RETURN NEW;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE t.tgname = 'trg_operational_records_before_insert_auto_approve_closing_snapshot'
      AND c.relname = 'operational_records'
      AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_operational_records_before_insert_auto_approve_closing_snapshot
    BEFORE INSERT ON public.operational_records
    FOR EACH ROW EXECUTE FUNCTION public.operational_records_before_insert_auto_approve_closing_snapshot();
  END IF;
END
$$;
