-- Migration 0005: Triggers and audit (Supabase-native, profiles-linked)
-- Implements audit logs, workflow enforcement, versioning, and deletion rules

-- Audit logs table referencing profiles
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.profiles(id),
  action_type text NOT NULL,
  entity_type entity_type NOT NULL,
  entity_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  diffs jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON public.audit_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at);

-- Helper: write audit log
CREATE OR REPLACE FUNCTION public.log_audit(action_type text, _entity_id uuid, _entity_type entity_type, details jsonb, diffs jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.audit_logs(actor_id, action_type, entity_type, entity_id, details, diffs)
  VALUES (app_current_user_id(), action_type, _entity_type, _entity_id, COALESCE(details, '{}'::jsonb), diffs);
END$$;

-- Maintain updated_at timestamp
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END$$;

CREATE OR REPLACE FUNCTION public.operational_records_set_original_id()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.original_id IS NULL THEN
    NEW.original_id := NEW.id;
  END IF;
  RETURN NEW;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE t.tgname = 'trg_operational_records_set_original_id'
      AND c.relname = 'operational_records'
      AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_operational_records_set_original_id
    BEFORE INSERT ON public.operational_records
    FOR EACH ROW EXECUTE FUNCTION public.operational_records_set_original_id();
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE t.tgname = 'trg_operational_records_updated_at'
      AND c.relname = 'operational_records'
      AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_operational_records_updated_at
    BEFORE UPDATE ON public.operational_records
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END
$$;

-- BEFORE INSERT: versioning and role-based defaults
CREATE OR REPLACE FUNCTION public.operational_records_before_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prev public.operational_records;
  rec_type text;
BEGIN
  -- Staff must submit pending records and as themselves
  IF app_is_staff() THEN
    NEW.status := 'pending';
    IF NEW.submitted_by IS NULL THEN
      NEW.submitted_by := app_current_user_id();
    END IF;
    IF NEW.submitted_by <> app_current_user_id() THEN
      RAISE EXCEPTION 'Staff can only submit records for themselves.';
    END IF;
  END IF;

  -- If inserting a correction/override referencing a previous version, propagate chain
  IF NEW.previous_version_id IS NOT NULL THEN
    SELECT * INTO prev FROM public.operational_records WHERE id = NEW.previous_version_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'previous_version_id % does not exist', NEW.previous_version_id;
    END IF;
    NEW.original_id := prev.original_id;
    NEW.version_no := prev.version_no + 1;
    NEW.entity_type := prev.entity_type;

    -- Admin/Manager overrides are inserted as approved with reviewer metadata
    IF app_current_role() IN ('manager','admin') THEN
      NEW.status := 'approved';
      NEW.reviewed_by := app_current_user_id();
      NEW.reviewed_at := now();
      NEW.rejection_reason := NULL;
    END IF;
  ELSE
    -- If this is the first version, ensure original_id is set
    IF NEW.original_id IS NULL THEN
      NEW.original_id := NEW.id;
    END IF;
  END IF;
 
  -- DEBUG: temporarily relax entity_type validation for debugging inserts
  -- No validation enforced here; all entity_type values pass

  rec_type := COALESCE(NEW.data->>'type', NEW.data->>'record_type');

  -- Block staff from inserting inventory structure configs
  IF app_is_staff() AND lower(rec_type) IN ('config_category','config_collection') THEN
    RAISE EXCEPTION 'Staff cannot create or edit inventory categories/collections.';
  END IF;

  -- Auto-approve inventory structure configs for admin/manager/supervisor
  IF lower(rec_type) IN ('config_category','config_collection') AND app_current_role() IN ('admin','manager','supervisor') THEN
    NEW.status := 'approved';
    NEW.reviewed_by := app_current_user_id();
    NEW.reviewed_at := now();
  END IF;

  -- Default submitted_by to current user if not provided
  IF NEW.submitted_by IS NULL THEN
    NEW.submitted_by := app_current_user_id();
  END IF;

  -- Prevent duplicates (case-insensitive)
  IF lower(rec_type) = 'config_category' THEN
    IF EXISTS (
      SELECT 1 FROM public.operational_records
      WHERE deleted_at IS NULL
        AND lower(data->>'type') = 'config_category'
        AND lower(COALESCE(data->>'category_name', data->>'category')) = lower(COALESCE(NEW.data->>'category_name', NEW.data->>'category'))
    ) THEN
      RAISE EXCEPTION 'Category % already exists.', COALESCE(NEW.data->>'category_name', NEW.data->>'category');
    END IF;
  ELSIF lower(rec_type) = 'config_collection' THEN
    IF EXISTS (
      SELECT 1 FROM public.operational_records
      WHERE deleted_at IS NULL
        AND lower(data->>'type') = 'config_collection'
        AND lower(COALESCE(data->>'category_name', data->>'category')) = lower(COALESCE(NEW.data->>'category_name', NEW.data->>'category'))
        AND lower(data->>'collection_name') = lower(NEW.data->>'collection_name')
    ) THEN
      RAISE EXCEPTION 'Collection % already exists for category %.', NEW.data->>'collection_name', COALESCE(NEW.data->>'category_name', NEW.data->>'category');
    END IF;
  END IF;

  -- DEBUG: temporarily disable financial_amount restrictions for debugging
  -- No checks on financial_amount during debugging
  -- Original constraints commented out:
  -- IF NEW.entity_type <> 'front_desk'::public.entity_type THEN
  --   IF COALESCE(NEW.financial_amount, 0) <> 0 THEN
  --     RAISE EXCEPTION 'financial_amount must be 0 for non-front_desk records';
  --   END IF;
  -- ELSE
  --   IF COALESCE(NEW.financial_amount, 0) > 0 THEN
  --     IF rec_type <> 'room_booking' THEN
  --       RAISE EXCEPTION 'financial_amount allowed only when data.type = room_booking for front_desk records';
  --     END IF;
  --   END IF;
  -- END IF;

  RETURN NEW;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE t.tgname = 'trg_operational_records_before_insert'
      AND c.relname = 'operational_records'
      AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_operational_records_before_insert
    BEFORE INSERT ON public.operational_records
    FOR EACH ROW EXECUTE FUNCTION public.operational_records_before_insert();
  END IF;
END
$$;

-- BEFORE UPDATE: enforce workflow rules
CREATE OR REPLACE FUNCTION public.operational_records_guard_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Staff: cannot edit submitted records; only soft delete their own pending/rejected submissions
  IF app_is_staff() THEN
    IF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      -- Only allow setting deleted_at from NULL to a timestamp on pending/rejected
      IF OLD.status NOT IN ('pending','rejected') THEN
        RAISE EXCEPTION 'Staff can only soft delete pending or rejected submissions.';
      END IF;
      IF OLD.submitted_by <> app_current_user_id() THEN
        RAISE EXCEPTION 'Staff can only soft delete their own submissions.';
      END IF;
      IF OLD.deleted_at IS NOT NULL THEN
        RAISE EXCEPTION 'Record already soft deleted.';
      END IF;
      -- Permit soft delete; other columns must remain unchanged
      IF NEW.financial_amount <> OLD.financial_amount OR NEW.data IS DISTINCT FROM OLD.data OR NEW.status <> OLD.status OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason OR NEW.submitted_by <> OLD.submitted_by OR NEW.entity_type <> OLD.entity_type OR NEW.previous_version_id IS DISTINCT FROM OLD.previous_version_id OR NEW.original_id <> OLD.original_id OR NEW.version_no <> OLD.version_no THEN
        RAISE EXCEPTION 'Staff cannot modify record fields other than deleted_at.';
      END IF;
      RETURN NEW;
    ELSE
      RAISE EXCEPTION 'Staff cannot edit submitted records.';
    END IF;
  END IF;

  -- Supervisor: can only transition status from pending -> approved/rejected and set review metadata; cannot change financial/data
  IF app_current_role() = 'supervisor' THEN
    IF OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'Only pending records can be reviewed by supervisor.';
    END IF;
    IF NEW.status NOT IN ('approved','rejected') THEN
      RAISE EXCEPTION 'Supervisor must set status to approved or rejected.';
    END IF;
    IF NEW.financial_amount <> OLD.financial_amount OR NEW.data IS DISTINCT FROM OLD.data THEN
      RAISE EXCEPTION 'Supervisors cannot change financial/data values.';
    END IF;
    -- Ensure no other fields change except review metadata and rejection_reason when rejected
    IF NEW.submitted_by <> OLD.submitted_by OR NEW.entity_type <> OLD.entity_type OR NEW.previous_version_id IS DISTINCT FROM OLD.previous_version_id OR NEW.original_id <> OLD.original_id OR NEW.version_no <> OLD.version_no OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      RAISE EXCEPTION 'Supervisors cannot modify record fields other than status and review metadata.';
    END IF;
    NEW.reviewed_by := app_current_user_id();
    NEW.reviewed_at := now();
    IF NEW.status = 'approved' THEN
      NEW.rejection_reason := NULL;
    ELSE
      IF COALESCE(NEW.rejection_reason, '') = '' THEN
        RAISE EXCEPTION 'Rejection must include a rejection_reason.';
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  -- Manager/Admin: cannot directly change financial/data on existing records; use correction versions instead
  IF app_current_role() IN ('manager','admin') THEN
    IF NEW.financial_amount <> OLD.financial_amount OR NEW.data IS DISTINCT FROM OLD.data THEN
      RAISE EXCEPTION 'Financial/data changes must be made via a correction version insert, not direct update.';
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE t.tgname = 'trg_operational_records_guard_update'
      AND c.relname = 'operational_records'
      AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_operational_records_guard_update
    BEFORE UPDATE ON public.operational_records
    FOR EACH ROW EXECUTE FUNCTION public.operational_records_guard_update();
  END IF;
END
$$;

-- AFTER UPDATE: audit approvals, rejections, soft deletes
CREATE OR REPLACE FUNCTION public.operational_records_after_update()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  diffs jsonb;
BEGIN
  diffs := jsonb_build_object(
    'status', CASE WHEN NEW.status <> OLD.status THEN jsonb_build_object('old', to_jsonb(OLD.status), 'new', to_jsonb(NEW.status)) END,
    'financial_amount', CASE WHEN NEW.financial_amount <> OLD.financial_amount THEN jsonb_build_object('old', to_jsonb(OLD.financial_amount), 'new', to_jsonb(NEW.financial_amount)) END,
    'data', CASE WHEN NEW.data IS DISTINCT FROM OLD.data THEN jsonb_build_object('old', OLD.data, 'new', NEW.data) END,
    'deleted_at', CASE WHEN NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN jsonb_build_object('old', COALESCE(to_jsonb(OLD.deleted_at), 'null'::jsonb), 'new', COALESCE(to_jsonb(NEW.deleted_at), 'null'::jsonb)) END,
    'reviewed_by', CASE WHEN NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by THEN jsonb_build_object('old', to_jsonb(OLD.reviewed_by), 'new', to_jsonb(NEW.reviewed_by)) END,
    'reviewed_at', CASE WHEN NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at THEN jsonb_build_object('old', COALESCE(to_jsonb(OLD.reviewed_at), 'null'::jsonb), 'new', COALESCE(to_jsonb(NEW.reviewed_at), 'null'::jsonb)) END,
    'rejection_reason', CASE WHEN NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN jsonb_build_object('old', COALESCE(to_jsonb(OLD.rejection_reason), 'null'::jsonb), 'new', COALESCE(to_jsonb(NEW.rejection_reason), 'null'::jsonb)) END
  );

  IF NEW.status = 'approved' AND OLD.status = 'pending' THEN
    PERFORM public.log_audit('approvals', NEW.id, NEW.entity_type, jsonb_build_object('message','Record approved'), diffs);
  ELSIF NEW.status = 'rejected' AND OLD.status = 'pending' THEN
    PERFORM public.log_audit('rejections', NEW.id, NEW.entity_type, jsonb_build_object('message','Record rejected','rejection_reason', NEW.rejection_reason), diffs);
  ELSIF NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
    PERFORM public.log_audit('soft_delete', NEW.id, NEW.entity_type, jsonb_build_object('message','Record soft deleted'), diffs);
  ELSE
    -- Other administrative metadata edits
    PERFORM public.log_audit('administrative_actions', NEW.id, NEW.entity_type, jsonb_build_object('message','Administrative edit'), diffs);
  END IF;

  RETURN NEW;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE t.tgname = 'trg_operational_records_after_update'
      AND c.relname = 'operational_records'
      AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_operational_records_after_update
    AFTER UPDATE ON public.operational_records
    FOR EACH ROW EXECUTE FUNCTION public.operational_records_after_update();
  END IF;
END
$$;

-- AFTER INSERT: audit submissions and correction versions
CREATE OR REPLACE FUNCTION public.operational_records_after_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  prev public.operational_records;
  diffs jsonb := NULL;
BEGIN
  IF NEW.previous_version_id IS NOT NULL THEN
    SELECT * INTO prev FROM public.operational_records WHERE id = NEW.previous_version_id;
    IF FOUND THEN
      diffs := jsonb_build_object(
        'financial_amount', CASE WHEN NEW.financial_amount <> prev.financial_amount THEN jsonb_build_object('old', to_jsonb(prev.financial_amount), 'new', to_jsonb(NEW.financial_amount)) END,
        'data', CASE WHEN NEW.data IS DISTINCT FROM prev.data THEN jsonb_build_object('old', prev.data, 'new', NEW.data) END
      );
      -- Determine if this is a financial change or general data edit
      IF NEW.financial_amount <> prev.financial_amount THEN
        PERFORM public.log_audit('financial_changes', NEW.id, NEW.entity_type, jsonb_build_object('message','Correction version with financial change','previous_version_id', NEW.previous_version_id), diffs);
      ELSE
        PERFORM public.log_audit('data_edits', NEW.id, NEW.entity_type, jsonb_build_object('message','Correction/override version','previous_version_id', NEW.previous_version_id), diffs);
      END IF;
    ELSE
      PERFORM public.log_audit('data_edits', NEW.id, NEW.entity_type, jsonb_build_object('message','Version created with missing previous reference'), NULL);
    END IF;
  ELSE
    -- Initial submission
    PERFORM public.log_audit('administrative_actions', NEW.id, NEW.entity_type, jsonb_build_object('message','Record created','status', NEW.status), NULL);
  END IF;
  RETURN NEW;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE t.tgname = 'trg_operational_records_after_insert'
      AND c.relname = 'operational_records'
      AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_operational_records_after_insert
    AFTER INSERT ON public.operational_records
    FOR EACH ROW EXECUTE FUNCTION public.operational_records_after_insert();
  END IF;
END
$$;

-- AFTER DELETE: audit hard deletes
CREATE OR REPLACE FUNCTION public.operational_records_after_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM public.log_audit('hard_delete', OLD.id, OLD.entity_type, jsonb_build_object('message','Record permanently deleted'), NULL);
  RETURN NULL;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON t.tgrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE t.tgname = 'trg_operational_records_after_delete'
      AND c.relname = 'operational_records'
      AND n.nspname = 'public'
  ) THEN
    CREATE TRIGGER trg_operational_records_after_delete
    AFTER DELETE ON public.operational_records
    FOR EACH ROW EXECUTE FUNCTION public.operational_records_after_delete();
  END IF;
END
$$;