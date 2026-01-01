import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Card } from './ui/Card';
import { Select } from './ui/Select';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Pagination } from './ui/Pagination';
import { SearchInput } from './ui/SearchInput';
import { 
  IconBox,
  IconChevronRight,
  IconRefreshCw,
  IconFilter
} from './ui/Icons';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell
} from './ui/Table';

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
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // UI state: filters and expand/collapse
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedCollection, setSelectedCollection] = useState<string>('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());

  // Pagination
  const [page, setPage] = useState<number>(1);
  const PAGE_SIZE = 5;

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

      // Compute current stock from latest approved opening_stock per item PLUS transactions
      const itemNames = Array.from(new Set(itemsRaw.map((i: any) => i.item_name)));
      let stockMap = new Map<string, number>();
      if (itemNames.length > 0) {
        // 1. Get latest opening stock
        const stocksRes = await supabase
          .from('operational_records')
          .select('id, data, created_at')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'opening_stock')
          .in('data->>item_name', itemNames)
          .order('created_at', { ascending: false }); // We'll process locally to find latest per item
        
        // 2. Get all restock transactions
        const restockRes = await supabase
          .from('operational_records')
          .select('id, data, original_id, version_no, created_at')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'stock_restock')
          .in('data->>item_name', itemNames)
          .order('created_at', { ascending: false });

        // 3. Get all issued transactions
        const issuedRes = await supabase
          .from('operational_records')
          .select('id, data, original_id, version_no, created_at')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'stock_issued')
          .in('data->>item_name', itemNames)
          .order('created_at', { ascending: false });

        if (stocksRes.error) {
          setError(stocksRes.error.message);
        } else {
          const latestOpeningMap = new Map<string, { qty: number; date: Date }>();
          
          // Find latest opening stock per item
          for (const row of (stocksRes.data ?? [])) {
            const name = String(row?.data?.item_name ?? '');
            if (!name) continue;
            // Prefer data.date (business date) if available, else created_at
            const dateStr = row.data?.date ?? row.created_at;
            const date = new Date(dateStr);
            if (!latestOpeningMap.has(name) || date > latestOpeningMap.get(name)!.date) {
              const qty = typeof row?.data?.quantity === 'number' ? row.data.quantity : Number(row?.data?.quantity ?? 0);
              latestOpeningMap.set(name, { qty: Number.isFinite(qty) ? qty : 0, date });
            }
          }

          // Initialize stockMap with opening stock
          for (const [name, val] of latestOpeningMap.entries()) {
            stockMap.set(name, val.qty);
          }

          // Deduplicate restock transactions (handle edits/versions)
          const uniqueRestocks = dedupLatest(restockRes.data ?? []);
          // Add restocks that happened AFTER the opening stock record
          for (const row of uniqueRestocks) {
            const name = String(row?.data?.item_name ?? '');
            if (!name) continue;
            const rDateStr = row.data?.date ?? row.created_at;
            const rDate = new Date(rDateStr);
            const opening = latestOpeningMap.get(name);
            // If no opening record, assume 0 start (or include all). If opening record exists, only include transactions after it.
            if (!opening || rDate >= opening.date) {
              const qty = typeof row?.data?.quantity === 'number' ? row.data.quantity : Number(row?.data?.quantity ?? 0);
              const current = stockMap.get(name) ?? 0;
              stockMap.set(name, current + qty);
            }
          }

          // Deduplicate issued transactions
          const uniqueIssued = dedupLatest(issuedRes.data ?? []);
          // Subtract issued that happened AFTER the opening stock record
          for (const row of uniqueIssued) {
            const name = String(row?.data?.item_name ?? '');
            if (!name) continue;
            const iDateStr = row.data?.date ?? row.created_at;
            const iDate = new Date(iDateStr);
            const opening = latestOpeningMap.get(name);
            if (!opening || iDate >= opening.date) {
              const qty = typeof row?.data?.quantity === 'number' ? row.data.quantity : Number(row?.data?.quantity ?? 0);
              const current = stockMap.get(name) ?? 0;
              stockMap.set(name, Math.max(0, current - qty));
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
      setLastUpdated(new Date());

      // Default expand all categories initially if first load
      if (categories.length === 0) {
        setExpandedCategories(new Set(catList.map(c => c.name)));
        setExpandedCollections(new Set());
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
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

  const paginatedCategories = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filteredCategories.slice(start, start + PAGE_SIZE);
  }, [filteredCategories, page]);

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
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-8 animate-in fade-in">
        <div className="bg-error-light p-4 rounded-full mb-4">
          <IconBox className="w-8 h-8 text-error" />
        </div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">Access Denied</h2>
        <p className="text-gray-500">You do not have permission to view this page.</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Inventory Catalog</h1>
          <p className="text-sm text-gray-500">View and track all inventory items and stock levels</p>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-xs text-gray-400 hidden sm:inline-block">
              Updated: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button variant="outline" size="sm" onClick={fetchCatalog} isLoading={loading}>
            <IconRefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="bg-error-light border border-error-light text-error px-4 py-3 rounded-md text-sm animate-in slide-in-from-top-2">
          {error}
        </div>
      )}

      {/* Top controls: search + filters */}
      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <SearchInput
            placeholder="Search items..."
            value={searchTerm}
            onChangeValue={setSearchTerm}
            fullWidth
          />
          <div className="relative">
             <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 z-10">
               <IconFilter className="h-4 w-4" />
             </div>
             <Select
              value={selectedCategory}
              onChange={(e) => { setSelectedCategory(e.target.value); setSelectedCollection(''); }}
              fullWidth
              className="pl-9"
            >
              <option value="">All categories</option>
              {categoryOptions.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </Select>
          </div>
          <Select
            value={selectedCollection}
            onChange={(e) => setSelectedCollection(e.target.value)}
            disabled={!selectedCategory}
            fullWidth
          >
            <option value="">All collections</option>
            {collectionOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </Select>
        </div>
      </Card>

      {loading && !lastUpdated ? (
        <div className="text-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Loading catalog...</p>
        </div>
      ) : filteredCategories.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <IconBox className="mx-auto h-12 w-12 text-gray-400 mb-3" />
          <h3 className="text-lg font-medium text-gray-900">No items found</h3>
          <p className="text-gray-500">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {paginatedCategories.map((cat) => (
            <Card key={cat.name} className="overflow-hidden p-0 border-none shadow-sm">
              <div 
                className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex items-center justify-between cursor-pointer hover:bg-gray-100 transition-colors"
                onClick={() => toggleCategory(cat.name)}
              >
                <div className="flex items-center gap-3">
                  <div className={`p-1 rounded transition-transform duration-200 ${expandedCategories.has(cat.name) ? 'rotate-90' : ''}`}>
                    <IconChevronRight className="w-5 h-5 text-gray-400" />
                  </div>
                  <h3 className="font-semibold text-gray-900 text-lg">{cat.name}</h3>
                  {!cat.active && <Badge variant="warning">Inactive</Badge>}
                </div>
                <Badge variant="outline" className="bg-white border-gray-300">
                  {cat.collections.reduce((acc, col) => acc + col.items.length, 0)} items
                </Badge>
              </div>

              {expandedCategories.has(cat.name) && (
                <div className="p-4 space-y-4 bg-white">
                  {cat.collections.length === 0 ? (
                    <div className="text-sm text-gray-500 italic px-8">No collections found in this category.</div>
                  ) : (
                    cat.collections.map((col) => {
                      const colKey = `${cat.name}::${col.name}`;
                      const isExpanded = expandedCollections.has(colKey);
                      
                      return (
                        <div key={col.name} className="border border-gray-200 rounded-lg overflow-hidden">
                          <div 
                            className="bg-white px-4 py-2 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100"
                            onClick={() => toggleCollection(cat.name, col.name)}
                          >
                            <div className="flex items-center gap-2">
                              <div className={`transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                                <IconChevronRight className="w-4 h-4 text-gray-400" />
                              </div>
                              <span className="font-medium text-gray-800">{col.name}</span>
                              {!col.active && <Badge variant="warning" size="sm">Inactive</Badge>}
                            </div>
                            <span className="text-xs text-gray-500">{col.items.length} items</span>
                          </div>

                          {isExpanded && (
                            <div className="bg-gray-50 border-t border-gray-100 p-4">
                              {col.items.length === 0 ? (
                                <div className="text-sm text-gray-500 italic">No items in this collection.</div>
                              ) : (
                                <div className="overflow-x-auto bg-white rounded-lg border border-gray-200 shadow-sm">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="w-[200px] sticky left-0 z-20 bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Item Name</TableHead>
                                        <TableHead>Unit</TableHead>
                                        <TableHead className="text-right">Current Stock</TableHead>
                                        <TableHead className="text-right">Status</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {col.items.map((it) => (
                                        <TableRow key={`${cat.name}:${col.name}:${it.item_name}`} className="group hover:bg-gray-50">
                                          <TableCell className="font-medium sticky left-0 z-10 bg-white group-hover:bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">{it.item_name}</TableCell>
                                          <TableCell className="text-gray-500">{it.unit || '-'}</TableCell>
                                        <TableCell className="text-right">
                                          <span className={`font-mono font-bold ${
                                            (it.current_stock ?? 0) <= 0 ? 'text-error' : 
                                            (it.current_stock ?? 0) < 10 ? 'text-warning' : 'text-green-600'
                                          }`}>
                                            {it.current_stock !== null ? it.current_stock : '-'}
                                          </span>
                                        </TableCell>
                                        <TableCell className="text-right">
                                          {!it.active && <Badge variant="warning" size="sm">Inactive</Badge>}
                                          {it.active && <Badge variant="success" size="sm">Active</Badge>}
                                        </TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </Card>
          ))}
          
          <Pagination
            currentPage={page}
            totalPages={Math.ceil(filteredCategories.length / PAGE_SIZE)}
            onPageChange={setPage}
            className="mt-6"
          />
        </div>
      )}
    </div>
  );
}
