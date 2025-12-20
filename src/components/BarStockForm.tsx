import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

import type { BarStockData } from '../types/bar';
import InventoryConsumptionTable from './InventoryConsumptionTable';

export default function BarStockForm() {
  const { role, session, isConfigured } = useAuth();

  // Role gating remains: screen is for bar staff
  if (role !== 'bar') {
    return (
      <div style={{ maxWidth: 960, margin: '24px auto' }}>
        <h2>Access denied</h2>
        <p>You must be bar staff to submit daily stock records.</p>
      </div>
    );
  }

  const [date, setDate] = useState<string>('');
  // Dynamic categories assigned to bar
  const [categories, setCategories] = useState<{ name: string; active: boolean }[]>([]);
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false);
  const [activeCategory, setActiveCategory] = useState<string>('');

  type UIItem = { item_name: string; unit: string | null; unit_price: number | null; opening_stock: number | null };
  const [items, setItems] = useState<UIItem[]>([]);
  const [loadingItems, setLoadingItems] = useState<boolean>(false);
  const [restockedMap, setRestockedMap] = useState<Record<string, number>>({});
  const [soldMap, setSoldMap] = useState<Record<string, number>>({});

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Fetch categories assigned to bar from config_category
  useEffect(() => {
    async function fetchCategories() {
      setError(null);
      setLoadingCategories(true);
      try {
        if (!isConfigured || !session || !supabase) return;
        const { data, error } = await supabase
          .from('operational_records')
          .select('id, data, original_id, version_no, created_at, status, deleted_at')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'config_category');
        if (error) { setError(error.message); return; }
        const rows = (data ?? []);
        // Dedup: latest approved version per original_id
        const latestByOriginal = new Map<string, any>();
        for (const r of rows) {
          const key = String(r?.original_id ?? r?.id);
          const prev = latestByOriginal.get(key);
          const currVer = Number(r?.version_no ?? 0);
          const prevVer = Number(prev?.version_no ?? -1);
          const currTs = new Date(r?.created_at ?? 0).getTime();
          const prevTs = new Date(prev?.created_at ?? 0).getTime();
          if (!prev || currVer > prevVer || (currVer === prevVer && currTs > prevTs)) {
            latestByOriginal.set(key, r);
          }
        }
        const latestRows = Array.from(latestByOriginal.values());
        const cats = latestRows
          .map((r: any) => {
            const assigned = r?.data?.assigned_to;
            const assigned_to_bar = Array.isArray(assigned)
              ? assigned.includes('bar')
              : assigned?.bar === true;
            return {
              name: String(r?.data?.category_name ?? r?.data?.category ?? ''),
              active: (r?.data?.active ?? true) !== false,
              assigned_to_bar,
            };
          })
          .filter((c: any) => c.name && c.active && c.assigned_to_bar)
          .map((c: any) => ({ name: c.name, active: c.active }));
        setCategories(cats);
        if (!activeCategory && cats.length > 0) setActiveCategory(cats[0].name);
      } finally {
        setLoadingCategories(false);
      }
    }
    fetchCategories();
  }, [isConfigured, session]);

  // Fetch items for active category
  useEffect(() => {
    async function fetchItems() {
      setError(null);
      setLoadingItems(true);
      try {
        if (!isConfigured || !session || !supabase || !activeCategory) { setItems([]); return; }
        const { data: itemRows, error: itemErr } = await supabase
          .from('operational_records')
          .select('id, data, original_id, version_no, created_at')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'config_item')
          .filter('data->>category', 'eq', activeCategory);
        if (itemErr) { setError(itemErr.message); return; }
        // Dedup latest approved per original_id
        const latestByOriginal = new Map<string, any>();
        for (const r of (itemRows ?? [])) {
          const key = String(r?.original_id ?? r?.id);
          const prev = latestByOriginal.get(key);
          const currVer = Number(r?.version_no ?? 0);
          const prevVer = Number(prev?.version_no ?? -1);
          const currTs = new Date(r?.created_at ?? 0).getTime();
          const prevTs = new Date(prev?.created_at ?? 0).getTime();
          if (!prev || currVer > prevVer || (currVer === prevVer && currTs > prevTs)) {
            latestByOriginal.set(key, r);
          }
        }
        const filteredRows = Array.from(latestByOriginal.values()).filter((r: any) => (r?.data?.active ?? true) !== false);
        const itemsRaw = filteredRows.map((r: any) => ({
          item_name: String(r?.data?.item_name ?? ''),
          unit: r?.data?.unit ?? null,
          unit_price: typeof r?.data?.unit_price === 'number' ? r.data.unit_price : Number(r?.data?.unit_price ?? null),
        })).filter((it: any) => it.item_name);
        const itemNames = Array.from(new Set(itemsRaw.map((i: any) => i.item_name)));
        let stockMap = new Map<string, number>();
        if (itemNames.length > 0) {
          const stocksRes = await supabase
            .from('operational_records')
            .select('id, data, created_at')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .eq('entity_type', 'storekeeper')
            .filter('data->>type', 'eq', 'opening_stock')
            .in('data->>item_name', itemNames)
            .order('created_at', { ascending: false });
          if (!stocksRes.error) {
            for (const row of (stocksRes.data ?? [])) {
              const name = String(row?.data?.item_name ?? '');
              if (!name) continue;
              if (!stockMap.has(name)) {
                const qty = typeof row?.data?.quantity === 'number' ? row.data.quantity : Number(row?.data?.quantity ?? 0);
                stockMap.set(name, Number.isFinite(qty) ? qty : 0);
              }
            }
          }
        }
        const enriched: UIItem[] = itemsRaw.map((it: any) => ({
          item_name: it.item_name,
          unit: it.unit ?? null,
          unit_price: Number.isFinite(it.unit_price) ? it.unit_price : null,
          opening_stock: stockMap.has(it.item_name) ? stockMap.get(it.item_name)! : null,
        })).sort((a, b) => a.item_name.localeCompare(b.item_name));
        setItems(enriched);
        const r: Record<string, number> = {}; const s: Record<string, number> = {};
        for (const it of enriched) { r[it.item_name] = 0; s[it.item_name] = 0; }
        setRestockedMap(r);
        setSoldMap(s);
      } finally {
        setLoadingItems(false);
      }
    }
    fetchItems();
  }, [isConfigured, session, activeCategory]);

  const handleChangeRestocked = (name: string, value: number) => {
    setRestockedMap((prev) => ({ ...prev, [name]: Math.max(0, Number(value) || 0) }));
  };
  const handleChangeSold = (name: string, value: number) => {
    setSoldMap((prev) => ({ ...prev, [name]: Math.max(0, Number(value) || 0) }));
  };

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    if (!isConfigured || !session || !supabase) {
      setError('Authentication required. Please sign in.');
      return;
    }
    if (!date) {
      setError('Date is required');
      return;
    }
    const records: { entity_type: string; data: BarStockData; financial_amount: number }[] = [];
    for (const row of items) {
      const o = Number(row.opening_stock ?? 0);
      const r = Number(restockedMap[row.item_name] ?? 0);
      const s = Number(soldMap[row.item_name] ?? 0);
      const u = Number(row.unit_price ?? 0);
      if (r <= 0 && s <= 0) continue; // only submit rows with non-zero activity
      if (s > o + r) { setError(`Sold for ${row.item_name} cannot exceed opening + restocked`); return; }
      const closing = o + r - s;
      if (closing < 0) { setError(`Closing stock for ${row.item_name} cannot be negative`); return; }
      const total = s * u;
      const payload: BarStockData = {
        date,
        item_name: row.item_name,
        opening_stock: o,
        restocked: r,
        sold: s,
        closing_stock: closing,
        unit_price: u,
        total_amount: total,
      } as any;
      records.push({ entity_type: 'bar', data: payload, financial_amount: total });
    }
    if (records.length === 0) {
      setError('Enter restocked or sold quantities for at least one item.');
      return;
    }
    try {
      setSubmitting(true);
      const { error: insertError } = await supabase.from('operational_records').insert(records);
      if (insertError) { setError(insertError.message); return; }
      setSuccess('Daily stock submitted for supervisor approval.');
      // Reset inputs but keep date and current tab
      const r: Record<string, number> = {};
      const s: Record<string, number> = {};
      for (const it of items) { r[it.item_name] = 0; s[it.item_name] = 0; }
      setRestockedMap(r);
      setSoldMap(s);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 1100, margin: '24px auto' }}>
      <h2>Bar — Daily Stock</h2>
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 6 }}>Date *</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={submitting} style={{ padding: '8px 10px' }} />
        </div>
        <div>
          <h3 style={{ margin: '12px 0' }}>Categories</h3>
          {loadingCategories ? (
            <div>Loading categories…</div>
          ) : categories.length === 0 ? (
            <div style={{ color: '#666' }}>No categories assigned to Bar.</div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {categories.map((c) => (
                <button key={c.name} className="btn" style={{ background: activeCategory === c.name ? '#004D40' : '#eee', color: activeCategory === c.name ? '#fff' : '#333' }} onClick={() => setActiveCategory(c.name)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: 8 }}>
          <h3 style={{ marginTop: 0 }}>{activeCategory || '—'} Items</h3>
          {loadingItems ? (
            <div>Loading items…</div>
          ) : items.length === 0 ? (
            <div style={{ color: '#666' }}>No items under this category.</div>
          ) : (
            <InventoryConsumptionTable
              items={items}
              restockedMap={restockedMap}
              soldMap={soldMap}
              disabled={submitting}
              onChangeRestocked={handleChangeRestocked}
              onChangeSold={handleChangeSold}
            />
          )}
        </div>

        {error && (
          <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6 }}>{error}</div>
        )}
        {success && (
          <div style={{ background: '#e6ffed', color: '#0a7f3b', padding: '8px 12px', borderRadius: 6 }}>{success}</div>
        )}

        <div>
          <button onClick={handleSubmit} disabled={submitting || !activeCategory || items.length === 0} style={{ padding: '10px 14px' }}>
            {submitting ? 'Submitting…' : 'Submit Daily Stock'}
          </button>
        </div>
      </div>
    </div>
  );
}