-- Migration 0019: Reservation Lifecycle & Analytics

-- 1. Update Trigger: Remove room_booking from auto-approval
CREATE OR REPLACE FUNCTION public.operational_records_before_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  rec_type text;
  prev public.operational_records;
BEGIN
  -- Force submitted_by to be the current authenticated user
  NEW.submitted_by := app_current_user_id();

  -- Identify record type
  rec_type := COALESCE(NEW.data->>'type', NEW.data->>'record_type');

  -- Staff logic
  IF app_is_staff() THEN
    -- Default to pending
    NEW.status := 'pending';
    
    -- EXCEPTION: Frontdesk Operational Actions are auto-approved
    -- Removed 'room_booking' from this list to enforce approval workflow
    IF app_current_role() = 'front_desk' AND rec_type IN ('checkout_record', 'guest_record', 'penalty_fee', 'payment_record') THEN
      NEW.status := 'approved';
      NEW.reviewed_by := app_current_user_id();
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
    IF app_current_role() IN ('manager','admin') THEN
      NEW.status := 'approved';
      NEW.reviewed_by := app_current_user_id();
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
       WHEN app_current_role() = 'front_desk' THEN 'front_desk'
       ELSE 'other'
     END;
  END IF;

  RETURN NEW;
END
$$;

-- 2. Update RLS Policy: Remove room_booking from allowed approved inserts for front_desk
DROP POLICY IF EXISTS p_insert_frontdesk_ops ON public.operational_records;

CREATE POLICY p_insert_frontdesk_ops ON public.operational_records
  FOR INSERT
  WITH CHECK (
    app_current_role() = 'front_desk'
    AND status = 'approved'
    AND submitted_by = app_current_user_id()
    AND (data->>'type' IN ('checkout_record', 'guest_record', 'penalty_fee', 'payment_record'))
  );

-- Note: room_booking will now be inserted as pending, covered by p_insert_staff_general (which allows pending)

-- 3. Update Approval RPCs to check availability
CREATE OR REPLACE FUNCTION api.approve_record(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rec_data jsonb;
  rec_type text;
  check_in date;
  check_out date;
  room_id uuid;
  is_available boolean;
BEGIN
  -- Allow Supervisor, Manager, Admin
  IF app_current_role() NOT IN ('supervisor', 'manager', 'admin') THEN
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
      reviewed_by = app_current_user_id(),
      reviewed_at = now(),
      rejection_reason = NULL
  WHERE id = _id;
END$$;

-- Update public wrapper too
CREATE OR REPLACE FUNCTION public.approve_record(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
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

-- 4. Admin Analytics Views

-- Room Revenue Stats
CREATE OR REPLACE VIEW public.v_room_revenue_stats AS
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

-- Dashboard Metrics RPC
CREATE OR REPLACE FUNCTION public.get_dashboard_metrics(
  _start_date date DEFAULT date_trunc('month', current_date)::date,
  _end_date date DEFAULT current_date
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
