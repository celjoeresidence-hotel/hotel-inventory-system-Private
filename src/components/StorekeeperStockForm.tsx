import { useEffect, useState } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'

type UIItem = { item_name: string; unit: string | null; opening_stock: number }
type MonthlyRow = { item_name: string; unit: string | null; opening_month_start: number; total_restocked: number; total_issued: number; closing_month_end: number }

export default function StorekeeperStockForm() {
  const { role, session, isConfigured } = useAuth()

  if (role !== 'storekeeper') {
    return (
      <div style={{ maxWidth: 960, margin: '24px auto' }}>
        <h2>Access denied</h2>
        <p>You must be storekeeper staff to submit daily stock records.</p>
      </div>
    )
  }

  const [activeTab, setActiveTab] = useState<'daily' | 'monthly'>('daily')
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10))

  // Categories and collections
  const [categories, setCategories] = useState<{ name: string; active: boolean }[]>([])
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false)
  const [activeCategory, setActiveCategory] = useState<string>('')

  const [collections, setCollections] = useState<string[]>([])
  const [selectedCollection, setSelectedCollection] = useState<string>('')
  const [loadingCollections, setLoadingCollections] = useState<boolean>(false)

  // Items and per-item inputs
  const [items, setItems] = useState<UIItem[]>([])
  const [loadingItems, setLoadingItems] = useState<boolean>(false)
  const [restockedMap, setRestockedMap] = useState<Record<string, number>>({})
  const [issuedMap, setIssuedMap] = useState<Record<string, number>>({})
  const [notesMap, setNotesMap] = useState<Record<string, string>>({})

  const [submitting, setSubmitting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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
      setLoadingCollections(true)
      try {
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
        if (!selectedCollection && cols.length > 0) setSelectedCollection(cols[0])
      } finally { setLoadingCollections(false) }
    }
    fetchCollections()
  }, [isConfigured, session, activeCategory])

  function prevDay(isoDate: string): string {
    const d = new Date(isoDate)
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  }

  async function computeOpeningForItem(itemName: string, isoDate: string): Promise<number> {
    if (!supabase) return 0
    const d1 = prevDay(isoDate)
    // Sum restock for D-1
    const { data: rsRows, error: rsErr } = await supabase
      .from('operational_records')
      .select('id, data, status, deleted_at')
      .eq('status', 'approved')
      .is('deleted_at', null)
      .filter('data->>type', 'eq', 'stock_restock')
      .filter('data->>item_name', 'eq', itemName)
      .filter('data->>date', 'eq', d1)
    if (rsErr) return 0
    const totalRestock = (rsRows ?? []).reduce((sum: number, r: any) => sum + (typeof r?.data?.quantity === 'number' ? r.data.quantity : Number(r?.data?.quantity ?? 0)), 0)

    const { data: isRows, error: isErr } = await supabase
      .from('operational_records')
      .select('id, data, status, deleted_at')
      .eq('status', 'approved')
      .is('deleted_at', null)
      .filter('data->>type', 'eq', 'stock_issued')
      .filter('data->>item_name', 'eq', itemName)
      .filter('data->>date', 'eq', d1)
    if (isErr) return 0
    const totalIssued = (isRows ?? []).reduce((sum: number, r: any) => sum + (typeof r?.data?.quantity === 'number' ? r.data.quantity : Number(r?.data?.quantity ?? 0)), 0)

    // Latest opening_stock
    const { data: osRows } = await supabase
      .from('operational_records')
      .select('id, data, status, created_at, deleted_at')
      .eq('status', 'approved')
      .is('deleted_at', null)
      .filter('data->>type', 'eq', 'opening_stock')
      .filter('data->>item_name', 'eq', itemName)
      .order('created_at', { ascending: false })
      .limit(1)
    const openingD1 = osRows && osRows.length > 0 ? (typeof osRows[0]?.data?.quantity === 'number' ? osRows[0].data.quantity : Number(osRows[0]?.data?.quantity ?? 0)) : 0

    if ((rsRows?.length ?? 0) > 0 || (isRows?.length ?? 0) > 0) {
      return Math.max(0, openingD1 + totalRestock - totalIssued)
    }
    // Else latest opening stock
    return openingD1
  }

  // Fetch items and compute opening stock per item
  useEffect(() => {
    async function fetchItems() {
      setError(null)
      setLoadingItems(true)
      try {
        if (!isConfigured || !session || !supabase || !activeCategory) { setItems([]); return }
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
        const computed: UIItem[] = []
        for (const it of base) {
          const opening = await computeOpeningForItem(it.item_name, date)
          computed.push({ item_name: it.item_name, unit: it.unit ?? null, opening_stock: opening })
        }
        // Sort by item name
        computed.sort((a, b) => a.item_name.localeCompare(b.item_name))
        setItems(computed)
        const rmap: Record<string, number> = {}; const imap: Record<string, number> = {}; const nmap: Record<string, string> = {}
        for (const it of computed) { rmap[it.item_name] = 0; imap[it.item_name] = 0; nmap[it.item_name] = '' }
        setRestockedMap(rmap)
        setIssuedMap(imap)
        setNotesMap(nmap)
      } finally { setLoadingItems(false) }
    }
    fetchItems()
  }, [isConfigured, session, activeCategory, selectedCollection, date])

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
    if (!isConfigured || !session || !supabase) { setError('Authentication required. Please sign in.'); return }
    if (!date) { setError('Date is required'); return }
    if (!activeCategory) { setError('Select a category'); return }

    const records: { entity_type: string; data: any; financial_amount: number }[] = []
    for (const row of items) {
      const r = Number(restockedMap[row.item_name] ?? 0)
      const i = Number(issuedMap[row.item_name] ?? 0)
      const note = (notesMap[row.item_name] ?? '').trim()
      const opening = Number(row.opening_stock ?? 0)
      const closing = opening + r - i
      if (r < 0 || i < 0) { setError('Quantities must be ≥ 0'); return }
      if (i > opening + r) { setError(`Issued for ${row.item_name} cannot exceed opening + restocked`); return }
      if (closing < 0) { setError(`Closing stock for ${row.item_name} cannot be negative`); return }
      if (r > 0) {
        records.push({ entity_type: 'storekeeper', data: { type: 'stock_restock', item_name: row.item_name, quantity: r, date, notes: note || undefined }, financial_amount: 0 })
      }
      if (i > 0) {
        records.push({ entity_type: 'storekeeper', data: { type: 'stock_issued', item_name: row.item_name, quantity: i, date, notes: note || undefined }, financial_amount: 0 })
      }
    }
    if (records.length === 0) { setError('Enter restocked or issued quantities for at least one item.'); return }
    try {
      setSubmitting(true)
      const { error: insertError } = await supabase.from('operational_records').insert(records)
      if (insertError) { setError(insertError.message); return }
      setSuccess('Storekeeper daily stock submitted for supervisor approval.')
      // Reset input maps but keep date and selections
      const rmap: Record<string, number> = {}; const imap: Record<string, number> = {}; const nmap: Record<string, string> = {}
      for (const it of items) { rmap[it.item_name] = 0; imap[it.item_name] = 0; nmap[it.item_name] = '' }
      setRestockedMap(rmap); setIssuedMap(imap); setNotesMap(nmap)
    } finally { setSubmitting(false) }
  }

  // Return moved to the end of component to ensure views are defined before rendering.
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7))
  const [monthlyRows, setMonthlyRows] = useState<MonthlyRow[]>([])
  const [loadingMonthly, setLoadingMonthly] = useState<boolean>(false)

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
          // Baseline: latest approved opening_stock
          const { data: osRows } = await supabase
            .from('operational_records')
            .select('id, data, status, created_at, deleted_at')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .filter('data->>type', 'eq', 'opening_stock')
            .filter('data->>item_name', 'eq', it.item_name)
            .order('created_at', { ascending: false })
            .limit(1)
          const baseline = osRows && osRows.length > 0 ? (typeof osRows[0]?.data?.quantity === 'number' ? osRows[0].data.quantity : Number(osRows[0]?.data?.quantity ?? 0)) : 0
  
          // Previous month totals
          const { data: prevRs } = await supabase
            .from('operational_records')
            .select('id, data, status, deleted_at')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .filter('data->>type', 'eq', 'stock_restock')
            .filter('data->>item_name', 'eq', it.item_name)
            .filter('data->>date', 'gte', range.prevStart)
            .filter('data->>date', 'lte', range.prevEnd)
          const prevRestock = (prevRs ?? []).reduce((sum: number, r: any) => sum + (typeof r?.data?.quantity === 'number' ? r.data.quantity : Number(r?.data?.quantity ?? 0)), 0)
  
          const { data: prevIs } = await supabase
            .from('operational_records')
            .select('id, data, status, deleted_at')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .filter('data->>type', 'eq', 'stock_issued')
            .filter('data->>item_name', 'eq', it.item_name)
            .filter('data->>date', 'gte', range.prevStart)
            .filter('data->>date', 'lte', range.prevEnd)
          const prevIssued = (prevIs ?? []).reduce((sum: number, r: any) => sum + (typeof r?.data?.quantity === 'number' ? r.data.quantity : Number(r?.data?.quantity ?? 0)), 0)
  
          const openingMonthStart = (prevRestock + prevIssued) > 0 ? Math.max(0, baseline + prevRestock - prevIssued) : baseline
  
          // Current month totals
          const { data: currRs } = await supabase
            .from('operational_records')
            .select('id, data, status, deleted_at')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .filter('data->>type', 'eq', 'stock_restock')
            .filter('data->>item_name', 'eq', it.item_name)
            .filter('data->>date', 'gte', range.start)
            .filter('data->>date', 'lte', range.end)
          const totalRestocked = (currRs ?? []).reduce((sum: number, r: any) => sum + (typeof r?.data?.quantity === 'number' ? r.data.quantity : Number(r?.data?.quantity ?? 0)), 0)
  
          const { data: currIs } = await supabase
            .from('operational_records')
            .select('id, data, status, deleted_at')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .filter('data->>type', 'eq', 'stock_issued')
            .filter('data->>item_name', 'eq', it.item_name)
            .filter('data->>date', 'gte', range.start)
            .filter('data->>date', 'lte', range.end)
          const totalIssued = (currIs ?? []).reduce((sum: number, r: any) => sum + (typeof r?.data?.quantity === 'number' ? r.data.quantity : Number(r?.data?.quantity ?? 0)), 0)
  
          const closingMonthEnd = Math.max(0, openingMonthStart + totalRestocked - totalIssued)
  
          rows.push({ item_name: it.item_name, unit: it.unit ?? null, opening_month_start: openingMonthStart, total_restocked: totalRestocked, total_issued: totalIssued, closing_month_end: closingMonthEnd })
        }
        // Sort rows by item name
        rows.sort((a, b) => a.item_name.localeCompare(b.item_name))
        setMonthlyRows(rows)
      } finally { setLoadingMonthly(false) }
    }
    computeMonthly()
  }, [activeTab, isConfigured, session, activeCategory, selectedCollection, month])

  const monthlyView = (
    <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
      <div>
        <label style={{ display: 'block', marginBottom: 6 }}>Month *</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ padding: '8px 10px' }} />
      </div>
      <div>
        <h3 style={{ margin: '12px 0' }}>Categories</h3>
        {loadingCategories ? (
          <div>Loading categories…</div>
        ) : categories.length === 0 ? (
          <div style={{ color: '#666' }}>No categories found. Please configure categories in Inventory Setup.</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {categories.map((c) => (
              <button
                key={c.name}
                className="btn"
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  background: activeCategory === c.name ? '#004D40' : '#f7f7f7',
                  color: activeCategory === c.name ? '#fff' : '#333',
                  boxShadow: activeCategory === c.name ? '0 2px 6px rgba(0,0,0,0.15)' : 'none'
                }}
                onClick={() => setActiveCategory(c.name)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 style={{ margin: '12px 0' }}>Collection (optional)</h3>
        {loadingCollections ? (
          <div>Loading collections…</div>
        ) : collections.length === 0 ? (
          <div style={{ color: '#666' }}>No collections for this category.</div>
        ) : (
          <select value={selectedCollection} onChange={(e) => setSelectedCollection(e.target.value)} style={{ padding: '8px 10px' }} disabled={loadingCollections}>
            {collections.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}
      </div>
      <div>
        <h3 style={{ margin: '12px 0' }}>Monthly Summary — {month}</h3>
        {loadingMonthly ? (
          <div>Computing monthly summary…</div>
        ) : monthlyRows.length === 0 ? (
          <div style={{ color: '#666' }}>No items found for the selected filters.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px' }}>Item</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px' }}>Unit</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Opening (Month Start)</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Total Restocked</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Total Issued</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Closing (Month End)</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((row) => (
                  <tr key={row.item_name}>
                    <td style={{ borderBottom: '1px solid #eee', padding: '8px' }}>{row.item_name}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: '8px' }}>{row.unit ?? '—'}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>{row.opening_month_start}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>{row.total_restocked}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>{row.total_issued}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>{row.closing_month_end}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )

  const dailyView = (
    <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
      {error && (
        <div style={{ background: '#ffefef', color: '#b00020', padding: '8px 12px', borderRadius: 8 }}>{error}</div>
      )}
      {success && (
        <div style={{ background: '#eafbea', color: '#0b7a0b', padding: '8px 12px', borderRadius: 8 }}>{success}</div>
      )}
      <div>
        <label style={{ display: 'block', marginBottom: 6 }}>Date *</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ padding: '8px 10px' }} />
      </div>
      <div>
        <h3 style={{ margin: '12px 0' }}>Categories</h3>
        {loadingCategories ? (
          <div>Loading categories…</div>
        ) : categories.length === 0 ? (
          <div style={{ color: '#666' }}>No categories found. Please configure categories in Inventory Setup.</div>
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {categories.map((c) => (
              <button
                key={c.name}
                className="btn"
                style={{
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #ddd',
                  background: activeCategory === c.name ? '#004D40' : '#f7f7f7',
                  color: activeCategory === c.name ? '#fff' : '#333',
                  boxShadow: activeCategory === c.name ? '0 2px 6px rgba(0,0,0,0.15)' : 'none'
                }}
                onClick={() => setActiveCategory(c.name)}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div>
        <h3 style={{ margin: '12px 0' }}>Collection (optional)</h3>
        {loadingCollections ? (
          <div>Loading collections…</div>
        ) : collections.length === 0 ? (
          <div style={{ color: '#666' }}>No collections for this category.</div>
        ) : (
          <select value={selectedCollection} onChange={(e) => setSelectedCollection(e.target.value)} style={{ padding: '8px 10px' }} disabled={loadingCollections}>
            {collections.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}
      </div>
      <div>
        <h3 style={{ margin: '12px 0' }}>Daily Stock — {date}</h3>
        {loadingItems ? (
          <div>Loading items…</div>
        ) : items.length === 0 ? (
          <div style={{ color: '#666' }}>No items found for the selected filters.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px' }}>Item</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px' }}>Unit</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Opening Stock</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Quantity Re-Stock</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Quantity Issued</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: '8px' }}>Notes</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: '8px' }}>Closing Stock</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const o = Number(row.opening_stock ?? 0)
                  const r = Number(restockedMap[row.item_name] ?? 0)
                  const i = Number(issuedMap[row.item_name] ?? 0)
                  const closing = o + r - i
                  return (
                    <tr key={row.item_name}>
                      <td style={{ borderBottom: '1px solid #eee', padding: '8px' }}>{row.item_name}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: '8px' }}>{row.unit ?? '—'}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>{Number.isFinite(o) ? o : '—'}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={r}
                          onChange={(e) => handleChangeRestocked(row.item_name, Number(e.target.value))}
                          disabled={submitting}
                          style={{ width: 120 }}
                        />
                      </td>
                      <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={i}
                          onChange={(e) => handleChangeIssued(row.item_name, Number(e.target.value))}
                          disabled={submitting}
                          style={{ width: 120 }}
                        />
                      </td>
                      <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'left' }}>
                        <input
                          type="text"
                          value={notesMap[row.item_name] ?? ''}
                          onChange={(e) => handleChangeNotes(row.item_name, e.target.value)}
                          disabled={submitting}
                          style={{ width: 220 }}
                        />
                      </td>
                      <td style={{ borderBottom: '1px solid #eee', padding: '8px', textAlign: 'right' }}>{closing}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <div>
        <button onClick={handleSubmit} disabled={submitting || !activeCategory || items.length === 0} style={{ padding: '10px 14px' }}>
          {submitting ? 'Submitting…' : 'Submit for Approval'}
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: 1100, margin: '24px auto' }}>
      <h2>Storekeeper — Stock</h2>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button
          onClick={() => setActiveTab('daily')}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', background: activeTab === 'daily' ? '#004D40' : '#f7f7f7', color: activeTab === 'daily' ? '#fff' : '#333' }}
        >
          Daily Stock
        </button>
        <button
          onClick={() => setActiveTab('monthly')}
          style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid #ddd', background: activeTab === 'monthly' ? '#004D40' : '#f7f7f7', color: activeTab === 'monthly' ? '#fff' : '#333' }}
        >
          Monthly Summary
        </button>
      </div>
      {activeTab === 'daily' ? dailyView : monthlyView}
    </div>
  )
}