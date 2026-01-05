-- Migration 0030: Frontdesk-Managed Housekeeping (Additive, Non-Destructive)
-- Goals:
-- - Introduce lightweight housekeepers table (no auth, no roles)
-- - Store housekeeping activity as operational_records data (type = 'housekeeping_report')
-- - Extend availability logic to respect housekeeping status (dirty/maintenance)
-- - Preserve RLS and existing workflows; no destructive schema changes

-- 1) Lightweight Housekeepers table
CREATE TABLE IF NOT EXISTS public.housekeepers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.housekeepers ENABLE ROW LEVEL SECURITY;

-- RLS: Frontdesk-managed; supervisors/managers/admins also allowed
DROP POLICY IF EXISTS p_select_housekeepers ON public.housekeepers;
CREATE POLICY p_select_housekeepers ON public.housekeepers
  FOR SELECT
  USING (public.app_current_role() IN ('front_desk','supervisor','manager','admin'));

DROP POLICY IF EXISTS p_insert_housekeepers ON public.housekeepers;
CREATE POLICY p_insert_housekeepers ON public.housekeepers
  FOR INSERT
  WITH CHECK (
    public.app_current_role() IN ('front_desk','supervisor','manager','admin')
    AND created_by = public.app_current_user_id()
  );

DROP POLICY IF EXISTS p_update_housekeepers ON public.housekeepers;
CREATE POLICY p_update_housekeepers ON public.housekeepers
  FOR UPDATE
  USING (public.app_current_role() IN ('front_desk','supervisor','manager','admin'))
  WITH CHECK (public.app_current_role() IN ('front_desk','supervisor','manager','admin'));

-- 2) Availability hardening: respect latest housekeeping report
-- Extend existing check_room_availability to block rooms marked dirty/maintenance
-- Rule: If latest housekeeping_report for room indicates 'dirty' or 'maintenance', room is unavailable
CREATE OR REPLACE FUNCTION public.check_room_availability(
  _room_id uuid,
  _check_in date,
  _check_out date,
  _exclude_booking_id uuid DEFAULT NULL
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE
  _latest_status text;
BEGIN
  -- Determine latest housekeeping status for the room
  SELECT (data->>'housekeeping_status')::text
  INTO _latest_status
  FROM public.operational_records r
  WHERE r.entity_type = 'front_desk'
    AND r.deleted_at IS NULL
    AND (r.data->>'type') = 'housekeeping_report'
    AND (r.data->>'room_id')::uuid = _room_id
  ORDER BY r.created_at DESC
  LIMIT 1;

  -- Block if dirty or maintenance
  IF _latest_status IN ('dirty','maintenance') THEN
    RETURN FALSE;
  END IF;

  -- Original overlap-based availability for bookings/reservations
  RETURN NOT EXISTS (
    SELECT 1
    FROM public.operational_records r
    WHERE r.entity_type = 'front_desk'
      AND r.status IN ('approved', 'pending')
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

-- 3) Helper view (invoker) for latest housekeeping status per room (UI/reporting)
CREATE OR REPLACE VIEW public.v_room_housekeeping_status
WITH (security_invoker = true) AS
SELECT
  r.id AS room_id,
  r.room_number,
  r.room_name,
  r.room_type,
  (
    SELECT (hr.data->>'housekeeping_status')::text
    FROM public.operational_records hr
    WHERE hr.entity_type = 'front_desk'
      AND hr.deleted_at IS NULL
      AND (hr.data->>'type') = 'housekeeping_report'
      AND (hr.data->>'room_id')::uuid = r.id
    ORDER BY hr.created_at DESC
    LIMIT 1
  ) AS housekeeping_status,
  (
    SELECT (hr.data->>'report_date')::date
    FROM public.operational_records hr
    WHERE hr.entity_type = 'front_desk'
      AND hr.deleted_at IS NULL
      AND (hr.data->>'type') = 'housekeeping_report'
      AND (hr.data->>'room_id')::uuid = r.id
    ORDER BY hr.created_at DESC
    LIMIT 1
  ) AS status_date
FROM public.rooms r
WHERE r.is_active = true;

GRANT SELECT ON public.v_room_housekeeping_status TO authenticated;

