-- Migration 0048: Monthly Report RPC
-- Optimized monthly aggregation for departments.

CREATE OR REPLACE FUNCTION public.get_department_monthly_report(
    _month_start date,
    _month_end date,
    _department text,
    _category text
)
RETURNS TABLE (
    item_id uuid,
    item_name text,
    unit text,
    opening_stock numeric,
    restocked_month numeric,
    sold_month numeric,
    closing_stock numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN QUERY
    WITH 
    items AS (
        SELECT i.id, i.item_name, i.unit
        FROM inventory_items i
        WHERE i.category = _category
          AND i.active = true
          AND i.deleted_at IS NULL
    ),
    pre_month AS (
        SELECT 
            t.item_id, 
            SUM(CASE 
                WHEN t.transaction_type = 'stock_restock' OR t.transaction_type = 'opening_stock' THEN t.quantity_in
                ELSE -t.quantity_out 
            END) as qty
        FROM inventory_transactions t
        WHERE t.department = _department
          AND t.event_date < _month_start
          AND t.status = 'approved'
        GROUP BY t.item_id
    ),
    in_month AS (
        SELECT 
            t.item_id,
            SUM(CASE WHEN t.transaction_type IN ('stock_restock', 'opening_stock') THEN t.quantity_in ELSE 0 END) as restocked,
            SUM(CASE WHEN t.transaction_type IN ('stock_issued', 'sold', 'consumed') THEN t.quantity_out ELSE 0 END) as sold
        FROM inventory_transactions t
        WHERE t.department = _department
          AND t.event_date >= _month_start
          AND t.event_date <= _month_end
          AND t.status = 'approved'
        GROUP BY t.item_id
    )
    SELECT 
        i.id, 
        i.item_name, 
        i.unit, 
        COALESCE(pm.qty, 0) as opening_stock,
        COALESCE(im.restocked, 0) as restocked_month,
        COALESCE(im.sold, 0) as sold_month,
        (COALESCE(pm.qty, 0) + COALESCE(im.restocked, 0) - COALESCE(im.sold, 0)) as closing_stock
    FROM items i
    LEFT JOIN pre_month pm ON pm.item_id = i.id
    LEFT JOIN in_month im ON im.item_id = i.id
    ORDER BY i.item_name;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_department_monthly_report(date, date, text, text) TO authenticated;
