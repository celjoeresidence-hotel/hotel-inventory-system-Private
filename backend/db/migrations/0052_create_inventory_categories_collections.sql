-- Migration 0052: Create Inventory Categories and Collections Tables
-- Replaces operational_records for storing category and collection configurations.

-- 1. Create inventory_categories table
CREATE TABLE public.inventory_categories (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    assigned_to text[] DEFAULT '{}', -- Array of roles (kitchen, bar, storekeeper)
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT inventory_categories_name_key UNIQUE (name)
);

-- 2. Create inventory_collections table
CREATE TABLE public.inventory_collections (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    category_id uuid REFERENCES public.inventory_categories(id) ON DELETE CASCADE,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT inventory_collections_name_category_key UNIQUE (name, category_id)
);

-- 3. Enable RLS
ALTER TABLE public.inventory_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_collections ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policies
-- Read: All authenticated users can read
CREATE POLICY "Enable read access for authenticated users" ON public.inventory_categories
    FOR SELECT TO authenticated USING (deleted_at IS NULL);

CREATE POLICY "Enable read access for authenticated users" ON public.inventory_collections
    FOR SELECT TO authenticated USING (deleted_at IS NULL);

-- Write: Only Storekeepers, Managers, Admins can write (matching app logic)
-- Actually, the app logic allows 'storekeeper', 'supervisor', 'manager', 'admin'.
-- We'll use a broad policy for now to match current operational_records permissiveness for these roles.

CREATE POLICY "Enable write access for staff" ON public.inventory_categories
    FOR ALL TO authenticated
    USING (
        (app_current_role() IN ('storekeeper', 'manager', 'admin') OR 
         EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper', 'manager', 'admin')))
    );

CREATE POLICY "Enable write access for staff" ON public.inventory_collections
    FOR ALL TO authenticated
    USING (
        (app_current_role() IN ('storekeeper', 'manager', 'admin') OR 
         EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('storekeeper', 'manager', 'admin')))
    );

-- 5. Migrate Data from operational_records
DO $$
DECLARE
    r RECORD;
    cat_id uuid;
    cat_name text;
    col_name text;
    assigned text[];
    is_active boolean;
    latest_records JSONB;
BEGIN
    -- 5.1 Migrate Categories
    -- We need to get the latest approved version for each category
    FOR r IN 
        SELECT DISTINCT ON (data->>'category_name', data->>'category')
            COALESCE(data->>'category_name', data->>'category') as name,
            data->>'assigned_to' as assigned_raw,
            (data->>'active')::boolean as active
        FROM public.operational_records
        WHERE entity_type = 'storekeeper'
          AND status = 'approved'
          AND deleted_at IS NULL
          AND data->>'type' = 'config_category'
        ORDER BY data->>'category_name', data->>'category', created_at DESC
    LOOP
        cat_name := r.name;
        is_active := COALESCE(r.active, true);
        
        -- Handle assigned_to (can be array or object)
        IF jsonb_typeof(to_jsonb(r.assigned_raw)) = 'array' THEN
            assigned := ARRAY(SELECT jsonb_array_elements_text(to_jsonb(r.assigned_raw)));
        ELSIF jsonb_typeof(to_jsonb(r.assigned_raw)) = 'object' THEN
             assigned := ARRAY(SELECT key FROM jsonb_each(to_jsonb(r.assigned_raw)) WHERE value::text = 'true');
        ELSE
            assigned := '{}';
        END IF;

        IF cat_name IS NOT NULL AND cat_name != '' THEN
            INSERT INTO public.inventory_categories (name, assigned_to, is_active)
            VALUES (cat_name, assigned, is_active)
            ON CONFLICT (name) DO UPDATE 
            SET assigned_to = EXCLUDED.assigned_to, 
                is_active = EXCLUDED.is_active,
                updated_at = NOW();
        END IF;
    END LOOP;

    -- 5.2 Migrate Collections
    FOR r IN
        SELECT DISTINCT ON (data->>'collection_name')
            data->>'collection_name' as name,
            COALESCE(data->>'category_name', data->>'category') as category_name,
            (data->>'active')::boolean as active
        FROM public.operational_records
        WHERE entity_type = 'storekeeper'
          AND status = 'approved'
          AND deleted_at IS NULL
          AND data->>'type' = 'config_collection'
        ORDER BY data->>'collection_name', created_at DESC
    LOOP
        col_name := r.name;
        cat_name := r.category_name;
        is_active := COALESCE(r.active, true);

        IF col_name IS NOT NULL AND col_name != '' AND cat_name IS NOT NULL THEN
            -- Find category ID
            SELECT id INTO cat_id FROM public.inventory_categories WHERE name = cat_name;
            
            IF cat_id IS NOT NULL THEN
                INSERT INTO public.inventory_collections (name, category_id, is_active)
                VALUES (col_name, cat_id, is_active)
                ON CONFLICT (name, category_id) DO UPDATE
                SET is_active = EXCLUDED.is_active,
                    updated_at = NOW();
            END IF;
        END IF;
    END LOOP;
END $$;
