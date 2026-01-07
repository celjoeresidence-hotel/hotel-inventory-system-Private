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

type UIItem = { 
  item_name: string; 
  unit: string | null; 
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
  const { role, session, isConfigured, ensureActiveSession, user } = useAuth()

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

  // Fetch ALL approved categories (storekeeper sees everything)
  useEffect(() => {
    async function fetchCategories() {
      setError(null)
      setLoadingCategories(true)
      try {
        if (!isConfigured || !session || !supabase) return
        const { data, error } = await supabase
          .from('operational_records')
          .select('id, data, original_id, version_no, created_at, status, deleted_at')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .filter('data->>type', 'eq', 'config_category')
          .order('created_at', { ascending: false })
        if (error) { setError(error.message); return }
        const latestByOriginal = new Map<string, any>()
        for (const r of (data ?? [])) {
          const key = String((r as any)?.original_id ?? (r as any)?.id)
          const prev = latestByOriginal.get(key)
          const currVer = Number((r as any)?.version_no ?? 0)
          const prevVer = Number((prev as any)?.version_no ?? -1)
          const currTs = new Date((r as any)?.created_at ?? 0).getTime()
          const prevTs = new Date((prev as any)?.created_at ?? 0).getTime()
          if (!prev || currVer > prevVer || (currVer === prevVer && currTs > prevTs)) {
            latestByOriginal.set(key, r)
          }
        }
        let cats = Array.from(latestByOriginal.values())
          .map((r: any) => ({ name: String(r?.data?.category_name ?? r?.data?.name ?? ''), active: (r?.data?.active ?? true) !== false }))
          .filter((c: any) => c.name)
        // de-duplicate by name
        cats = cats.filter((c: any, idx: number, arr: any[]) => arr.findIndex(x => x.name === c.name) === idx)
        setCategories(cats)
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
      const { data, error } = await supabase
        .from('operational_records')
        .select('id, data, original_id, version_no, created_at, status, deleted_at')
        .eq('status', 'approved')
        .is('deleted_at', null)
        .filter('data->>type', 'eq', 'config_collection')
        .filter('data->>category', 'eq', activeCategory)
        .order('created_at', { ascending: false })
      if (error) { setError(error.message); return }
      const latestByOriginal = new Map<string, any>()
      for (const r of (data ?? [])) {
        const key = String((r as any)?.original_id ?? (r as any)?.id)
        const prev = latestByOriginal.get(key)
        const currVer = Number((r as any)?.version_no ?? 0)
        const prevVer = Number((prev as any)?.version_no ?? -1)
        const currTs = new Date((r as any)?.created_at ?? 0).getTime()
        const prevTs = new Date((prev as any)?.created_at ?? 0).getTime()
        if (!prev || currVer > prevVer || (currVer === prevVer && currTs > prevTs)) {
          latestByOriginal.set(key, r)
        }
      }
      let cols = Array.from(latestByOriginal.values())
        .map((r: any) => String(r?.data?.collection_name ?? ''))
        .filter((c: any) => c)
      cols = cols.filter((c: any, idx: number, arr: any[]) => arr.indexOf(c) === idx)
      setCollections(cols)
      if (!selectedCollection && cols.length > 0) setSelectedCollection('')
    }
    fetchCollections()
  }, [isConfigured, session, activeCategory])

  // Helper to deduplicate records by original_id (taking latest version)
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

  // Fetch items and compute opening stock per item
  useEffect(() => {
    if (activeTab !== 'daily') return
    async function fetchItems() {
      setError(null)
      setLoadingItems(true)
      try {
        if (!isConfigured || !session || !supabase || !activeCategory) { setItems([]); return }
        
        let computed: UIItem[] = []
        let useFallback = false

        // Try Optimized RPC first
        try {
          const { data, error } = await supabase.rpc('get_daily_stock_sheet', { 
            _role: 'storekeeper', 
            _category: activeCategory,
            _report_date: date 
          })

          if (!error && data) {
            let rows = data as any[]
            // Filter by collection if selected
            if (selectedCollection) {
              rows = rows.filter(r => r.collection_name === selectedCollection)
            }
            
            computed = rows.map((r: any) => ({
              item_name: String(r?.item_name ?? ''),
              unit: r?.unit ?? null,
              opening_stock: typeof r?.opening_stock === 'number' ? r.opening_stock : Number(r?.opening_stock ?? null),
              stock_in_db: Number(r?.stock_in_db ?? 0),
              stock_out_db: Number(r?.stock_out_db ?? 0)
            })).filter((it: any) => it.item_name)
          } else {
            console.warn('get_daily_stock_sheet failed or missing, falling back to legacy fetch', error)
            useFallback = true
          }
        } catch (err) {
          console.warn('get_daily_stock_sheet exception', err)
          useFallback = true
        }

        if (useFallback) {
          // 1. Fetch config items
          let q = supabase
            .from('operational_records')
            .select('id, data, original_id, version_no, created_at, status, deleted_at')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .filter('data->>type', 'eq', 'config_item')
            .filter('data->>category', 'eq', activeCategory)
            .order('created_at', { ascending: false })
          if (selectedCollection) {
            q = q.filter('data->>collection_name', 'eq', selectedCollection)
          }
          const { data, error } = await q
          if (error) { setError(error.message); return }
          
          const latestByOriginal = new Map<string, any>()
          for (const r of (data ?? [])) {
            const key = String((r as any)?.original_id ?? (r as any)?.id)
            const prev = latestByOriginal.get(key)
            const currVer = Number((r as any)?.version_no ?? 0)
            const prevVer = Number((prev as any)?.version_no ?? -1)
            const currTs = new Date((r as any)?.created_at ?? 0).getTime()
            const prevTs = new Date((prev as any)?.created_at ?? 0).getTime()
            if (!prev || currVer > prevVer || (currVer === prevVer && currTs > prevTs)) {
              latestByOriginal.set(key, r)
            }
          }
          
          const base = Array.from(latestByOriginal.values())
            .map((r: any) => ({ item_name: String(r?.data?.item_name ?? ''), unit: r?.data?.unit ?? null }))
            .filter((it: any) => it.item_name)

          // 2. Fetch opening stocks from Ledger RPC
          const { data: openingData, error: openingError } = await supabase
            .rpc('get_expected_opening_stock_batch', { 
              _role: 'storekeeper', 
              _report_date: date 
            })
          
          if (openingError) {
            console.error('Error fetching opening stock:', openingError)
          }

          const openingMap = new Map<string, number>()
          if (openingData) {
            for (const row of (openingData as any[])) {
              openingMap.set(row.item_name, Number(row.opening_stock ?? 0))
            }
          }

          // 3. Fetch today's transactions for Fallback
          const todayRestocked: Record<string, number> = {}
          const todayIssued: Record<string, number> = {}
          try {
            const { data: txData, error: txError } = await supabase.rpc('get_daily_report_details', {
              _department: 'storekeeper',
              _date: date
            })
            if (!txError && txData) {
              for (const tx of (txData as any[])) {
                const item = tx.item_name
                const qty = Number(tx.quantity ?? 0)
                const type = tx.type
                if (type === 'stock_restock') todayRestocked[item] = (todayRestocked[item] ?? 0) + qty
                else if (type === 'stock_issued') todayIssued[item] = (todayIssued[item] ?? 0) + qty
              }
            }
          } catch (err) { console.error('Failed to fetch daily transactions', err) }

          for (const it of base) {
            const opening = openingMap.get(it.item_name) ?? 0
            computed.push({ 
              item_name: it.item_name, 
              unit: it.unit ?? null, 
              opening_stock: opening,
              stock_in_db: todayRestocked[it.item_name] ?? 0,
              stock_out_db: todayIssued[it.item_name] ?? 0
            })
          }
        }
        
        // Sort by item name
        computed.sort((a, b) => a.item_name.localeCompare(b.item_name))
        
        setItems(computed)
        // Reset inputs to empty (Delta Mode)
        // Only reset if we are loading fresh data (e.g. date change or category change)
        // But here we are inside fetchItems which runs on dependencies.
        // We should probably preserve inputs if we are just refreshing? 
        // No, if date changes, inputs should clear.
        // If category changes, inputs should clear.
        // If just refreshing after submit, we want inputs to clear.
        // So clearing here is safe.
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

    const records: { entity_type: string; data: any; financial_amount: number }[] = []
    for (const row of items) {
      const rInput = Number(restockedMap[row.item_name] ?? 0)
      const iInput = Number(issuedMap[row.item_name] ?? 0)
      const note = (notesMap[row.item_name] ?? '').trim()
      
      const opening = Number(row.opening_stock ?? 0)
      const prevRestock = Number(row.stock_in_db ?? 0)
      const prevIssued = Number(row.stock_out_db ?? 0)

      const totalRestock = prevRestock + rInput
      const totalIssued = prevIssued + iInput
      const closing = opening + totalRestock - totalIssued
      
      if (rInput < 0 || iInput < 0) { setError('Quantities must be ≥ 0'); return }
      if (totalIssued > opening + totalRestock) { setError(`Total issued for ${row.item_name} cannot exceed opening + total restocked`); return }
      if (closing < 0) { setError(`Closing stock for ${row.item_name} cannot be negative`); return }
      
      if (rInput > 0) {
        records.push({ entity_type: 'storekeeper', data: { type: 'stock_restock', item_name: row.item_name, quantity: rInput, date, staff_name: staffName, notes: note || undefined }, financial_amount: 0 })
      }
      if (iInput > 0) {
        records.push({ entity_type: 'storekeeper', data: { type: 'stock_issued', item_name: row.item_name, quantity: iInput, date, staff_name: staffName, notes: note || undefined }, financial_amount: 0 })
      }
      // Submit closing snapshot only if this item had changes
      if (rInput > 0 || iInput > 0) {
        records.push({ 
          entity_type: 'storekeeper', 
          data: { 
            type: 'daily_closing_stock', 
            item_name: row.item_name, 
            quantity: 0, 
            closing_stock: closing, 
            date, 
            staff_name: staffName, 
            notes: note || undefined 
          }, 
          financial_amount: 0 
        })
      }
    }
    if (records.length === 0) { setError('No changes detected to submit.'); return }
    try {
      setSubmitting(true)
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true))
      if (!ok) { setError('Session expired. Please sign in again to continue.'); setSubmitting(false); return }
      const payload = records.map(r => ({ ...r, submitted_by: user?.id ?? null, status: 'pending' }))
      const { error: rpcError } = await supabase
        .rpc('submit_storekeeper_daily', { _records: payload })
      if (rpcError) {
        const chunkSize = 20
        for (let i = 0; i < payload.length; i += chunkSize) {
          const batch = payload.slice(i, i + chunkSize)
          const { error: insertError } = await supabase
            .from('operational_records')
            .insert(batch)
          if (insertError) { setError(insertError.message); return }
        }
      }
      setSuccess('Storekeeper daily stock updated.')
      
      // Clear inputs and refresh data
      setRestockedMap({})
      setIssuedMap({})
      setNotesMap({})
      
      // Trigger a re-fetch of items to update stock_in_db/stock_out_db
      // We can do this by toggling a dependency or just calling the effect?
      // Since fetchItems is inside useEffect, we can't call it directly.
      // But we can force a refresh by creating a refresh trigger state?
      // Or just reload the page? No, that's bad UX.
      // The simplest way is to update `items` locally, but `fetchItems` is better for consistency.
      // Let's rely on the user refreshing or add a `refreshKey` state.
      // Actually, since we cleared the maps, the displayed Closing Stock will revert to Opening + PrevRestock - PrevIssued
      // UNTIL the new data is fetched.
      // So we MUST fetch new data immediately.
      // I'll add a refresh trigger to the dependency array.
      setRefreshKey(prev => prev + 1)
      
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally { setSubmitting(false) }
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
        // Fetch items in selected category and optional collection
        let q = supabase
          .from('operational_records')
          .select('id, data, original_id, version_no, created_at, status, deleted_at')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .filter('data->>type', 'eq', 'config_item')
          .filter('data->>category', 'eq', activeCategory)
          .order('created_at', { ascending: false })
        if (selectedCollection) {
          q = q.filter('data->>collection_name', 'eq', selectedCollection)
        }
        const { data, error } = await q
        if (error) { setError(error.message); return }
        const latestByOriginal = new Map<string, any>()
        for (const r of (data ?? [])) {
          const key = String((r as any)?.original_id ?? (r as any)?.id)
          const prev = latestByOriginal.get(key)
          const currVer = Number((r as any)?.version_no ?? 0)
          const prevVer = Number((prev as any)?.version_no ?? -1)
          const currTs = new Date((r as any)?.created_at ?? 0).getTime()
          const prevTs = new Date((prev as any)?.created_at ?? 0).getTime()
          if (!prev || currVer > prevVer || (currVer === prevVer && currTs > prevTs)) {
            latestByOriginal.set(key, r)
          }
        }
        const base = Array.from(latestByOriginal.values())
          .map((r: any) => ({ item_name: String(r?.data?.item_name ?? ''), unit: r?.data?.unit ?? null }))
          .filter((it: any) => it.item_name)
  
        const range = getMonthRange(month)
        const rows: MonthlyRow[] = []
        for (const it of base) {
          if (!supabase) { rows.push({ item_name: it.item_name, unit: it.unit ?? null, opening_month_start: 0, total_restocked: 0, total_issued: 0, closing_month_end: 0 }); continue }
          
          // 1. Baseline: Latest approved opening_stock
          const { data: osRows } = await supabase
            .from('operational_records')
            .select('id, data, status, created_at, deleted_at')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .filter('data->>type', 'eq', 'opening_stock')
            .filter('data->>item_name', 'eq', it.item_name)
            .order('created_at', { ascending: false })
            .limit(1)
            
          const baselineRecord = osRows && osRows.length > 0 ? osRows[0] : null;
          const baselineQty = baselineRecord ? (typeof baselineRecord.data?.quantity === 'number' ? baselineRecord.data.quantity : Number(baselineRecord.data?.quantity ?? 0)) : 0;
          const baselineDateStr = baselineRecord ? (baselineRecord.data?.date ?? baselineRecord.created_at) : '1970-01-01';
          const baselineDate = new Date(baselineDateStr).toISOString().slice(0, 10);

          // 2. Fetch ALL transactions after baseline
          const { data: txRows } = await supabase
            .from('operational_records')
            .select('id, data, original_id, version_no, created_at, status, deleted_at')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .in('data->>type', ['stock_restock', 'stock_issued'])
            .filter('data->>item_name', 'eq', it.item_name)
            .order('created_at', { ascending: false })
          
          const uniqueTx = dedupLatest(txRows ?? [])

          let preMonthRestock = 0;
          let preMonthIssued = 0;
          let inMonthRestock = 0;
          let inMonthIssued = 0;

          const startIso = range.start;
          const endIso = range.end;

          for (const tx of uniqueTx) {
            const txDate = tx.data?.date ?? tx.created_at.slice(0, 10);
            if (txDate < baselineDate) continue; // Ignore transactions before baseline

            const qty = Number(tx.data?.quantity ?? 0);
            const type = tx.data?.type;

            if (txDate < startIso) {
              // Pre-month
              if (type === 'stock_restock') preMonthRestock += qty;
              else if (type === 'stock_issued') preMonthIssued += qty;
            } else if (txDate >= startIso && txDate <= endIso) {
              // In-month
              if (type === 'stock_restock') inMonthRestock += qty;
              else if (type === 'stock_issued') inMonthIssued += qty;
            }
          }

          const openingMonthStart = Math.max(0, baselineQty + preMonthRestock - preMonthIssued);
          const closingMonthEnd = Math.max(0, openingMonthStart + inMonthRestock - inMonthIssued);

          rows.push({ 
            item_name: it.item_name, 
            unit: it.unit ?? null, 
            opening_month_start: openingMonthStart, 
            total_restocked: inMonthRestock, 
            total_issued: inMonthIssued, 
            closing_month_end: closingMonthEnd 
          })
        }
        rows.sort((a, b) => a.item_name.localeCompare(b.item_name))
        setMonthlyRows(rows)
      } finally { setLoadingMonthly(false) }
    }
    computeMonthly()
  }, [isConfigured, session, activeCategory, selectedCollection, month, activeTab])

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
                    items={paginatedItems.map(i => ({ ...i, unit_price: null, opening_stock: i.opening_stock }))}
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
