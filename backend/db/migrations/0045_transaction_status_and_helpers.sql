-- Migration 0045: Transaction Status and Helper RPCs
-- Adds status column for approval workflows and creates stock state RPCs.

-- 1. Add status column to inventory_transactions
ALTER TABLE public.inventory_transactions 
ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending', 'approved', 'rejected'));

-- Index for status
CREATE INDEX IF NOT EXISTS idx_inventory_transactions_status ON public.inventory_transactions(status);

-- 2. Storekeeper Stock State RPC
CREATE OR REPLACE FUNCTION public.get_storekeeper_stock_state(
    _date date,
    _category text DEFAULT NULL,
    _collection text DEFAULT NULL
)
RETURNS TABLE (
    item_id uuid,
    item_name text,
    unit text,
    opening_stock numeric,
    restocked_today numeric,
    issued_today numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    WITH items AS (
        SELECT i.id, i.item_name, i.unit
        FROM inventory_items i
        WHERE i.active = true
          AND i.deleted_at IS NULL
          AND (_category IS NULL OR i.category = _category)
          AND (_collection IS NULL OR i.collection = _collection)
    ),
    opening AS (
        SELECT 
            t.item_id, 
            SUM(CASE 
                WHEN t.transaction_type = 'stock_restock' OR t.transaction_type = 'opening_stock' THEN t.quantity_in
                ELSE -t.quantity_out 
            END) as qty
        FROM inventory_transactions t
        WHERE t.event_date < _date
          AND t.status = 'approved' -- Only approved stock counts
          AND t.department = 'STORE'
        GROUP BY t.item_id
    ),
    today_tx AS (
        SELECT 
            t.item_id,
            SUM(CASE WHEN t.transaction_type IN ('stock_restock', 'opening_stock') THEN t.quantity_in ELSE 0 END) as restocked,
            SUM(CASE WHEN t.transaction_type = 'stock_issued' THEN t.quantity_out ELSE 0 END) as issued
        FROM inventory_transactions t
        WHERE t.event_date = _date
          AND t.status = 'approved'
          AND t.department = 'STORE'
        GROUP BY t.item_id
    )
    SELECT 
        i.id, 
        i.item_name, 
        i.unit, 
        COALESCE(o.qty, 0) as opening_stock, 
        COALESCE(tt.restocked, 0) as restocked_today, 
        COALESCE(tt.issued, 0) as issued_today
    FROM items i
    LEFT JOIN opening o ON o.item_id = i.id
    LEFT JOIN today_tx tt ON tt.item_id = i.id
    ORDER BY i.item_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_storekeeper_stock_state(date, text, text) TO authenticated;

-- 3. Update Department Stock State RPC (Kitchen/Bar) to use status
CREATE OR REPLACE FUNCTION public.get_department_stock_state(
    _date date,
    _department text, -- 'KITCHEN' or 'BAR'
    _category text
)
RETURNS TABLE (
    item_id uuid,
    item_name text,
    unit text,
    unit_price numeric,
    opening_stock numeric,
    restocked_today numeric,
    sold_today numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    WITH 
    items AS (
        SELECT i.id, i.item_name, i.unit, i.unit_price
        FROM inventory_items i
        WHERE i.category = _category
          AND i.active = true
          AND i.deleted_at IS NULL
    ),
    opening AS (
        SELECT 
            t.item_id, 
            SUM(CASE 
                WHEN t.transaction_type = 'stock_restock' OR t.transaction_type = 'opening_stock' THEN t.quantity_in
                ELSE -t.quantity_out 
            END) as qty
        FROM inventory_transactions t
        WHERE t.department = _department
          AND t.event_date < _date
          AND t.status = 'approved'
        GROUP BY t.item_id
    ),
    today_tx AS (
        SELECT 
            t.item_id,
            SUM(CASE WHEN t.transaction_type IN ('stock_restock', 'opening_stock') THEN t.quantity_in ELSE 0 END) as restocked,
            SUM(CASE WHEN t.transaction_type IN ('stock_issued', 'sold', 'consumed') THEN t.quantity_out ELSE 0 END) as sold
        FROM inventory_transactions t
        WHERE t.department = _department
          AND t.event_date = _date
          AND t.status = 'approved'
        GROUP BY t.item_id
    )
    SELECT 
        i.id, 
        i.item_name, 
        i.unit, 
        COALESCE(i.unit_price, 0),
        COALESCE(o.qty, 0) as opening_stock,
        COALESCE(tt.restocked, 0) as restocked_today,
        COALESCE(tt.sold, 0) as sold_today
    FROM items i
    LEFT JOIN opening o ON o.item_id = i.id
    LEFT JOIN today_tx tt ON tt.item_id = i.id
    ORDER BY i.item_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_department_stock_state(date, text, text) TO authenticated;
