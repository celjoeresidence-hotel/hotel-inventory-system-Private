-- Migration 0056: Migrate legacy stock to inventory_transactions
-- Moves inventory_items.current_stock to inventory_transactions as 'opening_stock'
-- This ensures the Storekeeper view (which relies on transactions) sees the legacy stock.

DO $$
DECLARE
    r RECORD;
    count_migrated INTEGER := 0;
BEGIN
    -- Source opening stock from the catalog/current inventory views (ledger-based),
    -- and map to inventory_items by item_name.
    FOR r IN
        SELECT 
            i.id,
            COALESCE(cur.current_stock, 0) AS current_stock,
            COALESCE(i.unit_price, 0) AS unit_price
        FROM public.inventory_items i
        LEFT JOIN public.v_current_inventory cur 
          ON cur.item_name = i.item_name AND cur.department = 'STORE'
        WHERE COALESCE(cur.current_stock, 0) <> 0
          AND i.deleted_at IS NULL
    LOOP
        -- Check if any transaction exists for this item (to prevent double migration)
        IF NOT EXISTS (SELECT 1 FROM inventory_transactions WHERE item_id = r.id) THEN
            IF r.current_stock > 0 THEN
                INSERT INTO inventory_transactions (
                    item_id, department, transaction_type, quantity_in, quantity_out, 
                    unit_price, total_value, event_date, status, staff_name, notes
                ) VALUES (
                    r.id, 'STORE', 'opening_stock', r.current_stock, 0,
                    COALESCE(r.unit_price, 0), COALESCE(r.unit_price, 0) * r.current_stock, CURRENT_DATE, 'approved', 'System Migration', 'Migrated from legacy current_stock'
                );
                count_migrated := count_migrated + 1;
            ELSIF r.current_stock < 0 THEN
                -- Handle negative stock as adjustment (quantity_out)
                -- We assume we start at 0 and adjust down.
                -- Note: This might result in negative stock in ledger, which is allowed for calculated balance,
                -- but quantity_out itself must be positive.
                INSERT INTO inventory_transactions (
                    item_id, department, transaction_type, quantity_in, quantity_out,
                    unit_price, total_value, event_date, status, staff_name, notes
                ) VALUES (
                    r.id, 'STORE', 'adjustment', 0, ABS(r.current_stock),
                    COALESCE(r.unit_price, 0), 0, CURRENT_DATE, 'approved', 'System Migration', 'Migrated negative legacy stock'
                );
                count_migrated := count_migrated + 1;
            END IF;
        END IF;
    END LOOP;
    
    RAISE NOTICE 'Migrated % items from legacy stock.', count_migrated;
END $$;
