-- Migration 0017: Fix soft-delete logic for inventory configuration
-- Instead of hard-deleting approved items/collections/categories, we soft-delete them (set deleted_at).
-- This preserves historical data/audit trails while hiding them from the active catalog.
-- Dependencies (e.g. items in a category) still prevent deletion to maintain hierarchy integrity.

-- 1. Soft Delete Item
CREATE OR REPLACE FUNCTION public.delete_config_item(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rec public.operational_records;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  IF app_current_role() NOT IN ('supervisor','manager','admin') THEN
    RAISE EXCEPTION 'Permission denied: only supervisor/manager/admin can delete items.';
  END IF;

  SELECT * INTO rec FROM public.operational_records
  WHERE id = _id AND status = 'approved' AND deleted_at IS NULL
    AND entity_type = 'storekeeper' AND lower(data->>'type') = 'config_item';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found or not approved';
  END IF;

  -- Perform Soft Delete
  UPDATE public.operational_records
  SET deleted_at = now()
  WHERE id = _id;
END$$;
GRANT EXECUTE ON FUNCTION public.delete_config_item(uuid) TO PUBLIC;

-- 2. Soft Delete Collection
CREATE OR REPLACE FUNCTION public.delete_config_collection(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rec public.operational_records;
  cat_name text;
  col_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  IF app_current_role() NOT IN ('supervisor','manager','admin') THEN
    RAISE EXCEPTION 'Permission denied: only supervisor/manager/admin can delete collections.';
  END IF;

  SELECT * INTO rec FROM public.operational_records
  WHERE id = _id AND status = 'approved' AND deleted_at IS NULL
    AND entity_type = 'storekeeper' AND lower(data->>'type') = 'config_collection';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collection not found or not approved';
  END IF;

  cat_name := COALESCE(rec.data->>'category_name', rec.data->>'category');
  col_name := rec.data->>'collection_name';
  
  -- Block if any approved, non-deleted items reference this collection
  IF EXISTS (
    SELECT 1 FROM public.operational_records
    WHERE status = 'approved' AND deleted_at IS NULL AND entity_type = 'storekeeper'
      AND lower(data->>'type') = 'config_item'
      AND lower(data->>'category') = lower(cat_name)
      AND lower(data->>'collection_name') = lower(col_name)
  ) THEN
    RAISE EXCEPTION 'Cannot delete collection % in category % because items reference it. Deactivate instead or delete items first.', col_name, cat_name;
  END IF;

  -- Perform Soft Delete
  UPDATE public.operational_records
  SET deleted_at = now()
  WHERE id = _id;
END$$;
GRANT EXECUTE ON FUNCTION public.delete_config_collection(uuid) TO PUBLIC;

-- 3. Soft Delete Category
CREATE OR REPLACE FUNCTION public.delete_config_category(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rec public.operational_records;
  cat_name text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  IF app_current_role() NOT IN ('supervisor','manager','admin') THEN
    RAISE EXCEPTION 'Permission denied: only supervisor/manager/admin can delete categories.';
  END IF;

  SELECT * INTO rec FROM public.operational_records
  WHERE id = _id AND status = 'approved' AND deleted_at IS NULL
    AND entity_type = 'storekeeper' AND lower(data->>'type') = 'config_category';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found or not approved';
  END IF;

  cat_name := COALESCE(rec.data->>'category_name', rec.data->>'category');
  
  -- Block if any approved, non-deleted collections reference this category
  IF EXISTS (
    SELECT 1 FROM public.operational_records
    WHERE status = 'approved' AND deleted_at IS NULL AND entity_type = 'storekeeper'
      AND lower(data->>'type') = 'config_collection'
      AND lower(data->>'category') = lower(cat_name)
  ) THEN
    RAISE EXCEPTION 'Cannot delete category % because it has approved collections. Deactivate or delete collections first.', cat_name;
  END IF;

  -- Block if any approved, non-deleted items reference this category
  IF EXISTS (
    SELECT 1 FROM public.operational_records
    WHERE status = 'approved' AND deleted_at IS NULL AND entity_type = 'storekeeper'
      AND lower(data->>'type') = 'config_item'
      AND lower(data->>'category') = lower(cat_name)
  ) THEN
    RAISE EXCEPTION 'Cannot delete category % because items reference it. Deactivate instead or delete items first.', cat_name;
  END IF;

  -- Perform Soft Delete
  UPDATE public.operational_records
  SET deleted_at = now()
  WHERE id = _id;
END$$;
GRANT EXECUTE ON FUNCTION public.delete_config_category(uuid) TO PUBLIC;
