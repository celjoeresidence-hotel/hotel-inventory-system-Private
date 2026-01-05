-- Migration 0029: Security Hardening (Non-Destructive)
-- Objectives:
-- 1. Fix Function Search Path Mutable warnings (SET search_path = pg_catalog, public)
-- 2. Fix SECURITY DEFINER VIEW ERRORS (Convert to SECURITY INVOKER)
-- 3. Enable RLS on public.profiles
-- 4. Validate Audit Log & Trigger Safety

-- ==============================================================================
-- 1. Fix Function Search Path Mutable warnings
-- ==============================================================================

-- 1.1 Auth & Role Helpers
CREATE OR REPLACE FUNCTION public.app_current_user_id()
RETURNS uuid STABLE LANGUAGE sql SET search_path = pg_catalog, public AS $$
  SELECT auth.uid();
$$;

-- Note: Made SECURITY DEFINER to avoid recursion in RLS policies and ensure consistent role resolution
CREATE OR REPLACE FUNCTION public.app_current_role()
RETURNS role_type STABLE LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  SELECT role::role_type FROM public.staff_profiles WHERE user_id = auth.uid()
  UNION ALL
  SELECT role::role_type FROM public.profiles WHERE id = auth.uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.app_is_staff()
RETURNS boolean STABLE LANGUAGE sql SET search_path = pg_catalog, public AS $$
  SELECT public.app_current_role() IN ('front_desk','kitchen','bar','storekeeper');
$$;

-- 1.2 Audit & Triggers
CREATE OR REPLACE FUNCTION public.log_audit(action_type text, _entity_id uuid, _entity_type entity_type, details jsonb, diffs jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  INSERT INTO public.audit_logs(actor_id, action_type, entity_type, entity_id, details, diffs)
  VALUES (public.app_current_user_id(), action_type, _entity_type, _entity_id, COALESCE(details, '{}'::jsonb), diffs);
END$$;

CREATE OR REPLACE FUNCTION public.operational_records_before_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  rec_type text;
  prev public.operational_records;
BEGIN
  -- Force submitted_by to be the current authenticated user
  NEW.submitted_by := public.app_current_user_id();

  -- Identify record type
  rec_type := COALESCE(NEW.data->>'type', NEW.data->>'record_type');

  -- Staff logic
  IF public.app_is_staff() THEN
    -- Default to pending
    NEW.status := 'pending';
    
    -- EXCEPTION: Frontdesk Operational Actions are auto-approved
    IF public.app_current_role() = 'front_desk' AND rec_type IN ('checkout_record', 'guest_record', 'penalty_fee', 'payment_record') THEN
      NEW.status := 'approved';
      NEW.reviewed_by := public.app_current_user_id();
      NEW.reviewed_at := now();
    END IF;
  END IF;

  -- If inserting a correction/override referencing a previous version, propagate chain
  IF NEW.previous_version_id IS NOT NULL THEN
    SELECT * INTO prev FROM public.operational_records WHERE id = NEW.previous_version_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'previous_version_id % does not exist', NEW.previous_version_id;
    END IF;
    NEW.original_id := prev.original_id;
    NEW.version_no := prev.version_no + 1;
    NEW.entity_type := prev.entity_type;

    -- Admin/Manager overrides are inserted as approved with reviewer metadata
    IF public.app_current_role() IN ('manager','admin') THEN
      NEW.status := 'approved';
      NEW.reviewed_by := public.app_current_user_id();
      NEW.reviewed_at := now();
      NEW.rejection_reason := NULL;
    END IF;
  ELSE
    -- If this is the first version, ensure original_id is set
    IF NEW.original_id IS NULL THEN
      NEW.original_id := NEW.id;
    END IF;
  END IF;
 
  -- Ensure entity_type is set
  IF NEW.entity_type IS NULL THEN
     NEW.entity_type := CASE 
       WHEN public.app_current_role() = 'front_desk' THEN 'front_desk'::entity_type
       ELSE 'other'::entity_type -- Preserving original logic despite enum risk, assuming 'other' handles fallbacks or fails gracefully if not in enum (user rule: do not change behavior)
     END;
  END IF;

  RETURN NEW;
END
$$;

-- 1.3 Operations & Analytics
CREATE OR REPLACE FUNCTION api.approve_record(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  rec_data jsonb;
  rec_type text;
  check_in date;
  check_out date;
  room_id uuid;
  is_available boolean;
BEGIN
  -- Allow Supervisor, Manager, Admin
  IF public.app_current_role() NOT IN ('supervisor', 'manager', 'admin') THEN
    RAISE EXCEPTION 'Permission denied: only supervisor/manager/admin can approve records.';
  END IF;

  SELECT data INTO rec_data FROM public.operational_records WHERE id = _id AND status = 'pending';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found or not pending.';
  END IF;

  -- Reservation Availability Check
  rec_type := rec_data->>'type';
  IF rec_type = 'room_booking' THEN
    room_id := (rec_data->>'room_id')::uuid;
    check_in := (rec_data->>'start_date')::date;
    check_out := (rec_data->>'end_date')::date;
    
    -- Check availability excluding self
    is_available := public.check_room_availability(room_id, check_in, check_out, _id);
    
    IF NOT is_available THEN
       RAISE EXCEPTION 'Room is no longer available for these dates (conflict found).';
    END IF;
  END IF;

  UPDATE public.operational_records
  SET status = 'approved',
      reviewed_by = public.app_current_user_id(),
      reviewed_at = now(),
      rejection_reason = NULL
  WHERE id = _id;
END$$;

CREATE OR REPLACE FUNCTION public.approve_record(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  rec_data jsonb;
  rec_type text;
  check_in date;
  check_out date;
  room_id uuid;
  is_available boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles sp WHERE sp.user_id = auth.uid() AND sp.role IN ('supervisor','manager','admin')
  ) THEN
    RAISE EXCEPTION 'Permission denied: only supervisor/manager/admin can approve records.';
  END IF;

  SELECT data INTO rec_data FROM public.operational_records WHERE id = _id AND status = 'pending';
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found or not pending.';
  END IF;

  -- Reservation Availability Check
  rec_type := rec_data->>'type';
  IF rec_type = 'room_booking' THEN
    room_id := (rec_data->>'room_id')::uuid;
    check_in := (rec_data->>'start_date')::date;
    check_out := (rec_data->>'end_date')::date;
    
    is_available := public.check_room_availability(room_id, check_in, check_out, _id);
    
    IF NOT is_available THEN
       RAISE EXCEPTION 'Room is no longer available for these dates (conflict found).';
    END IF;
  END IF;

  UPDATE public.operational_records
  SET status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      rejection_reason = NULL
  WHERE id = _id;
END$$;

CREATE OR REPLACE FUNCTION public.delete_record(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  
  -- Check permissions: Only Manager or Admin can delete arbitrary records
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles sp 
    WHERE sp.user_id = auth.uid() AND sp.role IN ('manager', 'admin')
  ) THEN
    RAISE EXCEPTION 'Permission denied: only manager/admin can delete records.';
  END IF;

  -- Perform Soft Delete
  UPDATE public.operational_records
  SET deleted_at = now()
  WHERE id = _id AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found or already deleted.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_daily_report_details(
  _department text,
  _date date
)
RETURNS TABLE (
  id uuid,
  type text,
  item_name text,
  quantity numeric,
  notes text,
  created_at timestamptz,
  status approval_status,
  data jsonb
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.data->>'type' AS type,
    r.data->>'item_name' AS item_name,
    COALESCE((r.data->>'quantity')::numeric, (r.data->>'restocked')::numeric, (r.data->>'sold')::numeric, 0) AS quantity,
    r.data->>'notes' AS notes,
    r.created_at,
    r.status,
    r.data
  FROM public.operational_records r
  WHERE r.entity_type::text = _department
    AND (r.data->>'date')::date = _date
    AND r.deleted_at IS NULL
    AND r.status IN ('approved', 'pending')
  ORDER BY r.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_room_analytics(_start_date date, _end_date date)
RETURNS TABLE (
  room_id uuid,
  room_number text,
  room_type text,
  booking_count bigint,
  total_revenue numeric,
  nights_sold bigint,
  occupancy_rate numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  days_in_period int;
BEGIN
  days_in_period := (_end_date - _start_date) + 1;
  IF days_in_period <= 0 THEN days_in_period := 1; END IF;

  RETURN QUERY
  WITH bookings AS (
    SELECT
      (data->'stay'->>'room_id')::uuid AS r_id,
      COALESCE((data->'pricing'->>'total_room_cost')::numeric, 0) AS cost,
      GREATEST(1, ((data->'stay'->>'check_out')::date - (data->'stay'->>'check_in')::date)) AS nights
    FROM public.operational_records
    WHERE entity_type = 'front_desk'
      AND (data->>'type') = 'room_booking'
      AND status IN ('approved', 'checked_out', 'completed', 'archived')
      AND deleted_at IS NULL
      AND (data->'stay'->>'check_in')::date >= _start_date
      AND (data->'stay'->>'check_in')::date <= _end_date
  )
  SELECT
    r.id,
    r.room_number,
    r.room_type,
    COUNT(b.r_id) AS booking_count,
    COALESCE(SUM(b.cost), 0) AS total_revenue,
    COALESCE(SUM(b.nights), 0) AS nights_sold,
    ROUND((COALESCE(SUM(b.nights), 0)::numeric / (days_in_period::numeric)) * 100, 2) AS occupancy_rate
  FROM public.rooms r
  LEFT JOIN bookings b ON b.r_id = r.id
  WHERE r.is_active = true
  GROUP BY r.id, r.room_number, r.room_type
  ORDER BY total_revenue DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_room_availability(
  _room_id uuid,
  _check_in date,
  _check_out date,
  _exclude_booking_id uuid DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  -- Overlap condition: (StartA < EndB) AND (EndA > StartB)
  -- A = Booking, B = Requested Range
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.operational_records r
    WHERE r.entity_type = 'front_desk'
      AND r.status IN ('approved', 'pending') -- Pending bookings also block availability to prevent double-booking
      AND r.deleted_at IS NULL
      AND (r.data->>'type') = 'room_booking'
      AND (r.data->'stay'->>'room_id')::uuid = _room_id
      AND (
        (r.data->'stay'->>'check_in')::date < _check_out
        AND
        (r.data->'stay'->>'check_out')::date > _check_in
      )
      AND (_exclude_booking_id IS NULL OR r.id <> _exclude_booking_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_available_rooms(
  _check_in date,
  _check_out date
)
RETURNS TABLE (
  id uuid,
  room_number text,
  room_name text,
  room_type text,
  price_per_night numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  RETURN QUERY
  SELECT
    r.id,
    r.room_number,
    r.room_name,
    r.room_type,
    r.price_per_night
  FROM public.rooms r
  WHERE r.is_active = true
    AND NOT EXISTS (
      SELECT 1
      FROM public.operational_records b
      WHERE b.entity_type = 'front_desk'
        AND b.status IN ('approved', 'pending')
        AND b.deleted_at IS NULL
        AND (b.data->>'type') = 'room_booking'
        AND (b.data->'stay'->>'room_id')::uuid = r.id
        AND (
          (b.data->'stay'->>'check_in')::date < _check_out
          AND
          (b.data->'stay'->>'check_out')::date > _check_in
        )
    )
  ORDER BY r.room_number;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
  _start_date date DEFAULT date_trunc('month', current_date)::date,
  _end_date date DEFAULT current_date
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  total_revenue numeric;
  occupancy_rate numeric;
  active_guests int;
  pending_approvals int;
  total_rooms int;
  occupied_nights int;
  days_count int;
  
  -- Counts
  bar_orders int;
  kitchen_orders int;
  store_moves int;
BEGIN
  -- Total Revenue (Room Bookings) in period
  SELECT COALESCE(SUM((data->>'total_cost')::numeric), 0)
  INTO total_revenue
  FROM public.operational_records
  WHERE status = 'approved' AND deleted_at IS NULL
    AND entity_type = 'front_desk'
    AND (data->>'type') = 'room_booking'
    AND (data->>'start_date')::date >= _start_date
    AND (data->>'start_date')::date <= _end_date;

  -- Active Guests (currently checked in)
  SELECT COUNT(*)
  INTO active_guests
  FROM public.operational_records
  WHERE status = 'approved' AND deleted_at IS NULL
    AND entity_type = 'front_desk'
    AND (data->>'type') = 'room_booking'
    AND (data->>'start_date')::date <= current_date
    AND (data->>'end_date')::date > current_date;

  -- Pending Approvals (Total pending)
  SELECT COUNT(*) INTO pending_approvals
  FROM public.operational_records
  WHERE status = 'pending' AND deleted_at IS NULL;

  -- Department Counts (in period)
  SELECT COUNT(*) INTO bar_orders FROM public.operational_records
  WHERE status = 'approved' AND entity_type = 'bar'
  AND created_at >= _start_date::timestamp AND created_at < (_end_date + 1)::timestamp;

  SELECT COUNT(*) INTO kitchen_orders FROM public.operational_records
  WHERE status = 'approved' AND entity_type = 'kitchen'
  AND created_at >= _start_date::timestamp AND created_at < (_end_date + 1)::timestamp;

  SELECT COUNT(*) INTO store_moves FROM public.operational_records
  WHERE status = 'approved' AND entity_type = 'storekeeper'
  AND created_at >= _start_date::timestamp AND created_at < (_end_date + 1)::timestamp;

  -- Occupancy Rate
  SELECT COUNT(*) INTO total_rooms FROM public.rooms WHERE is_active = true;
  days_count := (_end_date - _start_date) + 1;
  
  SELECT COALESCE(SUM((data->>'nights')::int), 0)
  INTO occupied_nights
  FROM public.operational_records
  WHERE status = 'approved' AND deleted_at IS NULL
    AND entity_type = 'front_desk'
    AND (data->>'type') = 'room_booking'
    AND (data->>'start_date')::date >= _start_date
    AND (data->>'start_date')::date <= _end_date;

  IF total_rooms > 0 AND days_count > 0 THEN
    occupancy_rate := (occupied_nights::numeric / (total_rooms * days_count)) * 100;
  ELSE
    occupancy_rate := 0;
  END IF;

  RETURN jsonb_build_object(
    'total_revenue', total_revenue,
    'occupancy_rate', ROUND(occupancy_rate, 2),
    'active_guests', active_guests,
    'pending_approvals', pending_approvals,
    'bar_orders', bar_orders,
    'kitchen_orders', kitchen_orders,
    'store_moves', store_moves
  );
END;
$$;

-- 1.4 Inventory Helpers
CREATE OR REPLACE FUNCTION public.get_inventory_opening_at_date(_department text, _date date)
RETURNS TABLE (item_name text, opening_stock numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
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
$$;

CREATE OR REPLACE FUNCTION public.get_expected_opening_stock(_role text, _item_name text, _report_date date DEFAULT CURRENT_DATE)
RETURNS numeric LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  _last_closing numeric;
  _global_stock numeric;
BEGIN
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
$$;

CREATE OR REPLACE FUNCTION public.get_expected_opening_stock_batch(_role text, _report_date date DEFAULT CURRENT_DATE)
RETURNS TABLE (item_name text, opening_stock numeric) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF _role = 'storekeeper' THEN
    RETURN QUERY SELECT * FROM public.get_inventory_opening_at_date('STORE', _report_date);
  ELSE
    RETURN QUERY
    SELECT
      i.item_name::text,
      public.get_expected_opening_stock(_role, i.item_name, _report_date)
    FROM public.inventory_catalog_view i;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_opening_stock_chain()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  _expected numeric;
  _role text;
  _item text;
BEGIN
  IF NEW.entity_type NOT IN ('kitchen', 'bar', 'storekeeper') THEN
    RETURN NEW;
  END IF;
  
  _item := NEW.data->>'item_name';
  IF _item IS NULL THEN
    RETURN NEW;
  END IF;

  _role := NEW.entity_type::text;
  
  _expected := public.get_expected_opening_stock(_role, _item, (NEW.data->>'date')::date);
  
  IF _role IN ('kitchen', 'bar') THEN
     NEW.data := jsonb_set(NEW.data, '{opening_stock}', to_jsonb(_expected));
     NEW.data := jsonb_set(NEW.data, '{closing_stock}', to_jsonb(
       _expected + 
       COALESCE((NEW.data->>'restocked')::numeric, 0) - 
       COALESCE((NEW.data->>'sold')::numeric, 0)
     ));
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_daily_stock_sheet(_role text, _category text, _report_date date DEFAULT CURRENT_DATE)
RETURNS TABLE(item_name text, unit text, unit_price numeric, opening_stock numeric, collection_name text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
BEGIN
  IF _role = 'storekeeper' THEN
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
$$;

-- ==============================================================================
-- 2. Fix SECURITY DEFINER VIEW ERRORS (Convert to SECURITY INVOKER)
-- ==============================================================================

-- 2.1 Canonical Operational Records
CREATE OR REPLACE VIEW public.canonical_operational_records WITH (security_invoker = true) AS
SELECT DISTINCT ON (original_id) r.*
FROM public.operational_records r
WHERE r.status = 'approved' AND r.deleted_at IS NULL
ORDER BY original_id, reviewed_at DESC NULLS LAST, created_at DESC;

-- 2.2 Inventory Ledger
CREATE OR REPLACE VIEW public.v_inventory_ledger WITH (security_invoker = true) AS
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
SELECT
  id, created_at, (data->>'date')::date, 'KITCHEN', data->>'item_name',
  -COALESCE((data->>'sold')::numeric, 0), 'CONSUMED',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by
FROM public.canonical_operational_records
WHERE entity_type = 'kitchen' AND (data->>'sold')::numeric > 0;

-- 2.3 Inventory Catalog View
CREATE OR REPLACE VIEW public.inventory_catalog_view WITH (security_invoker = true) AS
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

-- 2.4 Stock History
CREATE OR REPLACE VIEW public.v_stock_history WITH (security_invoker = true) AS
SELECT
  r.id,
  r.entity_type AS role,
  (r.data->>'date')::date AS date,
  r.data->>'item_name' AS item_name,
  (
    SELECT COALESCE(data->>'category', data->>'category_name')
    FROM public.canonical_operational_records ci
    WHERE ci.entity_type = 'storekeeper' 
      AND data->>'type' = 'config_item' 
      AND data->>'item_name' = r.data->>'item_name'
    LIMIT 1
  ) AS category,
  (r.data->>'opening_stock')::numeric AS opening_stock,
  CASE 
    WHEN r.entity_type = 'storekeeper' AND r.data->>'type' = 'stock_restock' THEN (r.data->>'quantity')::numeric
    WHEN r.entity_type IN ('kitchen', 'bar') THEN (r.data->>'restocked')::numeric
    ELSE 0
  END AS quantity_in,
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
  AND r.data->>'item_name' IS NOT NULL;

-- 2.5 Room Revenue Stats
CREATE OR REPLACE VIEW public.v_room_revenue_stats WITH (security_invoker = true) AS
SELECT 
  (data->>'room_number') AS room_number,
  (data->>'room_type') AS room_type,
  COUNT(*) AS total_bookings,
  SUM(COALESCE((data->>'total_cost')::numeric, 0)) AS total_revenue,
  SUM(COALESCE((data->>'nights')::int, 0)) AS total_nights,
  MAX((data->>'end_date')::date) AS last_booking_date
FROM public.operational_records
WHERE status = 'approved' 
  AND deleted_at IS NULL
  AND entity_type = 'front_desk'
  AND (data->>'type') = 'room_booking'
GROUP BY 1, 2;

-- 2.6 Daily Department Summary
CREATE OR REPLACE VIEW public.v_daily_department_summary WITH (security_invoker = true) AS
SELECT
  (data->>'date')::date AS report_date,
  entity_type AS department,
  COUNT(*) AS total_records,
  SUM(CASE WHEN data->>'type' IN ('stock_restock', 'restock') THEN COALESCE((data->>'quantity')::numeric, (data->>'restocked')::numeric, 0) ELSE 0 END) AS total_restocked_qty,
  SUM(CASE WHEN data->>'type' IN ('stock_issued', 'issued', 'sold') THEN COALESCE((data->>'quantity')::numeric, (data->>'sold')::numeric, 0) ELSE 0 END) AS total_issued_qty,
  SUM(CASE WHEN data->>'type' IN ('waste', 'discarded') THEN COALESCE((data->>'quantity')::numeric, 0) ELSE 0 END) AS total_discarded_qty,
  BOOL_OR(status = 'pending') AS has_pending
FROM public.operational_records
WHERE status IN ('approved', 'pending') 
  AND deleted_at IS NULL
  AND entity_type IN ('kitchen', 'bar', 'storekeeper')
GROUP BY (data->>'date')::date, entity_type;

-- ==============================================================================
-- 3. Enable RLS on public.profiles
-- ==============================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own profile" ON public.profiles;
CREATE POLICY "Users can read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Admins and Managers can read all profiles" ON public.profiles;
-- Uses app_current_role() which is now SECURITY DEFINER, preventing recursion
CREATE POLICY "Admins and Managers can read all profiles" ON public.profiles
  FOR SELECT USING (public.app_current_role() IN ('admin', 'manager'));

-- ==============================================================================
-- 4. Validate Audit Log & Trigger Safety
-- ==============================================================================
-- Ensure audit_logs RLS is strictly secure but allows system writes via log_audit
-- (log_audit is SECURITY DEFINER, so it works. No action needed for policies here)
-- Just ensuring the search_path fix on log_audit covers safety.
