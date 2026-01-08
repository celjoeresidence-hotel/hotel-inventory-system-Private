import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { SearchInput } from './ui/SearchInput'
import { Pagination } from './ui/Pagination'
import InventoryConsumptionTable from './InventoryConsumptionTable'
import { IconAlertCircle, IconCheckCircle, IconCoffee } from './ui/Icons'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table'
import { StaffSelect } from './ui/StaffSelect'
import { InventoryHistoryModule } from './InventoryHistoryModule'
import { isAssignedToRole } from '../utils/assignment'

interface UIItem {
  id: string
  item_name: string
  unit: string | null
  unit_price: number | null
  opening_stock: number | null
  stock_in_db?: number
  stock_out_db?: number
}

interface MonthlyRow {
  item_name: string
  unit: string | null
  opening_month_start: number
  total_restocked: number
  total_sold: number
  closing_month_end: number
  total_sales_value: number
}

export default function BarStockForm() {
  const { role, session, isConfigured, ensureActiveSession, isSupervisor, isManager, isAdmin } = useAuth()

  // Role gating
  if (role !== 'bar') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 animate-in fade-in">
        <Card className="max-w-md w-full p-8 text-center border-error-light shadow-lg">
          <div className="bg-error-light text-error w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
            <IconAlertCircle className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-500">You must be logged in as bar staff to access this page.</p>
        </Card>
      </div>
    )
  }

  // State
  const [activeTab, setActiveTab] = useState<'daily' | 'monthly' | 'history'>('daily')
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7))
  
  // Refresh trigger
  const [refreshKey, setRefreshKey] = useState(0)
  
  const [categories, setCategories] = useState<{ name: string; active: boolean }[]>([])
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false)
  const [activeCategory, setActiveCategory] = useState<string>('')

  // Search & Pagination
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  // Daily Data
  const [items, setItems] = useState<UIItem[]>([])
  const [loadingItems, setLoadingItems] = useState<boolean>(false)
  const [restockedMap, setRestockedMap] = useState<Record<string, number>>({})
  const [soldMap, setSoldMap] = useState<Record<string, number>>({})
  const [notesMap, setNotesMap] = useState<Record<string, string>>({})
  
  const [staffName, setStaffName] = useState<string>('')

  // Monthly Data
  const [monthlyRows, setMonthlyRows] = useState<MonthlyRow[]>([])
  const [loadingMonthly, setLoadingMonthly] = useState<boolean>(false)

  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [errorItemId, setErrorItemId] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const errorBannerRef = useRef<HTMLDivElement>(null)

  // Reset pagination/search on tab/category change
  useEffect(() => {
    setSearchTerm('')
    setPage(1)
  }, [activeTab, activeCategory])

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
    return monthlyRows.filter(row => row.item_name.toLowerCase().includes(lower))
  }, [monthlyRows, searchTerm])

  const paginatedMonthly = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredMonthly.slice(start, start + PAGE_SIZE)
  }, [filteredMonthly, page])

  // Fetch categories
  useEffect(() => {
    async function fetchCategories() {
      setError(null)
      setLoadingCategories(true)
      try {
        if (!isConfigured || !session || !supabase) return
        let cats: { name: string; active: boolean }[] = []
        const { data: catRows, error: catErr } = await supabase
          .from('inventory_categories')
          .select('name, assigned_to, is_active')
          .eq('is_active', true)
          .is('deleted_at', null)
          .order('name', { ascending: true })
        if (!catErr && Array.isArray(catRows) && catRows.length > 0) {
          cats = (catRows as any[])
            .filter((r: any) => isAssignedToRole(r.assigned_to, 'bar'))
            .map((r: any) => ({ name: String(r?.name ?? ''), active: true }))
            .filter((c: { name: string; active: boolean }) => Boolean(c.name))
        }
        if (!cats.length) {
          try {
            const { data, error } = await supabase.rpc('list_assigned_categories_for_role', { _role: 'bar' })
            if (!error && data) {
              cats = (data ?? [])
                .map((r: any) => ({ name: String(r?.category_name ?? ''), active: true }))
                .filter((c: { name: string; active: boolean }) => Boolean(c.name))
            }
          } catch (_) {}
        }
        if (!cats.length) {
          const { data: itemCats, error: itemCatsErr } = await supabase
            .from('inventory_items')
            .select('category')
            .eq('department', 'BAR')
          if (!itemCatsErr && itemCats) {
             const unique = Array.from(new Set(itemCats.map(c => c.category))).sort()
             cats = unique.map(c => ({ name: c, active: true }))
          }
        }
        
        setCategories(cats)
        if (!activeCategory && cats.length > 0) setActiveCategory(cats[0].name)
      } finally {
        setLoadingCategories(false)
      }
    }
    fetchCategories()
  }, [isConfigured, session])

  // Fetch items for active category (Daily)
  useEffect(() => {
    if (activeTab !== 'daily') return
    async function fetchItems() {
      setError(null)
      setLoadingItems(true)
      try {
        if (!isConfigured || !session || !supabase || !activeCategory) { setItems([]); return }
        
        const { data, error } = await supabase.rpc('get_department_stock_state', { 
            _date: date,
            _department: 'BAR',
            _category: activeCategory
        })

        if (error) {
            console.error('get_department_stock_state failed', error)
            setError('Failed to fetch stock data: ' + error.message)
            return
        }

        const sheet = await supabase.rpc('get_daily_stock_sheet', { _role: 'bar', _category: activeCategory, _report_date: date })
        const sheetMap = new Map<string, { unit: string | null; unit_price: number; opening_stock: number }>()
        if (!sheet.error && Array.isArray(sheet.data)) {
          for (const s of sheet.data as any[]) {
            sheetMap.set(String(s.item_name), { unit: s.unit ?? null, unit_price: Number(s.unit_price ?? 0), opening_stock: Number(s.opening_stock ?? 0) })
          }
        }

        const computedItems: UIItem[] = (data || []).map((r: any) => {
          const s = sheetMap.get(String(r.item_name))
          return {
            id: r.item_id,
            item_name: r.item_name,
            unit: (s?.unit ?? r.unit) ?? null,
            unit_price: s?.unit_price ?? Number(r.unit_price ?? 0),
            opening_stock: s?.opening_stock ?? Number(r.opening_stock ?? 0),
            stock_in_db: Number(r.restocked_today ?? 0),
            stock_out_db: Number(r.sold_today ?? 0)
          }
        });
        
        setItems(computedItems)

        // Reset inputs for delta mode
        setRestockedMap({})
        setSoldMap({})
        setNotesMap({})
      } finally {
        setLoadingItems(false)
      }
    }
    fetchItems()
  }, [isConfigured, session, activeCategory, date, activeTab, refreshKey])

  // Monthly Logic
  function getMonthRange(yyyyMM: string) {
    const [y, m] = yyyyMM.split('-').map(Number)
    const start = new Date(Date.UTC(y, m - 1, 1))
    const end = new Date(Date.UTC(y, m, 0))
    const toISO = (d: Date) => d.toISOString().split('T')[0]
    return { start: toISO(start), end: toISO(end) }
  }

  useEffect(() => {
    if (activeTab !== 'monthly') return
    async function computeMonthly() {
      setError(null)
      setLoadingMonthly(true)
      try {
        if (!isConfigured || !session || !supabase || !activeCategory) { setMonthlyRows([]); return }
        
        const range = getMonthRange(month)

        // 1. Get Opening Stock at start of month using RPC
        // This gives us the baseline state as of the morning of the 1st of the month
        const { data: openingData, error: openingError } = await supabase.rpc('get_department_stock_state', { 
            _date: range.start,
            _department: 'BAR',
            _category: activeCategory
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
            .select('item_id, transaction_type, quantity_in, quantity_out, total_value')
            .eq('department', 'BAR')
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
        const txMap = new Map<string, { restocked: number, sold: number, value: number }>()

        for (const tx of (txData || [])) {
            const key = tx.item_id
            const curr = txMap.get(key) || { restocked: 0, sold: 0, value: 0 }
            
            if (tx.transaction_type === 'stock_restock' || tx.transaction_type === 'opening_stock') {
                curr.restocked += Number(tx.quantity_in)
            } else {
                // sold, consumed, stock_issued (though stock_issued is usually incoming for bar? no, outgoing from store)
                // For BAR:
                // stock_restock = incoming
                // sold = outgoing
                // stock_issued = outgoing? No, stock_issued is usually FROM store TO bar.
                // But here we are querying BAR transactions.
                // If the store issued stock TO bar, does it appear as a transaction with department='BAR'?
                // Currently, Storekeeper writes 'stock_issued' with department='STORE'.
                // Does that write a corresponding 'stock_restock' for BAR?
                // Not yet. That's a key architectural point.
                // Ideally, Storekeeper issuing stock should auto-create a restock for Bar.
                // But currently Bar manually enters restock.
                // So we just look at what Bar entered.
                // Bar enters 'stock_restock' (incoming) and 'sold' (outgoing).
                
                if (tx.quantity_in > 0) {
                     curr.restocked += Number(tx.quantity_in)
                }
                if (tx.quantity_out > 0) {
                     curr.sold += Number(tx.quantity_out)
                     // Only count value for sold items? Or total value of transactions?
                     // total_sales_value usually implies sales.
                     if (tx.transaction_type === 'sold') {
                         curr.value += Number(tx.total_value)
                     }
                }
            }
            txMap.set(key, curr)
        }

        for (const item of itemsStart) {
            const tx = txMap.get(item.item_id) || { restocked: 0, sold: 0, value: 0 }
            const open = Number(item.opening_stock ?? 0)
            const close = open + tx.restocked - tx.sold
            
            rows.push({
                item_name: item.item_name,
                unit: item.unit,
                opening_month_start: open,
                total_restocked: tx.restocked,
                total_sold: tx.sold,
                closing_month_end: Math.max(0, close),
                total_sales_value: tx.value
            })
        }
        
        rows.sort((a, b) => a.item_name.localeCompare(b.item_name))
        setMonthlyRows(rows)

      } finally {
        setLoadingMonthly(false)
      }
    }
    computeMonthly()
  }, [isConfigured, session, activeCategory, month, activeTab])


  // Handlers
  const handleChangeRestocked = (name: string, value: number) => {
    setRestockedMap((prev) => ({ ...prev, [name]: Math.max(0, Number(value) || 0) }))
  }
  const handleChangeSold = (name: string, value: number) => {
    setSoldMap((prev) => ({ ...prev, [name]: Math.max(0, Number(value) || 0) }))
  }
  const handleChangeNotes = (name: string, value: string) => {
    setNotesMap((prev) => ({ ...prev, [name]: value }))
  }

  const handleSubmit = async () => {
    setError(null)
    setSuccess(null)

    // Ensure session is active
    const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
    if (!ok) {
      setError('Session expired. Please sign in again to continue.');
      return;
    }

    if (!staffName) {
      setError('Please select a staff member responsible for today.')
      return
    }

    if (!isConfigured || !session || !supabase) { setError('Authentication required.'); return }
    if (!date) { setError('Date is required'); return }

    const transactions: any[] = []
    const status = (isSupervisor || isManager || isAdmin) ? 'approved' : 'pending'
    
    for (const row of items) {
      const o = Number(row.opening_stock ?? 0)
      const prevR = Number(row.stock_in_db ?? 0)
      const prevS = Number(row.stock_out_db ?? 0)
      
      const r = Number(restockedMap[row.item_name] ?? 0)
      const s = Number(soldMap[row.item_name] ?? 0)
      const u = Number(row.unit_price ?? 0)
      const n = notesMap[row.item_name]?.trim()
      
      if (r === 0 && s === 0) continue

      // Validation check on TOTALS
      const totalRestocked = prevR + r
      const totalSold = prevS + s
      
      if (totalSold > o + totalRestocked) { 
        setError(`Total sold (${totalSold}) for ${row.item_name} cannot exceed opening (${o}) + total restocked (${totalRestocked})`)
        setErrorItemId(row.id)
        return 
      }
      const closing = o + totalRestocked - totalSold
      if (closing < 0) { 
        setError(`Closing stock for ${row.item_name} cannot be negative`)
        setErrorItemId(row.id)
        return 
      }
      
      if (r > 0) {
        transactions.push({
            item_id: row.id,
            department: 'BAR',
            transaction_type: 'stock_restock',
            quantity_in: r,
            quantity_out: 0,
            unit_price: u,
            total_value: r * u,
            staff_name: staffName,
            notes: n || undefined,
            event_date: date,
            status: status
        })
      }
      if (s > 0) {
        transactions.push({
            item_id: row.id,
            department: 'BAR',
            transaction_type: 'sold', // Bar sells
            quantity_in: 0,
            quantity_out: s,
            unit_price: u,
            total_value: s * u,
            staff_name: staffName,
            notes: n || undefined,
            event_date: date,
            status: status
        })
      }
    }

    if (transactions.length === 0) {
      setError('No new changes to submit.')
      errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    try {
      setSubmitting(true)
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true))
      if (!ok) { 
          setError('Session expired. Please sign in again to continue.')
          setSubmitting(false)
          errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return 
      }
      
      const insertError = await insertWithRetry('inventory_transactions', transactions)
      if (insertError) { 
          setError(insertError)
          errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return 
      }
      
      if (status === 'pending') {
          setSuccess('Bar stock submitted for supervisor approval.')
      } else {
          setSuccess('Bar stock updated successfully.')
      }
      
      // Reset inputs and refresh to show updated "prev" values
      setRestockedMap({})
      setSoldMap({})
      setNotesMap({})
      setRefreshKey(prev => prev + 1)
      
    } finally {
      setSubmitting(false)
    }
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

  useEffect(() => {
    if (errorItemId) {
      const el = document.getElementById(`row-${errorItemId}`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      if (el) {
        const input = el.querySelector('input[type="number"]') as HTMLInputElement | null
        input?.focus()
      }
    }
  }, [errorItemId])

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
            <div className="p-2 bg-green-100 text-green-700 rounded-lg">
              <IconCoffee className="w-6 h-6" />
            </div>
            Bar Stock
          </h1>
          <p className="text-sm text-gray-500 mt-1 ml-12">Manage bar inventory, sales, and restocking</p>
        </div>

        {/* Controls */}
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
          {activeTab === 'daily' && (
            <div className="w-full sm:w-48">
              <StaffSelect
                role="bar"
                value={staffName}
                onChange={setStaffName}
                disabled={submitting}
              />
            </div>
          )}
          <div className="flex items-center gap-4 bg-white p-1 rounded-lg border border-gray-200 shadow-sm shadow-inner">
            <div className="flex bg-gray-100 p-1 rounded-md">
              <button
                onClick={() => setActiveTab('daily')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'daily' ? 'bg-white text-green-700 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/50'}`}
              >
                Daily
              </button>
              <button
                onClick={() => setActiveTab('monthly')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'monthly' ? 'bg-white text-green-700 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/50'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setActiveTab('history')}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all ${activeTab === 'history' ? 'bg-white text-green-700 shadow-sm ring-1 ring-black/5' : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/50'}`}
              >
                History
              </button>
            </div>
            <div className="h-6 w-px bg-gray-200"></div>
            {activeTab === 'daily' ? (
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="border-none bg-transparent shadow-none p-0 h-auto focus:ring-0 w-36 text-sm font-medium text-gray-700"
              />
            ) : activeTab === 'monthly' ? (
              <Input
                type="month"
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="border-none bg-transparent shadow-none p-0 h-auto focus:ring-0 w-36 text-sm font-medium text-gray-700"
              />
            ) : null}
          </div>
        </div>
      </div>

      {/* Messages */}
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

      {/* Categories */}
      {activeTab !== 'history' && (
      <Card className="p-0 overflow-hidden shadow-sm">
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
              <p className="text-gray-500 text-sm italic">No categories assigned to Bar.</p>
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
      </Card>
      )}

      {/* Main Table Area */}
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
                placeholder={`Search ${activeCategory}...`} 
              />
            </div>
          </div>
          
          <div className="p-0 sm:p-4">
            {(activeTab === 'daily' ? loadingItems : loadingMonthly) ? (
               <div className="p-12 text-center text-gray-500">
                 <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                 Loading data...
               </div>
            ) : activeTab === 'daily' ? (
              <>
                <div className="overflow-x-auto border rounded-lg shadow-sm bg-white">
                  <InventoryConsumptionTable
                    items={paginatedItems}
                    restockedMap={restockedMap}
                    soldMap={soldMap}
                    notesMap={notesMap}
                    disabled={submitting}
                    errorItemId={errorItemId}
                    soldLabel="Sold"
                    onChangeRestocked={handleChangeRestocked}
                    onChangeSold={handleChangeSold}
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
            ) : (
              // Monthly View
              <>
                <div className="overflow-x-auto border rounded-lg shadow-sm bg-white">
                  <Table>
                    <TableHeader className="bg-gray-50">
                      <TableRow>
                        <TableHead className="w-[200px] sticky left-0 bg-gray-50 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Item</TableHead>
                        <TableHead className="text-right">Open ({month}-01)</TableHead>
                        <TableHead className="text-right text-green-700">Restocked</TableHead>
                        <TableHead className="text-right text-green-700">Sold</TableHead>
                        <TableHead className="text-right">Closing</TableHead>
                        <TableHead className="text-right">Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {paginatedMonthly.map((row) => (
                        <TableRow key={row.item_name}>
                          <TableCell className="font-medium text-gray-900 sticky left-0 bg-white z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">{row.item_name}</TableCell>
                          <TableCell className="text-right font-mono text-gray-600">{row.opening_month_start}</TableCell>
                          <TableCell className="text-right font-mono text-blue-600">+{row.total_restocked}</TableCell>
                          <TableCell className="text-right font-mono text-orange-600">-{row.total_sold}</TableCell>
                          <TableCell className="text-right font-mono font-bold text-gray-900">{row.closing_month_end}</TableCell>
                          <TableCell className="text-right font-mono text-green-600 font-medium">
                             {row.total_sales_value > 0 ? `₦${row.total_sales_value.toLocaleString()}` : '-'}
                          </TableCell>
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
      {/* History */}
      {activeTab === 'history' && (
        <InventoryHistoryModule role="bar" />
      )}

    </div>
  )
}
