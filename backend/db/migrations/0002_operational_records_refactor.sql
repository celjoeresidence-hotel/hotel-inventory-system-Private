-- Migration 0002: Operational Records refactor (profiles linkage) and canonical view
-- Align operational_records with Supabase profiles and prepare canonical view

-- Create table if not exists with correct references (submitted_by/reviewed_by -> profiles)
CREATE TABLE IF NOT EXISTS public.operational_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type entity_type NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  financial_amount numeric(12,2) NOT NULL DEFAULT 0,
  status approval_status NOT NULL DEFAULT 'pending',
  submitted_by uuid NOT NULL REFERENCES public.profiles(id),
  reviewed_by uuid REFERENCES public.profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  previous_version_id uuid REFERENCES public.operational_records(id),
  original_id uuid NOT NULL,
  version_no int NOT NULL DEFAULT 1,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT financial_amount_nonnegative CHECK (financial_amount >= 0)
);

-- If table already exists from legacy schema, adjust FKs to public.profiles
DO $$
DECLARE
  rec RECORD;
BEGIN
  -- Fix submitted_by FK to point to public.profiles(id)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'operational_records' AND column_name = 'submitted_by'
  ) THEN
    FOR rec IN
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_name = kcu.table_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public' AND tc.table_name = 'operational_records'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'submitted_by'
    LOOP
      EXECUTE format('ALTER TABLE public.operational_records DROP CONSTRAINT %I', rec.constraint_name);
    END LOOP;

    BEGIN
      ALTER TABLE public.operational_records
        ADD CONSTRAINT fk_operational_records_submitted_by_profiles
        FOREIGN KEY (submitted_by) REFERENCES public.profiles(id);
    EXCEPTION WHEN duplicate_object THEN
      -- Already exists, ignore
      NULL;
    END;
  END IF;

  -- Fix reviewed_by FK to point to public.profiles(id)
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'operational_records' AND column_name = 'reviewed_by'
  ) THEN
    FOR rec IN
      SELECT tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name AND tc.table_name = kcu.table_name AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public' AND tc.table_name = 'operational_records'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND kcu.column_name = 'reviewed_by'
    LOOP
      EXECUTE format('ALTER TABLE public.operational_records DROP CONSTRAINT %I', rec.constraint_name);
    END LOOP;

    BEGIN
      ALTER TABLE public.operational_records
        ADD CONSTRAINT fk_operational_records_reviewed_by_profiles
        FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);
    EXCEPTION WHEN duplicate_object THEN
      -- Already exists, ignore
      NULL;
    END;
  END IF;
END$$;

-- Canonical view: latest approved and not soft-deleted per original chain
CREATE OR REPLACE VIEW public.canonical_operational_records AS
SELECT DISTINCT ON (original_id) r.*
FROM public.operational_records r
WHERE r.status = 'approved' AND r.deleted_at IS NULL
ORDER BY original_id, reviewed_at DESC NULLS LAST, created_at DESC;

-- Helpful indexes
CREATE INDEX IF NOT EXISTS idx_operational_records_status ON public.operational_records(status);
CREATE INDEX IF NOT EXISTS idx_operational_records_entity_type ON public.operational_records(entity_type);
CREATE INDEX IF NOT EXISTS idx_operational_records_submitted_by ON public.operational_records(submitted_by);
CREATE INDEX IF NOT EXISTS idx_operational_records_original_id ON public.operational_records(original_id);
CREATE INDEX IF NOT EXISTS idx_operational_records_previous_version_id ON public.operational_records(previous_version_id);
CREATE INDEX IF NOT EXISTS idx_operational_records_deleted_at ON public.operational_records(deleted_at);