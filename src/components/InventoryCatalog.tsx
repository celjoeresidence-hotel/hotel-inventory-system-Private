import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

interface CatalogItem {
  item_name: string;
  unit: string | null;
  current_stock: number | null;
  active?: boolean;
}

interface CatalogCollection {
  name: string;
  items: CatalogItem[];
  active?: boolean;
}

interface CatalogCategory {
  name: string;
  collections: CatalogCollection[];
  active?: boolean;
}

export default function InventoryCatalog() {
  const { session, isConfigured, isSupervisor, isManager, isAdmin } = useAuth();
  const canView = useMemo(() => Boolean(isConfigured && session && (isSupervisor || isManager || isAdmin)), [isConfigured, session, isSupervisor, isManager, isAdmin]);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);

  // UI state: filters and expand/collapse
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedCollection, setSelectedCollection] = useState<string>('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function fetchCatalog() {
      setError(null);
      setLoading(true);
      try {
        if (!canView || !supabase) return;
        // Fetch approved, non-deleted config records directly from operational_records and dedupe latest per original_id
        const [catRes, colRes, itemRes] = await Promise.all([
          supabase
            .from('operational_records')
            .select('id, data, original_id, version_no, created_at, status, deleted_at')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .eq('entity_type', 'storekeeper')
            .filter('data->>type', 'eq', 'config_category')
            .order('created_at', { ascending: false }),
          supabase
            .from('operational_records')
            .select('id, data, original_id, version_no, created_at, status, deleted_at')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .eq('entity_type', 'storekeeper')
            .filter('data->>type', 'eq', 'config_collection')
            .order('created_at', { ascending: false }),
          supabase
            .from('operational_records')
            .select('id, data, original_id, version_no, created_at, status, deleted_at')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .eq('entity_type', 'storekeeper')
            .filter('data->>type', 'eq', 'config_item')
            .order('created_at', { ascending: false }),
        ]);

        if (catRes.error) { setError(catRes.error.message); return; }
        if (colRes.error) { setError(colRes.error.message); return; }
        if (itemRes.error) { setError(itemRes.error.message); return; }

        const dedupLatest = (rows: any[]) => {
          const seen = new Set<string>();
          const out: any[] = [];
          for (const r of rows ?? []) {
            const oid = String(r?.original_id ?? r?.id ?? '');
            if (!oid) continue;
            if (seen.has(oid)) continue;
            seen.add(oid);
            out.push(r);
          }
          return out;
        };

        const categoriesRaw = dedupLatest(catRes.data ?? []).map((r: any) => ({
          name: String(r?.data?.category_name ?? r?.data?.category ?? ''),
          active: (r?.data?.active ?? true) !== false,
        })).filter((c: any) => c.name);

        const collectionsRaw = dedupLatest(colRes.data ?? []).map((r: any) => ({
          name: String(r?.data?.collection_name ?? ''),
          category: String(r?.data?.category_name ?? r?.data?.category ?? ''),
          active: (r?.data?.active ?? true) !== false,
        })).filter((c: any) => c.name && c.category);

        const itemsRaw = dedupLatest(itemRes.data ?? []).map((r: any) => ({
          item_name: String(r?.data?.item_name ?? ''),
          unit: r?.data?.unit ?? null,
          category: String(r?.data?.category_name ?? r?.data?.category ?? ''),
          collection_name: String(r?.data?.collection_name ?? ''),
          active: (r?.data?.active ?? true) !== false,
        })).filter((it: any) => it.item_name && it.category && it.collection_name);

        // Compute current stock from latest approved opening_stock per item
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
          if (stocksRes.error) {
            // Don't fail the whole page; just show error banner
            setError(stocksRes.error.message);
          } else {
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

        // Build Category → Collection → Items hierarchy (include both active and inactive; show status badge)
        const catMap = new Map<string, { active: boolean; colMap: Map<string, { active: boolean; items: CatalogItem[] }> }>();

        for (const cat of categoriesRaw) {
          if (!catMap.has(cat.name)) catMap.set(cat.name, { active: Boolean(cat.active), colMap: new Map() });
        }
        for (const col of collectionsRaw) {
          if (!catMap.has(col.category)) catMap.set(col.category, { active: true, colMap: new Map() });
          const entry = catMap.get(col.category)!;
          if (!entry.colMap.has(col.name)) entry.colMap.set(col.name, { active: Boolean(col.active), items: [] });
        }
        for (const it of itemsRaw) {
          if (!catMap.has(it.category)) catMap.set(it.category, { active: true, colMap: new Map() });
          const entry = catMap.get(it.category)!;
          if (!entry.colMap.has(it.collection_name)) entry.colMap.set(it.collection_name, { active: true, items: [] });
          const colEntry = entry.colMap.get(it.collection_name)!;
          const current_stock = stockMap.has(it.item_name) ? stockMap.get(it.item_name)! : null;
          const active = entry.active && colEntry.active && (it.active ?? true);
          colEntry.items.push({ item_name: it.item_name, unit: it.unit ?? null, current_stock, active });
        }

        const catList: CatalogCategory[] = Array.from(catMap.entries()).map(([catName, { active, colMap }]) => ({
          name: catName,
          active,
          collections: Array.from(colMap.entries()).map(([colName, { active: colActive, items }]) => ({
            name: colName,
            active: colActive,
            items: items.sort((a, b) => a.item_name.localeCompare(b.item_name)),
          })).sort((a, b) => a.name.localeCompare(b.name)),
        })).sort((a, b) => a.name.localeCompare(b.name));
        setCategories(catList);

        // Default expand all categories initially
        setExpandedCategories(new Set(catList.map(c => c.name)));
        // Default expand collections for selected category if any, else none
        setExpandedCollections(new Set());
      } finally {
        setLoading(false);
      }
    }
    fetchCatalog();
  }, [canView]);

  // Derived options for filters
  const categoryOptions = useMemo(() => {
    const names = Array.from(new Set(categories.map(c => c.name)));
    return names.sort((a, b) => a.localeCompare(b));
  }, [categories]);

  const collectionOptions = useMemo(() => {
    if (!selectedCategory) return [] as string[];
    const cat = categories.find(c => c.name === selectedCategory);
    const names = Array.from(new Set((cat?.collections ?? []).map(c => c.name)));
    return names.sort((a, b) => a.localeCompare(b));
  }, [categories, selectedCategory]);

  // Client-side filtered view of categories/collections/items
  const filteredCategories = useMemo(() => {
    const st = searchTerm.trim().toLowerCase();
    const catFilter = selectedCategory || '';
    const colFilter = selectedCollection || '';

    const matchesItem = (it: CatalogItem) => {
      if (!st) return true;
      return it.item_name.toLowerCase().includes(st);
    };

    const filtered: CatalogCategory[] = [];
    for (const cat of categories) {
      if (catFilter && cat.name !== catFilter) continue;
      const filteredCollections: CatalogCollection[] = [];
      for (const col of cat.collections) {
        if (colFilter && col.name !== colFilter) continue;
        const items = col.items.filter(matchesItem);
        if (items.length > 0 || (!st && !colFilter)) {
          filteredCollections.push({ ...col, items });
        }
      }
      if (filteredCollections.length > 0 || (!st && !catFilter)) {
        filtered.push({ ...cat, collections: filteredCollections });
      }
    }
    return filtered;
  }, [categories, searchTerm, selectedCategory, selectedCollection]);

  // Handlers for expand/collapse
  function toggleCategory(name: string) {
    const next = new Set(expandedCategories);
    if (next.has(name)) next.delete(name); else next.add(name);
    setExpandedCategories(next);
  }
  function toggleCollection(catName: string, colName: string) {
    const key = `${catName}::${colName}`;
    const next = new Set(expandedCollections);
    if (next.has(key)) next.delete(key); else next.add(key);
    setExpandedCollections(next);
  }

  if (!canView) {
    return (
      <div style={{ maxWidth: 960, margin: '24px auto', padding: '0 16px' }}>
        <h2>Access denied</h2>
        <p>You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, fontFamily: 'Montserrat, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif', background: '#fff' }}>
      <h2 style={{ marginTop: 0 }}>Inventory Catalog</h2>

      {error && (
        <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>{error}</div>
      )}

      {/* Top controls: search + filters */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 }}>
        <input
          type="text"
          placeholder="Search items…"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={{ flex: 2, padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6 }}
        />
        <select
          value={selectedCategory}
          onChange={(e) => { setSelectedCategory(e.target.value); setSelectedCollection(''); }}
          style={{ flex: 1, padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6 }}
        >
          <option value="">All categories</option>
          {categoryOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <select
          value={selectedCollection}
          onChange={(e) => setSelectedCollection(e.target.value)}
          disabled={!selectedCategory}
          style={{ flex: 1, padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, opacity: selectedCategory ? 1 : 0.6 }}
        >
          <option value="">All collections</option>
          {collectionOptions.map((name) => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div>Loading…</div>
      ) : (
        <div>
          {filteredCategories.length === 0 ? (
            <div style={{ color: '#666' }}>No items defined yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {filteredCategories.map((cat) => (
                <section key={cat.name} style={{ borderTop: '1px solid #eee', paddingTop: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => toggleCategory(cat.name)}
                      style={{ border: '1px solid #cde5cd', background: '#f5fbf5', color: '#2E7D32', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}
                    >
                      {expandedCategories.has(cat.name) ? '−' : '+'}
                    </button>
                    <h3 style={{ color: '#1B5E20', marginTop: 0, marginBottom: 0 }}>{cat.name}</h3>
                    {cat.active === false && (
                      <span style={{ marginLeft: 8, fontSize: 12, color: '#fff', background: '#777', padding: '2px 6px', borderRadius: 12 }}>Inactive</span>
                    )}
                  </div>

                  {expandedCategories.has(cat.name) && (
                    <div style={{ display: 'grid', gap: 12, marginTop: 8 }}>
                      {cat.collections.length === 0 ? (
                        <div style={{ color: '#777' }}>No collections.</div>
                      ) : (
                        cat.collections.map((col) => {
                          const colKey = `${cat.name}::${col.name}`;
                          return (
                            <div key={col.name} style={{ borderLeft: '2px solid #e6f2e6', paddingLeft: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <button
                                  onClick={() => toggleCollection(cat.name, col.name)}
                                  style={{ border: '1px solid #cde5cd', background: '#f5fbf5', color: '#2E7D32', borderRadius: 6, padding: '4px 8px', cursor: 'pointer' }}
                                >
                                  {expandedCollections.has(colKey) ? '−' : '+'}
                                </button>
                                <h4 style={{ margin: '8px 0', color: '#2E7D32' }}>{col.name}</h4>
                                {col.active === false && (
                                  <span style={{ marginLeft: 8, fontSize: 12, color: '#fff', background: '#777', padding: '2px 6px', borderRadius: 12 }}>Inactive</span>
                                )}
                              </div>
                              {expandedCollections.has(colKey) && (
                                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                                  {col.items.length === 0 ? (
                                    <li style={{ color: '#777' }}>No items.</li>
                                  ) : (
                                    col.items.map((it) => (
                                      <li key={`${cat.name}:${col.name}:${it.item_name}`} style={{ padding: '6px 0', display: 'flex', gap: 12, borderBottom: '1px dashed #eee' }}>
                                        <span style={{ flex: 2 }}>{it.item_name}</span>
                                        <span style={{ flex: 1, color: '#555' }}>{it.unit ?? '—'}</span>
                                        <span style={{ flex: 1, textAlign: 'right', color: '#333' }}>{Number.isFinite(it.current_stock as number) ? it.current_stock : '—'}</span>
                                        {it.active === false && (
                                          <span style={{ marginLeft: 8, fontSize: 12, color: '#fff', background: '#777', padding: '2px 6px', borderRadius: 12 }}>Inactive</span>
                                        )}
                                      </li>
                                    ))
                                  )}
                                </ul>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}