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
  const { session, isConfigured, isSupervisor, isManager, isAdmin, ensureActiveSession } = useAuth();
  const canView = useMemo(() => Boolean(isConfigured && session && (isSupervisor || isManager || isAdmin)), [isConfigured, session, isSupervisor, isManager, isAdmin]);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  // Server-side filter options
  const [categoryOptions, setCategoryOptions] = useState<string[]>([]);
  const [collectionOptions, setCollectionOptions] = useState<string[]>([]);
  const [allCollections, setAllCollections] = useState<{name: string, category: string}[]>([]);

  // UI state: filters and expand/collapse
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedCollection, setSelectedCollection] = useState<string>('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [expandedCollections, setExpandedCollections] = useState<Set<string>>(new Set());

  // Pagination
  const [page, setPage] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);
  const PAGE_SIZE = 50; // Increased page size since we are paginating items now

  // Debounce search term
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
      setPage(1); // Reset to page 1 on search change
    }, 500);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [selectedCategory, selectedCollection]);

  // Fetch Filters (Categories and Collections)
  async function fetchFilters() {
    try {
      if (!isConfigured || !session || !supabase) return;

      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) return;

      // Fetch Categories and Collections from inventory_items
      const { data, error } = await supabase
        .from('inventory_items')
        .select('category, collection')
        .is('deleted_at', null);

      if (error) {
        console.error('Error fetching filters:', error);
        return;
      }

      const uniqueCategories = new Set<string>();
      const uniqueCollections: {name: string, category: string}[] = [];
      const seenCollections = new Set<string>();

      (data || []).forEach((row: any) => {
        if (row.category) {
          uniqueCategories.add(row.category);
        }
        if (row.collection && row.category) {
          const key = `${row.category}::${row.collection}`;
          if (!seenCollections.has(key)) {
            uniqueCollections.push({ name: row.collection, category: row.category });
            seenCollections.add(key);
          }
        }
      });

      setCategoryOptions(Array.from(uniqueCategories).sort());
      setAllCollections(uniqueCollections);
      // Collection options will be derived from allCollections based on selectedCategory
    } catch (err) {
      console.error('Error in fetchFilters:', err);
    }
  }

  useEffect(() => {
    fetchFilters();
  }, [isConfigured, session]);

  // Derive collection options based on selected category
  useEffect(() => {
    if (!selectedCategory) {
      const allCols = Array.from(new Set(allCollections.map(c => c.name))).sort();
      setCollectionOptions(allCols);
    } else {
      const cols = allCollections
        .filter(c => c.category === selectedCategory)
        .map(c => c.name);
      setCollectionOptions(Array.from(new Set(cols)).sort());
    }
  }, [selectedCategory, allCollections]);

  async function fetchCatalog() {
    setError(null);
    setLoading(true);
    try {
      if (!canView || !supabase) return;

      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) {
        setError('Session expired. Please sign in again.');
        setLoading(false);
        return;
      }

      try {
        let builtCatList: CatalogCategory[] = [];
        let query = supabase
          .from('inventory_catalog_view')
          .select('*', { count: 'exact' });

        if (selectedCategory) {
          query = query.eq('category', selectedCategory);
        }
        if (selectedCollection) {
          query = query.eq('collection_name', selectedCollection);
        }
        if (debouncedSearchTerm) {
          query = query.ilike('item_name', `%${debouncedSearchTerm}%`);
        }

        const from = (page - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        
        const { data, error, count } = await query
          .order('category', { ascending: true })
          .order('collection_name', { ascending: true })
          .order('item_name', { ascending: true })
          .range(from, to);

        if (error) throw error;

        setTotalCount(count || 0);

        const catMap = new Map<string, { active: boolean; colMap: Map<string, { active: boolean; items: CatalogItem[] }> }>();
        for (const row of (data ?? [])) {
          const catName = row.category;
          const colName = row.collection_name;
          if (!catMap.has(catName)) catMap.set(catName, { active: true, colMap: new Map() });
          const entry = catMap.get(catName)!;
          if (!entry.colMap.has(colName)) entry.colMap.set(colName, { active: true, items: [] });
          const colEntry = entry.colMap.get(colName)!;
          colEntry.items.push({
            item_name: row.item_name,
            unit: row.unit,
            current_stock: Number(row.current_stock ?? 0),
            active: true
          });
        }

        builtCatList = Array.from(catMap.entries()).map(([catName, { active, colMap }]) => ({
          name: catName,
          active,
          collections: Array.from(colMap.entries()).map(([colName, { active: colActive, items }]) => ({
            name: colName,
            active: colActive,
            items: items
          })).sort((a, b) => a.name.localeCompare(b.name)),
        })).sort((a, b) => a.name.localeCompare(b.name));
        
        setCategories(builtCatList);
        setLastUpdated(new Date());

        if (builtCatList.length > 0 && (expandedCategories.size === 0 || debouncedSearchTerm)) {
          setExpandedCategories(new Set(builtCatList.map((c: CatalogCategory) => c.name)));
          setExpandedCollections(new Set());
          if (debouncedSearchTerm) {
            const allColKeys = new Set<string>();
            builtCatList.forEach((c: CatalogCategory) => c.collections.forEach((col: CatalogCollection) => allColKeys.add(`${c.name}::${col.name}`)));
            setExpandedCollections(allColKeys);
          }
        }
      } catch (viewErr: any) {
        // Fallback: build catalog from inventory_items and aggregate stock from v_inventory_ledger
        let itemsQuery = supabase
          .from('inventory_items')
          .select('item_name, unit, category, collection')
          .is('deleted_at', null);
        if (selectedCategory) itemsQuery = itemsQuery.eq('category', selectedCategory);
        if (selectedCollection) itemsQuery = itemsQuery.eq('collection', selectedCollection);
        const { data: itemsData, error: itemsErr } = await itemsQuery;
        if (itemsErr) throw itemsErr;

        const filtered = (itemsData ?? []).filter((r: any) =>
          debouncedSearchTerm ? String(r.item_name).toLowerCase().includes(debouncedSearchTerm.toLowerCase()) : true
        );
        setTotalCount(filtered.length);

        const itemNames = filtered.map((r: any) => r.item_name);
        const stockMap = new Map<string, number>();
        if (itemNames.length > 0) {
          const { data: ledgerRows } = await supabase
            .from('v_inventory_ledger')
            .select('item_name, quantity_change')
            .eq('department', 'STORE')
            .in('item_name', itemNames);
          for (const row of ((ledgerRows ?? []) as any[])) {
            const key = row.item_name;
            const prev = stockMap.get(key) ?? 0;
            stockMap.set(key, prev + Number(row.quantity_change ?? 0));
          }
        }

        const catMap = new Map<string, { active: boolean; colMap: Map<string, { active: boolean; items: CatalogItem[] }> }>();
        for (const r of filtered as any[]) {
          const catName = r.category;
          const colName = r.collection;
          if (!catMap.has(catName)) catMap.set(catName, { active: true, colMap: new Map() });
          const entry = catMap.get(catName)!;
          if (!entry.colMap.has(colName)) entry.colMap.set(colName, { active: true, items: [] });
          const colEntry = entry.colMap.get(colName)!;
          colEntry.items.push({
            item_name: r.item_name,
            unit: r.unit,
            current_stock: stockMap.get(r.item_name) ?? 0,
            active: true
          });
        }

        const builtCatList: CatalogCategory[] = Array.from(catMap.entries()).map(([catName, { active, colMap }]) => ({
          name: catName,
          active,
          collections: Array.from(colMap.entries()).map(([colName, { active: colActive, items }]) => ({
            name: colName,
            active: colActive,
            items
          })).sort((a, b) => a.name.localeCompare(b.name)),
        })).sort((a, b) => a.name.localeCompare(b.name));

        setCategories(builtCatList);
        setLastUpdated(new Date());

        if (builtCatList.length > 0 && (expandedCategories.size === 0 || debouncedSearchTerm)) {
          setExpandedCategories(new Set(builtCatList.map((c: CatalogCategory) => c.name)));
          setExpandedCollections(new Set());
          if (debouncedSearchTerm) {
            const allColKeys = new Set<string>();
            builtCatList.forEach((c: CatalogCategory) => c.collections.forEach((col: CatalogCollection) => allColKeys.add(`${c.name}::${col.name}`)));
            setExpandedCollections(allColKeys);
          }
        }
      }

    } catch (err: any) {
      console.error('Error fetching catalog:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchCatalog();
  }, [canView, page, debouncedSearchTerm, selectedCategory, selectedCollection]);

  // Removed client-side filtering logic

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
      ) : categories.length === 0 ? (
        <div className="text-center py-16 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <IconBox className="mx-auto h-12 w-12 text-gray-400 mb-3" />
          <h3 className="text-lg font-medium text-gray-900">No items found</h3>
          <p className="text-gray-500">Try adjusting your search or filters.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-xs text-gray-500 text-right">
            Showing {categories.reduce((acc, cat) => acc + cat.collections.reduce((cAcc, col) => cAcc + col.items.length, 0), 0)} of {totalCount} items
          </div>
          {categories.map((cat) => (
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
                  {cat.collections.reduce((acc, col) => acc + col.items.length, 0)} items visible
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
            totalPages={Math.ceil(totalCount / PAGE_SIZE)}
            onPageChange={setPage}
            className="mt-6"
          />
        </div>
      )}
    </div>
  );
}
