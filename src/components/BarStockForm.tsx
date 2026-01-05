import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import type { BarStockData } from '../types/bar'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { SearchInput } from './ui/SearchInput'
import { Pagination } from './ui/Pagination'
import InventoryConsumptionTable from './InventoryConsumptionTable'
import { IconAlertCircle, IconCheckCircle, IconCoffee, IconHistory } from './ui/Icons'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table'
import { StaffSelect } from './ui/StaffSelect'

interface UIItem {
  item_name: string
  unit: string | null
  unit_price: number | null
  opening_stock: number | null
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
  const { role, session, isConfigured, ensureActiveSession } = useAuth()

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

  // History Data
  const [historyRecords, setHistoryRecords] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false)

  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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

  // Filtered & Paginated History
  const filteredHistory = useMemo(() => {
    if (!searchTerm) return historyRecords
    const lower = searchTerm.toLowerCase()
    return historyRecords.filter((r: any) => 
      (r.item_name || '').toLowerCase().includes(lower) || 
      (r.staff_name || '').toLowerCase().includes(lower)
    )
  }, [historyRecords, searchTerm])

  const paginatedHistory = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredHistory.slice(start, start + PAGE_SIZE)
  }, [filteredHistory, page])

  // Fetch categories
  useEffect(() => {
    async function fetchCategories() {
      setError(null)
      setLoadingCategories(true)
      try {
        if (!isConfigured || !session || !supabase) return
        
        let cats: { name: string; active: boolean }[] = []
        try {
          const { data, error } = await supabase.rpc('list_assigned_categories_for_role', { _role: 'bar' })
          if (!error && data) {
            cats = (data ?? [])
              .map((r: any) => ({ name: String(r?.category_name ?? ''), active: true }))
              .filter((c: { name: string; active: boolean }) => Boolean(c.name))
          }
        } catch {}

        if (!cats.length) {
          const { data: catRows, error: catErr } = await supabase
            .from('operational_records')
            .select('id, data, original_id, version_no, created_at, status, deleted_at')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .filter('data->>type', 'eq', 'config_category')
            .order('created_at', { ascending: false })
            
          if (catErr) { setError(catErr.message); return }
          
          const latestByOriginal = new Map<string, any>()
          for (const r of (catRows ?? [])) {
            const key = String(r?.original_id ?? r?.id)
            const prev = latestByOriginal.get(key)
            const currVer = Number((r as any)?.version_no ?? 0)
            const prevVer = Number((prev as any)?.version_no ?? -1)
            const currTs = new Date((r as any)?.created_at ?? 0).getTime()
            const prevTs = new Date((prev as any)?.created_at ?? 0).getTime()
            if (!prev || currVer > prevVer || (currVer === prevVer && currTs > prevTs)) {
              latestByOriginal.set(key, r)
            }
          }
          
          let tmpCats = Array.from(latestByOriginal.values())
            .map((r: any) => ({
              name: String(r?.data?.category_name ?? r?.data?.name ?? ''),
              active: (r?.data?.active ?? true) !== false,
              _assigned: r?.data?.assigned_to ?? null,
            }))
            .filter((c: any) => c.name)

          tmpCats = tmpCats.filter((c: any, idx: number, arr: any[]) => arr.findIndex(x => x.name === c.name) === idx)
          
          cats = tmpCats.filter((c: any) => {
            const assigned = c._assigned
            if (Array.isArray(assigned)) return assigned.includes('bar')
            if (assigned && typeof assigned === 'object') return Boolean(assigned?.bar)
            return false
          }).map((c: any) => ({ name: c.name, active: c.active }))
        }
        
        setCategories(cats)
        if (!activeCategory && cats.length > 0) setActiveCategory(cats[0].name)
      } finally {
        setLoadingCategories(false)
      }
    }
    fetchCategories()
  }, [isConfigured, session])

  // Fetch Items & Daily Logic
  useEffect(() => {
    if (activeTab !== 'daily') return
    async function fetchItems() {
      setError(null)
      setLoadingItems(true)
      try {
        if (!isConfigured || !session || !supabase || !activeCategory) { setItems([]); return }
        
        // 1. Get Base Items & Opening Stock via Optimized RPC
        let computedItems: UIItem[] = []
        try {
          const { data, error } = await supabase.rpc('get_daily_stock_sheet', { 
            _role: 'bar', 
            _category: activeCategory,
            _report_date: date 
          })

          if (!error && data) {
            computedItems = (data ?? []).map((r: any) => ({
              item_name: String(r?.item_name ?? ''),
              unit: r?.unit ?? null,
              unit_price: typeof r?.unit_price === 'number' ? r.unit_price : Number(r?.unit_price ?? null),
              opening_stock: typeof r?.opening_stock === 'number' ? r.opening_stock : Number(r?.opening_stock ?? null),
            })).filter((it: any) => it.item_name)
          } else {
             // Fallback if new RPC fails (e.g. migration not applied)
             console.warn('get_daily_stock_sheet failed, falling back to legacy fetch', error)
             // ... (Logic below would need to be reinstated if we want robust fallback, but for now we assume migration)
             throw new Error('RPC not available')
          }
        } catch (err) {
            // Fallback: Fetch items + calculate opening stock manually (Old Way)
            let enriched: UIItem[] = []
            try {
                const { data, error } = await supabase.rpc('list_items_for_category', { _category: activeCategory })
                if (!error && data) {
                    enriched = (data ?? []).map((r: any) => ({
                    item_name: String(r?.item_name ?? ''),
                    unit: r?.unit ?? null,
                    unit_price: typeof r?.unit_price === 'number' ? r.unit_price : Number(r?.unit_price ?? null),
                    opening_stock: 0, // Will be filled below
                    })).filter((it: any) => it.item_name)
                }
            } catch {}

            if (!enriched.length) {
                // ... fetch from operational_records ...
                const { data: itemRows } = await supabase
                    .from('operational_records')
                    .select('id, data, original_id, version_no, created_at, status, deleted_at')
                    .eq('status', 'approved')
                    .is('deleted_at', null)
                    .filter('data->>type', 'eq', 'config_item')
                    .filter('data->>category', 'eq', activeCategory)
                    .order('created_at', { ascending: false })
                
                // (Simplified fallback deduplication logic for brevity, assuming main path works)
                 const latestByOriginal = new Map<string, any>()
                 for (const r of (itemRows ?? [])) {
                    const key = String(r?.original_id ?? r?.id)
                    const prev = latestByOriginal.get(key)
                    const currVer = Number((r as any)?.version_no ?? 0)
                    const prevVer = Number((prev as any)?.version_no ?? -1)
                    if (!prev || currVer > prevVer) latestByOriginal.set(key, r)
                 }
                 enriched = Array.from(latestByOriginal.values()).map((r: any) => ({
                    item_name: String(r?.data?.item_name ?? ''),
                    unit: r?.data?.unit ?? null,
                    unit_price: Number(r?.data?.unit_price ?? 0),
                    opening_stock: 0,
                 })).filter((it: any) => it.item_name)
            }
            
            // 2. Compute Opening Stock via Ledger RPC
            const { data: openingData } = await supabase
                .rpc('get_expected_opening_stock_batch', { 
                    _role: 'bar', 
                    _report_date: date 
                })
            const openingMap = new Map<string, number>()
            if (openingData) {
                for (const row of (openingData as any[])) {
                    openingMap.set(row.item_name, Number(row.opening_stock ?? 0))
                }
            }
            computedItems = enriched.map(it => ({
                ...it,
                opening_stock: openingMap.get(it.item_name) ?? 0
            }))
        }
        
        computedItems.sort((a, b) => a.item_name.localeCompare(b.item_name))
        setItems(computedItems)

        const rmap: Record<string, number> = {}; const smap: Record<string, number> = {}; const nmap: Record<string, string> = {}
        for (const it of computedItems) { 
          rmap[it.item_name] = 0
          smap[it.item_name] = 0
          nmap[it.item_name] = ''
        }
        setRestockedMap(rmap)
        setSoldMap(smap)
        setNotesMap(nmap)
      } finally {
        setLoadingItems(false)
      }
    }
    fetchItems()
  }, [isConfigured, session, activeCategory, date, activeTab])

  // Fetch History
  useEffect(() => {
    async function fetchHistory() {
      if (activeTab !== 'history') return
      setLoadingHistory(true)
      try {
        if (!supabase) return
        const { data, error } = await supabase
          .from('v_stock_history')
          .select('*')
          .eq('role', 'bar')
          .order('date', { ascending: false })
          .limit(100)
        
        if (error) throw error
        setHistoryRecords(data ?? [])
      } catch (err: any) {
        console.error('Error fetching history:', err)
      } finally {
        setLoadingHistory(false)
      }
    }
    fetchHistory()
  }, [activeTab])

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
        
        // 1. Get Items & Config (for units/baseline)
        const itemConfigMap = new Map<string, { unit: string | null; opening_stock: number }>()
        
        try {
          // Fetch config items to get units and static baselines
          const { data: configData } = await supabase
            .from('operational_records')
            .select('data')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .filter('data->>type', 'eq', 'config_item')
            .filter('data->>category', 'eq', activeCategory)
            
          if (configData) {
            for (const r of configData) {
              const d = r.data
              if (d?.item_name) {
                 itemConfigMap.set(d.item_name, {
                   unit: d.unit ?? null,
                   opening_stock: Number(d.opening_stock ?? 0)
                 })
              }
            }
          }
        } catch {}

        let baseItems: string[] = []
        // Use RPC or fallback
        try {
          const { data } = await supabase.rpc('list_items_for_category', { _category: activeCategory })
          if (data) {
             baseItems = data.map((x: any) => x.item_name)
             // Update map from RPC if available (RPC might be fresher or different)
             for (const x of data) {
               if (!itemConfigMap.has(x.item_name)) {
                 itemConfigMap.set(x.item_name, { unit: x.unit, opening_stock: x.opening_stock })
               }
             }
          }
        } catch {}
        
        if (baseItems.length === 0) {
           baseItems = Array.from(itemConfigMap.keys())
        }
        baseItems.sort()

        const range = getMonthRange(month)
        const rows: MonthlyRow[] = []

        for (const itemName of baseItems) {
           // Get Opening Stock at start of month
           // 1. Baseline
           // 2. Transactions before start of month
           
           const { data: allTx } = await supabase
             .from('operational_records')
             .select('data, created_at')
             .eq('entity_type', 'bar')
             .eq('status', 'approved')
             .is('deleted_at', null)
             .filter('data->>item_name', 'eq', itemName)
           
           const config = itemConfigMap.get(itemName)
           const staticBaseline = config?.opening_stock ?? 0
           const unit = config?.unit ?? null
           
           let preMonthRestock = 0
           let preMonthSold = 0
           let inMonthRestock = 0
           let inMonthSold = 0
           let totalSalesValue = 0

           if (allTx) {
             for (const tx of allTx) {
               const d = tx.data?.date
               const r = Number(tx.data?.restocked ?? 0)
               const s = Number(tx.data?.sold ?? 0)
               const val = Number(tx.data?.total_amount ?? 0)
               
               if (d < range.start) {
                 preMonthRestock += r
                 preMonthSold += s
               } else if (d >= range.start && d <= range.end) {
                 inMonthRestock += r
                 inMonthSold += s
                 totalSalesValue += val
               }
             }
           }
           
           const openingMonth = Math.max(0, staticBaseline + preMonthRestock - preMonthSold)
           const closingMonth = Math.max(0, openingMonth + inMonthRestock - inMonthSold)
           
           rows.push({
             item_name: itemName,
             unit: unit, 
             opening_month_start: openingMonth,
             total_restocked: inMonthRestock,
             total_sold: inMonthSold,
             closing_month_end: closingMonth,
             total_sales_value: totalSalesValue
           })
        }
        
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

    if (!staffName) {
      setError('Please select a staff member responsible for today.')
      return
    }

    if (!isConfigured || !session || !supabase) { setError('Authentication required.'); return }
    if (!date) { setError('Date is required'); return }

    const records: { entity_type: string; data: BarStockData; financial_amount: number }[] = []
    
    for (const row of items) {
      const o = Number(row.opening_stock ?? 0)
      const r = Number(restockedMap[row.item_name] ?? 0)
      const s = Number(soldMap[row.item_name] ?? 0)
      const u = Number(row.unit_price ?? 0)
      const n = notesMap[row.item_name]?.trim()
      
      // Submit if there's activity OR a note
      if (r <= 0 && s <= 0 && !n) continue
      
      if (s > o + r) { setError(`Sold for ${row.item_name} cannot exceed opening + restocked`); return }
      const closing = o + r - s
      if (closing < 0) { setError(`Closing stock for ${row.item_name} cannot be negative`); return }
      
      const total = s * u
      
      const payload: BarStockData = {
        date,
        staff_name: staffName,
        item_name: row.item_name,
        opening_stock: o,
        restocked: r,
        sold: s,
        closing_stock: closing,
        unit_price: u,
        total_amount: total,
        notes: n || undefined
      } as any // casting to match type if notes is not in interface yet
      
      records.push({ entity_type: 'bar', data: payload, financial_amount: total })
    }

    if (records.length === 0) {
      setError('Enter restocked or sold quantities (or notes) for at least one item.')
      return
    }

    try {
      setSubmitting(true)
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true))
      if (!ok) { setError('Session expired. Please sign in again to continue.'); setSubmitting(false); return }
      const { error: insertError } = await supabase.from('operational_records').insert(records)
      if (insertError) { setError(insertError.message); return }
      
      setSuccess('Daily stock submitted for supervisor approval.')
      
      // Reset inputs
      const r: Record<string, number> = {}
      const s: Record<string, number> = {}
      const n: Record<string, string> = {}
      for (const it of items) { r[it.item_name] = 0; s[it.item_name] = 0; n[it.item_name] = '' }
      setRestockedMap(r)
      setSoldMap(s)
      setNotesMap(n)
      
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
    }
  }

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
        <Card className="p-0 overflow-hidden">
          <div className="border-b border-gray-100 bg-gray-50/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-medium text-gray-900 flex items-center gap-2">
                <IconHistory className="w-5 h-5 text-gray-500" />
                Submission History
              </h3>
              <div className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600">
                {filteredHistory.length} records
              </div>
            </div>
            <div className="w-full sm:w-64">
              <SearchInput 
                value={searchTerm} 
                onChangeValue={setSearchTerm} 
                placeholder="Search history..." 
              />
            </div>
          </div>

          {loadingHistory ? (
            <div className="p-8 text-center text-gray-500">Loading history...</div>
          ) : historyRecords.length === 0 ? (
             <div className="p-8 text-center text-gray-500">No history found.</div>
          ) : (
            <div className="p-0 sm:p-4">
              <div className="overflow-x-auto border rounded-lg shadow-sm bg-white">
                <Table>
                  <TableHeader className="bg-gray-50">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Staff</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Opening</TableHead>
                      <TableHead className="text-right">Restock</TableHead>
                      <TableHead className="text-right">Sold</TableHead>
                      <TableHead className="text-right">Closing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedHistory.map((r: any) => (
                      <TableRow key={r.id} className="hover:bg-gray-50">
                        <TableCell className="text-sm text-gray-600 whitespace-nowrap">{r.date}</TableCell>
                        <TableCell className="text-sm text-gray-600">{r.category || '—'}</TableCell>
                        <TableCell className="font-medium text-gray-900">{r.staff_name}</TableCell>
                        <TableCell>{r.item_name}</TableCell>
                        <TableCell className="text-right">{r.opening_stock}</TableCell>
                        <TableCell className="text-right text-green-600">{r.quantity_in > 0 ? `+${r.quantity_in}` : '-'}</TableCell>
                        <TableCell className="text-right text-red-600">{r.quantity_out > 0 ? `-${r.quantity_out}` : '-'}</TableCell>
                        <TableCell className="text-right font-medium">{r.closing_stock}</TableCell>
                      </TableRow>
                    ))}
                    {paginatedHistory.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center py-8 text-gray-500">
                          No matching records found.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div className="mt-4 flex justify-center pb-4">
                <Pagination
                  currentPage={page}
                  totalPages={Math.ceil(filteredHistory.length / PAGE_SIZE)}
                  onPageChange={setPage}
                />
              </div>
            </div>
          )}
        </Card>
      )}

    </div>
  )
}
