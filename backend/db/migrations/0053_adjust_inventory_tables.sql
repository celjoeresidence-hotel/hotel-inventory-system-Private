ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

ALTER TABLE public.inventory_transactions
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS event_timestamp timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_status_check'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD CONSTRAINT inventory_transactions_status_check
        CHECK (status IN ('pending','approved','rejected'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'inventory_transactions_type_check'
  ) THEN
    ALTER TABLE public.inventory_transactions
      ADD CONSTRAINT inventory_transactions_type_check
        CHECK (transaction_type IN ('opening_stock','stock_restock','stock_issued','sold','consumed','adjustment'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_inventory_items_deleted_at ON public.inventory_items(deleted_at);
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_status ON public.inventory_transactions(status);

DROP POLICY IF EXISTS "Enable write access for staff" ON public.inventory_categories;
DROP POLICY IF EXISTS "Enable write access for staff" ON public.inventory_collections;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy 
    WHERE polname = 'Allow insert categories for managers/admins' 
      AND polrelid = 'public.inventory_categories'::regclass
  ) THEN
    ALTER POLICY "Allow insert categories for managers/admins" ON public.inventory_categories
      TO authenticated
      WITH CHECK (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      );
  ELSE
    CREATE POLICY "Allow insert categories for managers/admins" ON public.inventory_categories
      FOR INSERT TO authenticated
      WITH CHECK (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy 
    WHERE polname = 'Allow update categories for managers/admins' 
      AND polrelid = 'public.inventory_categories'::regclass
  ) THEN
    ALTER POLICY "Allow update categories for managers/admins" ON public.inventory_categories
      TO authenticated
      USING (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      )
      WITH CHECK (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      );
  ELSE
    CREATE POLICY "Allow update categories for managers/admins" ON public.inventory_categories
      FOR UPDATE TO authenticated
      USING (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      )
      WITH CHECK (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy 
    WHERE polname = 'Allow delete categories for managers/admins' 
      AND polrelid = 'public.inventory_categories'::regclass
  ) THEN
    ALTER POLICY "Allow delete categories for managers/admins" ON public.inventory_categories
      TO authenticated
      USING (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      );
  ELSE
    CREATE POLICY "Allow delete categories for managers/admins" ON public.inventory_categories
      FOR DELETE TO authenticated
      USING (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy 
    WHERE polname = 'Allow insert collections for managers/admins' 
      AND polrelid = 'public.inventory_collections'::regclass
  ) THEN
    ALTER POLICY "Allow insert collections for managers/admins" ON public.inventory_collections
      TO authenticated
      WITH CHECK (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      );
  ELSE
    CREATE POLICY "Allow insert collections for managers/admins" ON public.inventory_collections
      FOR INSERT TO authenticated
      WITH CHECK (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy 
    WHERE polname = 'Allow update collections for managers/admins' 
      AND polrelid = 'public.inventory_collections'::regclass
  ) THEN
    ALTER POLICY "Allow update collections for managers/admins" ON public.inventory_collections
      TO authenticated
      USING (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      )
      WITH CHECK (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      );
  ELSE
    CREATE POLICY "Allow update collections for managers/admins" ON public.inventory_collections
      FOR UPDATE TO authenticated
      USING (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      )
      WITH CHECK (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policy 
    WHERE polname = 'Allow delete collections for managers/admins' 
      AND polrelid = 'public.inventory_collections'::regclass
  ) THEN
    ALTER POLICY "Allow delete collections for managers/admins" ON public.inventory_collections
      TO authenticated
      USING (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      );
  ELSE
    CREATE POLICY "Allow delete collections for managers/admins" ON public.inventory_collections
      FOR DELETE TO authenticated
      USING (
        app_current_role() IN ('storekeeper','supervisor','manager','admin') OR
        EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper','supervisor','manager','admin'))
      );
  END IF;
END $$;
