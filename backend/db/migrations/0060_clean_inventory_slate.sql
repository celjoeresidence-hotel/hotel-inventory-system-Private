-- Migration 0060: Clean Inventory Slate
-- Wipes all inventory stock values and transaction history while preserving:
-- 1. Configurations (Categories, Collections, Items, Rooms)
-- 2. User Profiles
-- 3. Front Desk Operational Records

-- 1. Wipe new inventory transactions (The new ledger)
TRUNCATE TABLE public.inventory_transactions;

-- 2. Wipe legacy operational records for Inventory Departments (Store, Kitchen, Bar)
-- BUT PRESERVE:
-- - Front Desk records (entity_type = 'front_desk')
-- - Configuration records (type starts with 'config_')
DELETE FROM public.operational_records
WHERE entity_type IN ('storekeeper', 'kitchen', 'bar')
  AND (
      COALESCE(data->>'type', data->>'record_type', '') NOT LIKE 'config_%'
  );

-- 3. Reset Inventory Items Cache/Snapshot columns
-- (No cache columns current_stock/last_restocked exist on inventory_items table, 
-- so no update needed here. Stock is purely transactional.)


-- 4. Reset sequences if any (optional but good for clean slate feel, though UUIDs are used mostly)
-- No serial sequences for transactions, they use UUIDs.

-- 5. Note: Views (v_inventory_ledger, etc.) will automatically reflect the empty state.
