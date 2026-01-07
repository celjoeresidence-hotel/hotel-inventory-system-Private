import { useEffect, useState, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Checkbox } from './ui/Checkbox';
import { Modal } from './ui/Modal';
import { Select } from './ui/Select';
import { SearchInput } from './ui/SearchInput';
import { Pagination } from './ui/Pagination';
import { 
  Table, 
  TableHeader, 
  TableBody, 
  TableRow, 
  TableHead, 
  TableCell 
} from './ui/Table';
import { 
  IconPlus, 
  IconEdit, 
  IconTrash2, 
  IconHistory, 
  IconCheckCircle,
  IconAlertCircle
} from './ui/Icons';
import { DeleteConfirmationModal } from './DeleteConfirmationModal';

interface CategoryRow {
  id: string;
  name: string;
  active: boolean;
  assigned_to?: string[];
  status?: 'approved' | 'pending' | 'rejected' | string;
}

interface CollectionRow {
  id: string;
  name: string;
  active?: boolean;
  status?: 'approved' | 'pending' | 'rejected' | string;
}

interface ItemRow {
  id: string;
  item_name: string;
  unit?: string | null;
  unit_price?: number | null;
  opening_stock?: number | null;
  last_adjusted?: string | null;
}

export default function InventoryItemsTab() {
  const { session, isConfigured, isSupervisor, isManager, isAdmin, role } = useAuth();
  const canView = useMemo(() => Boolean(isConfigured && session && (isSupervisor || isManager || isAdmin)), [isConfigured, session, isSupervisor, isManager, isAdmin]);
  const canEdit = useMemo(() => Boolean(isSupervisor || isManager || isAdmin || role === 'storekeeper'), [isSupervisor, isManager, isAdmin, role]);
  const canDeleteItem = useMemo(() => Boolean(isManager || isAdmin), [isManager, isAdmin]);

  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [itemsReloadKey, setItemsReloadKey] = useState<number>(0);

  // Delete Modal
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Categories (for dropdowns)
  const [categories, setCategories] = useState<CategoryRow[]>([]);

  // Items & Opening Stock state
  const [filterCategoryName, setFilterCategoryName] = useState<string>('');
  const [collectionsFilter, setCollectionsFilter] = useState<CollectionRow[]>([]);
  const [filterCollection, setFilterCollection] = useState<string>('');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loadingItems, setLoadingItems] = useState<boolean>(false);
  
  // Search & Bulk Actions
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const PAGE_SIZE = 10;
  
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());

  // Add Item modal state
  const [addItemOpen, setAddItemOpen] = useState<boolean>(false);
  const [addItemName, setAddItemName] = useState<string>('');
  const [addItemUnit, setAddItemUnit] = useState<string>('');
  const [addItemUnitPrice, setAddItemUnitPrice] = useState<string>('');
  const [addOpeningQty, setAddOpeningQty] = useState<number>(0);
  const [addOpeningDate, setAddOpeningDate] = useState<string>('');
  const [addOpeningNote, setAddOpeningNote] = useState<string>('');
  const [savingItem, setSavingItem] = useState<boolean>(false);

  // Adjust Opening Stock modal state
  const [adjustOpen, setAdjustOpen] = useState<boolean>(false);
  const [adjustItem, setAdjustItem] = useState<ItemRow | null>(null);
  const [adjustQuantity, setAdjustQuantity] = useState<number>(0);
  const [adjustDate, setAdjustDate] = useState<string>('');
  const [adjustReason, setAdjustReason] = useState<string>('');

  // Edit Item modal state
  const [editItemOpen, setEditItemOpen] = useState<boolean>(false);
  const [editItemTarget, setEditItemTarget] = useState<ItemRow | null>(null);
  const [editItemName, setEditItemName] = useState<string>('');
  const [editItemUnit, setEditItemUnit] = useState<string>('');
  const [editItemUnitPrice, setEditItemUnitPrice] = useState<string>('');
  const [editItemCategory, setEditItemCategory] = useState<string>('');
  const [editItemCollection, setEditItemCollection] = useState<string>('');
  const [editItemSaving, setEditItemSaving] = useState<boolean>(false);

  // Helper: Insert and Approve
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

  // Fetch Categories for Dropdowns
  useEffect(() => {
    async function fetchCategories() {
      setError(null);
      setMessage(null);
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
        
        // Initialize filters if empty
        if (!filterCategoryName && list.length > 0) {
          setFilterCategoryName(list[0].name);
        }
      } finally {
        // Loading state removed
      }
    }
    fetchCategories();
  }, [canView]);

  // Fetch Collections for Dropdown Filter
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
        if (list.length > 0 && !filterCollection) {
            setFilterCollection(list[0].name);
        } else if (list.length === 0) {
            setFilterCollection('');
        }
      } catch (e) {
        console.warn('Fetch collections for filter failed');
      }
    }
    fetchCollectionsForFilter();
  }, [filterCategoryName, canView]);

  // Fetch Items
  useEffect(() => {
    async function fetchItems() {
      setError(null);
      setMessage(null);
      setLoadingItems(true);
      setSelectedItemIds(new Set()); // Reset selection
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

        // Fetch current stock from authoritative view
        const stockMap = new Map<string, number>();
        try {
            const { data: stockData, error: stockErr } = await supabase
                .from('inventory_catalog_view')
                .select('item_name, current_stock')
                .eq('category', filterCategoryName)
                .eq('collection_name', filterCollection);

            if (!stockErr && stockData) {
                for (const r of (stockData as any[])) {
                    stockMap.set(r.item_name, Number(r.current_stock ?? 0));
                }
            }
        } catch (err) {
            console.error('Failed to fetch stock levels', err);
        }

        const results: ItemRow[] = baseItems.map(it => ({
            ...it,
            opening_stock: stockMap.get(it.item_name) ?? 0,
            last_adjusted: null
        }));

        setItems(results);
      } finally {
        setLoadingItems(false);
      }
    }
    if (filterCollection) fetchItems();
  }, [filterCategoryName, filterCollection, canView, itemsReloadKey]);

  useEffect(() => { setPage(1); }, [searchTerm, filterCategoryName, filterCollection]);

  async function handleAddItem() {
    if (!canEdit) return;
    if (!addItemName.trim() || !filterCategoryName || !filterCollection) return;
    setSavingItem(true);
    const itemPayload = {
      type: 'config_item',
      category: filterCategoryName,
      collection_name: filterCollection,
      item_name: addItemName.trim(),
      unit: addItemUnit.trim(),
      unit_price: parseFloat(addItemUnitPrice) || 0,
      active: true,
    };
    const newId = await insertAndApproveStorekeeper(itemPayload);
    if (newId && addOpeningQty > 0) {
      const stockPayload = {
        type: 'opening_stock',
        item_name: addItemName.trim(),
        category: filterCategoryName,
        collection_name: filterCollection,
        quantity: addOpeningQty,
        date: addOpeningDate || new Date().toISOString().slice(0, 10),
        note: addOpeningNote || 'Initial opening stock',
      };
      await insertAndApproveStorekeeper(stockPayload);
    }
    setSavingItem(false);
    setAddItemOpen(false);
    setAddItemName('');
    setAddItemUnit('');
    setAddItemUnitPrice('');
    setAddOpeningQty(0);
    setAddOpeningDate('');
    setAddOpeningNote('');
    setItemsReloadKey(k => k + 1);
  }

  async function handleBulkDelete() {
    if (!canDeleteItem || selectedItemIds.size === 0) return;
    setShowDeleteConfirm(true);
  }
  
  async function confirmBulkDelete() {
    setIsDeleting(true);
    try {
      if (!supabase) { setError('Supabase is not configured.'); return; }
      
      const ids = Array.from(selectedItemIds);
      let successCount = 0;
      let failCount = 0;

      // Process sequentially to ensure all are handled
      for (const id of ids) {
        const { error: delErr } = await supabase.rpc('delete_record', { _id: id });
        if (delErr) {
            console.error(`Failed to delete ${id}`, delErr);
            failCount++;
        } else {
            successCount++;
        }
      }
      
      setSelectedItemIds(new Set());
      setItemsReloadKey((k) => k + 1);
      
      if (failCount > 0) {
          setError(`Deleted ${successCount} items. Failed to delete ${failCount} items (they may be in use).`);
      } else {
          setMessage(`Successfully deleted ${successCount} items.`);
      }
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    } finally {
        setIsDeleting(false);
        setShowDeleteConfirm(false);
    }
  }

  async function handleAdjustStock() {
    if (!canEdit) return;
    if (!adjustItem) return;
    try {
      if (!supabase) { setError('Supabase is not configured.'); return; }
      
      const stockPayload = {
        type: 'opening_stock',
        item_name: adjustItem.item_name,
        category: filterCategoryName,
        collection_name: filterCollection,
        quantity: adjustQuantity,
        date: adjustDate || new Date().toISOString().slice(0, 10),
        note: adjustReason || 'Stock adjustment',
      };
      await insertAndApproveStorekeeper(stockPayload);
      
      setAdjustOpen(false);
      setAdjustItem(null);
      setAdjustQuantity(0);
      setAdjustDate('');
      setAdjustReason('');
      setItemsReloadKey(k => k + 1);
      setMessage('Stock adjusted successfully.');
    } catch (e: any) {
      setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    }
  }

  async function handleUpdateItem() {
    if (!canEdit) return;
    if (!editItemTarget || !editItemName.trim()) return;
    setEditItemSaving(true);
    try {
        if (!supabase) { setError('Supabase is not configured.'); return; }
        
        // Use edit_config_record RPC
        const { data: newVersionId, error: editErr } = await supabase.rpc('edit_config_record', { 
            _previous_version_id: editItemTarget.id, 
            _data: { 
                item_name: editItemName.trim(),
                unit: editItemUnit.trim(),
                unit_price: parseFloat(editItemUnitPrice) || 0,
                category: editItemCategory || filterCategoryName,
                collection_name: editItemCollection || filterCollection
            } 
        });
        
        if (editErr) { setError(editErr.message); return; }
        
        const newId: any = typeof newVersionId === 'string' ? newVersionId : (newVersionId?.id ?? newVersionId);
        if (newId) {
            const { error: aprErr } = await supabase.rpc('approve_record', { _id: newId });
            if (aprErr) { setError(aprErr.message); return; }
        }
        
        setEditItemOpen(false);
        setItemsReloadKey(k => k + 1);
        setMessage('Item updated successfully.');
    } catch (e: any) {
        setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
    } finally {
        setEditItemSaving(false);
    }
  }

  // Filtered items based on search
  const filteredItems = items.filter(item => 
    item.item_name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
            <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
                <div className="w-full md:w-64">
                    <Select
                        label="Category"
                        value={filterCategoryName}
                        onChange={(e) => {
                            setFilterCategoryName(e.target.value);
                            setFilterCollection(''); // Reset collection when category changes
                        }}
                        options={categories.map(c => ({ value: c.name, label: c.name }))}
                    />
                </div>
                <div className="w-full md:w-64">
                    <Select
                        label="Collection"
                        value={filterCollection}
                        onChange={(e) => setFilterCollection(e.target.value)}
                        options={collectionsFilter.map(c => ({ value: c.name, label: c.name }))}
                        disabled={!filterCategoryName}
                        placeholder={!filterCategoryName ? "Select a category first" : "Select a collection"}
                    />
                </div>
            </div>
            
            <div className="flex gap-2">
                <Button 
                    onClick={() => setAddItemOpen(true)} 
                    disabled={!filterCategoryName || !filterCollection}
                >
                    <IconPlus className="w-4 h-4 mr-2" />
                    Add Item
                </Button>
                {selectedItemIds.size > 0 && canDeleteItem && (
                    <Button variant="danger" onClick={handleBulkDelete}>
                        <IconTrash2 className="w-4 h-4 mr-2" />
                        Delete ({selectedItemIds.size})
                    </Button>
                )}
            </div>
        </div>

        {error && (
            <div className="bg-error-light border border-error-light text-error px-4 py-3 rounded-md flex items-start gap-3">
                <IconAlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <span className="text-sm">{error}</span>
            </div>
        )}

        {message && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md flex items-start gap-3">
                <IconCheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
                <span className="text-sm">{message}</span>
            </div>
        )}

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-center gap-4">
                <h3 className="text-lg font-semibold text-gray-900">
                    Items in {filterCollection || '...'}
                </h3>
                <div className="w-full sm:w-64">
                    <SearchInput
                        value={searchTerm}
                        onChangeValue={setSearchTerm}
                        placeholder="Search items..."
                    />
                </div>
            </div>

            <div className="overflow-x-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead className="w-10 sticky left-0 z-20 bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                <Checkbox 
                                    checked={filteredItems.length > 0 && selectedItemIds.size === filteredItems.length}
                                    indeterminate={selectedItemIds.size > 0 && selectedItemIds.size < filteredItems.length}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setSelectedItemIds(new Set(filteredItems.map(i => i.id)));
                                        } else {
                                            setSelectedItemIds(new Set());
                                        }
                                    }}
                                />
                            </TableHead>
                            <TableHead className="sticky left-10 z-20 bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Item Name</TableHead>
                            <TableHead>Unit</TableHead>
                            <TableHead className="text-right">Price</TableHead>
                            <TableHead className="text-right">Current Stock</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loadingItems ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-32 text-center text-gray-500">
                                    <div className="flex flex-col items-center justify-center gap-2">
                                        <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin" />
                                        Loading items...
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : filteredItems.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={6} className="h-32 text-center text-gray-500">
                                    {filterCollection ? 'No items found in this collection.' : 'Select a collection to view items.'}
                                </TableCell>
                            </TableRow>
                        ) : (
                            filteredItems
                                .slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
                                .map((item) => (
                                <TableRow key={item.id} className="group hover:bg-gray-50 transition-colors">
                                    <TableCell className="sticky left-0 z-10 bg-white group-hover:bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                        <Checkbox 
                                            checked={selectedItemIds.has(item.id)}
                                            onChange={(e) => {
                                                const newSet = new Set(selectedItemIds);
                                                if (e.target.checked) newSet.add(item.id);
                                                else newSet.delete(item.id);
                                                setSelectedItemIds(newSet);
                                            }}
                                        />
                                    </TableCell>
                                    <TableCell className="font-medium text-gray-900 sticky left-10 z-10 bg-white group-hover:bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                        {item.item_name}
                                    </TableCell>
                                    <TableCell className="text-gray-500">
                                        {item.unit || '-'}
                                    </TableCell>
                                    <TableCell className="text-right font-mono">
                                        {item.unit_price?.toFixed(2) || '-'}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex flex-col items-end">
                                            <span className="font-medium text-gray-900">{item.opening_stock ?? '-'}</span>
                                            {item.last_adjusted && (
                                                <span className="text-xs text-gray-400">
                                                    {new Date(item.last_adjusted).toLocaleDateString()}
                                                </span>
                                            )}
                                        </div>
                                    </TableCell>
                                    {canEdit && (
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                className="h-8 w-8 p-0"
                                                onClick={() => {
                                                    setEditItemTarget(item);
                                                    setEditItemName(item.item_name);
                                                    setEditItemUnit(item.unit || '');
                                                    setEditItemUnitPrice(String(item.unit_price || ''));
                                                    setEditItemCategory(filterCategoryName);
                                                    setEditItemCollection(filterCollection);
                                                    setEditItemOpen(true);
                                                }}
                                                title="Edit Item"
                                            >
                                                <IconEdit className="w-4 h-4 text-gray-500" />
                                            </Button>
                                            <Button 
                                                variant="ghost" 
                                                size="sm" 
                                                className="h-8 w-8 p-0"
                                                onClick={() => {
                                                    setAdjustItem(item);
                                                    setAdjustQuantity(item.opening_stock || 0);
                                                    setAdjustOpen(true);
                                                }}
                                                title="Adjust Stock"
                                            >
                                                <IconHistory className="w-4 h-4 text-gray-500" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                    )}
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </div>
        </div>

        <Pagination
            currentPage={page}
            totalPages={Math.ceil(filteredItems.length / PAGE_SIZE)}
            onPageChange={setPage}
        />

        <DeleteConfirmationModal
            isOpen={showDeleteConfirm}
            onClose={() => setShowDeleteConfirm(false)}
            onConfirm={confirmBulkDelete}
            title="Delete Items"
            message={`Are you sure you want to delete ${selectedItemIds.size} items? This action cannot be undone.`}
            loading={isDeleting}
        />

        {/* Add Item Modal */}
        <Modal
            isOpen={addItemOpen}
            onClose={() => setAddItemOpen(false)}
            title="Add New Item"
        >
            <div className="space-y-4">
                <Input
                    label="Item Name"
                    value={addItemName}
                    onChange={(e) => setAddItemName(e.target.value)}
                    placeholder="e.g. Coca Cola 330ml"
                />
                <div className="grid grid-cols-2 gap-4">
                    <Input
                        label="Unit"
                        value={addItemUnit}
                        onChange={(e) => setAddItemUnit(e.target.value)}
                        placeholder="e.g. can, bottle, kg"
                    />
                    <Input
                        label="Unit Price"
                        type="number"
                        value={addItemUnitPrice}
                        onChange={(e) => setAddItemUnitPrice(e.target.value)}
                        placeholder="0.00"
                    />
                </div>
                
                <div className="border-t pt-4 mt-4">
                    <h4 className="text-sm font-medium text-gray-900 mb-3">Initial Stock (Optional)</h4>
                    <div className="grid grid-cols-2 gap-4">
                        <Input
                            label="Opening Quantity"
                            type="number"
                            value={addOpeningQty}
                            onChange={(e) => setAddOpeningQty(Number(e.target.value))}
                        />
                        <Input
                            label="Date"
                            type="date"
                            value={addOpeningDate}
                            onChange={(e) => setAddOpeningDate(e.target.value)}
                        />
                    </div>
                </div>

                <div className="flex justify-end gap-3 pt-4">
                    <Button variant="outline" onClick={() => setAddItemOpen(false)}>Cancel</Button>
                    <Button 
                        onClick={handleAddItem} 
                        isLoading={savingItem}
                        disabled={!addItemName.trim()}
                    >
                        Save Item
                    </Button>
                </div>
            </div>
        </Modal>

        {/* Edit Item Modal */}
        <Modal
            isOpen={editItemOpen}
            onClose={() => setEditItemOpen(false)}
            title="Edit Item"
        >
            <div className="space-y-4">
                <Input
                    label="Item Name"
                    value={editItemName}
                    onChange={(e) => setEditItemName(e.target.value)}
                />
                <div className="grid grid-cols-2 gap-4">
                    <Input
                        label="Unit"
                        value={editItemUnit}
                        onChange={(e) => setEditItemUnit(e.target.value)}
                    />
                    <Input
                        label="Unit Price"
                        type="number"
                        value={editItemUnitPrice}
                        onChange={(e) => setEditItemUnitPrice(e.target.value)}
                    />
                </div>
                
                <div className="flex justify-end gap-3 pt-4">
                    <Button variant="outline" onClick={() => setEditItemOpen(false)}>Cancel</Button>
                    <Button 
                        onClick={handleUpdateItem} 
                        isLoading={editItemSaving}
                        disabled={!editItemName.trim()}
                    >
                        Update Item
                    </Button>
                </div>
            </div>
        </Modal>

        {/* Adjust Stock Modal */}
        <Modal
            isOpen={adjustOpen}
            onClose={() => setAdjustOpen(false)}
            title={`Adjust Stock: ${adjustItem?.item_name}`}
        >
            <div className="space-y-4">
                <div className="bg-green-50 text-green-800 p-3 rounded-md text-sm">
                    Current Opening Stock: <strong>{adjustItem?.opening_stock ?? 0}</strong>
                </div>
                
                <Input
                    label="New Quantity"
                    type="number"
                    value={adjustQuantity}
                    onChange={(e) => setAdjustQuantity(Number(e.target.value))}
                />
                <Input
                    label="Date"
                    type="date"
                    value={adjustDate}
                    onChange={(e) => setAdjustDate(e.target.value)}
                />
                <Input
                    label="Reason / Note"
                    value={adjustReason}
                    onChange={(e) => setAdjustReason(e.target.value)}
                    placeholder="e.g. Stock count correction"
                />

                <div className="flex justify-end gap-3 pt-4">
                    <Button variant="outline" onClick={() => setAdjustOpen(false)}>Cancel</Button>
                    <Button 
                        onClick={handleAdjustStock}
                        disabled={!adjustReason && adjustQuantity === adjustItem?.opening_stock}
                    >
                        Save Adjustment
                    </Button>
                </div>
            </div>
        </Modal>
    </div>
  );
}
