import { useState, useEffect } from 'react'
import { supabase } from '../supabaseClient'
import { useAuth } from '../context/AuthContext'
import type { KitchenStockData } from '../types/kitchen'
import InventoryConsumptionTable from './InventoryConsumptionTable'

export default function KitchenStockForm() {
  const { role, session, isConfigured } = useAuth()

  // Role gating remains: screen is for kitchen staff
  if (role !== 'kitchen') {
    return (
      <div style={{ maxWidth: 960, margin: '24px auto' }}>
        <h2>Access denied</h2>
        <p>You must be kitchen staff to submit daily stock records.</p>
      </div>
    )
  }

  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10))
  // Dynamic categories assigned to kitchen
  const [categories, setCategories] = useState<{ name: string; active: boolean }[]>([])
  const [loadingCategories, setLoadingCategories] = useState<boolean>(false)
  const [activeCategory, setActiveCategory] = useState<string>('')

  type UIItem = { item_name: string; unit: string | null; unit_price: number | null; opening_stock: number | null }
  const [items, setItems] = useState<UIItem[]>([])
  const [, setLoadingItems] = useState<boolean>(false)
  const [restockedMap, setRestockedMap] = useState<Record<string, number>>({})
  const [soldMap, setSoldMap] = useState<Record<string, number>>({})

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
            // If no assigned_to, include by default so kitchen can see categories
            return true
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
        // Try RPC first
        let enriched: UIItem[] = []
        try {
          const { data, error } = await supabase.rpc('list_items_for_category', { _category: activeCategory })
          if (!error && data) {
            enriched = (data ?? []).map((r: any) => ({
              item_name: String(r?.item_name ?? ''),
              unit: r?.unit ?? null,
              unit_price: typeof r?.unit_price === 'number' ? r.unit_price : Number(r?.unit_price ?? null),
              opening_stock: typeof r?.opening_stock === 'number' ? r.opening_stock : Number(r?.opening_stock ?? null),
            })).filter((it: any) => it.item_name)
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
        const rmap: Record<string, number> = {}; const smap: Record<string, number> = {}
        for (const it of enriched) { rmap[it.item_name] = 0; smap[it.item_name] = 0 }
        setRestockedMap(rmap)
        setSoldMap(smap)
      } finally {
        setLoadingItems(false)
      }
    }
    fetchItems()
  }, [isConfigured, session, activeCategory])

  const handleChangeRestocked = (name: string, value: number) => {
    setRestockedMap((prev) => ({ ...prev, [name]: Math.max(0, Number(value) || 0) }))
  }
  const handleChangeSold = (name: string, value: number) => {
    setSoldMap((prev) => ({ ...prev, [name]: Math.max(0, Number(value) || 0) }))
  }

  const handleSubmit = async () => {
    setError(null)
    setSuccess(null)
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
      if (r <= 0 && s <= 0) continue // only submit rows with non-zero activity
      if (s > o + r) { setError(`Sold for ${row.item_name} cannot exceed opening + restocked`); return }
      const closing = o + r - s
      if (closing < 0) { setError(`Closing stock for ${row.item_name} cannot be negative`); return }
      const total = s * u
      const payload: KitchenStockData = {
        date,
        item_name: row.item_name,
        opening_stock: o,
        restocked: r,
        sold: s,
        closing_stock: closing,
        unit_price: u,
        total_amount: total,
      } as any
      records.push({ entity_type: 'kitchen', data: payload, financial_amount: total })
    }
    if (records.length === 0) {
      setError('Enter restocked or sold quantities for at least one item.')
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
      for (const it of items) { r[it.item_name] = 0; s[it.item_name] = 0 }
      setRestockedMap(r)
      setSoldMap(s)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '24px auto' }}>
      <h2>Kitchen — Daily Stock</h2>
      <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 6 }}>Date *</label>
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={submitting} style={{ padding: '8px 10px' }} />
        </div>
        <div>
          <h3 style={{ margin: '12px 0' }}>Categories</h3>
          {loadingCategories ? (
            <div>Loading categories…</div>
          ) : categories.length === 0 ? (
            <div style={{ color: '#666' }}>No categories assigned to Kitchen. Ask an admin/manager/supervisor to assign categories in Inventory Setup.</div>
          ) : (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {categories.map((c: { name: string; active: boolean }) => (
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
          <h3 style={{ margin: '12px 0' }}>{activeCategory || '—'} Items</h3>
          <InventoryConsumptionTable
            items={items}
            restockedMap={restockedMap}
            soldMap={soldMap}
            disabled={submitting}
            onChangeRestocked={handleChangeRestocked}
            onChangeSold={handleChangeSold}
          />
        </div>
        <div>
          <button onClick={handleSubmit} disabled={submitting || !activeCategory || items.length === 0} style={{ padding: '10px 14px' }}>
            {submitting ? 'Submitting…' : 'Submit for Approval'}
          </button>
          {error && <div style={{ color: '#900', marginTop: 8 }}>{error}</div>}
          {success && <div style={{ color: '#0a7f3b', marginTop: 8 }}>{success}</div>}
        </div>
      </div>
    </div>
  )
}