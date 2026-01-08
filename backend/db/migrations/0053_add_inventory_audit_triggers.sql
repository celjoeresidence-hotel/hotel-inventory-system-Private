-- Migration 0053: Add Audit Triggers for Inventory Tables
-- Adds audit logging for inventory_items, inventory_categories, and inventory_collections.

-- 1. Update entity_type enum to include new inventory types
-- Note: ALTER TYPE ... ADD VALUE cannot be run inside a transaction block in some contexts,
-- but Supabase/Postgres usually allows it in migrations.
DO $$
BEGIN
  ALTER TYPE entity_type ADD VALUE IF NOT EXISTS 'inventory_item';
  ALTER TYPE entity_type ADD VALUE IF NOT EXISTS 'inventory_category';
  ALTER TYPE entity_type ADD VALUE IF NOT EXISTS 'inventory_collection';
EXCEPTION
  WHEN duplicate_object THEN null; -- Ignore if already exists
END $$;

-- 2. Create Trigger Function for Inventory Auditing
CREATE OR REPLACE FUNCTION public.trigger_log_inventory_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  entity_type_val entity_type;
BEGIN
  -- Argument 0 is the entity_type (passed from trigger definition)
  entity_type_val := TG_ARGV[0]::entity_type;
  
  IF TG_OP = 'INSERT' THEN
    PERFORM public.log_audit(
      'create', 
      NEW.id, 
      entity_type_val, 
      to_jsonb(NEW), 
      null
    );
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Check for Soft Delete (if deleted_at column exists and changed)
    -- We cast to record to access fields dynamically or just assume the schema has it.
    -- inventory_items, categories, collections all have deleted_at.
    IF (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL) THEN
      PERFORM public.log_audit(
        'soft_delete', 
        NEW.id, 
        entity_type_val, 
        to_jsonb(NEW), 
        to_jsonb(OLD)
      );
    ELSE
      PERFORM public.log_audit(
        'edit', 
        NEW.id, 
        entity_type_val, 
        to_jsonb(NEW), 
        to_jsonb(OLD)
      );
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.log_audit(
      'hard_delete', 
      OLD.id, 
      entity_type_val, 
      to_jsonb(OLD), 
      null
    );
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

-- 3. Apply Triggers

-- Inventory Items
DROP TRIGGER IF EXISTS trg_audit_inventory_items ON public.inventory_items;
CREATE TRIGGER trg_audit_inventory_items
AFTER INSERT OR UPDATE OR DELETE ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.trigger_log_inventory_change('inventory_item');

-- Inventory Categories
DROP TRIGGER IF EXISTS trg_audit_inventory_categories ON public.inventory_categories;
CREATE TRIGGER trg_audit_inventory_categories
AFTER INSERT OR UPDATE OR DELETE ON public.inventory_categories
FOR EACH ROW EXECUTE FUNCTION public.trigger_log_inventory_change('inventory_category');

-- Inventory Collections
DROP TRIGGER IF EXISTS trg_audit_inventory_collections ON public.inventory_collections;
CREATE TRIGGER trg_audit_inventory_collections
AFTER INSERT OR UPDATE OR DELETE ON public.inventory_collections
FOR EACH ROW EXECUTE FUNCTION public.trigger_log_inventory_change('inventory_collection');
