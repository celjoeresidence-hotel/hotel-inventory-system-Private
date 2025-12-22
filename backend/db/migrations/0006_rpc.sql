-- Migration 0006: Secure RPC routines (Supabase-native)
-- Implements approval actions, corrections, deletions, and listing helpers

CREATE SCHEMA IF NOT EXISTS api;

-- Approve a pending record (Supervisor only)
-- SECURITY DEFINER is used so this function can perform controlled workflow updates regardless of caller RLS, while table RLS remains enforced elsewhere.
-- Frontend must never update approval fields directly; always call this RPC.
CREATE OR REPLACE FUNCTION api.approve_record(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_current_role() <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can approve records.';
  END IF;

  UPDATE public.operational_records
  SET status = 'approved',
      reviewed_by = app_current_user_id(),
      reviewed_at = now(),
      rejection_reason = NULL
  WHERE id = _id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found or not pending.';
  END IF;
END$$;
GRANT EXECUTE ON FUNCTION api.approve_record(uuid) TO PUBLIC;

-- Reject a pending record with reason (Supervisor only)
-- SECURITY DEFINER is used so this function can perform controlled workflow updates regardless of caller RLS, while table RLS remains enforced elsewhere.
-- Frontend must never update approval fields directly; always call this RPC.
CREATE OR REPLACE FUNCTION api.reject_record(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_current_role() <> 'supervisor' THEN
    RAISE EXCEPTION 'Only supervisors can reject records.';
  END IF;
  IF COALESCE(_reason, '') = '' THEN
    RAISE EXCEPTION 'Rejection requires a non-empty reason.';
  END IF;

  UPDATE public.operational_records
  SET status = 'rejected',
      rejection_reason = _reason,
      reviewed_by = app_current_user_id(),
      reviewed_at = now()
  WHERE id = _id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found or not pending.';
  END IF;
END$$;
GRANT EXECUTE ON FUNCTION api.reject_record(uuid, text) TO PUBLIC;

-- Staff soft delete their own pending/rejected submission
CREATE OR REPLACE FUNCTION api.soft_delete_record(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT app_is_staff() THEN
    RAISE EXCEPTION 'Only staff can soft delete their submissions via this routine.';
  END IF;

  UPDATE public.operational_records
  SET deleted_at = now()
  WHERE id = _id
    AND submitted_by = app_current_user_id()
    AND status IN ('pending','rejected')
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Soft delete not permitted: record may not belong to you, not pending/rejected, or already deleted.';
  END IF;
END$$;
GRANT EXECUTE ON FUNCTION api.soft_delete_record(uuid) TO PUBLIC;

-- Manager/Admin: create a correction/override version referencing previous version
CREATE OR REPLACE FUNCTION api.create_correction_version(_previous_version_id uuid, _data jsonb, _financial_amount numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  prev public.operational_records;
  new_id uuid;
BEGIN
  IF app_current_role() NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'Only manager/admin can create correction versions.';
  END IF;

  SELECT * INTO prev FROM public.operational_records WHERE id = _previous_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Previous version % not found.', _previous_version_id;
  END IF;

  INSERT INTO public.operational_records(id, entity_type, data, financial_amount, status, submitted_by, reviewed_by, reviewed_at, rejection_reason, previous_version_id, original_id, version_no, deleted_at)
  VALUES (gen_random_uuid(), prev.entity_type, COALESCE(_data, prev.data), COALESCE(_financial_amount, prev.financial_amount), 'approved', app_current_user_id(), app_current_user_id(), now(), NULL, _previous_version_id, prev.original_id, prev.version_no + 1, NULL)
  RETURNING id INTO new_id;

  RETURN new_id;
END$$;
GRANT EXECUTE ON FUNCTION api.create_correction_version(uuid, jsonb, numeric) TO PUBLIC;

-- Manager/Admin/Supervisor: edit configuration records (categories/collections) via correction version
CREATE OR REPLACE FUNCTION api.edit_config_record(_previous_version_id uuid, _data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  prev public.operational_records;
  new_id uuid;
  rec_type text;
  new_data jsonb;
  -- added: variables for canonical assigned_to handling
  assigned_input jsonb;
  assigned_prev jsonb;
  assigned_canonical jsonb;
  k boolean;
  b boolean;
  s boolean;
BEGIN
  IF app_current_role() NOT IN ('admin','manager','supervisor') THEN
    RAISE EXCEPTION 'Only admin/manager/supervisor can edit configuration records.';
  END IF;

  SELECT * INTO prev FROM public.operational_records WHERE id = _previous_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Previous version % not found.', _previous_version_id;
  END IF;

  rec_type := COALESCE(prev.data->>'type', prev.data->>'record_type');
  IF lower(rec_type) NOT IN ('config_category','config_collection') THEN
    RAISE EXCEPTION 'Only configuration records can be edited via this routine.';
  END IF;

  -- Build base without assigned_to to ensure full replacement when provided
  new_data := (prev.data - 'assigned_to') || (COALESCE(_data, '{}'::jsonb) - 'assigned_to');

  -- Preserve canonical type
  new_data := new_data || jsonb_build_object('type', rec_type);

  -- Determine previous assigned_to (may be array or object)
  assigned_prev := prev.data->'assigned_to';

  -- Handle assigned_to replacement and canonicalization for config_category
  IF lower(rec_type) = 'config_category' THEN
    IF COALESCE(_data ? 'assigned_to', false) THEN
      assigned_input := _data->'assigned_to';
    ELSE
      assigned_input := assigned_prev;
    END IF;

    -- Default flags
    k := false; b := false; s := false;

    IF assigned_input IS NOT NULL THEN
      IF jsonb_typeof(assigned_input) = 'object' THEN
        k := COALESCE((assigned_input->>'kitchen')::boolean, false);
        b := COALESCE((assigned_input->>'bar')::boolean, false);
        s := COALESCE((assigned_input->>'storekeeper')::boolean, false);
      ELSIF jsonb_typeof(assigned_input) = 'array' THEN
        -- treat as roles array; set booleans by membership
        k := assigned_input @> '"kitchen"'::jsonb OR assigned_input @> '["kitchen"]'::jsonb;
        b := assigned_input @> '"bar"'::jsonb OR assigned_input @> '["bar"]'::jsonb;
        s := assigned_input @> '"storekeeper"'::jsonb OR assigned_input @> '["storekeeper"]'::jsonb;
      END IF;
    END IF;

    assigned_canonical := jsonb_build_object('assigned_to', jsonb_build_object('kitchen', k, 'bar', b, 'storekeeper', s));
    new_data := new_data || assigned_canonical;
  ELSE
    -- For other config types, if caller provided assigned_to, fully replace it; otherwise preserve previous
    IF COALESCE(_data ? 'assigned_to', false) THEN
      new_data := new_data || jsonb_build_object('assigned_to', _data->'assigned_to');
    ELSIF assigned_prev IS NOT NULL THEN
      new_data := new_data || jsonb_build_object('assigned_to', assigned_prev);
    END IF;
  END IF;

  INSERT INTO public.operational_records(id, entity_type, data, financial_amount, status, submitted_by, reviewed_by, reviewed_at, rejection_reason, previous_version_id, original_id, version_no, deleted_at)
  VALUES (gen_random_uuid(), prev.entity_type, new_data, 0, 'pending', app_current_user_id(), NULL, NULL, NULL, _previous_version_id, prev.original_id, prev.version_no + 1, NULL)
  RETURNING id INTO new_id;

  -- BEFORE INSERT trigger will auto-approve for config types and allowed roles
  RETURN new_id;
END$$;
GRANT EXECUTE ON FUNCTION api.edit_config_record(uuid, jsonb) TO PUBLIC;

-- Manager/Admin: hard delete a record (permanent) with safeguards for config references
CREATE OR REPLACE FUNCTION api.hard_delete_record(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  prev public.operational_records;
  rec_type text;
  cat_name text;
  col_name text;
BEGIN
  IF app_current_role() NOT IN ('supervisor','manager','admin') THEN
    RAISE EXCEPTION 'Only supervisor/manager/admin can permanently delete records.';
  END IF;

  SELECT * INTO prev FROM public.operational_records WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found.';
  END IF;

  rec_type := COALESCE(prev.data->>'type', prev.data->>'record_type');
  IF lower(rec_type) = 'config_category' THEN
    cat_name := COALESCE(prev.data->>'category_name', prev.data->>'category');
    IF EXISTS (
      SELECT 1 FROM public.operational_records
      WHERE status = 'approved' AND deleted_at IS NULL AND entity_type = 'storekeeper'
        AND lower(data->>'type') = 'config_item'
        AND lower(data->>'category') = lower(cat_name)
    ) THEN
      RAISE EXCEPTION 'Cannot delete category % because it is referenced by items. Deactivate instead.', cat_name;
    END IF;
  ELSIF lower(rec_type) = 'config_collection' THEN
    cat_name := COALESCE(prev.data->>'category_name', prev.data->>'category');
    col_name := prev.data->>'collection_name';
    IF EXISTS (
      SELECT 1 FROM public.operational_records
      WHERE status = 'approved' AND deleted_at IS NULL AND entity_type = 'storekeeper'
        AND lower(data->>'type') = 'config_item'
        AND lower(data->>'category') = lower(cat_name)
        AND lower(data->>'collection_name') = lower(col_name)
    ) THEN
      RAISE EXCEPTION 'Cannot delete collection % in category % because it is referenced by items. Deactivate instead.', col_name, cat_name;
    END IF;
  END IF;

  DELETE FROM public.operational_records WHERE id = _id;
END$$;
GRANT EXECUTE ON FUNCTION api.hard_delete_record(uuid) TO PUBLIC;

-- Dashboard helpers: list canonical approved (Manager/Admin)
CREATE OR REPLACE FUNCTION api.list_canonical_records(_entity entity_type DEFAULT NULL)
RETURNS SETOF public.canonical_operational_records LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF app_current_role() NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'Only manager/admin can list canonical records.';
  END IF;

  RETURN QUERY
    SELECT * FROM public.canonical_operational_records
    WHERE (_entity IS NULL OR entity_type = _entity);
END$$;
GRANT EXECUTE ON FUNCTION api.list_canonical_records(entity_type) TO PUBLIC;

-- Public schema RPCs for frontend usage (Supabase client supports only public/graphql_public)
CREATE OR REPLACE FUNCTION public.approve_record(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles sp WHERE sp.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'User profile not found.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles sp WHERE sp.user_id = auth.uid() AND sp.role IN ('supervisor','manager','admin')
  ) THEN
    RAISE EXCEPTION 'Permission denied: only supervisor/manager/admin can approve records.';
  END IF;

  UPDATE public.operational_records
  SET status = 'approved',
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      rejection_reason = NULL
  WHERE id = _id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found or not pending.';
  END IF;
END$$;
GRANT EXECUTE ON FUNCTION public.approve_record(uuid) TO PUBLIC;

CREATE OR REPLACE FUNCTION public.reject_record(_id uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles sp WHERE sp.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'User profile not found.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles sp WHERE sp.user_id = auth.uid() AND sp.role IN ('supervisor','manager','admin')
  ) THEN
    RAISE EXCEPTION 'Permission denied: only supervisor/manager/admin can reject records.';
  END IF;
  IF COALESCE(_reason, '') = '' THEN
    RAISE EXCEPTION 'Rejection requires a non-empty reason.';
  END IF;

  UPDATE public.operational_records
  SET status = 'rejected',
      rejection_reason = _reason,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = _id AND status = 'pending';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Record not found or not pending.';
  END IF;
END$$;
GRANT EXECUTE ON FUNCTION public.reject_record(uuid, text) TO PUBLIC;

-- Public wrapper: soft_delete_record
CREATE OR REPLACE FUNCTION public.soft_delete_record(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.staff_profiles sp WHERE sp.user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'User profile not found.';
  END IF;

  UPDATE public.operational_records
  SET deleted_at = now()
  WHERE id = _id
    AND submitted_by = auth.uid()
    AND status IN ('pending','rejected')
    AND deleted_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Soft delete not permitted: record may not belong to you, not pending/rejected, or already deleted.';
  END IF;
END$$;
GRANT EXECUTE ON FUNCTION public.soft_delete_record(uuid) TO PUBLIC;

-- Public wrapper: edit_config_record
CREATE OR REPLACE FUNCTION public.edit_config_record(_previous_version_id uuid, _data jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  new_id uuid;
BEGIN
  -- Delegate to internal API routine which enforces role checks and canonicalization
  new_id := api.edit_config_record(_previous_version_id, _data);
  RETURN new_id;
END$$;
GRANT EXECUTE ON FUNCTION public.edit_config_record(uuid, jsonb) TO PUBLIC;

-- Public delete RPCs for approved config records (SECURITY DEFINER)
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
  IF cat_name IS NULL OR cat_name = '' THEN
    RAISE EXCEPTION 'Category name is missing.';
  END IF;

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

  PERFORM api.hard_delete_record(_id);
END$$;
GRANT EXECUTE ON FUNCTION public.delete_config_category(uuid) TO PUBLIC;

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
  IF COALESCE(col_name, '') = '' THEN
    RAISE EXCEPTION 'Collection name is missing.';
  END IF;

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

  PERFORM api.hard_delete_record(_id);
END$$;
GRANT EXECUTE ON FUNCTION public.delete_config_collection(uuid) TO PUBLIC;

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

  PERFORM api.hard_delete_record(_id);
END$$;
GRANT EXECUTE ON FUNCTION public.delete_config_item(uuid) TO PUBLIC;

-- List categories assigned to a given role (bar/kitchen/storekeeper) from canonical approved config_category
CREATE OR REPLACE FUNCTION public.list_assigned_categories_for_role(_role text)
RETURNS TABLE(category_name text) LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT DISTINCT COALESCE(rc.data->>'category_name', rc.data->>'category') AS category_name
  FROM public.canonical_operational_records rc
  WHERE rc.entity_type = 'storekeeper'
    AND lower(COALESCE(rc.data->>'type', rc.data->>'record_type')) = 'config_category'
    AND COALESCE((rc.data->>'active')::boolean, true) = true
    AND (
      (jsonb_typeof(rc.data->'assigned_to') = 'array' AND (rc.data->'assigned_to') ? _role)
      OR (jsonb_typeof(rc.data->'assigned_to') = 'object' AND COALESCE((rc.data->'assigned_to'->>_role)::boolean, false) = true)
    );
$$;
GRANT EXECUTE ON FUNCTION public.list_assigned_categories_for_role(text) TO PUBLIC;

-- List items for a given category with unit, unit_price, and latest opening_stock
CREATE OR REPLACE FUNCTION public.list_items_for_category(_category text)
RETURNS TABLE(item_name text, unit text, unit_price numeric, opening_stock numeric) LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH items AS (
    SELECT
      rit.data->>'item_name' AS item_name,
      rit.data->>'unit' AS unit,
      COALESCE((rit.data->>'unit_price')::numeric, NULL) AS unit_price
    FROM public.canonical_operational_records rit
    WHERE rit.entity_type = 'storekeeper'
      AND lower(COALESCE(rit.data->>'type', rit.data->>'record_type')) = 'config_item'
      AND COALESCE((rit.data->>'active')::boolean, true) = true
      AND lower(COALESCE(rit.data->>'category_name', rit.data->>'category')) = lower(_category)
  ), opening AS (
    SELECT DISTINCT ON (ros.data->>'item_name')
      ros.data->>'item_name' AS item_name,
      COALESCE((ros.data->>'quantity')::numeric, 0) AS qty
    FROM public.operational_records ros
    WHERE ros.status = 'approved'
      AND ros.deleted_at IS NULL
      AND ros.entity_type = 'storekeeper'
      AND lower(COALESCE(ros.data->>'type', ros.data->>'record_type')) = 'opening_stock'
    ORDER BY ros.data->>'item_name', ros.created_at DESC NULLS LAST, ros.reviewed_at DESC NULLS LAST
  )
  SELECT i.item_name, i.unit, i.unit_price, COALESCE(o.qty, 0) AS opening_stock
  FROM items i
  LEFT JOIN opening o ON o.item_name = i.item_name
  WHERE i.item_name IS NOT NULL AND i.item_name <> ''
  ORDER BY i.item_name;
$$;
GRANT EXECUTE ON FUNCTION public.list_items_for_category(text) TO PUBLIC;