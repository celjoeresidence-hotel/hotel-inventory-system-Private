import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

interface OperationalRecordRow {
  id: string;
  entity_type: 'front_desk' | 'kitchen' | 'bar' | 'storekeeper' | string;
  status: 'pending' | 'rejected' | 'approved' | string;
  data: any | null;
  financial_amount: number;
  created_at: string | null;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso ?? '—';
  }
}

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
          <h4>Pricing Breakdown</h4>
          <div>Room Rate: {d?.pricing?.room_rate ?? '—'}</div>
          <div>Nights: {d?.pricing?.nights ?? '—'}</div>
          <div>Total Room Cost: {d?.pricing?.total_room_cost ?? '—'}</div>
        </section>
        <section style={{ marginBottom: 12 }}>
          <h4>Payment Info</h4>
          <div>Paid Amount: {d?.payment?.paid_amount ?? '—'}</div>
          <div>Payment Method: {d?.payment?.payment_method ?? '—'}</div>
          <div>Payment Reference: {d?.payment?.payment_reference ?? '—'}</div>
          <div>Balance: {d?.payment?.balance ?? '—'}</div>
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
        <div>Unit Price: {d?.unit_price ?? '—'}</div>
        <div>Total Amount: {d?.total_amount ?? '—'}</div>
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
  const [records, setRecords] = useState<OperationalRecordRow[]>([]);
  const [selected, setSelected] = useState<OperationalRecordRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [showReject, setShowReject] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  const canUse = useMemo(() => Boolean(isConfigured && session && role === 'supervisor'), [isConfigured, session, role]);

  useEffect(() => {
    async function fetchPending() {
      setError(null);
      setLoadingList(true);
      try {
        if (!canUse || !supabase) return;
        const { data, error } = await supabase
          .from('operational_records')
          .select('id, entity_type, status, data, financial_amount, created_at')
          .eq('status', 'pending')
          .order('created_at', { ascending: false });
        if (error) {
          setError(error.message);
          return;
        }
        const safe = (data ?? []).map((r: any) => ({
          id: r?.id,
          entity_type: r?.entity_type,
          status: r?.status,
          data: r?.data ?? null,
          financial_amount: r?.financial_amount ?? 0,
          created_at: r?.created_at ?? null,
        })) as OperationalRecordRow[];
        setRecords(safe);
      } finally {
        setLoadingList(false);
      }
    }
    fetchPending();
  }, [canUse]);

  const groups = useMemo(() => {
    const byType: Record<string, OperationalRecordRow[]> = {};
    for (const r of records) {
      const key = r.entity_type ?? 'unknown';
      if (!byType[key]) byType[key] = [];
      byType[key].push(r);
    }
    return byType;
  }, [records]);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  function toggleGroup(key: string) {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function approve(record: OperationalRecordRow) {
    if (!canUse || !supabase) return;
    setError(null);
    setSuccessMessage('');
    setActionLoading(true);
    try {
      const { error } = await supabase.rpc('api.approve_record', { id: record.id });
      if (error) {
        setError(error.message);
        return;
      }
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
      setSelected(null);
      setShowReject(false);
      setSuccessMessage('Record approved successfully.');
    } finally {
      setActionLoading(false);
    }
  }

  async function reject(record: OperationalRecordRow) {
    if (!canUse || !supabase) return;
    setError(null);
    setSuccessMessage('');
    setActionLoading(true);
    try {
      const reason = rejectReason.trim() || null;
      const { error } = await supabase.rpc('api.reject_record', { _id: record.id, _reason: reason });
      if (error) {
        setError(error.message);
        return;
      }
      setRecords((prev) => prev.filter((r) => r.id !== record.id));
      setSelected(null);
      setRejectReason('');
      setShowReject(false);
      setSuccessMessage('Record rejected successfully.');
    } finally {
      setActionLoading(false);
    }
  }

  if (!canUse) {
    return (
      <div style={{ maxWidth: 720, margin: '24px auto' }}>
        <h2>Access denied</h2>
        <p>You must be logged in as a supervisor to view this page.</p>
      </div>
    );
  }

  const orderedGroupKeys = ['front_desk', 'kitchen', 'bar', 'storekeeper'].filter((k) => groups[k]?.length);
  const noRecords = orderedGroupKeys.length === 0;

  return (
    <div style={{ padding: 16 }}>
      <h2>Supervisor Approval Inbox</h2>
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
      {loadingList ? (
        <div>Loading records...</div>
      ) : noRecords ? (
        <div style={{ color: '#666', marginTop: 12 }}>No pending records.</div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {orderedGroupKeys.map((key) => (
            <div key={key} style={{ border: '1px solid #ddd', borderRadius: 8 }}>
              <div
                onClick={() => toggleGroup(key)}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 12, cursor: 'pointer', background: '#f7f7f7' }}
              >
                <strong style={{ textTransform: 'capitalize' }}>{key.replace('_', ' ')}</strong>
                <span style={{ color: '#555' }}>Pending: {groups[key]?.length ?? 0}</span>
              </div>
              {!collapsed[key] && (
                <div style={{ padding: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      {key === 'front_desk' && (
                        <tr>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Guest</th>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Room</th>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Check-in</th>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Check-out</th>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Submitted</th>
                        </tr>
                      )}
                      {key === 'kitchen' && (
                        <tr>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Item</th>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Date</th>
                          <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Opening</th>
                          <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Restocked</th>
                          <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Sold</th>
                          <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Closing</th>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Submitted</th>
                        </tr>
                      )}
                      {key === 'bar' && (
                        <tr>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Item</th>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Date</th>
                          <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Sold</th>
                          <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Unit Price</th>
                          <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Total Amount</th>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Submitted</th>
                        </tr>
                      )}
                      {key === 'storekeeper' && (
                        <tr>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Item</th>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Date</th>
                          <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Opening</th>
                          <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Restocked</th>
                          <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Issued</th>
                          <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Closing</th>
                          <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Submitted</th>
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {groups[key]!.map((r) => (
                        <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => setSelected(r)}>
                          {key === 'front_desk' && (
                            <>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{r.data?.guest?.full_name ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{r.data?.stay?.room_id ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{r.data?.stay?.check_in ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{r.data?.stay?.check_out ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{formatDate(r.created_at)}</td>
                            </>
                          )}
                          {key === 'kitchen' && (
                            <>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{r.data?.item_name ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{r.data?.date ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>{r.data?.opening_stock ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>{r.data?.restocked ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>{r.data?.sold ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>{r.data?.closing_stock ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{formatDate(r.created_at)}</td>
                            </>
                          )}
                          {key === 'bar' && (
                            <>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{r.data?.item_name ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{r.data?.date ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>{r.data?.sold ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>{r.data?.unit_price ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>{r.data?.total_amount ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{formatDate(r.created_at)}</td>
                            </>
                          )}
                          {key === 'storekeeper' && (
                            <>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{r.data?.item_name ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{r.data?.date ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>{r.data?.opening_stock ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>{r.data?.restocked ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>{r.data?.issued ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>{r.data?.closing_stock ?? '—'}</td>
                              <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{formatDate(r.created_at)}</td>
                            </>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <h2>Details</h2>
        {!selected ? (
          <div style={{ color: '#666' }}>Select a record to view details.</div>
        ) : (
          <div>
            <Details record={selected} />
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button onClick={() => approve(selected!)} disabled={actionLoading}>
                {actionLoading ? 'Working...' : 'Approve'}
              </button>
              <button onClick={() => setShowReject(true)} disabled={actionLoading}>
                Reject
              </button>
            </div>
            {showReject && (
              <div style={{ marginTop: 12 }}>
                <label style={{ display: 'block', marginBottom: 8 }}>Rejection Reason (optional)</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  style={{ width: '100%' }}
                  placeholder="Optionally provide a reason"
                />
                <div style={{ marginTop: 8 }}>
                  <button onClick={() => reject(selected!)} disabled={actionLoading}>
                    {actionLoading ? 'Working...' : 'Submit Rejection'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}