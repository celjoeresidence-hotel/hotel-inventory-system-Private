-- Migration 0025: Admin Dashboard Intelligence
-- Provides comprehensive intelligence metrics for the admin dashboard

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_intelligence(
  _start_date date,
  _end_date date
)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  _result jsonb;
  
  -- Snapshot vars
  _total_revenue numeric;
  _total_expense numeric;
  _occupancy_rate numeric;
  _active_guests bigint;
  _pending_approvals bigint;
  
  -- Financial vars
  _revenue_by_collection jsonb;
  
  -- Rooms vars
  _top_rooms jsonb;
  _worst_rooms jsonb;
  _room_stats jsonb;
  
  -- Ops vars
  _shrinkage_alerts jsonb;
  _anomalies jsonb;
  
  -- Risk vars
  _rejected_reports jsonb;
  _cancelled_stays jsonb;
  
BEGIN
  -- 1. Snapshot Metrics
  
  -- Revenue: Sum of approved financial_amount (assuming positive is income)
  SELECT COALESCE(SUM(financial_amount), 0)
  INTO _total_revenue
  FROM public.operational_records
  WHERE status = 'approved'
    AND deleted_at IS NULL
    AND created_at::date BETWEEN _start_date AND _end_date
    AND financial_amount > 0;

  -- Expenses: Sum of financial_amount where amount < 0 OR type='expense'
  -- Currently we might not have explicit expenses, so we check for negative values
  SELECT COALESCE(ABS(SUM(financial_amount)), 0)
  INTO _total_expense
  FROM public.operational_records
  WHERE status = 'approved'
    AND deleted_at IS NULL
    AND created_at::date BETWEEN _start_date AND _end_date
    AND financial_amount < 0;

  -- Active Guests: Distinct guests currently checked in (overlap with today)
  -- Logic: check_in <= now AND check_out > now
  SELECT COUNT(DISTINCT (data->'guest'->>'id'))
  INTO _active_guests
  FROM public.operational_records
  WHERE entity_type = 'front_desk'
    AND (data->>'type') = 'room_booking'
    AND status = 'approved'
    AND deleted_at IS NULL
    AND (data->'stay'->>'check_in')::date <= now()::date
    AND (data->'stay'->>'check_out')::date > now()::date;

  -- Pending Approvals: Total pending (not just in date range, but current state)
  SELECT COUNT(*)
  INTO _pending_approvals
  FROM public.operational_records
  WHERE status = 'pending'
    AND deleted_at IS NULL;

  -- Occupancy Rate (Current)
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

  -- 2. Financial Breakdown
  -- Group by entity_type (mapped to collections later if needed)
  SELECT jsonb_object_agg(COALESCE(entity_type, 'other'), total)
  INTO _revenue_by_collection
  FROM (
    SELECT entity_type, COALESCE(SUM(financial_amount), 0) as total
    FROM public.operational_records
    WHERE status = 'approved'
      AND deleted_at IS NULL
      AND created_at::date BETWEEN _start_date AND _end_date
      AND financial_amount > 0
    GROUP BY entity_type
  ) t;

  -- 3. Rooms Intelligence
  -- Top 5 rooms by revenue
  SELECT jsonb_agg(t)
  INTO _top_rooms
  FROM (
    SELECT 
      (data->'stay'->>'room_id') as room_id,
      SUM(financial_amount) as revenue,
      COUNT(*) as bookings
    FROM public.operational_records
    WHERE entity_type = 'front_desk'
      AND (data->>'type') = 'room_booking'
      AND status = 'approved'
      AND deleted_at IS NULL
      AND created_at::date BETWEEN _start_date AND _end_date
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 5
  ) t;

  -- Worst 5 rooms (lowest revenue)
  SELECT jsonb_agg(t)
  INTO _worst_rooms
  FROM (
    SELECT 
      (data->'stay'->>'room_id') as room_id,
      SUM(financial_amount) as revenue,
      COUNT(*) as bookings
    FROM public.operational_records
    WHERE entity_type = 'front_desk'
      AND (data->>'type') = 'room_booking'
      AND status = 'approved'
      AND deleted_at IS NULL
      AND created_at::date BETWEEN _start_date AND _end_date
    GROUP BY 1
    ORDER BY 2 ASC
    LIMIT 5
  ) t;

  -- 4. Ops Health
  -- Anomalies: Repeated adjustments? Or just 'adjustment' type records?
  -- Let's count 'adjustment' records as anomalies/signals
  SELECT jsonb_agg(t)
  INTO _anomalies
  FROM (
    SELECT id, created_at, entity_type, data->>'reason' as reason, front_desk_staff_id
    FROM public.operational_records
    WHERE (data->>'type') LIKE '%adjustment%'
      AND created_at::date BETWEEN _start_date AND _end_date
    LIMIT 20
  ) t;

  -- Shrinkage: Stock outs with reason 'waste', 'expired', 'damaged'
  SELECT jsonb_agg(t)
  INTO _shrinkage_alerts
  FROM (
    SELECT id, created_at, entity_type, data->>'item_name' as item, data->>'quantity' as qty, data->>'reason' as reason
    FROM public.operational_records
    WHERE entity_type IN ('bar', 'kitchen', 'storekeeper')
      AND (data->>'type') = 'stock_out'
      AND (data->>'reason') IN ('waste', 'expired', 'damaged', 'shrinkage')
      AND created_at::date BETWEEN _start_date AND _end_date
    LIMIT 20
  ) t;

  -- 5. Risk & Oversight
  -- Rejected reports
  SELECT jsonb_agg(t)
  INTO _rejected_reports
  FROM (
    SELECT id, created_at, entity_type, data->>'type' as type, front_desk_staff_id
    FROM public.operational_records
    WHERE status = 'rejected'
      AND created_at::date BETWEEN _start_date AND _end_date
    LIMIT 20
  ) t;

  -- Cancelled stays (deleted bookings)
  SELECT jsonb_agg(t)
  INTO _cancelled_stays
  FROM (
    SELECT id, deleted_at, data->'stay'->>'room_id' as room_id
    FROM public.operational_records
    WHERE entity_type = 'front_desk'
      AND (data->>'type') = 'room_booking'
      AND deleted_at IS NOT NULL
      AND deleted_at::date BETWEEN _start_date AND _end_date
    LIMIT 20
  ) t;

  -- Construct Result
  _result := jsonb_build_object(
    'snapshot', jsonb_build_object(
      'revenue', _total_revenue,
      'expense', _total_expense,
      'net_profit', _total_revenue - _total_expense,
      'occupancy_rate', _occupancy_rate,
      'active_guests', _active_guests,
      'pending_approvals', _pending_approvals
    ),
    'financial', jsonb_build_object(
      'breakdown', _revenue_by_collection
    ),
    'rooms', jsonb_build_object(
      'top', _top_rooms,
      'worst', _worst_rooms
    ),
    'ops', jsonb_build_object(
      'anomalies', _anomalies,
      'shrinkage', _shrinkage_alerts
    ),
    'risk', jsonb_build_object(
      'rejected', _rejected_reports,
      'cancelled', _cancelled_stays
    )
  );

  RETURN _result;
END;
$$;
