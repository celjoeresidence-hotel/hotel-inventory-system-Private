import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';


interface CategoryRow {
  id: string;
  name: string;
  active: boolean;
  assigned_to?: string[];
  status?: 'approved' | 'pending' | 'rejected' | string; // add status for decision
}

interface CollectionRow {
  id: string;
  name: string;
  active?: boolean;
  status?: 'approved' | 'pending' | 'rejected' | string; // add status for decision
}

interface ItemRow {
  id: string;
  item_name: string;
  unit?: string | null;
  unit_price?: number | null;
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
  const [newCategoryAssignedKitchen, setNewCategoryAssignedKitchen] = useState<boolean>(false);
  const [newCategoryAssignedBar, setNewCategoryAssignedBar] = useState<boolean>(false);
  const [newCategoryAssignedStorekeeper, setNewCategoryAssignedStorekeeper] = useState<boolean>(false);

  // Collections (per Category)
  const [collections, setCollections] = useState<CollectionRow[]>([]);
  const [loadingCollections, setLoadingCollections] = useState<boolean>(false);
  const [addCollectionOpen, setAddCollectionOpen] = useState<boolean>(false);
  const [newCollectionName, setNewCollectionName] = useState<string>('');
  const [savingCollection, setSavingCollection] = useState<boolean>(false);

  // Edit Category assignments state
  const [editCategoryOpen, setEditCategoryOpen] = useState<boolean>(false);
  const [editCategoryTarget, setEditCategoryTarget] = useState<CategoryRow | null>(null);
  const [editAssignedKitchen, setEditAssignedKitchen] = useState<boolean>(false);
  const [editAssignedBar, setEditAssignedBar] = useState<boolean>(false);
  const [editAssignedStorekeeper, setEditAssignedStorekeeper] = useState<boolean>(false);

  // Items & Opening Stock state
  const [filterCategoryName, setFilterCategoryName] = useState<string>('');
  const [collectionsFilter, setCollectionsFilter] = useState<CollectionRow[]>([]);
  const [filterCollection, setFilterCollection] = useState<string>('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loadingItems, setLoadingItems] = useState<boolean>(false);

  const [savingItem, setSavingItem] = useState<boolean>(false);
  // Add Item modal state and fields
  const [addItemOpen, setAddItemOpen] = useState<boolean>(false);
  const [addItemName, setAddItemName] = useState<string>('');
  const [addItemUnit, setAddItemUnit] = useState<string>('');
  const [addItemUnitPrice, setAddItemUnitPrice] = useState<string>(''); // optional
  const [addOpeningQty, setAddOpeningQty] = useState<number>(0);
  const [addOpeningDate, setAddOpeningDate] = useState<string>('');
  const [addOpeningNote, setAddOpeningNote] = useState<string>('');

  // Adjust Opening Stock modal state
  const [adjustOpen, setAdjustOpen] = useState<boolean>(false);
  const [adjustItem, setAdjustItem] = useState<ItemRow | null>(null);
  const [adjustQuantity, setAdjustQuantity] = useState<number>(0);
  const [adjustDate, setAdjustDate] = useState<string>('');
  const [adjustReason, setAdjustReason] = useState<string>('');
  const canAdjustOpeningStock = isSupervisor; // Supervisor-only per requirements

  // Edit Item modal state
  const [editItemOpen, setEditItemOpen] = useState<boolean>(false);
  const [editItemTarget, setEditItemTarget] = useState<ItemRow | null>(null);
  const [editItemName, setEditItemName] = useState<string>('');
  const [editItemUnit, setEditItemUnit] = useState<string>('');
  const [editItemUnitPrice, setEditItemUnitPrice] = useState<string>('');
  const [editItemCategory, setEditItemCategory] = useState<string>('');
  const [editItemCollection, setEditItemCollection] = useState<string>('');
  const [editItemSaving, setEditItemSaving] = useState<boolean>(false);

  // Edit Opening Stock (read-only behavior for Step 1)
  const [editOpeningOpen, setEditOpeningOpen] = useState<boolean>(false);
  const [editOpeningTarget, setEditOpeningTarget] = useState<ItemRow | null>(null);
  const [editOpeningDate, setEditOpeningDate] = useState<string>('');

  // Stock History modal state (Step 3)
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [historyItem, setHistoryItem] = useState<ItemRow | null>(null);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  type HistoryRow = { id: string; type: string | null; quantity: number; date: string | null; note: string | null; submitted_by: string | null; reviewed_by: string | null; status: string | null; created_at: string | null };
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [historyProfilesMap, setHistoryProfilesMap] = useState<Record<string, { full_name: string | null }>>({});
  const [historyPage, setHistoryPage] = useState<number>(0);
  const [historyStartDate, setHistoryStartDate] = useState<string>('');
  const [historyEndDate, setHistoryEndDate] = useState<string>('');
  const HISTORY_PAGE_SIZE = 10;

  useEffect(() => {
    async function fetchCategories() {
      setError(null);
      setMessage(null);
      setLoadingCategories(true);
      try {
        if (!canView || !supabase) return;
        const { data, error } = await supabase
          .from('operational_records')
          .select('id, data, original_id, version_no, created_at, status, deleted_at')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'config_category')
          .order('created_at', { ascending: false });
        if (error) {
          setError(error.message);
          return;
        }
        const rows = (data ?? []);
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
        const list: CategoryRow[] = latestRows.map((r: any) => ({
          id: String(r.id),
          name: String(r.data?.category_name ?? r.data?.category ?? ''),
          active: (r.data?.active ?? true) !== false,
          assigned_to: Array.isArray(r.data?.assigned_to)
            ? r.data.assigned_to
            : typeof r.data?.assigned_to === 'object' && r.data?.assigned_to !== null
              ? Object.entries(r.data.assigned_to)
                 .filter(([_, v]) => v === true)
                 .map(([k]) => k)
              : [],
          status: String(r.status ?? ''),
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
          .select('id, data, original_id, version_no, created_at, status, deleted_at')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'config_collection')
          .filter('data->>category', 'eq', selectedCategoryName)
          .order('created_at', { ascending: false });
        if (error) {
          setError(error.message);
          return;
        }
        const rowsSel = (data ?? []);
        const latestByOriginalSel = new Map<string, any>();
        for (const r of rowsSel) {
          const key = String(r?.original_id ?? r?.id);
          const prev = latestByOriginalSel.get(key);
          const currVer = Number(r?.version_no ?? 0);
          const prevVer = Number(prev?.version_no ?? -1);
          const currTs = new Date(r?.created_at ?? 0).getTime();
          const prevTs = new Date(prev?.created_at ?? 0).getTime();
          if (!prev || currVer > prevVer || (currVer === prevVer && currTs > prevTs)) {
            latestByOriginalSel.set(key, r);
          }
        }
        const latestRowsSel = Array.from(latestByOriginalSel.values());
        const list = latestRowsSel.map((r: any) => ({ id: String(r.id), name: String(r.data?.collection_name ?? ''), active: (r.data?.active ?? true) !== false, status: String(r.status ?? '') })).filter((c: any) => c.name);
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
          .select('id, data, original_id, version_no, created_at, status, deleted_at')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'config_collection')
          .filter('data->>category', 'eq', filterCategoryName)
          .order('created_at', { ascending: false });
        if (error) {
          setError(error.message);
          return;
        }
        const rowsFilt = (data ?? []);
        const latestByOriginalFilt = new Map<string, any>();
        for (const r of rowsFilt) {
          const key = String(r?.original_id ?? r?.id);
          const prev = latestByOriginalFilt.get(key);
          const currVer = Number(r?.version_no ?? 0);
          const prevVer = Number(prev?.version_no ?? -1);
          const currTs = new Date(r?.created_at ?? 0).getTime();
          const prevTs = new Date(prev?.created_at ?? 0).getTime();
          if (!prev || currVer > prevVer || (currVer === prevVer && currTs > prevTs)) {
            latestByOriginalFilt.set(key, r);
          }
        }
        const latestRowsFilt = Array.from(latestByOriginalFilt.values());
        const list = latestRowsFilt.map((r: any) => ({ id: String(r.id), name: String(r.data?.collection_name ?? ''), active: (r.data?.active ?? true) !== false, status: String(r.status ?? '') })).filter((c: any) => c.name);
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
          .select('id, data, status, created_at, original_id, version_no, deleted_at')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'config_item')
          .filter('data->>category', 'eq', filterCategoryName)
          .filter('data->>collection_name', 'eq', filterCollection)
          .order('created_at', { ascending: false });
        if (error) {
          setError(error.message);
          return;
        }
        const rowsItems = (data ?? []);
        const latestByOriginalItems = new Map<string, any>();
        for (const r of rowsItems) {
          const key = String(r?.original_id ?? r?.id);
          const prev = latestByOriginalItems.get(key);
          const currVer = Number(r?.version_no ?? 0);
          const prevVer = Number(prev?.version_no ?? -1);
          const currTs = new Date(r?.created_at ?? 0).getTime();
          const prevTs = new Date(prev?.created_at ?? 0).getTime();
          if (!prev || currVer > prevVer || (currVer === prevVer && currTs > prevTs)) {
            latestByOriginalItems.set(key, r);
          }
        }
        const latestRowsItems = Array.from(latestByOriginalItems.values());
        const baseItems: ItemRow[] = latestRowsItems.map((r: any) => ({
          id: String(r.id),
          item_name: String(r.data?.item_name ?? ''),
          unit: r.data?.unit ?? null,
          unit_price: typeof r.data?.unit_price === 'number' ? r.data.unit_price : (r.data?.unit_price != null ? Number(r.data.unit_price) : null),
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

  async function insertAndApproveStorekeeper(payload: any): Promise<string | null> {
    setError(null);
    setMessage(null);
    try {
      if (!supabase) {
        setError('Supabase is not configured.');
        return null;
      }
      const { data: inserted, error: insErr } = await supabase
        .from('operational_records')
        .insert({ entity_type: 'storekeeper', data: payload, financial_amount: 0 })
        .select()
        .single();
      if (insErr) {
        setError(insErr.message);
        return null;
      }
      const id = (inserted as any)?.id;
      if (!id) {
        setError('Failed to insert record.');
        return null;
      }
      const { error: aprErr } = await supabase.rpc('approve_record', { _id: id });
      if (aprErr) {
        setError(aprErr.message);
        return null;
      }
      setMessage('Saved successfully.');
      return String(id);
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
      return null;
    }
  }

  async function saveCategory() {
    if (!newCategoryName.trim()) return;
    setSavingCategory(true);
    const assigned: string[] = [];
    if (newCategoryAssignedKitchen) assigned.push('kitchen');
    if (newCategoryAssignedBar) assigned.push('bar');
    if (newCategoryAssignedStorekeeper) assigned.push('storekeeper');
    await insertConfigRecord({ type: 'config_category', category_name: newCategoryName.trim(), active: true, assigned_to: assigned });
    setSavingCategory(false);
    setNewCategoryName('');
    setNewCategoryAssignedKitchen(false);
    setNewCategoryAssignedBar(false);
    setNewCategoryAssignedStorekeeper(false);
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
      await supabase.rpc('edit_config_record', { _previous_version_id: cat.id, _data: { active: !cat.active } });
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
      await supabase.rpc('edit_config_record', { _previous_version_id: col.id, _data: { active: !(col.active ?? true) } });
      setCollectionsReloadKey((k) => k + 1);
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    }
  }

  // Soft delete a category via RPC
  async function deleteCategory(cat: CategoryRow) {
    if (!canEditStructure) return;
    try {
      if (!supabase) {
        setError('Supabase is not configured.');
        return;
      }
      const isApproved = (cat.status ?? 'approved') === 'approved';
      const { error: delErr } = isApproved
        ? await supabase.rpc('delete_config_category', { _id: cat.id })
        : await supabase.rpc('soft_delete_record', { _id: cat.id });
      if (delErr) {
        setError(delErr.message);
        return;
      }
      setMessage('Category deleted.');
      setSelectedCategoryName((prev) => (prev === cat.name ? '' : prev));
      setCategoriesReloadKey((k) => k + 1);
      setCollectionsReloadKey((k) => k + 1);
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    }
  }

  // Soft delete a collection via RPC
  async function deleteCollection(col: CollectionRow) {
    if (!canEditStructure) return;
    try {
      if (!supabase) {
        setError('Supabase is not configured.');
        return;
      }
      const isApproved = (col.status ?? 'approved') === 'approved';
      const { error: delErr } = isApproved
        ? await supabase.rpc('delete_config_collection', { _id: col.id })
        : await supabase.rpc('soft_delete_record', { _id: col.id });
      if (delErr) {
        setError(delErr.message);
        return;
      }
      setMessage('Collection deleted.');
      setCollectionsReloadKey((k) => k + 1);
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    }
  }

  function openEditCategory(cat: CategoryRow) {
    setEditCategoryTarget(cat);
    const assigned = Array.isArray(cat.assigned_to) ? cat.assigned_to : [];
    setEditAssignedKitchen(assigned.includes('kitchen'));
    setEditAssignedBar(assigned.includes('bar'));
    setEditAssignedStorekeeper(assigned.includes('storekeeper'));
    setEditCategoryOpen(true);
  }

  async function saveEditCategoryAssignments() {
    if (!canEditStructure || !editCategoryTarget) return;
    try {
      if (!supabase) {
        setError('Supabase is not configured.');
        return;
      }
      const assigned: string[] = [];
      if (editAssignedKitchen) assigned.push('kitchen');
      if (editAssignedBar) assigned.push('bar');
      if (editAssignedStorekeeper) assigned.push('storekeeper');
      await supabase.rpc('edit_config_record', { _previous_version_id: editCategoryTarget.id, _data: { assigned_to: assigned } });
      setEditCategoryOpen(false);
      setEditCategoryTarget(null);
      setCategoriesReloadKey((k) => k + 1);
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    }
  }


  async function saveNewItem() {
    if (!canEditStructure) return;
    if (!filterCategoryName || !filterCollection) {
      setError('Select category and collection first.');
      return;
    }
    if (!addItemName.trim()) {
      setError('Item name is required.');
      return;
    }
    if (!addItemUnit.trim()) {
      setError('Unit is required.');
      return;
    }
    if (!addOpeningDate) {
      setError('Opening stock date is required.');
      return;
    }
    if (addOpeningQty < 0) {
      setError('Opening stock must be a non-negative number.');
      return;
    }
    setSavingItem(true);
    try {
      const itemPayload: any = { type: 'config_item', category: filterCategoryName, collection_name: filterCollection, item_name: addItemName.trim(), unit: addItemUnit.trim() };
      if (addItemUnitPrice && addItemUnitPrice.trim().length > 0) {
        itemPayload.unit_price = Number(addItemUnitPrice) || 0;
      }
      const itemId = await insertAndApproveStorekeeper(itemPayload);
      if (!itemId) {
        setSavingItem(false);
        return;
      }
      await insertAndApproveStorekeeper({
        type: 'opening_stock',
        item_id: itemId,
        item_name: addItemName.trim(),
        quantity: Number(addOpeningQty) || 0,
        date: addOpeningDate,
        note: addOpeningNote.trim() ? addOpeningNote.trim() : undefined,
      });
      setAddItemOpen(false);
      setAddItemName('');
      setAddItemUnit('');
      setAddItemUnitPrice('');
      setAddOpeningQty(0);
      setAddOpeningDate('');
      setAddOpeningNote('');
      // Refresh items
      setItemsReloadKey((k) => k + 1);
    } finally {
      setSavingItem(false);
    }
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
    await insertAndApproveStorekeeper({
      type: 'opening_stock',
      item_id: adjustItem.id,
      item_name: adjustItem.item_name,
      quantity: Number(adjustQuantity) || 0,
      date: adjustDate,
      note: adjustReason.trim(),
    });
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

  function openEditItem(it: ItemRow) {
    setEditItemTarget(it);
    setEditItemName(it.item_name);
    setEditItemUnit(it.unit ?? '');
    setEditItemUnitPrice(it.unit_price != null ? String(it.unit_price) : '');
    setEditItemCategory(filterCategoryName || '');
    setEditItemCollection(filterCollection || '');
    setEditItemOpen(true);
  }

  async function saveEditItem() {
    if (!canEditStructure || !editItemTarget) return;
    setError(null);
    setMessage(null);
    setEditItemSaving(true);
    try {
      if (!supabase) {
        setError('Supabase is not configured.');
        return;
      }
      const payload: any = {
        type: 'config_item',
        category: editItemCategory,
        collection_name: editItemCollection,
        item_name: editItemName.trim(),
        unit: editItemUnit.trim(),
      };
      if (editItemUnitPrice.trim().length > 0) {
        payload.unit_price = Number(editItemUnitPrice) || 0;
      }
      const { error: rpcErr } = await supabase.rpc('edit_config_record', { _previous_version_id: editItemTarget.id, _data: payload });
      if (rpcErr) {
        setError(rpcErr.message);
        return;
      }
      setMessage('Item updated. A new version has been created.');
      setEditItemOpen(false);
      setEditItemTarget(null);
      setItemsReloadKey((k) => k + 1);
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    } finally {
      setEditItemSaving(false);
    }
  }

  function openEditOpening(it: ItemRow) {
    setEditOpeningTarget(it);
    // Pre-fill with the latest adjustment date if available
    setEditOpeningDate(it.last_adjusted ? String(it.last_adjusted).slice(0, 10) : '');
    setEditOpeningOpen(true);
  }

  function closeEditOpening() {
    setEditOpeningOpen(false);
    setEditOpeningTarget(null);
    setEditOpeningDate('');
  }

  // Step 3: Stock History handlers
  function openStockHistory(it: ItemRow) {
    setHistoryError(null);
    setHistoryLoading(true);
    setHistoryRows([]);
    setHistoryProfilesMap({});
    setHistoryPage(0);
    setHistoryItem(it);
    setHistoryOpen(true);
    (async () => {
      try {
        if (!supabase || !canView) return;
        // Build base query for operational_records for the item, across multiple types
        let q = supabase
          .from('operational_records')
          .select('id, data, created_at, submitted_by, reviewed_by, status')
          .eq('entity_type', 'storekeeper')
          .filter('data->>item_name', 'eq', it.item_name)
          .order('created_at', { ascending: false });
        // Allow types: opening_stock, restock, sold
        // Supabase JS client doesn't support IN for json filter, so we fetch broader set and filter locally by type
        const { data, error } = await q;
        if (error) {
          setHistoryError(error.message);
          return;
        }
        const allowedTypes = new Set(['opening_stock', 'restock', 'sold']);
        let rows: HistoryRow[] = (data ?? [])
          .filter((r: any) => allowedTypes.has(r?.data?.type))
          .map((r: any) => ({
            id: String(r.id),
            type: r?.data?.type ?? null,
            quantity: typeof r?.data?.quantity === 'number' ? r.data.quantity : Number(r?.data?.quantity ?? 0),
            date: r?.data?.date ?? null,
            note: (typeof r?.data?.note === 'string' ? r.data.note : null),
            submitted_by: r?.submitted_by ?? null,
            reviewed_by: r?.reviewed_by ?? null,
            status: r?.status ?? null,
            created_at: r?.created_at ?? null,
          }));
        // Apply date range filter if provided
        if (historyStartDate) {
          rows = rows.filter((r) => {
            const d = r.date ?? r.created_at;
            return d ? new Date(d).getTime() >= new Date(historyStartDate).getTime() : true;
          });
        }
        if (historyEndDate) {
          rows = rows.filter((r) => {
            const d = r.date ?? r.created_at;
            return d ? new Date(d).getTime() <= new Date(historyEndDate).getTime() : true;
          });
        }
        setHistoryRows(rows);
        const ids = Array.from(new Set(rows.flatMap((r) => [r.submitted_by, r.reviewed_by]).filter(Boolean))) as string[];
        if (ids.length) {
          const { data: profs, error: pErr } = await supabase
            .from('profiles')
            .select('id, full_name')
            .in('id', ids);
          if (!pErr && profs) {
            const map: Record<string, { full_name: string | null }> = {};
            for (const p of profs as any[]) {
              map[p.id] = { full_name: p.full_name ?? null };
            }
            setHistoryProfilesMap(map);
          }
        }
      } finally {
        setHistoryLoading(false);
      }
    })();
  }

  function closeStockHistory() {
    setHistoryOpen(false);
    setHistoryItem(null);
    setHistoryRows([]);
    setHistoryProfilesMap({});
    setHistoryError(null);
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
                      <>
                        <button className="btn" style={{ background: '#eee', color: '#333' }} onClick={() => toggleCategoryActive(cat)}>{cat.active ? 'Deactivate' : 'Activate'}</button>
                        <button className="btn" style={{ background: '#eee', color: '#333' }} onClick={() => openEditCategory(cat)}>Edit</button>
                        <button className="btn" style={{ background: '#fee', color: '#900' }} onClick={() => deleteCategory(cat)}>Delete</button>
                      </>
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
                        <>
                          <button className="btn" style={{ background: '#eee', color: '#333' }} onClick={() => toggleCollectionActive(col)}>{(col.active ?? true) ? 'Deactivate' : 'Activate'}</button>
                          <button className="btn" style={{ background: '#fee', color: '#900' }} onClick={() => deleteCollection(col)}>Delete</button>
                        </>
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
                        {/* Supervisor-only adjust opening stock */}
                        {canEditStructure && (
                          <>
                            <button className="btn" style={{ background: '#eee', color: '#333', marginRight: 8 }} onClick={() => openEditItem(it)}>Edit Item</button>
                            <button className="btn" style={{ background: '#eee', color: '#333', marginRight: 8 }} onClick={() => openEditOpening(it)}>Edit Opening Stock</button>
                            <button className="btn" style={{ background: '#1B5E20', color: '#fff', marginRight: 8 }} onClick={() => openStockHistory(it)}>Stock History</button>
                            <button className="btn" style={{ background: '#1B5E20', color: '#fff' }} onClick={() => { setAdjustItem(it); setAdjustOpen(true); }} disabled={!canAdjustOpeningStock}>Adjust Opening Stock</button>
                          </>
                        )}
                        {/* For viewers, allow history view only */}
                        {!canEditStructure && (
                          <>
                            <button className="btn" style={{ background: '#1B5E20', color: '#fff' }} onClick={() => openStockHistory(it)}>Stock History</button>
                          </>
                        )}
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

          {/* Add Item trigger */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {canEditStructure ? (
              <button
                className="btn"
                style={{
                  background: (!filterCategoryName || !filterCollection) ? '#eee' : '#1B5E20',
                  color: (!filterCategoryName || !filterCollection) ? '#555' : '#fff',
                  cursor: (!filterCategoryName || !filterCollection) ? 'not-allowed' : 'pointer'
                }}
                onClick={() => setAddItemOpen(true)}
                disabled={!filterCategoryName || !filterCollection}
                title={(!filterCategoryName || !filterCollection) ? 'Select category and collection first' : undefined}
              >
                Add Item
              </button>
            ) : (
              <button className="btn" disabled style={{ background: '#eee', color: '#555' }}>Add Item</button>
            )}
            {canEditStructure && (!filterCategoryName || !filterCollection) && (
              <span style={{ color: '#777', fontSize: 13 }}>Select a category and collection first.</span>
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
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Assign to</label>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={newCategoryAssignedKitchen} onChange={(e) => setNewCategoryAssignedKitchen(e.target.checked)} /> Kitchen
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={newCategoryAssignedBar} onChange={(e) => setNewCategoryAssignedBar(e.target.checked)} /> Bar
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={newCategoryAssignedStorekeeper} onChange={(e) => setNewCategoryAssignedStorekeeper(e.target.checked)} /> Storekeeper
                  </label>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => { setAddCategoryOpen(false); setNewCategoryName(''); setNewCategoryAssignedKitchen(false); setNewCategoryAssignedBar(false); setNewCategoryAssignedStorekeeper(false); }} style={{ background: '#eee', color: '#333' }}>Cancel</button>
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

      {/* Edit Category Assignments Modal */}
      {editCategoryOpen && editCategoryTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal={true}>
          <div className="modal" style={{ background: '#fff', padding: 16, borderRadius: 8, width: 520, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>Edit Category Assignments</h3>
            <p style={{ color: '#555' }}>Category: {editCategoryTarget.name}</p>
            <div style={{ display: 'grid', gap: 12 }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Assign to</label>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={editAssignedKitchen} onChange={(e) => setEditAssignedKitchen(e.target.checked)} /> Kitchen
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={editAssignedBar} onChange={(e) => setEditAssignedBar(e.target.checked)} /> Bar
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" checked={editAssignedStorekeeper} onChange={(e) => setEditAssignedStorekeeper(e.target.checked)} /> Storekeeper
                  </label>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => { setEditCategoryOpen(false); setEditCategoryTarget(null); }} style={{ background: '#eee', color: '#333' }}>Cancel</button>
              <button className="btn" onClick={saveEditCategoryAssignments} style={{ background: '#1B5E20', color: '#fff' }} disabled={!canEditStructure}>Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Item Modal */}
      {addItemOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal={true}>
          <div className="modal" style={{ background: '#fff', padding: 16, borderRadius: 8, width: 560, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>Add Item</h3>
            <p style={{ color: '#555' }}>Category: {filterCategoryName || '—'} | Collection: {filterCollection || '—'}</p>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Item name</label>
                <input type="text" placeholder="e.g. Eggs" value={addItemName} onChange={(e) => setAddItemName(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Unit</label>
                <input type="text" placeholder="e.g. tray, kg, bottle" value={addItemUnit} onChange={(e) => setAddItemUnit(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Unit price (optional)</label>
                <input type="number" min={0} step={0.01} placeholder="e.g. 500" value={addItemUnitPrice} onChange={(e) => setAddItemUnitPrice(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Opening stock quantity</label>
                <input type="number" min={0} step={1} placeholder="e.g. 10" value={addOpeningQty} onChange={(e) => setAddOpeningQty(Number(e.target.value))} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Opening stock date</label>
                <input type="date" value={addOpeningDate} onChange={(e) => setAddOpeningDate(e.target.value)} />
              </div>
              <div style={{ gridColumn: '1 / span 2' }}>
                <label style={{ display: 'block', marginBottom: 6 }}>Note (optional)</label>
                <input type="text" value={addOpeningNote} onChange={(e) => setAddOpeningNote(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => { setAddItemOpen(false); }} style={{ background: '#eee', color: '#333' }}>Cancel</button>
              <button className="btn" onClick={saveNewItem} style={{ background: '#1B5E20', color: '#fff' }} disabled={!canEditStructure || savingItem || !filterCategoryName || !filterCollection || !addItemName.trim() || !addItemUnit.trim() || !addOpeningDate || addOpeningQty < 0}>Save</button>
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
      {editItemOpen && editItemTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal={true}>
          <div className="modal" style={{ background: '#fff', padding: 16, borderRadius: 8, width: 560, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>Edit Item</h3>
            <p style={{ color: '#555' }}>Category: {editItemCategory || '—'} | Collection: {editItemCollection || '—'}</p>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Item name</label>
                <input type="text" value={editItemName} onChange={(e) => setEditItemName(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Unit</label>
                <input type="text" value={editItemUnit} onChange={(e) => setEditItemUnit(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Unit price (optional)</label>
                <input type="number" min={0} step={0.01} value={editItemUnitPrice} onChange={(e) => setEditItemUnitPrice(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => { setEditItemOpen(false); setEditItemTarget(null); }} style={{ background: '#eee', color: '#333' }} disabled={editItemSaving}>Cancel</button>
              <button className="btn" onClick={saveEditItem} style={{ background: '#1B5E20', color: '#fff' }} disabled={!canEditStructure || editItemSaving || !editItemName.trim() || !editItemUnit.trim()}>
                {editItemSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Opening Stock Modal (no persistence change in Step 1) */}
      {editOpeningOpen && editOpeningTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal={true}>
          <div className="modal" style={{ background: '#fff', padding: 16, borderRadius: 8, width: 520, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>Edit Opening Stock</h3>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Item</label>
                <input value={editOpeningTarget.item_name} readOnly />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Current opening stock</label>
                <input value={typeof editOpeningTarget.opening_stock === 'number' ? String(editOpeningTarget.opening_stock) : '—'} readOnly />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Date</label>
                <input type="date" value={editOpeningDate} onChange={(e) => setEditOpeningDate(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={closeEditOpening} style={{ background: '#eee', color: '#333' }}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Stock History Modal (read-only, Step 3) */}
      {historyOpen && historyItem && (
        <div className="modal-backdrop" role="dialog" aria-modal={true}>
          <div className="modal" style={{ background: '#fff', padding: 16, borderRadius: 8, width: 900, maxWidth: '95vw' }}>
            <h3 style={{ marginTop: 0 }}>Stock History — {historyItem.item_name}</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <label>Start</label>
              <input type="date" value={historyStartDate} onChange={(e) => setHistoryStartDate(e.target.value)} />
              <label>End</label>
              <input type="date" value={historyEndDate} onChange={(e) => setHistoryEndDate(e.target.value)} />
              <button className="btn" onClick={() => openStockHistory(historyItem!)} style={{ background: '#eee', color: '#333' }}>Apply</button>
            </div>
            {historyError && (
              <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6 }}>{historyError}</div>
            )}
            {historyLoading ? (
              <div className="table-loading">Loading history...</div>
            ) : historyRows.length === 0 ? (
              <div style={{ color: '#666' }}>No history found for this item.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Date</th>
                      <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Type</th>
                      <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Quantity</th>
                      <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Note</th>
                      <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Recorded By</th>
                      <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Reviewed By</th>
                      <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyRows
                      .slice(historyPage * HISTORY_PAGE_SIZE, historyPage * HISTORY_PAGE_SIZE + HISTORY_PAGE_SIZE)
                      .map((row) => {
                        const d = row.date ?? row.created_at;
                        const qty = Number(row.quantity ?? 0);
                        const who = row.submitted_by ? (historyProfilesMap[row.submitted_by]?.full_name ?? '—') : '—';
                        const reviewer = row.reviewed_by ? (historyProfilesMap[row.reviewed_by]?.full_name ?? '—') : '—';
                        return (
                          <tr key={row.id}>
                            <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{d ? new Date(d).toLocaleDateString() : '—'}</td>
                            <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{row.type ?? '—'}</td>
                            <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{Number.isFinite(qty) ? qty : '—'}</td>
                            <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{row.note ?? '—'}</td>
                            <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{who}</td>
                            <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{reviewer}</td>
                            <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{row.status ?? '—'}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <div style={{ color: '#666' }}>Page {historyPage + 1} of {Math.max(1, Math.ceil(historyRows.length / HISTORY_PAGE_SIZE))}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={() => setHistoryPage((p) => Math.max(0, p - 1))} style={{ background: '#eee', color: '#333' }} disabled={historyPage === 0}>Prev</button>
                <button className="btn" onClick={() => setHistoryPage((p) => ((p + 1) < Math.ceil(historyRows.length / HISTORY_PAGE_SIZE) ? p + 1 : p))} style={{ background: '#eee', color: '#333' }} disabled={(historyPage + 1) >= Math.ceil(historyRows.length / HISTORY_PAGE_SIZE)}>Next</button>
                <button className="btn" onClick={closeStockHistory} style={{ background: '#1B5E20', color: '#fff' }}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
      {editItemOpen && editItemTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal={true}>
          <div className="modal" style={{ background: '#fff', padding: 16, borderRadius: 8, width: 560, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>Edit Item</h3>
            <p style={{ color: '#555' }}>Category: {editItemCategory || '—'} | Collection: {editItemCollection || '—'}</p>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Item name</label>
                <input type="text" value={editItemName} onChange={(e) => setEditItemName(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Unit</label>
                <input type="text" value={editItemUnit} onChange={(e) => setEditItemUnit(e.target.value)} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Unit price (optional)</label>
                <input type="number" min={0} step={0.01} value={editItemUnitPrice} onChange={(e) => setEditItemUnitPrice(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={() => { setEditItemOpen(false); setEditItemTarget(null); }} style={{ background: '#eee', color: '#333' }} disabled={editItemSaving}>Cancel</button>
              <button className="btn" onClick={saveEditItem} style={{ background: '#1B5E20', color: '#fff' }} disabled={!canEditStructure || editItemSaving || !editItemName.trim() || !editItemUnit.trim()}>
                {editItemSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Opening Stock Modal (no persistence change in Step 1) */}
      {editOpeningOpen && editOpeningTarget && (
        <div className="modal-backdrop" role="dialog" aria-modal={true}>
          <div className="modal" style={{ background: '#fff', padding: 16, borderRadius: 8, width: 520, maxWidth: '90vw' }}>
            <h3 style={{ marginTop: 0 }}>Edit Opening Stock</h3>
            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: '1fr 1fr' }}>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Item</label>
                <input value={editOpeningTarget.item_name} readOnly />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Current opening stock</label>
                <input value={typeof editOpeningTarget.opening_stock === 'number' ? String(editOpeningTarget.opening_stock) : '—'} readOnly />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: 6 }}>Date</label>
                <input type="date" value={editOpeningDate} onChange={(e) => setEditOpeningDate(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
              <button className="btn" onClick={closeEditOpening} style={{ background: '#eee', color: '#333' }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}