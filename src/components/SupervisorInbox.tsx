import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

interface OperationalRecordRow {
  id: string;
  entity_type: 'front_desk' | 'kitchen' | 'bar' | 'storekeeper' | string;
  status: 'pending' | 'rejected' | 'approved' | string;
  data: any | null;
  created_at: string | null;
  original_id?: string | null;
  submitted_by?: string | null;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso ?? '—';
  }
}

const DEPARTMENT_LABEL: Record<string, string> = {
  front_desk: 'Front Desk',
  kitchen: 'Kitchen',
  bar: 'Bar',
  storekeeper: 'Storekeeper',
};

function Details({ record }: { record: OperationalRecordRow }) {
  const d: any = record.data ?? {};
  const type = record.entity_type;
  if (type === 'front_desk') {
    return (
      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Record Details — Front Desk</h3>
        <section style={{ marginBottom: 12 }}>
          <h4>Guest Info</h4>
          <div>Full Name: {d?.guest?.full_name ?? '—'}</div>
          <div>Phone: {d?.guest?.phone ?? '—'}</div>
          <div>Email: {d?.guest?.email ?? '—'}</div>
          <div>ID Ref: {d?.guest?.id_reference ?? '—'}</div>
        </section>
        <section style={{ marginBottom: 12 }}>
          <h4>Stay Info</h4>
          <div>Room ID: {d?.stay?.room_id ?? '—'}</div>
          <div>Check-in: {d?.stay?.check_in ?? '—'}</div>
          <div>Check-out: {d?.stay?.check_out ?? '—'}</div>
          <div>Adults: {d?.stay?.adults ?? '—'}</div>
          <div>Children: {d?.stay?.children ?? '—'}</div>
        </section>
        <section style={{ marginBottom: 12 }}>
          <h4>Notes</h4>
          <div>{d?.meta?.notes ?? '—'}</div>
        </section>
        <div>Submitted: {formatDate(record.created_at)}</div>
      </div>
    );
  }
  if (type === 'kitchen') {
    return (
      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Record Details — Kitchen</h3>
        <div>Date: {d?.date ?? '—'}</div>
        <div>Item: {d?.item_name ?? '—'}</div>
        <div>Opening: {d?.opening_stock ?? '—'}</div>
        <div>Restocked: {d?.restocked ?? '—'}</div>
        <div>Sold: {d?.sold ?? '—'}</div>
        <div>Closing: {d?.closing_stock ?? '—'}</div>
        <div>Notes: {d?.notes ?? '—'}</div>
        <div style={{ marginTop: 8 }}>Submitted: {formatDate(record.created_at)}</div>
      </div>
    );
  }
  if (type === 'bar') {
    return (
      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Record Details — Bar</h3>
        <div>Date: {d?.date ?? '—'}</div>
        <div>Item: {d?.item_name ?? '—'}</div>
        <div>Opening: {d?.opening_stock ?? '—'}</div>
        <div>Restocked: {d?.restocked ?? '—'}</div>
        <div>Sold: {d?.sold ?? '—'}</div>
        <div>Closing: {d?.closing_stock ?? '—'}</div>
        <div>Notes: {d?.notes ?? '—'}</div>
        <div style={{ marginTop: 8 }}>Submitted: {formatDate(record.created_at)}</div>
      </div>
    );
  }
  if (type === 'storekeeper') {
    return (
      <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
        <h3 style={{ marginTop: 0 }}>Record Details — Storekeeper</h3>
        <div>Date: {d?.date ?? '—'}</div>
        <div>Item: {d?.item_name ?? '—'}</div>
        <div>Opening: {d?.opening_stock ?? '—'}</div>
        <div>Restocked: {d?.restocked ?? '—'}</div>
        <div>Issued: {d?.issued ?? '—'}</div>
        <div>Closing: {d?.closing_stock ?? '—'}</div>
        <div>Notes: {d?.notes ?? '—'}</div>
        <div style={{ marginTop: 8 }}>Submitted: {formatDate(record.created_at)}</div>
      </div>
    );
  }
  return (
    <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Record Details</h3>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(d ?? {}, null, 2)}</pre>
      <div>Submitted: {formatDate(record.created_at)}</div>
    </div>
  );
}

export default function SupervisorInbox() {
  const { session, role, isConfigured } = useAuth();
  // removed: const [activeTab, setActiveTab] = useState<'approvals' | 'config'>('approvals');
  const [records, setRecords] = useState<OperationalRecordRow[]>([]);
  const [selected, setSelected] = useState<OperationalRecordRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [showReject, setShowReject] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  // Filters & drawer state
  const [filterDept, setFilterDept] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [showDrawer, setShowDrawer] = useState<boolean>(false);

  const [profilesMap, setProfilesMap] = useState<Record<string, { full_name: string | null; role: string | null }>>({});

  const canUse = useMemo(() => Boolean(isConfigured && session && role === 'supervisor'), [isConfigured, session, role]);

  // Entity type filter options derived from pending records
  const typeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of records) {
      const t = (r as any)?.data?.type;
      if (t) s.add(String(t));
    }
    return Array.from(s);
  }, [records]);

  // Apply type filter to the fetched records
  const filteredRecords = useMemo(() => {
    if (typeFilter === 'all') return records;
    if (typeFilter === 'none') return records.filter((r) => !(r as any)?.data?.type);
    return records.filter((r) => String((r as any)?.data?.type ?? '') === typeFilter);
  }, [records, typeFilter]);

  useEffect(() => {
    async function fetchPending() {
      setError(null);
      setLoadingList(true);
      try {
        const sb = supabase;
        if (!canUse || !sb) return;
        let query = sb
          .from('operational_records')
          .select('id, entity_type, status, data, created_at, original_id, submitted_by')
          .eq('status', 'pending');
        if (filterDept !== 'all') {
          query = query.eq('entity_type', filterDept);
        }
        if (fromDate) {
          const fromIso = new Date(fromDate).toISOString();
          query = query.gte('created_at', fromIso);
        }
        if (toDate) {
          const toIso = new Date(`${toDate}T23:59:59.999Z`).toISOString();
          query = query.lte('created_at', toIso);
        }
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) {
          setError(error.message);
          return;
        }
        const safe = (data ?? []).map((r: any) => ({
          id: r?.id,
          entity_type: r?.entity_type,
          status: r?.status,
          data: r?.data ?? null,
          created_at: r?.created_at ?? null,
          original_id: r?.original_id ?? null,
          submitted_by: r?.submitted_by ?? null,
        })) as OperationalRecordRow[];
        setRecords(safe);
        const ids = Array.from(new Set(safe.map((r) => r.submitted_by).filter(Boolean))) as string[];
        if (ids.length) {
          const { data: profs, error: pErr } = await sb
            .from('profiles')
            .select('id, full_name, role')
            .in('id', ids);
          if (!pErr && profs) {
            const map: Record<string, { full_name: string | null; role: string | null }> = {};
            for (const p of profs as any[]) {
              map[p.id] = { full_name: p.full_name ?? null, role: p.role ?? null };
            }
            setProfilesMap(map);
          }
        }
      } finally {
        setLoadingList(false);
      }
    }
    fetchPending();
  }, [canUse, filterDept, fromDate, toDate]);

  const groupsByOriginal = useMemo(() => {
    const byOrig: Record<string, OperationalRecordRow[]> = {};
    for (const r of filteredRecords) {
      const key = (r.original_id ?? r.id) as string;
      if (!byOrig[key]) byOrig[key] = [];
      byOrig[key].push(r);
    }
    return byOrig;
  }, [filteredRecords]);

  const orderedGroupKeys = useMemo(() => Object.keys(groupsByOriginal).sort((a, b) => {
    const ra = groupsByOriginal[a]?.[0];
    const rb = groupsByOriginal[b]?.[0];
    return (rb?.created_at ? new Date(rb.created_at).getTime() : 0) - (ra?.created_at ? new Date(ra.created_at).getTime() : 0);
  }), [groupsByOriginal]);

  // removed: collapsed state
  // removed: const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  // removed: function toggleGroup(key: string) {
  //   setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  // }

  async function approveGroup(originalId: string) {
    const sb = supabase;
    if (!canUse || !sb) return;
    setError(null);
    setSuccessMessage('');
    setActionLoading(true);
    try {
      const group = groupsByOriginal[originalId] || [];
      for (const rec of group) {
        const { error } = await sb.rpc('approve_record', { _id: rec.id });
        if (error) {
          setError(error.message);
          return;
        }
      }
      setRecords((prev) => prev.filter((r) => (r.original_id ?? r.id) !== originalId));
      setSelected(null);
      setShowReject(false);
      setSuccessMessage('Record(s) approved successfully.');
    } finally {
      setActionLoading(false);
    }
  }

  async function rejectGroup(originalId: string) {
    const sb = supabase;
    if (!canUse || !sb) return;
    setError(null);
    setSuccessMessage('');
    setActionLoading(true);
    try {
      const reason = rejectReason.trim();
      if (!reason) {
        setError('Rejection requires a non-empty reason.');
        return;
      }
      const group = groupsByOriginal[originalId] || [];
      for (const rec of group) {
        const { error } = await sb.rpc('reject_record', { _id: rec.id, _reason: reason });
        if (error) {
          setError(error.message);
          return;
        }
      }
      setRecords((prev) => prev.filter((r) => (r.original_id ?? r.id) !== originalId));
      setSelected(null);
      setRejectReason('');
      setShowReject(false);
      setSuccessMessage('Record(s) rejected successfully.');
    } finally {
      setActionLoading(false);
    }
  }

  // Configuration Tab State
  // const [category, setCategory] = useState<'food' | 'drink' | 'provision'>('food');
  // const [collectionName, setCollectionName] = useState<string>('');
  // const [itemName, setItemName] = useState<string>('');
  // const [openingQty, setOpeningQty] = useState<number>(0);
  // const [restockQty, setRestockQty] = useState<number>(0);
  // const [restockDate, setRestockDate] = useState<string>('');
  // const [cfgMsg, setCfgMsg] = useState<string>('');
  // const [cfgErr, setCfgErr] = useState<string>('');
  // const [cfgLoading, setCfgLoading] = useState<boolean>(false);

  // async function insertAndApproveStorekeeper(data: any) {
  //   setCfgErr('');
  //   setCfgMsg('');
  //   setCfgLoading(true);
  //   try {
  //     const sb = supabase;
  //     if (!sb) {
  //       setCfgErr('Supabase is not configured.');
  //       return;
  //     }
  //     const { data: inserted, error: insErr } = await sb
  //       .from('operational_records')
  //       .insert({ entity_type: 'storekeeper', data, financial_amount: 0 })
  //       .select()
  //       .single();
  //     if (insErr) {
  //       setCfgErr(insErr.message);
  //       return;
  //     }
  //     const id = (inserted as any)?.id;
  //     if (!id) {
  //       setCfgErr('Failed to insert configuration record.');
  //       return;
  //     }
  //     const { error: aprErr } = await sb.rpc('approve_record', { _id: id });
  //     if (aprErr) {
  //       setCfgErr(aprErr.message);
  //       return;
  //     }
  //     setCfgMsg('Saved successfully.');
  //     setCollectionName('');
  //     setItemName('');
  //     setOpeningQty(0);
  //     setRestockQty(0);
  //     setRestockDate('');
  //   } finally {
  //     setCfgLoading(false);
  //   }
  // }

  function ApprovalsTab() {
    const noRecords = orderedGroupKeys.length === 0;
    return (
      <div>
        {error && (
          <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6, marginTop: 8 }}>
            {error}
          </div>
        )}
        {successMessage && (
          <div style={{ background: '#e6ffed', color: '#0a7f3b', padding: '8px 12px', borderRadius: 6, marginTop: 8 }}>
            {successMessage}
          </div>
        )}
        {/* Filters */}
        <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8, padding: 16, marginTop: 8 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', marginBottom: 6 }}>Department</label>
              <select value={filterDept} onChange={(e) => setFilterDept(e.target.value)} style={{ width: '100%', padding: '8px 10px' }}>
                <option value="all">All</option>
                <option value="front_desk">Front Desk</option>
                <option value="kitchen">Kitchen</option>
                <option value="bar">Bar</option>
                <option value="storekeeper">Storekeeper</option>
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 6 }}>Entity type</label>
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: '100%', padding: '8px 10px' }}>
                <option value="all">All</option>
                <option value="none">None</option>
                {typeOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 6 }}>From date</label>
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ width: '100%', padding: '8px 10px' }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: 6 }}>To date</label>
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ width: '100%', padding: '8px 10px' }} />
            </div>
          </div>
        </div>
        {loadingList ? (
          <div className="table-loading">Loading records...</div>
        ) : noRecords ? (
          <div style={{ color: '#666', marginTop: 12 }}>No pending records.</div>
        ) : (
          <div style={{ background: '#fff', border: '1px solid #ddd', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Entity</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Department</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Submitted by</th>
                  <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Submission date</th>
                  <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {orderedGroupKeys.map((orig) => {
                  const group = groupsByOriginal[orig] || [];
                  const first = group[0];
                  const submittedName = first?.submitted_by ? (profilesMap[first.submitted_by]?.full_name ?? '—') : '—';
                  const department = DEPARTMENT_LABEL[first?.entity_type ?? ''] ?? first?.entity_type ?? '—';
                  return (
                    <tr key={orig}>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{first?.entity_type}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{department}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{submittedName}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{formatDate(first?.created_at)}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>
                        <button
                          className="btn"
                          style={{ background: '#eee', color: '#333', padding: '6px 10px', borderRadius: 6, marginRight: 8 }}
                          onClick={() => { setSelected(first ?? null); setShowDrawer(true); }}
                          disabled={actionLoading}
                        >
                          Details
                        </button>
                        <button
                          className="btn"
                          style={{ background: '#1B5E20', color: '#fff', padding: '6px 10px', borderRadius: 6, marginRight: 8 }}
                          onClick={() => approveGroup(orig)}
                          disabled={actionLoading}
                        >
                          Approve
                        </button>
                        <button
                          className="btn"
                          style={{ background: '#eee', color: '#333', padding: '6px 10px', borderRadius: 6 }}
                          onClick={() => { setSelected(first ?? null); setShowReject(true); }}
                          disabled={actionLoading}
                        >
                          Reject
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Side drawer details */}
        {showDrawer && selected && (
          <div style={{ position: 'fixed', top: 0, right: 0, height: '100vh', width: 420, background: '#fff', boxShadow: '-2px 0 12px rgba(0,0,0,0.1)', zIndex: 1000, display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #eee' }}>
              <h3 style={{ margin: 0 }}>Record Details</h3>
              <button className="btn" onClick={() => setShowDrawer(false)} style={{ background: '#eee', color: '#333' }}>Close</button>
            </div>
            <div style={{ padding: 16, overflowY: 'auto' }}>
              <Details record={selected} />
            </div>
          </div>
        )}

        {showReject && selected && (
          <div className="modal-backdrop">
            <div style={{ background: '#fff', padding: 16, borderRadius: 8, width: 480, maxWidth: '90vw' }}>
              <h3 style={{ marginTop: 0 }}>Reject Submission</h3>
              <p style={{ color: '#555' }}>Provide a reason for rejection. This is required.</p>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={3}
                style={{ width: '100%', padding: '8px 10px' }}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                <button className="btn" onClick={() => { setShowReject(false); setRejectReason(''); }} style={{ background: '#eee', color: '#333', padding: '6px 10px', borderRadius: 6 }}>Cancel</button>
                <button className="btn" onClick={() => rejectGroup(selected.original_id ?? selected.id)} style={{ background: '#1B5E20', color: '#fff', padding: '6px 10px', borderRadius: 6 }} disabled={actionLoading}>Confirm Reject</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (!canUse) {
    return (
      <div style={{ maxWidth: 720, margin: '24px auto' }}>
        <h2>Access denied</h2>
        <p>You must be logged in as a supervisor to view this page.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, fontFamily: 'Montserrat, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif', background: '#fff' }}>
      <h2 style={{ marginTop: 0 }}>Pending Approvals</h2>
      <ApprovalsTab />
    </div>
  );
}