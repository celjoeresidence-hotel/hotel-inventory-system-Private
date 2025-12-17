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

  -- Merge patch, preserve type
  new_data := (prev.data || COALESCE(_data, '{}'::jsonb)) || jsonb_build_object('type', rec_type);

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
  IF app_current_role() NOT IN ('manager','admin') THEN
    RAISE EXCEPTION 'Only manager/admin can permanently delete records.';
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