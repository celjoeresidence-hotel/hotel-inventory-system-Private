import { useEffect, useState, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { Select } from './ui/Select'
import { 
  IconAlertCircle, 
  IconCheckCircle, 
  IconClipboardList,
  IconCoffee
} from './ui/Icons'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell
} from './ui/Table'
import InventoryConsumptionTable from './InventoryConsumptionTable'
import { SearchInput } from './ui/SearchInput'
import { Pagination } from './ui/Pagination'
import { StaffSelect } from './ui/StaffSelect'
import { InventoryHistoryModule } from './InventoryHistoryModule'
import { isAssignedToRole } from '../utils/assignment'

type UIItem = { 
  id: string;
  item_name: string; 
  unit: string | null; 
  unit_price: number | null;
  opening_stock: number;
  stock_in_db: number;
  stock_out_db: number;
}

type MonthlyRow = { 
  item_name: string; 
  unit: string | null; 
  opening_month_start: number; 
  total_restocked: number; 
  total_issued: number; 
  closing_month_end: number 
}

export default function StorekeeperStockForm() {
  const { role, session, isConfigured, ensureActiveSession } = useAuth()

  // Categories and collections
  const [categories, setCategories] = useState<{ name: string; active: boolean }[]>([])
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false)
  const [activeCategory, setActiveCategory] = useState<string>('')

  const [collections, setCollections] = useState<string[]>([])
  const [selectedCollection, setSelectedCollection] = useState<string>('')

  // Search & Pagination
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10
  
  // Refresh trigger
  const [refreshKey, setRefreshKey] = useState(0)

  // Items and per-item inputs
  const [items, setItems] = useState<UIItem[]>([])
  const [loadingItems, setLoadingItems] = useState<boolean>(false)
  const [restockedMap, setRestockedMap] = useState<Record<string, number>>({})
  const [issuedMap, setIssuedMap] = useState<Record<string, number>>({})
  const [notesMap, setNotesMap] = useState<Record<string, string>>({})
  
  // Track initial values loaded from DB to calculate deltas
  // REMOVED: Delta logic now relies on stock_in_db/stock_out_db from DB, and inputs are always fresh deltas.
  // const [initialRestockedMap, setInitialRestockedMap] = useState<Record<string, number>>({})
  // const [initialIssuedMap, setInitialIssuedMap] = useState<Record<string, number>>({})

  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Tabs and Date/Month state
  const [activeTab, setActiveTab] = useState<'daily' | 'monthly' | 'history'>('daily')
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7))
  const [monthlyRows, setMonthlyRows] = useState<MonthlyRow[]>([])
  const [loadingMonthly, setLoadingMonthly] = useState<boolean>(false)
  const [staffName, setStaffName] = useState<string>('')

  // Reset search/page on tab/collection change
  useEffect(() => {
    setSearchTerm('')
    setPage(1)
  }, [activeTab, selectedCollection])

  // Filtered & Paginated Daily Items
  const filteredItems = useMemo(() => {
    if (!searchTerm) return items
    const lower = searchTerm.toLowerCase()
    return items.filter(it => it.item_name.toLowerCase().includes(lower))
  }, [items, searchTerm])

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredItems.slice(start, start + PAGE_SIZE)
  }, [filteredItems, page])

  // Filtered & Paginated Monthly Rows
  const filteredMonthly = useMemo(() => {
    if (!searchTerm) return monthlyRows
    const lower = searchTerm.toLowerCase()
    return monthlyRows.filter(r => r.item_name.toLowerCase().includes(lower))
  }, [monthlyRows, searchTerm])

  const paginatedMonthly = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredMonthly.slice(start, start + PAGE_SIZE)
  }, [filteredMonthly, page])

  // Fetch categories (Storekeeper sees assigned categories, or all if none assigned)
  useEffect(() => {
    if (role !== 'storekeeper') return; 
    
    async function fetchCategories() {
      setError(null)
      setLoadingCategories(true)
      try {
        if (!isConfigured || !session || !supabase) return
        
        let cats: { name: string; active: boolean }[] = []
        
        // Phase 2: Try fetching from inventory_categories with assignment check
        try {
          const { data: catRows, error: catErr } = await supabase
            .from('inventory_categories')
            .select('name, assigned_to, is_active')
            .eq('is_active', true)
            .is('deleted_at', null)
            .order('name', { ascending: true })

          if (!catErr && Array.isArray(catRows) && catRows.length > 0) {
            console.log('StorekeeperStockForm: All categories:', catRows);
            cats = (catRows as any[])
              .filter((r: any) => {
                const assigned = isAssignedToRole(r.assigned_to, 'storekeeper');
                console.log(`Category ${r.name} assigned to storekeeper?`, assigned, r.assigned_to);
                return assigned;
              })
              .map((r: any) => ({ name: String(r?.name ?? ''), active: true }))
              .filter((c: { name: string; active: boolean }) => Boolean(c.name))
          } else {
            console.log('StorekeeperStockForm: No categories found or error', catErr);
          }
        } catch (e) {
          console.warn('Fetch categories from inventory_categories failed', e);
        }

        // Fallback: If no assigned categories found, fetch all from items (legacy behavior)
        if (cats.length === 0) {
           const { data, error } = await supabase
             .from('inventory_items')
             .select('category, active')
             .eq('active', true)
             .is('deleted_at', null)
             .order('category', { ascending: true })

           if (!error && data) {
             const unique = Array.from(new Set((data || []).map(r => r.category))).map(c => ({ name: c, active: true }));
             cats = unique;
           }
        }
        
        setCategories(cats);
        
        if (!activeCategory && cats.length > 0) setActiveCategory(cats[0].name)
      } finally { setLoadingCategories(false) }
    }
    fetchCategories()
  }, [isConfigured, session])

  // Fetch collections for active category
  useEffect(() => {
    async function fetchCollections() {
      setError(null)
      if (!isConfigured || !session || !supabase || !activeCategory) { setCollections([]); setSelectedCollection(''); return }
      
      // Phase 2: Fetch distinct collections from inventory_items
      const { data, error } = await supabase
        .from('inventory_items')
        .select('collection')
        .eq('category', activeCategory)
        .eq('active', true)
        .is('deleted_at', null)
        .order('collection', { ascending: true })

      if (error) { setError(error.message); return }
      
      const unique = Array.from(new Set((data || []).map(r => r.collection)));
      setCollections(unique)
      if (!selectedCollection && unique.length > 0) setSelectedCollection('')
    }
    fetchCollections()
  }, [isConfigured, session, activeCategory])

  // Fetch items and compute opening stock per item
  useEffect(() => {
    if (activeTab !== 'daily') return
    async function fetchItems() {
      setError(null)
      setLoadingItems(true)
      try {
        if (!isConfigured || !session || !supabase || !activeCategory) { setItems([]); return }
        
        // Phase 2: Use get_storekeeper_stock_state RPC
        const { data, error } = await supabase.rpc('get_storekeeper_stock_state', { 
            _date: date,
            _category: activeCategory,
            _collection: selectedCollection || null
        })

        if (error) {
            console.error('get_storekeeper_stock_state failed', error)
            setError('Failed to fetch stock data: ' + error.message)
            return
        }

        const computed: UIItem[] = (data || []).map((r: any) => ({
            id: r.item_id,
            item_name: r.item_name,
            unit: r.unit,
            unit_price: typeof r.unit_price === 'number' ? r.unit_price : Number(r.unit_price ?? 0),
            opening_stock: Number(r.opening_stock ?? 0),
            stock_in_db: Number(r.restocked_today ?? 0),
            stock_out_db: Number(r.issued_today ?? 0)
        }));
        
        setItems(computed)
        setRestockedMap({})
        setIssuedMap({})
        setNotesMap({})

      } finally { setLoadingItems(false) }
    }
    fetchItems()
  }, [isConfigured, session, activeCategory, selectedCollection, date, activeTab, refreshKey])

  // Input handlers
  const handleChangeRestocked = (name: string, value: number) => {
    setRestockedMap((prev) => ({ ...prev, [name]: Math.max(0, Number(value) || 0) }))
  }
  const handleChangeIssued = (name: string, value: number) => {
    setIssuedMap((prev) => ({ ...prev, [name]: Math.max(0, Number(value) || 0) }))
  }
  const handleChangeNotes = (name: string, value: string) => {
    setNotesMap((prev) => ({ ...prev, [name]: value }))
  }

  async function handleSubmit() {
    setError(null)
    setSuccess(null)
    
    if (!staffName) {
      setError('Please select a staff member responsible for today.');
      return;
    }

    if (!isConfigured || !session || !supabase) { setError('Authentication required. Please sign in.'); return }
    if (!date) { setError('Date is required'); return }
    if (!activeCategory) { setError('Select a category'); return }

    // Ensure session is active
    const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
    if (!ok) {
      setError('Session expired. Please sign in again to continue.');
      return;
    }

    const transactions: any[] = []
    
    for (const row of items) {
      const rInput = Number(restockedMap[row.item_name] ?? 0)
      const iInput = Number(issuedMap[row.item_name] ?? 0)
      const note = (notesMap[row.item_name] ?? '').trim()
      
      const opening = Number(row.opening_stock ?? 0)
      const prevRestock = Number(row.stock_in_db ?? 0)
      const prevIssued = Number(row.stock_out_db ?? 0)
      const totalRestock = prevRestock + rInput
      const closing = opening + totalRestock - (prevIssued + iInput)
      
      if (rInput < 0 || iInput < 0) { setError('Quantities must be ≥ 0'); return }
      if ((prevIssued + iInput) > (opening + totalRestock)) { setError(`Total issued for ${row.item_name} cannot exceed available stock`); return }
      if (closing < 0) { setError(`Closing stock for ${row.item_name} cannot be negative`); return }
      
      if (rInput > 0) {
        transactions.push({
            item_id: row.id,
            department: 'STORE',
            transaction_type: 'stock_restock',
            quantity_in: rInput,
            quantity_out: 0,
            unit_price: 0, // Should be fetched from item but 0 is fine for now
            total_value: 0,
            staff_name: staffName,
            notes: note || undefined,
            event_date: date,
            status: 'approved'
        })
      }
      if (iInput > 0) {
        transactions.push({
            item_id: row.id,
            department: 'STORE',
            transaction_type: 'stock_issued',
            quantity_in: 0,
            quantity_out: iInput,
            unit_price: 0,
            total_value: 0,
            staff_name: staffName,
            notes: note || undefined,
            event_date: date,
            status: 'approved'
        })
      }
    }

    if (transactions.length === 0) { setError('No changes detected to submit.'); return }

    try {
      setSubmitting(true)
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true))
      if (!ok) { setError('Session expired. Please sign in again to continue.'); setSubmitting(false); return }

      const insertError = await insertWithRetry('inventory_transactions', transactions)
      if (insertError) { setError(insertError); return }
      
      setSuccess('Storekeeper daily stock updated.')
      
      setRestockedMap({})
      setIssuedMap({})
      setNotesMap({})
      setRefreshKey(prev => prev + 1)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally { setSubmitting(false) }
  }

  async function insertWithRetry(table: string, rows: any[]) {
    let attempt = 0
    while (attempt < 3) {
      const { error } = await supabase!.from(table).insert(rows)
      if (!error) return null
      attempt += 1
      await new Promise(r => setTimeout(r, 400 * attempt))
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true))
      if (!ok) return 'Session expired. Please sign in again to continue.'
    }
    return 'Failed to submit. Please try again.'
  }

  function getMonthRange(yyyyMM: string) {
    const [y, m] = yyyyMM.split('-').map((x) => Number(x))
    const start = new Date(Date.UTC(y, m - 1, 1))
    const end = new Date(Date.UTC(y, m, 0))
    const prevEnd = new Date(Date.UTC(y, m - 1, 0))
    const prevStart = new Date(Date.UTC(prevEnd.getUTCFullYear(), prevEnd.getUTCMonth(), 1))
    const toISO = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
    return { start: toISO(start), end: toISO(end), prevStart: toISO(prevStart), prevEnd: toISO(prevEnd) }
  }

  useEffect(() => {
    async function computeMonthly() {
      if (activeTab !== 'monthly') return
      setError(null)
      setLoadingMonthly(true)
      try {
        if (!isConfigured || !session || !supabase || !activeCategory) { setMonthlyRows([]); return }
        
        const range = getMonthRange(month)

        // 1. Get Opening Stock at start of month using RPC
        const { data: openingData, error: openingError } = await supabase.rpc('get_storekeeper_stock_state', { 
            _date: range.start,
            _category: activeCategory,
            _collection: selectedCollection || null
        })

        if (openingError) {
            console.error('Monthly opening fetch failed', openingError)
            setError('Failed to fetch monthly data')
            return
        }

        const itemsStart = (openingData || []) as any[]
        const itemIds = itemsStart.map(x => x.item_id)

        if (itemIds.length === 0) {
            setMonthlyRows([])
            return
        }

        // 2. Fetch all transactions for this month for these items
        const { data: txData, error: txError } = await supabase
            .from('inventory_transactions')
            .select('item_id, transaction_type, quantity_in, quantity_out')
            .eq('department', 'STORE')
            .gte('event_date', range.start)
            .lte('event_date', range.end)
            .in('item_id', itemIds)
            .eq('status', 'approved')

        if (txError) {
            console.error('Monthly tx fetch failed', txError)
            setError('Failed to fetch monthly transactions')
            return
        }

        // 3. Aggregate
        const rows: MonthlyRow[] = []
        const txMap = new Map<string, { restocked: number, issued: number }>()

        for (const tx of (txData || [])) {
            const key = tx.item_id
            const curr = txMap.get(key) || { restocked: 0, issued: 0 }
            
            if (tx.quantity_in > 0) {
                curr.restocked += Number(tx.quantity_in)
            }
            if (tx.quantity_out > 0) {
                curr.issued += Number(tx.quantity_out)
            }
            txMap.set(key, curr)
        }

        for (const item of itemsStart) {
            const tx = txMap.get(item.item_id) || { restocked: 0, issued: 0 }
            const open = Number(item.opening_stock ?? 0)
            const close = open + tx.restocked - tx.issued
            
            rows.push({
                item_name: item.item_name,
                unit: item.unit,
                opening_month_start: open,
                total_restocked: tx.restocked,
                total_issued: tx.issued,
                closing_month_end: Math.max(0, close)
            })
        }
        
        rows.sort((a, b) => a.item_name.localeCompare(b.item_name))
        setMonthlyRows(rows)

      } finally { setLoadingMonthly(false) }
    }
    computeMonthly()
  }, [isConfigured, session, activeCategory, selectedCollection, month, activeTab])

  if (role !== 'storekeeper') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 animate-in fade-in">
        <Card className="max-w-md w-full p-8 text-center border-error-light shadow-lg">
          <div className="bg-error-light text-error w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <IconAlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-500">You must be storekeeper staff to access this page.</p>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
            <div className="p-2 bg-green-100 text-green-700 rounded-lg">
              <IconClipboardList className="w-6 h-6" />
            </div>
            Storekeeper Stock
          </h1>
          <p className="text-sm text-gray-500 mt-1 ml-12">Manage inventory intake and issuance</p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-center gap-3">
          {activeTab === 'daily' && (
            <div className="w-full sm:w-48">
              <StaffSelect
                role="storekeeper"
                value={staffName}
                onChange={setStaffName}
                disabled={submitting}
              />
            </div>
          )}
          {/* Tabs and Date Pickers */}
          <div className="flex items-center gap-4 bg-white p-1 rounded-lg border border-gray-200 shadow-sm w-full sm:w-auto">
             <div className="flex bg-gray-100 p-1 rounded-md">
               <button
                 onClick={() => setActiveTab('daily')}
                 className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'daily' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
               >
                 Daily
               </button>
               <button
                 onClick={() => setActiveTab('monthly')}
                 className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'monthly' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
               >
                 Monthly
               </button>
               <button
                 onClick={() => setActiveTab('history')}
                 className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'history' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
               >
                 History
               </button>
             </div>
             {activeTab !== 'history' && <div className="h-6 w-px bg-gray-200"></div>}
             {activeTab === 'daily' ? (
               <Input
                 type="date"
                 value={date}
                 onChange={(e) => setDate(e.target.value)}
                 className="border-none bg-transparent shadow-none p-0 h-auto focus:ring-0 w-36"
               />
             ) : activeTab === 'monthly' ? (
               <Input
                 type="month"
                 value={month}
                 onChange={(e) => setMonth(e.target.value)}
                 className="border-none bg-transparent shadow-none p-0 h-auto focus:ring-0 w-36"
               />
             ) : null}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-error-light border border-error-light text-error px-4 py-3 rounded-md flex items-start gap-3 animate-in slide-in-from-top-2">
          <IconAlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md flex items-start gap-3 animate-in slide-in-from-top-2">
          <IconCheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <span className="text-sm">{success}</span>
        </div>
      )}

      {/* Categories Bar */}
      <Card className="p-0 overflow-hidden">
        <div className="border-b border-gray-100 bg-gray-50/50 p-4">
           <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Categories</h3>
        </div>
        <div className="p-4">
          {loadingCategories ? (
            <div className="flex gap-2 animate-pulse">
              <div className="h-10 w-24 bg-gray-200 rounded-lg"></div>
              <div className="h-10 w-24 bg-gray-200 rounded-lg"></div>
              <div className="h-10 w-24 bg-gray-200 rounded-lg"></div>
            </div>
          ) : categories.length === 0 ? (
            <div className="text-center py-6">
              <p className="text-gray-500 text-sm italic">No categories found.</p>
            </div>
          ) : (
            <div className="flex overflow-x-auto pb-2 gap-2 snap-x hide-scrollbar">
              {categories.map((c) => (
                <button
                  key={c.name}
                  onClick={() => setActiveCategory(c.name)}
                  className={`
                    flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 snap-start whitespace-nowrap border
                    ${activeCategory === c.name 
                      ? 'bg-green-50 border-green-200 text-green-700 ring-1 ring-green-500/20 shadow-sm' 
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }
                  `}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>
        
        {/* Collection Filter (Optional) */}
        {collections.length > 0 && (
           <div className="px-4 pb-4 animate-in fade-in slide-in-from-top-2">
             <div className="max-w-xs">
               <Select
                 value={selectedCollection}
                 onChange={(e) => setSelectedCollection(e.target.value)}
                 className="w-full text-sm"
               >
                 <option value="">All Collections</option>
                 {collections.map((col) => (
                   <option key={col} value={col}>{col}</option>
                 ))}
               </Select>
             </div>
           </div>
        )}
      </Card>

      {/* Main Content Area */}
      {activeCategory && (
        <Card className="p-0 overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
          <div className="border-b border-gray-100 bg-gray-50/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                {activeCategory}
                <span className="text-gray-400 text-sm font-normal">
                  {activeTab === 'daily' ? 'Daily Entry' : 'Monthly Overview'}
                </span>
              </h3>
              <div className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                 {activeTab === 'daily' ? `${items.length} items` : `${monthlyRows.length} items`}
              </div>
            </div>
            
            <div className="w-full sm:w-64">
              <SearchInput 
                value={searchTerm} 
                onChangeValue={setSearchTerm} 
                placeholder={`Search ${selectedCollection || activeCategory}...`} 
              />
            </div>
          </div>
          
          <div className="p-0 sm:p-4">
            {(activeTab === 'daily' ? loadingItems : activeTab === 'monthly' ? loadingMonthly : false) ? (
               <div className="p-12 text-center text-gray-500">
                 <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                 Loading data...
               </div>
            ) : activeTab === 'daily' ? (
              // DAILY TABLE
              <>
                <div className="overflow-x-auto border rounded-lg shadow-sm bg-white">
                  <InventoryConsumptionTable
                    items={paginatedItems}
                    restockedMap={restockedMap}
                    soldMap={issuedMap}
                    notesMap={notesMap}
                    disabled={submitting}
                    soldLabel="Issued"
                    onChangeRestocked={handleChangeRestocked}
                    onChangeSold={handleChangeIssued}
                    onChangeNotes={handleChangeNotes}
                  />
                </div>

                {filteredItems.length === 0 && (
                  <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200 m-4">
                    <IconCoffee className="w-12 h-12 mx-auto text-gray-300 mb-3" />
                    <h3 className="text-lg font-medium text-gray-900">No items found</h3>
                    <p className="text-gray-500">Try adjusting your search terms</p>
                  </div>
                )}

                <div className="mt-4 flex justify-center pb-4">
                  <Pagination
                    currentPage={page}
                    totalPages={Math.ceil(filteredItems.length / PAGE_SIZE)}
                    onPageChange={setPage}
                  />
                </div>
              </>
            ) : activeTab === 'monthly' ? (
              // MONTHLY TABLE
              <>
                <div className="overflow-x-auto border rounded-lg shadow-sm bg-white">
                  <Table>
                    <TableHeader className="bg-gray-50">
                      <TableRow>
                        <TableHead className="w-[200px] sticky left-0 bg-gray-50 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Item</TableHead>
                        <TableHead>Unit</TableHead>
                        <TableHead className="text-right">Open ({month}-01)</TableHead>
                        <TableHead className="text-right">Total Restocked</TableHead>
                        <TableHead className="text-right">Total Issued</TableHead>
                        <TableHead className="text-right">Close (End)</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedMonthly.map((row) => (
                        <TableRow key={row.item_name} className="hover:bg-gray-50 group">
                          <TableCell className="font-medium text-gray-900 sticky left-0 bg-white group-hover:bg-gray-50 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                            {row.item_name}
                          </TableCell>
                          <TableCell className="text-gray-500">{row.unit ?? '—'}</TableCell>
                          <TableCell className="text-right font-mono text-gray-600">{row.opening_month_start}</TableCell>
                          <TableCell className="text-right font-mono text-green-600 font-medium">+{row.total_restocked}</TableCell>
                          <TableCell className="text-right font-mono text-error font-medium">-{row.total_issued}</TableCell>
                          <TableCell className="text-right font-mono font-bold text-gray-900">{row.closing_month_end}</TableCell>
                        </TableRow>
                      ))}
                      {paginatedMonthly.length === 0 && (
                         <TableRow>
                           <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                             No records found for this month.
                           </TableCell>
                         </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
                
                <div className="mt-4 flex justify-center pb-4">
                  <Pagination
                    currentPage={page}
                    totalPages={Math.ceil(filteredMonthly.length / PAGE_SIZE)}
                    onPageChange={setPage}
                  />
                </div>
              </>
            ) : (
              // HISTORY TABLE
              <InventoryHistoryModule role="storekeeper" />
            )}
          </div>

          {activeTab === 'daily' && items.length > 0 && (
            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <Button 
                onClick={handleSubmit} 
                disabled={submitting}
                isLoading={submitting}
                size="lg"
                className="w-full sm:w-auto shadow-sm"
              >
                Submit Daily Stock
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
