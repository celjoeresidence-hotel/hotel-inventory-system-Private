-- Migration 0018: Room Availability Logic
-- Provides functions to check room availability and list available rooms based on bookings.

-- Check if a specific room is available for a given date range
CREATE OR REPLACE FUNCTION public.check_room_availability(
  _room_id uuid,
  _check_in date,
  _check_out date,
  _exclude_booking_id uuid DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
GRANT EXECUTE ON FUNCTION public.check_room_availability(uuid, date, date, uuid) TO PUBLIC;

-- List available rooms for a given date range
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
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
GRANT EXECUTE ON FUNCTION public.get_available_rooms(date, date) TO PUBLIC;
