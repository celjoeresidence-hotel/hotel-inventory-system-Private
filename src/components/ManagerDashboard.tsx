import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

interface OperationalRecordRow {
  id: string;
  entity_type: string;
  status: string;
  data: any;
  financial_amount: number | null;
  created_at: string | null;
  reviewed_at: string | null;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso ?? '—';
  }
}

function formatCurrency(amount: number | null | undefined) {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return '₦0';
  return `₦${n.toLocaleString()}`;
}

export default function ManagerDashboard() {
  const { role, session, isConfigured } = useAuth();
  const canUse = useMemo(() => Boolean(role === 'manager' && isConfigured && session && supabase), [role, isConfigured, session]);

  const [rows, setRows] = useState<OperationalRecordRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchApproved() {
      if (!canUse) return;
      setError(null);
      setLoading(true);
      try {
        const { data, error } = await supabase!
          .from('operational_records')
          .select('*')
          // Removed entity_type filter to include all approved sectors
          .eq('status', 'approved')
          .order('created_at', { ascending: false });
        if (error) {
          setError(error.message);
          return;
        }
        const safe = (data ?? []).map((r: any) => ({
          id: String(r.id),
          entity_type: String(r.entity_type ?? ''),
          status: String(r.status ?? ''),
          data: r.data ?? null,
          financial_amount: typeof r.financial_amount === 'number' ? r.financial_amount : Number(r.financial_amount ?? 0),
          created_at: r.created_at ?? null,
          reviewed_at: r.reviewed_at ?? null,
        })) as OperationalRecordRow[];
        setRows(safe);
      } finally {
        setLoading(false);
      }
    }
    fetchApproved();
  }, [canUse]);

  // Helpers for date checks (use approval date primarily)
  const isToday = (iso: string | null | undefined) => {
    if (!iso) return false;
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  };
  const isCurrentMonth = (iso: string | null | undefined) => {
    if (!iso) return false;
    const d = new Date(iso);
    const now = new Date();
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  };

  const rowsApprovedToday = useMemo(() => rows.filter((r) => isToday(r.reviewed_at ?? r.created_at)), [rows]);
  const rowsApprovedThisMonth = useMemo(() => rows.filter((r) => isCurrentMonth(r.reviewed_at ?? r.created_at)), [rows]);

  // Daily summary
  const roomsRevenueToday = useMemo(
    () => rowsApprovedToday.filter((r) => r.entity_type === 'front_desk').reduce((sum, r) => sum + (Number(r.financial_amount ?? 0) || 0), 0),
    [rowsApprovedToday]
  );
  const barRevenueToday = useMemo(
    () => rowsApprovedToday.filter((r) => r.entity_type === 'bar').reduce((sum, r) => sum + (Number(r.financial_amount ?? 0) || 0), 0),
    [rowsApprovedToday]
  );
  const kitchenCountToday = useMemo(() => rowsApprovedToday.filter((r) => r.entity_type === 'kitchen').length, [rowsApprovedToday]);
  const storekeeperCountToday = useMemo(() => rowsApprovedToday.filter((r) => r.entity_type === 'storekeeper').length, [rowsApprovedToday]);

  // Monthly aggregation
  const roomsMonthlyRevenue = useMemo(
    () => rowsApprovedThisMonth.filter((r) => r.entity_type === 'front_desk').reduce((sum, r) => sum + (Number(r.financial_amount ?? 0) || 0), 0),
    [rowsApprovedThisMonth]
  );
  const barMonthlyRevenue = useMemo(
    () => rowsApprovedThisMonth.filter((r) => r.entity_type === 'bar').reduce((sum, r) => sum + (Number(r.financial_amount ?? 0) || 0), 0),
    [rowsApprovedThisMonth]
  );
  const monthlyRevenueTotal = roomsMonthlyRevenue + barMonthlyRevenue;
  const roomsMonthlyPct = monthlyRevenueTotal > 0 ? (roomsMonthlyRevenue / monthlyRevenueTotal) * 100 : 0;
  const barMonthlyPct = monthlyRevenueTotal > 0 ? (barMonthlyRevenue / monthlyRevenueTotal) * 100 : 0;

  if (role !== 'manager') {
    return (
      <div style={{ maxWidth: 900, margin: '24px auto' }}>
        <h2>Access denied</h2>
        <p>You must be a manager to view this dashboard.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1100, margin: '24px auto' }}>
      <h2>Manager Dashboard — Approved Operational Records</h2>

      {error && (
        <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6, marginTop: 8 }}>
          {error}
        </div>
      )}

      {/* Daily Summary */}
      <h3 style={{ marginTop: 16 }}>Daily Summary</h3>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, minWidth: 220 }}>
          <div style={{ color: '#666' }}>Rooms Revenue (Today)</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{formatCurrency(roomsRevenueToday)}</div>
        </div>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, minWidth: 220 }}>
          <div style={{ color: '#666' }}>Bar Revenue (Today)</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{formatCurrency(barRevenueToday)}</div>
        </div>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, minWidth: 220 }}>
          <div style={{ color: '#666' }}>Kitchen Approvals (Today)</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{kitchenCountToday}</div>
        </div>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, minWidth: 220 }}>
          <div style={{ color: '#666' }}>Storekeeper Approvals (Today)</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{storekeeperCountToday}</div>
        </div>
      </div>

      {/* Monthly Aggregation */}
      <h3>Monthly Aggregation</h3>
      <div style={{ display: 'flex', gap: 16, marginTop: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, minWidth: 220 }}>
          <div style={{ color: '#666' }}>Rooms Revenue (Month)</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{formatCurrency(roomsMonthlyRevenue)}</div>
          <div style={{ color: '#666', fontSize: 12 }}>{roomsMonthlyPct.toFixed(1)}% of total</div>
        </div>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, minWidth: 220 }}>
          <div style={{ color: '#666' }}>Bar Revenue (Month)</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{formatCurrency(barMonthlyRevenue)}</div>
          <div style={{ color: '#666', fontSize: 12 }}>{barMonthlyPct.toFixed(1)}% of total</div>
        </div>
        <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, minWidth: 220 }}>
          <div style={{ color: '#666' }}>Total Approved Records (Month)</div>
          <div style={{ fontSize: 20, fontWeight: 600 }}>{rowsApprovedThisMonth.length}</div>
        </div>
      </div>

      {loading ? (
        <div>Loading approved records...</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Sector</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Record Type</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Room/Item</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Guest/Details</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Check-In</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Check-Out</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Nights</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Amount (₦)</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Approved Date</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Submitted Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sector = r.entity_type || '—';
              const recordTypeKey: string | undefined = r.data?.type;
              const recordType = recordTypeKey === 'guest_check_in'
                ? 'Guest Check-In'
                : recordTypeKey === 'room_booking'
                  ? 'Room Booking'
                  : recordTypeKey || '—';
              const roomOrItem = r.data?.room_number ?? r.data?.stay?.room_id ?? r.data?.item_name ?? '—';
              const guestOrDetails = r.data?.guest?.full_name ?? r.data?.details ?? '—';
              const checkIn = r.data?.stay?.check_in ?? r.data?.start_date ?? null;
              const checkOut = r.data?.stay?.check_out ?? r.data?.end_date ?? null;
              const nights = r.data?.pricing?.nights ?? r.data?.nights ?? '—';
              const amount = r.financial_amount ?? 0;
              const approvedDate = r.reviewed_at ?? null;
              const submittedDate = r.created_at ?? null;
              return (
                <tr key={r.id}>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{sector}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{recordType}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{roomOrItem}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{guestOrDetails}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{formatDate(checkIn)}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{formatDate(checkOut)}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>{Number(nights ?? 0)}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>{formatCurrency(amount)}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{formatDate(approvedDate)}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{formatDate(submittedDate)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} style={{ padding: 12, textAlign: 'center', color: '#666' }}>No approved operational records yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}