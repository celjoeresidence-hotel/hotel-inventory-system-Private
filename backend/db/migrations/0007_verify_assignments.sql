-- Temporary verification query for assigned_to updates on config_category
-- Run this after applying migration 0006 changes to api.edit_config_record

-- Note: This file is TEMPORARY for verification purposes and can be removed after confirming correctness.

-- Verify latest updates reflect canonical assigned_to shape
SELECT id, data->'assigned_to'
FROM public.operational_records
WHERE entity_type = 'config_category'
ORDER BY updated_at DESC;