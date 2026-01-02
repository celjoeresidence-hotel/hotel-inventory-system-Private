-- Migration 0015: Manager & Admin Oversight
-- Ensure Managers and Admins can view ALL operational records for oversight.

-- Drop existing policy if it conflicts (though unlikely given previous names)
DROP POLICY IF EXISTS p_select_manager_admin_oversight ON public.operational_records;

CREATE POLICY p_select_manager_admin_oversight ON public.operational_records
  FOR SELECT
  USING (
    app_current_role() IN ('manager', 'admin')
  );
