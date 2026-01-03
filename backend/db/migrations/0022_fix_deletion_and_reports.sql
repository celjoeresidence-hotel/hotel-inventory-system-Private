-- Migration 0022: Fix Deletion Logic and Add Reports View

-- 1. Generic Soft Delete RPC (referenced by frontend as 'delete_record')
-- Allows Managers/Admins to soft-delete any record.
CREATE OR REPLACE FUNCTION public.delete_record(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
GRANT EXECUTE ON FUNCTION public.delete_record(uuid) TO PUBLIC;

-- 2. Daily Department Summary View (for Reports)
-- Aggregates daily activities per department for the Reports dashboard.
CREATE OR REPLACE VIEW public.v_daily_department_summary AS
SELECT
  (data->>'date')::date AS report_date,
  entity_type AS department,
  COUNT(*) AS total_records,
  SUM(CASE WHEN data->>'type' IN ('stock_restock', 'restock') THEN COALESCE((data->>'quantity')::numeric, (data->>'restocked')::numeric, 0) ELSE 0 END) AS total_restocked_qty,
  SUM(CASE WHEN data->>'type' IN ('stock_issued', 'issued', 'sold') THEN COALESCE((data->>'quantity')::numeric, (data->>'sold')::numeric, 0) ELSE 0 END) AS total_issued_qty,
  SUM(CASE WHEN data->>'type' IN ('waste', 'discarded') THEN COALESCE((data->>'quantity')::numeric, 0) ELSE 0 END) AS total_discarded_qty,
  -- Check if any record for this day/dept is still pending
  BOOL_OR(status = 'pending') AS has_pending
FROM public.operational_records
WHERE status IN ('approved', 'pending') 
  AND deleted_at IS NULL
  AND entity_type IN ('kitchen', 'bar', 'storekeeper')
GROUP BY (data->>'date')::date, entity_type;

GRANT SELECT ON public.v_daily_department_summary TO authenticated;

-- 3. Get Report Details RPC
-- Fetches detailed records for a specific day and department, optimized for reports.
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
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
GRANT EXECUTE ON FUNCTION public.get_daily_report_details(text, date) TO PUBLIC;
