import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import type { KitchenStockData } from '../types/kitchen'
import InventoryConsumptionTable from './InventoryConsumptionTable'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { SearchInput } from './ui/SearchInput'
import { Select } from './ui/Select'
import { Pagination } from './ui/Pagination'
import { IconAlertCircle, IconCheckCircle, IconChefHat, IconHistory } from './ui/Icons'
import { StaffSelect } from './ui/StaffSelect'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table'

export default function KitchenStockForm() {
  const { role, session, isConfigured } = useAuth()

  // Role gating remains: screen is for kitchen staff
  if (role !== 'kitchen') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 animate-in fade-in">
        <Card className="max-w-md w-full p-8 text-center border-error-light shadow-lg">
        <div className="bg-error-light text-error w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
          <IconAlertCircle className="w-8 h-8" />
        </div>
          <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
          <p className="text-gray-500">You must be logged in as kitchen staff to access this page.</p>
        </Card>
      </div>
    )
  }

  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  // Dynamic categories assigned to kitchen
  const [categories, setCategories] = useState<{ name: string; active: boolean }[]>([])
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false)
  const [activeCategory, setActiveCategory] = useState<string>('')

  // Search & Pagination
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10

  type UIItem = { item_name: string; unit: string | null; unit_price: number | null; opening_stock: number | null }
  const [items, setItems] = useState<UIItem[]>([])
  const [loadingItems, setLoadingItems] = useState<boolean>(false)
  const [activeTab, setActiveTab] = useState<'daily' | 'history'>('daily')
  const [historyRecords, setHistoryRecords] = useState<any[]>([])
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false)

  const [restockedMap, setRestockedMap] = useState<Record<string, number>>({})
  const [soldMap, setSoldMap] = useState<Record<string, number>>({})
  const [notesMap, setNotesMap] = useState<Record<string, string>>({})
  const [staffName, setStaffName] = useState<string>('')

  // Reset pagination/search on category change
  useEffect(() => {
    setSearchTerm('')
    setPage(1)
  }, [activeCategory, activeTab])

  // Filtered & Paginated Items
  const filteredItems = useMemo(() => {
    if (!searchTerm) return items
    const lower = searchTerm.toLowerCase()
    return items.filter(it => it.item_name.toLowerCase().includes(lower))
  }, [items, searchTerm])

  const paginatedItems = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredItems.slice(start, start + PAGE_SIZE)
  }, [filteredItems, page])

  // Filtered & Paginated History
  const filteredHistory = useMemo(() => {
    if (!searchTerm) return historyRecords
    const lower = searchTerm.toLowerCase()
    return historyRecords.filter(r => 
      (r.item_name || '').toLowerCase().includes(lower) || 
      (r.staff_name || '').toLowerCase().includes(lower)
    )
  }, [historyRecords, searchTerm])

  const paginatedHistory = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE
    return filteredHistory.slice(start, start + PAGE_SIZE)
  }, [filteredHistory, page])

  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Fetch categories assigned to kitchen from RPC
  useEffect(() => {
    async function fetchCategories() {
      setError(null)
      setLoadingCategories(true)
      try {
        if (!isConfigured || !session || !supabase) return
        // Try RPC first
        let cats: { name: string; active: boolean }[] = []
        try {
          const { data, error } = await supabase.rpc('list_assigned_categories_for_role', { _role: 'kitchen' })
          if (!error && data) {
            cats = (data ?? [])
              .map((r: any) => ({ name: String(r?.category_name ?? ''), active: true }))
              .filter((c: { name: string; active: boolean }) => Boolean(c.name))
          }
        } catch {}
        // Fallback to operational_records if RPC unavailable or returned empty
        if (!cats.length) {
          const { data: catRows, error: catErr } = await supabase
            .from('operational_records')
            .select('id, data, original_id, version_no, created_at, status, deleted_at, entity_type')
            .eq('status', 'approved')
            .is('deleted_at', null)
            // removed: 
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
          const latestRows = Array.from(latestByOriginal.values())
          // Build category list and filter by assigned_to includes kitchen
          let tmpCats = latestRows
            .map((r: any) => ({
              name: String((r as any)?.data?.category_name ?? (r as any)?.data?.name ?? ''),
              active: ((r as any)?.data?.active ?? true) !== false,
              _assigned: (r as any)?.data?.assigned_to ?? null,
            }))
            .filter((c: any) => Boolean(c.name))
          // Remove duplicates by name
          tmpCats = tmpCats.filter((c: any, idx: number, arr: any[]) => arr.findIndex(x => x.name === c.name) === idx)
          // Assigned_to can be array of roles or object with flags
          cats = tmpCats.filter((c: any) => {
            const assigned = c._assigned
            if (Array.isArray(assigned)) return assigned.includes('kitchen')
            if (assigned && typeof assigned === 'object') return Boolean(assigned?.kitchen)
            // Strict filtering: if not explicitly assigned, do not show
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

  // Fetch items for active category via RPC
  useEffect(() => {
    async function fetchItems() {
      setError(null)
      setLoadingItems(true)
      try {
        if (!isConfigured || !session || !supabase || !activeCategory) { setItems([]); return }
        // Try RPC first (Use get_daily_stock_sheet for correct opening stock)
        let enriched: UIItem[] = []
        try {
          const { data, error } = await supabase.rpc('get_daily_stock_sheet', { 
            _role: 'kitchen',
            _category: activeCategory,
            _report_date: date
          })
          
          if (!error && data) {
            enriched = (data ?? []).map((r: any) => ({
              item_name: String(r?.item_name ?? ''),
              unit: r?.unit ?? null,
              unit_price: typeof r?.unit_price === 'number' ? r.unit_price : Number(r?.unit_price ?? null),
              opening_stock: typeof r?.opening_stock === 'number' ? r.opening_stock : Number(r?.opening_stock ?? null),
            })).filter((it: any) => it.item_name)
          } else {
             // Fallback to old RPC if new one not applied yet
             const { data: oldData, error: oldError } = await supabase.rpc('list_items_for_category', { _category: activeCategory })
             if (!oldError && oldData) {
                enriched = (oldData ?? []).map((r: any) => ({
                  item_name: String(r?.item_name ?? ''),
                  unit: r?.unit ?? null,
                  unit_price: typeof r?.unit_price === 'number' ? r.unit_price : Number(r?.unit_price ?? null),
                  opening_stock: typeof r?.opening_stock === 'number' ? r.opening_stock : Number(r?.opening_stock ?? null),
                })).filter((it: any) => it.item_name)
             }
          }
        } catch {}
        // Fallback to operational_records config_item if RPC unavailable or returned empty
        if (!enriched.length) {
          const { data: itemRows, error: itemErr } = await supabase
            .from('operational_records')
            .select('id, data, original_id, version_no, created_at, status, deleted_at, entity_type')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .filter('data->>type', 'eq', 'config_item')
            .filter('data->>category', 'eq', activeCategory)
            .order('created_at', { ascending: false })
          if (itemErr) { setError(itemErr.message); return }
          const latestByOriginalItems = new Map<string, any>()
          for (const r of (itemRows ?? [])) {
            const key = String(r?.original_id ?? r?.id)
            const prev = latestByOriginalItems.get(key)
            const currVer = Number((r as any)?.version_no ?? 0)
            const prevVer = Number((prev as any)?.version_no ?? -1)
            const currTs = new Date((r as any)?.created_at ?? 0).getTime()
            const prevTs = new Date((prev as any)?.created_at ?? 0).getTime()
            if (!prev || currVer > prevVer || (currVer === prevVer && currTs > prevTs)) {
              latestByOriginalItems.set(key, r)
            }
          }
          const latestRowsItems = Array.from(latestByOriginalItems.values())
          enriched = latestRowsItems.map((r: any) => ({
            item_name: String((r as any)?.data?.item_name ?? ''),
            unit: (r as any)?.data?.unit ?? null,
            unit_price: typeof (r as any)?.data?.unit_price === 'number' ? (r as any)?.data?.unit_price : Number((r as any)?.data?.unit_price ?? null),
            opening_stock: null, // can be enriched later from daily records
          })).filter((it: any) => it.item_name)
        }
        enriched = enriched.sort((a: any, b: any) => a.item_name.localeCompare(b.item_name))
        
        setItems(enriched)
        const rmap: Record<string, number> = {}; const smap: Record<string, number> = {}; const nmap: Record<string, string> = {}
        for (const it of enriched) { 
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
  }, [isConfigured, session, activeCategory, date]) // Added date dependency so it recalculates when date changes

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

    if (!isConfigured || !session || !supabase) {
      setError('Authentication required. Please sign in.')
      return
    }
    if (!date) {
      setError('Date is required')
      return
    }
    const records: { entity_type: string; data: KitchenStockData; financial_amount: number }[] = []
    for (const row of items) {
      const o = Number(row.opening_stock ?? 0)
      const r = Number(restockedMap[row.item_name] ?? 0)
      const s = Number(soldMap[row.item_name] ?? 0)
      const u = Number(row.unit_price ?? 0)
      const n = notesMap[row.item_name]?.trim()

      if (r <= 0 && s <= 0 && !n) continue
      if (s > o + r) { setError(`Sold for ${row.item_name} cannot exceed opening + restocked`); return }
      const closing = o + r - s
      if (closing < 0) { setError(`Closing stock for ${row.item_name} cannot be negative`); return }
      const total = s * u
      const payload: KitchenStockData = {
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
      } as any
      records.push({
        entity_type: 'kitchen',
        data: payload,
        financial_amount: total,
      })
    }
    if (records.length === 0) {
      setError('Enter restocked or sold quantities (or notes) for at least one item.')
      return
    }
    try {
      setSubmitting(true)
      const { error: insertError } = await supabase.from('operational_records').insert(records)
      if (insertError) { setError(insertError.message); return }
      setSuccess('Daily stock submitted for supervisor approval.')
      // Reset inputs but keep date and current tab
      const r: Record<string, number> = {}
      const s: Record<string, number> = {}
      const n: Record<string, string> = {}
      for (const it of items) { r[it.item_name] = 0; s[it.item_name] = 0; n[it.item_name] = '' }
      setRestockedMap(r)
      setSoldMap(s)
      setNotesMap(n)
      
      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } finally {
      setSubmitting(false)
    }
  }

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
          .eq('role', 'kitchen')
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

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
            <div className="p-2 bg-green-100 text-green-700 rounded-lg">
              <IconChefHat className="w-6 h-6" />
            </div>
            Kitchen Daily Stock
          </h1>
          <p className="text-sm text-gray-500 mt-1 ml-12">Manage inventory usage and requests for the kitchen</p>
        </div>
        <div className="w-full md:w-auto flex flex-col md:flex-row gap-4">
          <StaffSelect
            role="kitchen"
            value={staffName}
            onChange={setStaffName}
            disabled={submitting}
            className="w-full md:w-48"
          />
          <Input
            type="date"
            label="Date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            disabled={submitting}
            className="w-full md:w-48"
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 border-b border-gray-200 mb-6">
        <button
          onClick={() => setActiveTab('daily')}
          className={`pb-2 px-4 text-sm font-medium transition-colors relative ${
            activeTab === 'daily' ? 'text-primary border-b-2 border-primary' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Daily Entry
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`pb-2 px-4 text-sm font-medium transition-colors relative ${
            activeTab === 'history' ? 'text-primary border-b-2 border-primary' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          History
        </button>
      </div>

      {activeTab === 'daily' && (
        <div className="space-y-6">

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

      <div className="grid grid-cols-1 gap-6">
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
                <p className="text-gray-500 text-sm italic">No categories assigned to Kitchen.</p>
                <p className="text-xs text-gray-400 mt-1">Ask an admin or manager to assign categories to the Kitchen role.</p>
              </div>
            ) : (
              <div className="max-w-md">
                <Select
                  value={activeCategory}
                  onChange={(e) => setActiveCategory(e.target.value)}
                  options={categories.map((c) => ({ value: c.name, label: c.name }))}
                  placeholder="Select a category"
                />
              </div>
            )}
          </div>
        </Card>

        {activeCategory && (
          <Card className="p-0 overflow-hidden animate-in slide-in-from-bottom-4 duration-500">
            <div className="border-b border-gray-100 bg-gray-50/50 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-medium text-gray-900">
                  {activeCategory}
                </h3>
                <span className="text-gray-400 text-sm font-normal">Items</span>
                <div className="text-xs font-medium px-2.5 py-0.5 rounded-full bg-gray-100 text-gray-600 ml-2">
                  {filteredItems.length} items
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
              {loadingItems ? (
                 <div className="p-8 text-center text-gray-500">
                   <div className="w-8 h-8 border-2 border-green-600 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                   Loading items...
                 </div>
              ) : (
                <>
                  <InventoryConsumptionTable
                    items={paginatedItems}
                    restockedMap={restockedMap}
                    soldMap={soldMap}
                    notesMap={notesMap}
                    disabled={submitting}
                    soldLabel="Consumed"
                    onChangeRestocked={handleChangeRestocked}
                    onChangeSold={handleChangeSold}
                    onChangeNotes={handleChangeNotes}
                  />
                  <Pagination
                    currentPage={page}
                    totalPages={Math.ceil(filteredItems.length / PAGE_SIZE)}
                    onPageChange={setPage}
                    className="mt-4"
                  />
                </>
              )}
            </div>

            <div className="p-4 bg-gray-50 border-t border-gray-100 flex justify-end">
              <Button 
                onClick={handleSubmit} 
                disabled={submitting || items.length === 0}
                isLoading={submitting}
                size="lg"
                className="w-full sm:w-auto shadow-sm"
              >
                Submit Daily Stock
              </Button>
            </div>
          </Card>
        )}
      </div>
      </div>
      )}

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
                    {paginatedHistory.map((r) => (
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
