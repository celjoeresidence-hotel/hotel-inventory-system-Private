import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';


interface CategoryRow {
  id: string;
  name: string;
  active: boolean;
}

interface CollectionRow {
  id: string;
  name: string;
  active?: boolean;
}

interface ItemRow {
  id: string;
  item_name: string;
  unit?: string | null;
  opening_stock?: number | null;
  last_adjusted?: string | null;
}

export default function InventorySetup() {
  const { session, isConfigured, isSupervisor, isManager, isAdmin } = useAuth();
  const canView = useMemo(() => Boolean(isConfigured && session && (isSupervisor || isManager || isAdmin)), [isConfigured, session, isSupervisor, isManager, isAdmin]);
  const canEditStructure = useMemo(() => Boolean(isSupervisor || isManager || isAdmin), [isSupervisor, isManager, isAdmin]);
  // removed: const canAddItem = useMemo(() => Boolean(isManager || isAdmin), [isManager, isAdmin]);

  const [activeTab, setActiveTab] = useState<'structure' | 'items_stock'>('structure');

  // Shared state
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Add reload keys to control re-fetching after updates
  const [categoriesReloadKey, setCategoriesReloadKey] = useState<number>(0);
  const [collectionsReloadKey, setCollectionsReloadKey] = useState<number>(0);
  const [itemsReloadKey, setItemsReloadKey] = useState<number>(0);

  // Categories (dynamic)
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false);
  const [selectedCategoryName, setSelectedCategoryName] = useState<string>('');
  const [addCategoryOpen, setAddCategoryOpen] = useState<boolean>(false);
  const [newCategoryName, setNewCategoryName] = useState<string>('');
  const [savingCategory, setSavingCategory] = useState<boolean>(false);

  // Collections (per Category)
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [loadingCollections, setLoadingCollections] = useState<boolean>(false);
  const [addCollectionOpen, setAddCollectionOpen] = useState<boolean>(false);
  const [newCollectionName, setNewCollectionName] = useState<string>('');
  const [savingCollection, setSavingCollection] = useState<boolean>(false);

  // Items & Opening Stock state
  const [filterCategoryName, setFilterCategoryName] = useState<string>('');
  const [collectionsFilter, setCollectionsFilter] = useState<CollectionRow[]>([]);
  const [filterCollection, setFilterCollection] = useState<string>('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loadingItems, setLoadingItems] = useState<boolean>(false);
  const [newItemName, setNewItemName] = useState<string>('');
  const [savingItem, setSavingItem] = useState<boolean>(false);

  // Adjust Opening Stock modal state
  const [adjustOpen, setAdjustOpen] = useState<boolean>(false);
  const [adjustItem, setAdjustItem] = useState<ItemRow | null>(null);
  const [adjustQuantity, setAdjustQuantity] = useState<number>(0);
  const [adjustDate, setAdjustDate] = useState<string>('');
  const [adjustReason, setAdjustReason] = useState<string>('');
  const canAdjustOpeningStock = isSupervisor; // Supervisor-only per requirements

  useEffect(() => {
    async function fetchCategories() {
      setError(null);
      setMessage(null);
      setLoadingCategories(true);
      try {
        if (!canView || !supabase) return;
        const { data, error } = await supabase
          .from('operational_records')
          .select('id, data, status')
          .eq('status', 'approved')
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'config_category');
        if (error) {
          setError(error.message);
          return;
        }
        const list: CategoryRow[] = (data ?? []).map((r: any) => ({
          id: String(r.id),
          name: String(r.data?.category_name ?? r.data?.category ?? ''),
          active: (r.data?.active ?? true) !== false,
        })).filter((c) => c.name);
        setCategories(list);
        if (!selectedCategoryName && list.length > 0) {
          setSelectedCategoryName(list[0].name);
        }
        if (!filterCategoryName && list.length > 0) {
          setFilterCategoryName(list[0].name);
        }
      } finally {
        setLoadingCategories(false);
      }
    }
    fetchCategories();
  }, [canView, categoriesReloadKey]);

  // Fetch collections for Structure tab (selectedCategoryName)
  useEffect(() => {
    async function fetchCollectionsForSelected() {
      setError(null);
      setMessage(null);
      setLoadingCollections(true);
      try {
        if (!canView || !supabase || !selectedCategoryName) return;
        const { data, error } = await supabase
          .from('operational_records')
          .select('id, data, status')
          .eq('status', 'approved')
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'config_collection')
          .filter('data->>category', 'eq', selectedCategoryName);
        if (error) {
          setError(error.message);
          return;
        }
        const list = (data ?? []).map((r: any) => ({ id: String(r.id), name: String(r.data?.collection_name ?? ''), active: (r.data?.active ?? true) !== false })).filter((c: any) => c.name);
        setCollections(list);
      } finally {
        setLoadingCollections(false);
      }
    }
    if (activeTab === 'structure') fetchCollectionsForSelected();
  }, [selectedCategoryName, canView, activeTab, collectionsReloadKey]);

  // Fetch collections for Items filters (filterCategoryName)
  useEffect(() => {
    async function fetchCollectionsForFilter() {
      try {
        if (!canView || !supabase || !filterCategoryName) return;
        const { data, error } = await supabase
          .from('operational_records')
          .select('id, data, status')
          .eq('status', 'approved')
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'config_collection')
          .filter('data->>category', 'eq', filterCategoryName);
        if (error) {
          setError(error.message);
          return;
        }
        const list = (data ?? []).map((r: any) => ({ id: String(r.id), name: String(r.data?.collection_name ?? ''), active: (r.data?.active ?? true) !== false })).filter((c: any) => c.name);
        setCollectionsFilter(list);
      } catch {}
    }
    if (activeTab === 'items_stock') fetchCollectionsForFilter();
  }, [filterCategoryName, canView, activeTab, collectionsReloadKey]);

  // Items fetching uses dynamic filterCategoryName
  useEffect(() => {
    async function fetchItems() {
      setError(null);
      setMessage(null);
      setLoadingItems(true);
      try {
        if (!canView || !supabase) return;
        if (!filterCategoryName || !filterCollection) {
          setItems([]);
          return;
        }
        const { data, error } = await supabase
          .from('operational_records')
          .select('id, data, status, created_at')
          .eq('status', 'approved')
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'config_item')
          .filter('data->>category', 'eq', filterCategoryName)
          .filter('data->>collection_name', 'eq', filterCollection);
        if (error) {
          setError(error.message);
          return;
        }
        const baseItems: ItemRow[] = (data ?? []).map((r: any) => ({
          id: String(r.id),
          item_name: String(r.data?.item_name ?? ''),
          unit: r.data?.unit ?? null,
          opening_stock: null,
          last_adjusted: null,
        })).filter((it) => it.item_name);
        const results: ItemRow[] = [];
        for (const it of baseItems) {
          const { data: osData, error: osErr } = await supabase
            .from('operational_records')
            .select('id, data, status, created_at')
            .eq('status', 'approved')
            .eq('entity_type', 'storekeeper')
            .filter('data->>type', 'eq', 'opening_stock')
            .filter('data->>item_name', 'eq', it.item_name)
            .order('created_at', { ascending: false })
            .limit(1);
          if (!osErr && osData && osData.length > 0) {
            const row = osData[0];
            results.push({
              ...it,
              opening_stock: typeof row?.data?.quantity === 'number' ? row.data.quantity : Number(row?.data?.quantity ?? 0),
              last_adjusted: row?.data?.date ?? row?.created_at ?? null,
            });
          } else {
            results.push(it);
          }
        }
        setItems(results);
      } finally {
        setLoadingItems(false);
      }
    }
    if (filterCollection) fetchItems();
  }, [filterCategoryName, filterCollection, canView, itemsReloadKey]);

  // Insert helpers
  async function insertConfigRecord(payload: any) {
    setError(null);
    setMessage(null);
    try {
      if (!supabase) {
        setError('Supabase is not configured.');
        return;
      }
      const { data: inserted, error: insErr } = await supabase
        .from('operational_records')
        .insert({ entity_type: 'storekeeper', data: payload, financial_amount: 0 })
        .select()
        .single();
      if (insErr) {
        setError(insErr.message);
        return;
      }
      const id = (inserted as any)?.id;
      if (!id) {
        setError('Failed to insert record.');
        return;
      }
      setMessage('Saved successfully.');
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    }
  }

  async function insertAndApproveStorekeeper(payload: any) {
    setError(null);
    setMessage(null);
    try {
      if (!supabase) {
        setError('Supabase is not configured.');
        return;
      }
      const { data: inserted, error: insErr } = await supabase
        .from('operational_records')
        .insert({ entity_type: 'storekeeper', data: payload, financial_amount: 0 })
        .select()
        .single();
      if (insErr) {
        setError(insErr.message);
        return;
      }
      const id = (inserted as any)?.id;
      if (!id) {
        setError('Failed to insert record.');
        return;
      }
      const { error: aprErr } = await supabase.rpc('approve_record', { _id: id });
      if (aprErr) {
        setError(aprErr.message);
        return;
      }
      setMessage('Saved successfully.');
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    }
  }

  async function saveCategory() {
    if (!newCategoryName.trim()) return;
    setSavingCategory(true);
    await insertConfigRecord({ type: 'config_category', category_name: newCategoryName.trim(), active: true });
    setSavingCategory(false);
    setNewCategoryName('');
    setAddCategoryOpen(false);
    setCategoriesReloadKey((k) => k + 1);
  }

  async function saveCollection() {
    if (!newCollectionName.trim() || !selectedCategoryName) return;
    setSavingCollection(true);
    await insertConfigRecord({ type: 'config_collection', category: selectedCategoryName, collection_name: newCollectionName.trim(), active: true });
    setSavingCollection(false);
    setNewCollectionName('');
    setAddCollectionOpen(false);
    setCollectionsReloadKey((k) => k + 1);
  }

  async function toggleCategoryActive(cat: CategoryRow) {
    if (!canEditStructure) return;
    try {
      if (!supabase) {
        setError('Supabase is not configured.');
        return;
      }
      await supabase.schema('api').rpc('edit_config_record', { _previous_version_id: cat.id, _data: { active: !cat.active } });
      setCategoriesReloadKey((k) => k + 1);
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    }
  }

  async function toggleCollectionActive(col: CollectionRow) {
    if (!canEditStructure) return;
    try {
      if (!supabase) {
        setError('Supabase is not configured.');
        return;
      }
      await supabase.schema('api').rpc('edit_config_record', { _previous_version_id: col.id, _data: { active: !(col.active ?? true) } });
      setCollectionsReloadKey((k) => k + 1);
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    }
  }

  async function saveItem() {
    if (!newItemName.trim() || !filterCollection) return;
    setSavingItem(true);
    await insertAndApproveStorekeeper({ type: 'config_item', category: filterCategoryName, collection_name: filterCollection, item_name: newItemName.trim() });
    setSavingItem(false);
    setNewItemName('');
    setFilterCollection((prev) => prev);
  }

  async function saveAdjustOpeningStock() {
    if (!adjustItem || !canAdjustOpeningStock) return;
    if (!adjustQuantity || adjustQuantity < 0) {
      setError('Quantity must be a non-negative number.');
      return;
    }
    if (!adjustDate) {
      setError('Date is required.');
      return;
    }
    if (!adjustReason.trim()) {
      setError('Reason is required.');
      return;
    }
    await insertAndApproveStorekeeper({ type: 'opening_stock', item_name: adjustItem.item_name, quantity: Number(adjustQuantity) || 0, date: adjustDate, reason: adjustReason.trim() });
    setAdjustOpen(false);
    setAdjustItem(null);
    setAdjustQuantity(0);
    setAdjustDate('');
    setAdjustReason('');
    // Refresh items
    setFilterCollection((prev) => prev);
    // Trigger items refresh explicitly
    setItemsReloadKey((k) => k + 1);
  }

  if (!canView) {
    return (
      <div style={{ maxWidth: 720, margin: '24px auto' }}>
        <h2>Access denied</h2>
        <p>You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, fontFamily: 'Montserrat, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif', background: '#fff' }}>
      <h2 style={{ marginTop: 0 }}>Inventory Setup</h2>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className={`btn ${activeTab === 'structure' ? 'btn-primary' : ''}`} style={{ padding: '6px 10px', borderRadius: 6, background: activeTab === 'structure' ? '#1B5E20' : '#eee', color: activeTab === 'structure' ? '#fff' : '#333' }} onClick={() => setActiveTab('structure')}>Categories & Collections</button>
        <button className={`btn ${activeTab === 'items_stock' ? 'btn-primary' : ''}`} style={{ padding: '6px 10px', borderRadius: 6, background: activeTab === 'items_stock' ? '#1B5E20' : '#eee', color: activeTab === 'items_stock' ? '#fff' : '#333' }} onClick={() => setActiveTab('items_stock')}>Items & Opening Stock</button>
      </div>

      {error && (
        <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>{error}</div>
      )}
      {message && (
        <div style={{ background: '#e6ffed', color: '#0a7f3b', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>{message}</div>
      )}

      {activeTab === 'structure' ? (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr 1fr' }}>
          {/* Left: Categories (dynamic) */}
          <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Categories</h3>
            {loadingCategories ? (
              <div>Loading categories...</div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {categories.map((cat) => (
                  <li key={cat.id} style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button className={`btn ${selectedCategoryName === cat.name ? 'btn-primary' : ''}`} style={{ flex: 1, textAlign: 'left' }} onClick={() => setSelectedCategoryName(cat.name)}>
                      {cat.name}
                    </button>
                    <span style={{ fontSize: 12, color: cat.active ? '#0a7f3b' : '#777' }}>{cat.active ? 'Active' : 'Inactive'}</span>
                    {canEditStructure && (
                      <button className="btn" style={{ background: '#eee', color: '#333' }} onClick={() => toggleCategoryActive(cat)}>{cat.active ? 'Deactivate' : 'Activate'}</button>
                    )}
                  </li>
                ))}
                {categories.length === 0 && <li style={{ color: '#666' }}>No categories yet.</li>}
              </ul>
            )}
            <div style={{ marginTop: 12 }}>
              {canEditStructure ? (
                <button className="btn" style={{ background: '#1B5E20', color: '#fff' }} onClick={() => setAddCategoryOpen(true)}>Add Category</button>
              ) : (
                <button className="btn" disabled style={{ background: '#eee', color: '#555' }}>Add Category</button>
              )}
            </div>
          </div>
          {/* Right: Collections */}
          <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Collections</h3>
            {loadingCollections ? (
              <div>Loading collections...</div>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {collections.map((col) => (
                  <li key={col.id} style={{ padding: '6px 8px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                    <span>{col.name}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 12, color: (col.active ?? true) ? '#0a7f3b' : '#777' }}>{(col.active ?? true) ? 'Active' : 'Inactive'}</span>
                      {canEditStructure && (
                        <button className="btn" style={{ background: '#eee', color: '#333' }} onClick={() => toggleCollectionActive(col)}>{(col.active ?? true) ? 'Deactivate' : 'Activate'}</button>
                      )}
                    </div>
                  </li>
                ))}
                {collections.length === 0 && <li style={{ color: '#666' }}>No collections yet.</li>}
              </ul>
            )}
            <div style={{ marginTop: 12 }}>
              {canEditStructure ? (
                <button className="btn" style={{ background: '#1B5E20', color: '#fff' }} onClick={() => setAddCollectionOpen(true)}>Add Collection</button>
              ) : (
                <button className="btn" disabled style={{ background: '#eee', color: '#555' }}>Add Collection</button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {/* Filters */}
          <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Category</label>
                <select value={filterCategoryName} onChange={(e) => { const v = e.target.value; setFilterCategoryName(v); setFilterCollection(''); }} style={{ width: '100%', padding: '8px 10px' }}>
                  <option value="">Select category</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Collection</label>
                <select value={filterCollection} onChange={(e) => setFilterCollection(e.target.value)} style={{ width: '100%', padding: '8px 10px' }}>
                  <option value="">Select collection</option>
                  {collectionsFilter.map((c) => (
                    <option key={c.id} value={c.name}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          {/* Items table */}
          <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8 }}>
            {loadingItems ? (
              <div style={{ padding: 12 }}>Loading items...</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Item</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Unit</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Opening stock</th>
                    <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Last adjustment date</th>
                    <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => (
                    <tr key={it.id}>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{it.item_name}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{it.unit ?? '—'}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{typeof it.opening_stock === 'number' ? it.opening_stock : '—'}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{it.last_adjusted ? new Date(it.last_adjusted).toLocaleDateString() : '—'}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>
                        <button className="btn" style={{ background: '#eee', color: '#333', marginRight: 8 }} onClick={() => { /* view-only; editing redirects to setup, already here */ }} disabled>Edit</button>
                        <button className="btn" style={{ background: '#1B5E20', color: '#fff' }} onClick={() => { setAdjustItem(it); setAdjustOpen(true); }} disabled={!canAdjustOpeningStock}>Adjust Opening Stock</button>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: 12, color: '#666' }}>No items found. Use Add Item to create one.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>

          {/* Add Item */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
            <input type="text" placeholder="New item name" value={newItemName} onChange={(e) => setNewItemName(e.target.value)} />
            {canEditStructure ? (
              <button className="btn" style={{ background: '#1B5E20', color: '#fff' }} onClick={saveItem} disabled={savingItem || !newItemName.trim() || !filterCollection}>Add Item</button>
            ) : (
              <button className="btn" disabled style={{ background: '#eee', color: '#555' }}>Add Item</button>
            )}
          </div>
        </div>
      )}

      {/* Add Category Modal */}
      {addCategoryOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal={true}>
          <div className="modal" style={{ background: '#fff', padding: 16, borderRadius: 8, width: 520, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>Add Category</h3>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Category name</label>
                <input type="text" placeholder="e.g. Food" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => { setAddCategoryOpen(false); setNewCategoryName(''); }} style={{ background: '#eee', color: '#333' }}>Cancel</button>
              <button className="btn" onClick={saveCategory} style={{ background: '#1B5E20', color: '#fff' }} disabled={!canEditStructure || savingCategory || !newCategoryName.trim()}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Collection Modal */}
      {addCollectionOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal={true}>
          <div className="modal" style={{ background: '#fff', padding: 16, borderRadius: 8, width: 520, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>Add Collection</h3>
            <p style={{ color: '#555' }}>Category: {selectedCategoryName || '—'}</p>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Collection name</label>
                <input type="text" placeholder="e.g. Breakfast" value={newCollectionName} onChange={(e) => setNewCollectionName(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => { setAddCollectionOpen(false); setNewCollectionName(''); }} style={{ background: '#eee', color: '#333' }}>Cancel</button>
              <button className="btn" onClick={saveCollection} style={{ background: '#1B5E20', color: '#fff' }} disabled={!canEditStructure || savingCollection || !newCollectionName.trim() || !selectedCategoryName}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Adjust Opening Stock Modal */}
      {adjustOpen && adjustItem && (
        <div className="modal-backdrop" role="dialog" aria-modal={true}>
          <div className="modal" style={{ background: '#fff', padding: 16, borderRadius: 8, width: 520, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>Adjust Opening Stock</h3>
            <p style={{ color: '#555' }}>Provide quantity, date, and reason. Only supervisors can adjust opening stock.</p>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Item</label>
                <input value={adjustItem.item_name} readOnly />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Quantity</label>
                <input type="number" min={0} step={1} value={adjustQuantity} onChange={(e) => setAdjustQuantity(Number(e.target.value))} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Date</label>
                <input type="date" value={adjustDate} onChange={(e) => setAdjustDate(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Reason</label>
                <input type="text" value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => { setAdjustOpen(false); setAdjustItem(null); }} style={{ background: '#eee', color: '#333' }}>Cancel</button>
              <button className="btn" onClick={saveAdjustOpeningStock} style={{ background: '#1B5E20', color: '#fff' }} disabled={!canAdjustOpeningStock}>Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}