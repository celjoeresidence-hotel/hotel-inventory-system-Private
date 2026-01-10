-- Migration 0062: Fix Analytics Data and RLS

-- A. Fix Trigger Function
CREATE OR REPLACE FUNCTION public.operational_records_before_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    rec_type text;
BEGIN
    -- Extract type from data jsonb
    rec_type := NEW.data->>'type';
    
    -- Auto-assign entity_type if missing
    IF NEW.entity_type IS NULL THEN
       -- 1. Front Desk Types
       IF rec_type IN ('room_booking', 'check_in', 'check_out', 'guest_record', 'penalty_fee', 'payment_record', 'refund_record', 'interrupted_stay_credit', 'reservation', 'guest_registration', 'payment') THEN
          NEW.entity_type := 'front_desk';
       
       -- 2. Inventory/Department Types
       ELSIF rec_type IN ('restock_record', 'usage_record', 'waste_record', 'stock_restock', 'stock_issue', 'stock_out', 'stock_transfer', 'order') THEN
          -- Try to infer from department field
          IF NEW.data->>'department' = 'BAR' OR NEW.data->>'location' = 'bar' THEN NEW.entity_type := 'bar';
          ELSIF NEW.data->>'department' = 'KITCHEN' OR NEW.data->>'location' = 'kitchen' THEN NEW.entity_type := 'kitchen';
          ELSIF NEW.data->>'department' = 'STORE' OR NEW.data->>'location' = 'store' THEN NEW.entity_type := 'storekeeper';
          END IF;
       END IF;

       -- 3. Fallback to role-based assignment if still not set
       IF NEW.entity_type IS NULL THEN
          CASE app_current_role()
            WHEN 'front_desk' THEN NEW.entity_type := 'front_desk';
            WHEN 'bar' THEN NEW.entity_type := 'bar';
            WHEN 'kitchen' THEN NEW.entity_type := 'kitchen';
            WHEN 'storekeeper' THEN NEW.entity_type := 'storekeeper';
            ELSE NULL; -- Do nothing, let it be NULL (will fail if NOT NULL constraint exists, which is correct for invalid data)
          END CASE;
       END IF;
    END IF;

    -- Ensure submitted_by is set
    IF NEW.submitted_by IS NULL THEN
        NEW.submitted_by := auth.uid();
    END IF;

    RETURN NEW;
END;
$function$;

-- B. Fix Existing Data (Retroactive Update)

-- 1. Front Desk
UPDATE public.operational_records
SET entity_type = 'front_desk'
WHERE entity_type IS NULL
  AND data->>'type' IN ('room_booking', 'check_in', 'check_out', 'guest_record', 'penalty_fee', 'payment_record', 'refund_record', 'interrupted_stay_credit', 'reservation', 'guest_registration', 'payment');

-- 2. Bar
UPDATE public.operational_records
SET entity_type = 'bar'
WHERE entity_type IS NULL
  AND (data->>'department' = 'BAR' OR data->>'location' = 'bar' OR data->>'type' IN ('bar_sale', 'bar_restock', 'stock_restock', 'order'));

-- 3. Kitchen
UPDATE public.operational_records
SET entity_type = 'kitchen'
WHERE entity_type IS NULL
  AND (data->>'department' = 'KITCHEN' OR data->>'location' = 'kitchen' OR data->>'type' IN ('kitchen_usage', 'kitchen_restock', 'order'));

-- 4. Storekeeper
UPDATE public.operational_records
SET entity_type = 'storekeeper'
WHERE entity_type IS NULL
  AND (data->>'department' = 'STORE' OR data->>'location' = 'store' OR data->>'type' IN ('stock_in', 'stock_out', 'stock_issue'));


-- C. Fix RLS for Analytics Visibility

-- 1. Admin/Manager/Supervisor Read All Policy
DROP POLICY IF EXISTS p_select_admin_all ON public.operational_records;
DROP POLICY IF EXISTS "analytics_read_all_privileged" ON public.operational_records;

CREATE POLICY "analytics_read_all_privileged" ON public.operational_records
  FOR SELECT
  TO authenticated
  USING (
    public.app_current_role() IN ('admin', 'manager', 'supervisor')
  );

-- 2. Front Desk Read Own/Department Policy
DROP POLICY IF EXISTS p_select_front_desk_analytics ON public.operational_records;
DROP POLICY IF EXISTS "analytics_read_front_desk" ON public.operational_records;

CREATE POLICY "analytics_read_front_desk" ON public.operational_records
  FOR SELECT
  TO authenticated
  USING (
    (public.app_current_role() = 'front_desk' AND entity_type = 'front_desk')
  );

-- 3. Department Staff Policy
DROP POLICY IF EXISTS "analytics_read_department" ON public.operational_records;
CREATE POLICY "analytics_read_department" ON public.operational_records
  FOR SELECT
  TO authenticated
  USING (
    public.app_current_role() IN ('bar', 'kitchen', 'storekeeper')
    AND entity_type::text = public.app_current_role()::text
  );
  
-- 4. Inventory Transactions Visibility
DROP POLICY IF EXISTS "analytics_read_all_inv_tx" ON public.inventory_transactions;
CREATE POLICY "analytics_read_all_inv_tx" ON public.inventory_transactions
  FOR SELECT
  TO authenticated
  USING (
    public.app_current_role() IN ('admin', 'manager', 'supervisor')
    OR
    (public.app_current_role() = 'storekeeper')
    OR
    (public.app_current_role() IN ('bar', 'kitchen') AND department = CASE WHEN public.app_current_role() = 'bar' THEN 'BAR' WHEN public.app_current_role() = 'kitchen' THEN 'KITCHEN' ELSE department END)
  );
