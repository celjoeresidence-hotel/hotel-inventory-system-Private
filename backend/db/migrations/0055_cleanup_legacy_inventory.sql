DROP VIEW IF EXISTS public.v_live_inventory;
DROP VIEW IF EXISTS public.inventory_catalog_view;
DROP VIEW IF EXISTS public.v_current_inventory;
DROP VIEW IF EXISTS public.v_inventory_ledger;
DROP FUNCTION IF EXISTS public.get_inventory_daily_history(text, date, date);
DROP FUNCTION IF EXISTS public.get_expected_opening_stock_batch(text, date);
DROP FUNCTION IF EXISTS public.get_storekeeper_stock_state(date, text, text);

CREATE OR REPLACE VIEW public.v_inventory_ledger AS
SELECT
  id AS record_id,
  created_at,
  (data->>'date')::date AS event_date,
  'STORE' AS department,
  data->>'item_name' AS item_name,
  COALESCE((data->>'quantity')::numeric, 0) AS quantity_change,
  'OPENING_STOCK' AS event_type,
  (data->>'unit_price')::numeric AS unit_price,
  (data->>'total_amount')::numeric AS total_value,
  COALESCE(data->>'staff_name', 'System') AS staff_name,
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'opening_stock'
UNION ALL
SELECT
  id, created_at, (data->>'date')::date, 'STORE', data->>'item_name',
  COALESCE((data->>'quantity')::numeric, 0), 'SUPPLIER_RESTOCK',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'stock_restock'
UNION ALL
SELECT
  id, created_at, (data->>'date')::date, 'STORE', data->>'item_name',
  -COALESCE((data->>'quantity')::numeric, 0), 'ISSUED_TO_DEPT',
  (data->>'unit_price')::numeric,
  (data->>'total_amount')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'storekeeper' AND data->>'type' = 'stock_issued'
UNION ALL
SELECT
  id, created_at, (data->>'date')::date, 'BAR', data->>'item_name',
  COALESCE((data->>'restocked')::numeric, 0), 'RECEIVED_FROM_STORE',
  (data->>'unit_price')::numeric,
  0 AS total_value,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'bar' AND (data->>'restocked')::numeric > 0
UNION ALL
SELECT
  id, created_at, (data->>'date')::date, 'BAR', data->>'item_name',
  -COALESCE((data->>'sold')::numeric, 0), 'SOLD',
  (data->>'unit_price')::numeric,
  (data->>'total_sales_value')::numeric,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'bar' AND (data->>'sold')::numeric > 0
UNION ALL
SELECT
  id, created_at, (data->>'date')::date, 'KITCHEN', data->>'item_name',
  COALESCE((data->>'restocked')::numeric, 0), 'RECEIVED_FROM_STORE',
  (data->>'unit_price')::numeric,
  0 AS total_value,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'kitchen' AND (data->>'restocked')::numeric > 0
UNION ALL
SELECT
  id, created_at, (data->>'date')::date, 'KITCHEN', data->>'item_name',
  -COALESCE((data->>'sold')::numeric, 0), 'CONSUMED',
  (data->>'unit_price')::numeric,
  0 AS total_value,
  COALESCE(data->>'staff_name', 'System'),
  submitted_by::text
FROM public.canonical_operational_records
WHERE entity_type = 'kitchen' AND (data->>'sold')::numeric > 0
UNION ALL
SELECT
  t.id AS record_id,
  t.created_at,
  t.event_date,
  t.department,
  i.item_name,
  (t.quantity_in - t.quantity_out) AS quantity_change,
  CASE
    WHEN t.transaction_type = 'opening_stock' THEN 'OPENING_STOCK'
    WHEN t.department = 'STORE' AND t.transaction_type = 'stock_restock' THEN 'SUPPLIER_RESTOCK'
    WHEN t.department = 'STORE' AND t.transaction_type = 'stock_issued' THEN 'ISSUED_TO_DEPT'
    WHEN t.department IN ('BAR', 'KITCHEN') AND t.transaction_type = 'stock_restock' THEN 'RECEIVED_FROM_STORE'
    WHEN t.transaction_type = 'sold' THEN 'SOLD'
    WHEN t.transaction_type = 'consumed' THEN 'CONSUMED'
    ELSE UPPER(t.transaction_type)
  END AS event_type,
  t.unit_price,
  t.total_value,
  t.staff_name,
  t.staff_name AS submitted_by
FROM public.inventory_transactions t
JOIN public.inventory_items i ON t.item_id = i.id
WHERE t.status = 'approved';

GRANT SELECT ON public.v_inventory_ledger TO authenticated;

CREATE OR REPLACE VIEW public.v_current_inventory AS
SELECT
  department,
  item_name,
  SUM(quantity_change) AS current_stock
FROM public.v_inventory_ledger
GROUP BY department, item_name;

GRANT SELECT ON public.v_current_inventory TO authenticated;

CREATE OR REPLACE VIEW public.inventory_catalog_view AS
SELECT
  i.category,
  i.collection AS collection_name,
  i.item_name,
  i.unit,
  COALESCE(i.unit_price, 0) AS unit_price,
  COALESCE(s.current_stock, 0) AS current_stock
FROM public.inventory_items i
LEFT JOIN (
  SELECT item_name, SUM(quantity_change) AS current_stock
  FROM public.v_inventory_ledger
  WHERE department = 'STORE'
  GROUP BY item_name
) s ON s.item_name = i.item_name
WHERE i.deleted_at IS NULL;

GRANT SELECT ON public.inventory_catalog_view TO authenticated;

CREATE OR REPLACE VIEW public.v_live_inventory AS
SELECT
  cur.department,
  cur.item_name,
  cur.current_stock,
  cat.unit,
  cat.category,
  cat.collection_name,
  CASE
    WHEN cur.current_stock <= 0 THEN 'OUT_OF_STOCK'
    WHEN cur.current_stock < 10 THEN 'LOW_STOCK'
    ELSE 'IN_STOCK'
  END AS stock_status
FROM public.v_current_inventory cur
LEFT JOIN public.inventory_catalog_view cat ON cat.item_name = cur.item_name;

GRANT SELECT ON public.v_live_inventory TO authenticated;

CREATE OR REPLACE FUNCTION public.get_inventory_opening_at_date(_department text, _date date)
RETURNS TABLE (item_name text, opening_stock numeric) AS $$
BEGIN
  RETURN QUERY
  SELECT
    l.item_name,
    COALESCE(SUM(l.quantity_change), 0)
  FROM public.v_inventory_ledger l
  WHERE l.department = _department
    AND l.event_date < _date
  GROUP BY l.item_name;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_expected_opening_stock(_role text, _item_name text, _report_date date DEFAULT CURRENT_DATE)
RETURNS numeric AS $$
DECLARE
  _val numeric;
BEGIN
  IF _role = 'storekeeper' THEN
    SELECT opening_stock INTO _val
    FROM public.get_inventory_opening_at_date('STORE', _report_date)
    WHERE item_name = _item_name;
    RETURN COALESCE(_val, 0);
  ELSE
    IF _report_date >= CURRENT_DATE THEN
       SELECT current_stock INTO _val
       FROM public.inventory_catalog_view
       WHERE item_name = _item_name;
       RETURN COALESCE(_val, 0);
    ELSE
       SELECT opening_stock INTO _val
       FROM public.get_inventory_opening_at_date('STORE', _report_date)
       WHERE item_name = _item_name;
       RETURN COALESCE(_val, 0);
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.get_storekeeper_stock_state(
    _date date,
    _category text DEFAULT NULL,
    _collection text DEFAULT NULL
)
RETURNS TABLE (
    item_id uuid,
    item_name text,
    unit text,
    unit_price numeric,
    opening_stock numeric,
    restocked_today numeric,
    issued_today numeric
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
    RETURN QUERY
    WITH items AS (
        SELECT i.id, i.item_name, i.unit, i.unit_price
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
          AND t.status = 'approved'
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
        COALESCE(i.unit_price, 0),
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

CREATE OR REPLACE FUNCTION public.get_department_stock_state(
    _date date,
    _department text,
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
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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

DROP FUNCTION IF EXISTS public.get_daily_stock_sheet(text, text, date);
CREATE OR REPLACE FUNCTION public.get_daily_stock_sheet(_role text, _category text, _report_date date DEFAULT CURRENT_DATE)
RETURNS TABLE(item_name text, unit text, unit_price numeric, opening_stock numeric, collection_name text) AS $$
BEGIN
  IF _role = 'storekeeper' THEN
    RETURN QUERY
    SELECT 
      i.item_name::text,
      i.unit::text,
      i.unit_price::numeric,
      COALESCE(os.opening_stock, 0) AS opening_stock,
      i.collection_name::text
    FROM public.inventory_catalog_view i
    LEFT JOIN public.get_inventory_opening_at_date('STORE', _report_date) os ON os.item_name = i.item_name
    WHERE lower(i.category) = lower(_category)
    ORDER BY i.item_name;
  ELSE
    RETURN QUERY
    SELECT 
      i.item_name::text,
      i.unit::text,
      i.unit_price::numeric,
      public.get_expected_opening_stock(_role, i.item_name, _report_date) AS opening_stock,
      i.collection_name::text
    FROM public.inventory_catalog_view i
    WHERE lower(i.category) = lower(_category)
    ORDER BY i.item_name;
  END IF;
END;
$$ LANGUAGE plpgsql;

GRANT EXECUTE ON FUNCTION public.get_daily_stock_sheet(text, text, date) TO authenticated;
