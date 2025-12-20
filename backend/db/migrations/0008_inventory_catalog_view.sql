-- Migration 0008: Inventory Catalog read-only view derived from Inventory Setup data
-- No new tables; create a SQL VIEW from operational_records

-- View definition: approved, non-deleted configuration records (category, collection, item)
-- Join by names available in data JSON (category, collection_name, item_name)
-- Compute current_stock from latest approved opening_stock per item

CREATE OR REPLACE VIEW public.inventory_catalog_view AS
WITH categories AS (
  SELECT
    COALESCE(rc.data->>'category_name', rc.data->>'category') AS category_name
  FROM public.canonical_operational_records rc
  WHERE rc.entity_type = 'storekeeper'
    AND lower(COALESCE(rc.data->>'type', rc.data->>'record_type')) = 'config_category'
    AND COALESCE((rc.data->>'active')::boolean, true) = true
),
collections AS (
  SELECT
    rcol.data->>'collection_name' AS collection_name,
    COALESCE(rcol.data->>'category_name', rcol.data->>'category') AS category
  FROM public.canonical_operational_records rcol
  WHERE rcol.entity_type = 'storekeeper'
    AND lower(COALESCE(rcol.data->>'type', rcol.data->>'record_type')) = 'config_collection'
    AND COALESCE((rcol.data->>'active')::boolean, true) = true
),
items AS (
  SELECT
    rit.data->>'item_name' AS item_name,
    rit.data->>'collection_name' AS collection_name,
    COALESCE(rit.data->>'category_name', rit.data->>'category') AS category,
    rit.data->>'unit' AS unit
  FROM public.canonical_operational_records rit
  WHERE rit.entity_type = 'storekeeper'
    AND lower(COALESCE(rit.data->>'type', rit.data->>'record_type')) = 'config_item'
),
opening_stock AS (
  SELECT DISTINCT ON (ros.data->>'item_name')
    ros.data->>'item_name' AS item_name,
    COALESCE((ros.data->>'quantity')::numeric, 0) AS current_stock
  FROM public.operational_records ros
  WHERE ros.status = 'approved'
    AND ros.deleted_at IS NULL
    AND ros.entity_type = 'storekeeper'
    AND lower(COALESCE(ros.data->>'type', ros.data->>'record_type')) = 'opening_stock'
  ORDER BY ros.data->>'item_name', ros.created_at DESC NULLS LAST, ros.reviewed_at DESC NULLS LAST
)
SELECT
  i.category AS category,
  i.collection_name AS collection_name,
  i.item_name AS item_name,
  i.unit AS unit,
  COALESCE(os.current_stock, 0) AS current_stock
FROM items i
JOIN collections c ON c.collection_name = i.collection_name AND lower(c.category) = lower(i.category)
JOIN categories cat ON lower(cat.category_name) = lower(i.category)
LEFT JOIN opening_stock os ON os.item_name = i.item_name;

-- Grant read-only access to authenticated users
GRANT SELECT ON public.inventory_catalog_view TO authenticated;