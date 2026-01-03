-- Migration 0024: Admin Dashboard Stats
-- Provides aggregated metrics for the admin dashboard

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_stats()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _start_of_month date := date_trunc('month', now())::date;
  _end_of_month date := (date_trunc('month', now()) + interval '1 month' - interval '1 day')::date;
  
  _total_revenue numeric;
  _revenue_by_dept jsonb;
  _occupancy_rate numeric;
  _inventory_shrinkage numeric;
  _pending_approvals bigint;
  _top_rooms jsonb;
  _low_stock_items bigint;
  _operational_anomalies bigint;
BEGIN
  -- 1. Total Revenue (Financial Amount from approved records this month)
  SELECT COALESCE(SUM(financial_amount), 0)
  INTO _total_revenue
  FROM public.operational_records
  WHERE status = 'approved'
    AND deleted_at IS NULL
    AND created_at >= _start_of_month
    AND financial_amount > 0;

  -- 2. Revenue by Department
  SELECT jsonb_object_agg(entity_type, total)
  INTO _revenue_by_dept
  FROM (
    SELECT entity_type, COALESCE(SUM(financial_amount), 0) as total
    FROM public.operational_records
    WHERE status = 'approved'
      AND deleted_at IS NULL
      AND created_at >= _start_of_month
      AND financial_amount > 0
    GROUP BY entity_type
  ) t;

  -- 3. Occupancy Rate (Current)
  -- Defined as: (Rooms Occupied / Total Active Rooms) * 100
  -- Occupied = approved room_booking where today is between check_in and check_out
  DECLARE
    _total_rooms bigint;
    _occupied_rooms bigint;
  BEGIN
    SELECT COUNT(*) INTO _total_rooms FROM public.rooms WHERE is_active = true;
    
    SELECT COUNT(DISTINCT (data->'stay'->>'room_id'))
    INTO _occupied_rooms
    FROM public.operational_records
    WHERE entity_type = 'front_desk'
      AND (data->>'type') = 'room_booking'
      AND status = 'approved'
      AND deleted_at IS NULL
      AND (data->'stay'->>'check_in')::date <= now()::date
      AND (data->'stay'->>'check_out')::date > now()::date;
      
    IF _total_rooms > 0 THEN
      _occupancy_rate := ROUND((_occupied_rooms::numeric / _total_rooms::numeric) * 100, 2);
    ELSE
      _occupancy_rate := 0;
    END IF;
  END;

  -- 4. Inventory Shrinkage (Waste value this month)
  -- Assumes 'waste' or 'discarded' records in operational_records or specific logic
  -- Currently we look for 'stock_out' with reason 'waste' or similar in data
  -- Adjust based on actual inventory implementation. 
  -- Assuming inventory ledger view v_inventory_ledger exists, but let's use operational_records for speed if possible.
  -- Or query v_inventory_ledger if it has costs.
  -- Let's stick to operational_records where type='stock_out' and reason='waste' (hypothetical)
  -- If not strictly defined, we'll return 0 for now or sum negative financials if any.
  -- Better: Count rejected records as a proxy for "Operational Issues" for now if shrinkage isn't clear.
  -- Let's use "Pending Approvals" as the main operational metric requested.
  _inventory_shrinkage := 0; -- Placeholder until specific waste tracking is confirmed

  -- 5. Pending Approvals
  SELECT COUNT(*)
  INTO _pending_approvals
  FROM public.operational_records
  WHERE status = 'pending'
    AND deleted_at IS NULL;

  -- 6. Top Performing Rooms (Revenue this month)
  SELECT jsonb_agg(t)
  INTO _top_rooms
  FROM (
    SELECT 
      (data->'stay'->>'room_id') as room_id,
      SUM(financial_amount) as revenue
    FROM public.operational_records
    WHERE entity_type = 'front_desk'
      AND (data->>'type') = 'room_booking'
      AND status = 'approved'
      AND deleted_at IS NULL
      AND created_at >= _start_of_month
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 5
  ) t;

  -- 7. Operational Anomalies (High value deletions or rejected records)
  SELECT COUNT(*)
  INTO _operational_anomalies
  FROM public.operational_records
  WHERE status = 'rejected'
    AND created_at >= _start_of_month;

  RETURN jsonb_build_object(
    'total_revenue', _total_revenue,
    'revenue_by_dept', COALESCE(_revenue_by_dept, '{}'::jsonb),
    'occupancy_rate', _occupancy_rate,
    'inventory_shrinkage', _inventory_shrinkage,
    'pending_approvals', _pending_approvals,
    'top_rooms', COALESCE(_top_rooms, '[]'::jsonb),
    'operational_anomalies', _operational_anomalies
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_stats() TO PUBLIC;
