-- Migration 0054: Update Deletion RPCs for Inventory
-- Adds safe deletion logic for new inventory tables (categories, collections).
-- Replaces legacy operational_records deletion logic.

-- 1. Delete Inventory Category RPC
CREATE OR REPLACE FUNCTION public.delete_inventory_category(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rec public.inventory_categories;
  item_count int;
  col_count int;
BEGIN
  -- Check authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  
  -- Check permissions (Manager/Admin only)
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles 
    WHERE user_id = auth.uid() AND role IN ('manager', 'admin')
  ) THEN
    RAISE EXCEPTION 'Permission denied: only manager/admin can delete categories.';
  END IF;

  -- Get Category
  SELECT * INTO rec FROM public.inventory_categories
  WHERE id = _id AND deleted_at IS NULL;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found or already deleted.';
  END IF;

  -- Check for dependent Collections
  SELECT COUNT(*) INTO col_count
  FROM public.inventory_collections
  WHERE category_id = _id AND deleted_at IS NULL;
  
  IF col_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete category "%" because it has % active collections. Delete collections first.', rec.name, col_count;
  END IF;

  -- Check for dependent Items
  -- Note: inventory_items uses category name (string) currently.
  SELECT COUNT(*) INTO item_count
  FROM public.inventory_items
  WHERE category = rec.name AND deleted_at IS NULL;
  
  IF item_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete category "%" because it is used by % items. Delete items first.', rec.name, item_count;
  END IF;

  -- Perform Soft Delete
  UPDATE public.inventory_categories
  SET deleted_at = now(), updated_at = now()
  WHERE id = _id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_inventory_category(uuid) TO authenticated;

-- 2. Delete Inventory Collection RPC
CREATE OR REPLACE FUNCTION public.delete_inventory_collection(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  rec public.inventory_collections;
  cat_rec public.inventory_categories;
  item_count int;
BEGIN
  -- Check authentication
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  
  -- Check permissions (Manager/Admin only)
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles 
    WHERE user_id = auth.uid() AND role IN ('manager', 'admin')
  ) THEN
    RAISE EXCEPTION 'Permission denied: only manager/admin can delete collections.';
  END IF;

  -- Get Collection
  SELECT * INTO rec FROM public.inventory_collections
  WHERE id = _id AND deleted_at IS NULL;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Collection not found or already deleted.';
  END IF;

  -- Get Parent Category Name (needed for item check)
  SELECT * INTO cat_rec FROM public.inventory_categories
  WHERE id = rec.category_id;
  
  -- Check for dependent Items
  -- Note: inventory_items uses collection name (string) and category name.
  SELECT COUNT(*) INTO item_count
  FROM public.inventory_items
  WHERE collection = rec.name 
    AND category = cat_rec.name -- Ensure it matches the category too
    AND deleted_at IS NULL;
  
  IF item_count > 0 THEN
    RAISE EXCEPTION 'Cannot delete collection "%" because it is used by % items. Delete items first.', rec.name, item_count;
  END IF;

  -- Perform Soft Delete
  UPDATE public.inventory_collections
  SET deleted_at = now(), updated_at = now()
  WHERE id = _id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.delete_inventory_collection(uuid) TO authenticated;
