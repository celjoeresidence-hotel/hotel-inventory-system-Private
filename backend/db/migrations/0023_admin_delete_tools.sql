-- Migration 0023: Admin Delete Tools
-- Provides RPCs for admins to permanently delete records and wipe item history.

-- 1. Generic Hard Delete (by ID)
CREATE OR REPLACE FUNCTION public.admin_hard_delete_records(_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Permission Check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles sp 
    WHERE sp.user_id = auth.uid() AND sp.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Permission denied: only admins can hard delete records.';
  END IF;

  DELETE FROM public.operational_records
  WHERE id = ANY(_ids);
END;
$$;

-- 2. Wipe Inventory Item (by Name)
-- Deletes the item configuration AND all associated stock transactions (history).
CREATE OR REPLACE FUNCTION public.admin_wipe_inventory_item(_item_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  -- Permission Check
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles sp 
    WHERE sp.user_id = auth.uid() AND sp.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Permission denied: only admins can wipe inventory data.';
  END IF;

  -- Delete all records associated with this item name in storekeeper module
  -- Includes: config_item, opening_stock, stock_restock, stock_issued, daily_closing_stock
  DELETE FROM public.operational_records
  WHERE entity_type = 'storekeeper'
    AND data->>'item_name' = _item_name;
    
  -- Also delete from bar/kitchen if they reference it? 
  -- Maybe safe to leave them or delete them too?
  -- For now, let's focus on Storekeeper (Master Inventory).
  -- If we delete master item, sub-department records might be orphaned, but that's "Wipe".
  
END;
$$;
