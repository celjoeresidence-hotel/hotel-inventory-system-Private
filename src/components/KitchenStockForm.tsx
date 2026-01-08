import { useState, useEffect, useMemo, useRef } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import InventoryConsumptionTable from './InventoryConsumptionTable'
import { Card } from './ui/Card'
import { Button } from './ui/Button'
import { Input } from './ui/Input'
import { SearchInput } from './ui/SearchInput'
import { Select } from './ui/Select'
import { Pagination } from './ui/Pagination'
import { IconAlertCircle, IconCheckCircle, IconChefHat } from './ui/Icons'
import { StaffSelect } from './ui/StaffSelect'
import { InventoryHistoryModule } from './InventoryHistoryModule'
import { isAssignedToRole } from '../utils/assignment'

export default function KitchenStockForm() {
  const { role, session, isConfigured, ensureActiveSession, isSupervisor, isManager, isAdmin } = useAuth()

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
  // Refresh trigger
  const [refreshKey, setRefreshKey] = useState(0)

  // Dynamic categories assigned to kitchen
  const [categories, setCategories] = useState<{ name: string; active: boolean }[]>([])
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false)
  const [activeCategory, setActiveCategory] = useState<string>('')

  // Search & Pagination
  const [searchTerm, setSearchTerm] = useState('')
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10


  type UIItem = { 
    id: string;
    item_name: string; 
    unit: string | null; 
    unit_price: number | null; 
    opening_stock: number | null;
    stock_in_db?: number;
    stock_out_db?: number;
  }
  const [items, setItems] = useState<UIItem[]>([])
  const [loadingItems, setLoadingItems] = useState<boolean>(false)
  const [activeTab, setActiveTab] = useState<'daily' | 'history'>('daily')

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

  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  // Error handling
  const [errorItemId, setErrorItemId] = useState<string | null>(null)
  const errorBannerRef = useRef<HTMLDivElement>(null)

  // Fetch categories assigned to kitchen from RPC
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
            .filter((r: any) => isAssignedToRole(r.assigned_to, 'kitchen'))
            .map((r: any) => ({ name: String(r?.name ?? ''), active: true }))
            .filter((c: { name: string; active: boolean }) => Boolean(c.name))
        }
        if (!cats.length) {
          try {
            const { data, error } = await supabase.rpc('list_assigned_categories_for_role', { _role: 'kitchen' })
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
            .eq('department', 'KITCHEN')
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

  // Fetch items for active category via RPC
  useEffect(() => {
    async function fetchItems() {
      setError(null)
      setLoadingItems(true)
      try {
        if (!isConfigured || !session || !supabase || !activeCategory) { setItems([]); return }
        
        const { data, error } = await supabase.rpc('get_department_stock_state', { 
            _date: date,
            _department: 'KITCHEN',
            _category: activeCategory
        })

        if (error) {
            console.error('get_department_stock_state failed', error)
            setError('Failed to fetch stock data: ' + error.message)
            return
        }

        const sheet = await supabase.rpc('get_daily_stock_sheet', { _role: 'kitchen', _category: activeCategory, _report_date: date })
        const sheetMap = new Map<string, { unit: string | null; unit_price: number; opening_stock: number }>()
        if (!sheet.error && Array.isArray(sheet.data)) {
          for (const s of sheet.data as any[]) {
            sheetMap.set(String(s.item_name), { unit: s.unit ?? null, unit_price: Number(s.unit_price ?? 0), opening_stock: Number(s.opening_stock ?? 0) })
          }
        }

        const enriched: UIItem[] = (data || []).map((r: any) => {
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
        
        setItems(enriched)
        
        // Reset inputs for delta mode
        setRestockedMap({})
        setSoldMap({})
        setNotesMap({})
      } finally {
        setLoadingItems(false)
      }
    }
    fetchItems()
  }, [isConfigured, session, activeCategory, date, refreshKey]) // Added date dependency so it recalculates when date changes

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
    setErrorItemId(null)
    setSuccess(null)

    if (!staffName) {
      setError('Please select a staff member responsible for today.')
      errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    if (!isConfigured || !session || !supabase) {
      setError('Authentication required. Please sign in.')
      errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    // Ensure session is active
    const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
    if (!ok) {
      setError('Session expired. Please sign in again to continue.');
      return;
    }

    if (!date) {
      setError('Date is required')
      errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }

    const transactions: any[] = []
    // Determine status based on role
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

      const totalRestocked = prevR + r
      const totalSold = prevS + s
      
      if (totalSold > o + totalRestocked) { 
          setError(`Total used (${totalSold}) for ${row.item_name} cannot exceed opening (${o}) + total restocked (${totalRestocked})`)
          setErrorItemId(row.id)
          errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return 
      }
      const closing = o + totalRestocked - totalSold
      if (closing < 0) { 
          setError(`Closing stock for ${row.item_name} cannot be negative`)
          setErrorItemId(row.id)
          errorBannerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          return 
      }
      
      if (r > 0) {
        transactions.push({
            item_id: row.id,
            department: 'KITCHEN',
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
            department: 'KITCHEN',
            transaction_type: 'stock_consumed', // Kitchen consumes
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
      return
    }

    try {
      setSubmitting(true)
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true))
      if (!ok) { setError('Session expired. Please sign in again to continue.'); setSubmitting(false); return }

      const insertError = await insertWithRetry('inventory_transactions', transactions)
      if (insertError) { setError(insertError); return }
      
      if (status === 'pending') {
          setSuccess('Daily stock submitted for supervisor approval.')
      } else {
          setSuccess('Daily stock updated successfully.')
      }
      
      // Reset inputs and refresh
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
                    errorItemId={errorItemId}
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
        <InventoryHistoryModule role="kitchen" />
      )}

    </div>
  )
}
