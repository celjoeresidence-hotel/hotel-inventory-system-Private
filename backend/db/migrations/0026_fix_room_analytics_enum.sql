-- Migration 0026: Fix Room Analytics Enum
-- Re-applies the fix for invalid enum input error in get_room_analytics by restricting status check to 'approved'.
-- This ensures that if previous migrations left the function in a bad state, this one fixes it.

CREATE OR REPLACE FUNCTION public.get_room_analytics(_start_date date, _end_date date)
RETURNS TABLE (
  room_id uuid,
  room_number text,
  room_type text,
  booking_count bigint,
  total_revenue numeric,
  nights_sold bigint,
  occupancy_rate numeric
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
      AND status = 'approved' -- Explicitly check for 'approved' only, avoiding invalid enum values
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

GRANT EXECUTE ON FUNCTION public.get_room_analytics(date, date) TO PUBLIC;
