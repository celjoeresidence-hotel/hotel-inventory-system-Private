import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Card } from './ui/Card';
import { 
  IconCurrencyDollar, 
  IconBed, 
  IconCheckSquare, 
  IconAlertCircle, 
  IconLoader,
  IconTrendingUp,
  IconUsers,
  IconBarChart,
  IconClipboardList,
  IconShield,
  IconHistory,
  IconCalendar,
  IconFilter
} from './ui/Icons';
import { Modal } from './ui/Modal';
import { ConfirmationModal } from './ConfirmationModal';
import { Button } from './ui/Button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';
import { useAuth } from '../context/AuthContext';

// Types
interface DashboardData {
  snapshot: {
    revenue: number;
    expense: number;
    net_profit: number;
    occupancy_rate: number;
    active_guests: number;
    pending_approvals: number;
  };
  financial: {
    breakdown: Record<string, number>;
  };
  rooms: {
    top: { room_id: string; revenue: number; bookings: number }[];
    worst: { room_id: string; revenue: number; bookings: number }[];
  };
  ops: {
    anomalies: any[];
    shrinkage: any[];
  };
  risk: {
    rejected: any[];
    cancelled: any[];
  };
}

export default function AdminDashboard() {
  const { role } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [interruptedSummary, setInterruptedSummary] = useState<{ pending: number; totalCredit: number; resumed: number; refunded: number }>({ pending: 0, totalCredit: 0, resumed: 0, refunded: 0 });
  
  // Date Filter State
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>(() => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10); // Start of month
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10); // End of month
    return { start, end };
  });

  const [roomNames, setRoomNames] = useState<Record<string, string>>({});

  // Drill-down State
  const [showPendingModal, setShowPendingModal] = useState(false);
  const [pendingRecords, setPendingRecords] = useState<any[]>([]);
  const [loadingPending, setLoadingPending] = useState(false);
  
  // Approval State
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [isApproving, setIsApproving] = useState(false);

  async function handleApprove() {
    if (!confirmingId || !supabase) return;
    setIsApproving(true);
    try {
        const { error } = await supabase.rpc('approve_record', { _id: confirmingId });
        if (error) throw error;
        
        // Remove from list
        setPendingRecords(prev => prev.filter(p => p.id !== confirmingId));
        setConfirmingId(null);
        
        // Refresh dashboard stats
        fetchDashboardData();
    } catch (err: any) {
        console.error("Error approving:", err);
        alert(`Error approving reservation: ${err.message}`);
    } finally {
        setIsApproving(false);
    }
  }

  async function fetchPendingDetails() {
    setLoadingPending(true);
    setShowPendingModal(true);
    try {
        const client = supabase;
        if (!client) return;

        const { data, error } = await client
            .from('operational_records')
            .select('id, entity_type, created_at, data')
            .eq('status', 'pending')
            .is('deleted_at', null)
            .order('created_at', { ascending: false })
            .limit(50);
      
        if (error) throw error;
        setPendingRecords(data || []);
    } catch (err) {
        console.error("Error fetching pending:", err);
    } finally {
        setLoadingPending(false);
    }
  }

  useEffect(() => {
    fetchDashboardData();
  }, [dateRange]);

  async function fetchDashboardData() {
    setLoading(true);
    setError(null);
    try {
      const client = supabase;
      if (!client) throw new Error('Supabase client not initialized');

      // Parallel Fetching for "Intelligence Layers"
      const [
        revenueRes, 
        pendingRes,
        activeGuestRes,
        roomsRes,
        opsRes,
        riskRes,
        interruptedRes,
        refundsRes,
        resumedRes
      ] = await Promise.all([
        // 1. Financials (Approved records in date range)
        client.from('operational_records')
          .select('id, entity_type, financial_amount, data, created_at')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .gte('created_at', dateRange.start)
          .lte('created_at', dateRange.end + 'T23:59:59'),
        
        // 2. Pending Approvals (All time)
        client.from('operational_records')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'pending')
          .is('deleted_at', null),

        // 3. Active Guests (Current)
        client.from('operational_records')
          .select('data')
          .eq('entity_type', 'front_desk')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .filter('data->>type', 'eq', 'room_booking'),

        // 4. Rooms (Approved bookings in range)
        client.from('operational_records')
            .select('data, financial_amount')
            .eq('entity_type', 'front_desk')
            .eq('status', 'approved')
            .is('deleted_at', null)
            .filter('data->>type', 'eq', 'room_booking')
            .gte('created_at', dateRange.start)
            .lte('created_at', dateRange.end + 'T23:59:59'),

        // 5. Ops (Stock outs & Adjustments)
        client.from('operational_records')
            .select('*')
            .in('entity_type', ['bar', 'kitchen', 'storekeeper'])
            .eq('status', 'approved')
            .is('deleted_at', null)
            .gte('created_at', dateRange.start)
            .lte('created_at', dateRange.end + 'T23:59:59'),

        // 6. Risk (Rejected & Cancelled)
        client.from('operational_records')
          .select('*')
          .or('status.eq.rejected,deleted_at.not.is.null')
          .gte('created_at', dateRange.start)
          .lte('created_at', dateRange.end + 'T23:59:59')
        ,
        // 7. Interrupted Stays Credits
        client.from('operational_records')
          .select('id, data')
          .eq('entity_type', 'front_desk')
          .is('deleted_at', null)
          .filter('data->>type', 'eq', 'interrupted_stay_credit'),
        // 8. Refunds from credits
        client.from('operational_records')
          .select('id, data, financial_amount, created_at')
          .eq('entity_type', 'front_desk')
          .is('deleted_at', null)
          .filter('data->>type', 'eq', 'refund_record')
          .gte('created_at', dateRange.start)
          .lte('created_at', dateRange.end + 'T23:59:59'),
        // 9. Resumed bookings marked
        client.from('operational_records')
          .select('id, data, created_at')
          .eq('entity_type', 'front_desk')
          .is('deleted_at', null)
          .filter('data->>type', 'eq', 'room_booking')
          .gte('created_at', dateRange.start)
          .lte('created_at', dateRange.end + 'T23:59:59')
      ]);

      if (revenueRes.error) throw revenueRes.error;
      
      // --- Process Snapshot ---
      let totalRevenue = 0;
      let totalExpense = 0; // Placeholder if we find expenses
      const revenueByDept: Record<string, number> = {};
      
      revenueRes.data?.forEach(r => {
        const amt = Number(r.financial_amount || 0);
        if (amt > 0) {
            totalRevenue += amt;
            const dept = r.entity_type || 'other';
            revenueByDept[dept] = (revenueByDept[dept] || 0) + amt;
        } else {
            totalExpense += Math.abs(amt);
        }
      });

      // Active Guests Calculation
      const today = new Date().toISOString().slice(0, 10);
      const activeGuests = new Set();
      let occupiedRooms = 0;
      
      activeGuestRes.data?.forEach(r => {
        const stay = r.data?.stay;
        if (stay && stay.check_in <= today && stay.check_out > today) {
            if (r.data.guest?.id) activeGuests.add(r.data.guest.id);
            occupiedRooms++;
        }
      });

      // Occupancy Rate (Need total rooms)
      const { count: totalRooms } = await client.from('rooms').select('id', { count: 'exact', head: true }).eq('is_active', true);
      const occupancyRate = totalRooms ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

      // --- Process Rooms ---
      const roomStats: Record<string, { revenue: number, bookings: number }> = {};
      roomsRes.data?.forEach(r => {
          const roomId = r.data?.stay?.room_id;
          if (roomId) {
              if (!roomStats[roomId]) roomStats[roomId] = { revenue: 0, bookings: 0 };
              roomStats[roomId].revenue += Number(r.financial_amount || 0);
              roomStats[roomId].bookings += 1;
          }
      });
      
      const sortedRooms = Object.entries(roomStats).map(([id, s]) => ({ room_id: id, ...s })).sort((a, b) => b.revenue - a.revenue);
      const topRooms = sortedRooms.slice(0, 5);
      const worstRooms = [...sortedRooms].reverse().slice(0, 5);

      // Fetch room names
      if (topRooms.length > 0 || worstRooms.length > 0) {
          const ids = [...new Set([...topRooms.map(r => r.room_id), ...worstRooms.map(r => r.room_id)])];
          const { data: rData } = await client.from('rooms').select('id, room_number, room_type').in('id', ids);
          const map: Record<string, string> = {};
          rData?.forEach((r: any) => {
            const num = r.room_number;
            const typ = r.room_type;
            map[r.id] = typ ? `${num} (${typ})` : String(num);
          });
          setRoomNames(map);
      }

      // --- Process Ops ---
      const anomalies = opsRes.data?.filter(r => (r.data?.type || '').includes('adjustment')) || [];
      const shrinkage = opsRes.data?.filter(r => r.data?.type === 'stock_out' && ['waste', 'expired', 'damaged'].includes(r.data?.reason)) || [];

      // --- Process Risk ---
      const rejected = riskRes.data?.filter(r => r.status === 'rejected') || [];
      const cancelled = riskRes.data?.filter(r => r.deleted_at !== null) || [];

      const pendingInterrupted = (interruptedRes.data || []).filter((r: any) => Boolean(r.data?.can_resume));
      const totalPausedCredit = (interruptedRes.data || []).reduce((sum: number, r: any) => sum + Number(r.data?.credit_remaining || 0), 0);
      const resumedThisPeriod = (resumedRes.data || []).filter((r: any) => Boolean(r.data?.meta?.resumed_from_interruption)).length;
      const cancelledOrRefundedCredits = (refundsRes.data || []).length;

      setData({
        snapshot: {
          revenue: totalRevenue,
          expense: totalExpense,
          net_profit: totalRevenue - totalExpense,
          occupancy_rate: occupancyRate,
          active_guests: activeGuests.size,
          pending_approvals: pendingRes.count || 0
        },
        financial: {
          breakdown: revenueByDept
        },
        rooms: {
            top: topRooms,
            worst: worstRooms
        },
        ops: {
            anomalies,
            shrinkage
        },
        risk: {
            rejected,
            cancelled
        }
      });
      setInterruptedSummary({
        pending: pendingInterrupted.length,
        totalCredit: totalPausedCredit,
        resumed: resumedThisPeriod,
        refunded: cancelledOrRefundedCredits
      });

    } catch (err: any) {
      console.error(err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' }).format(val);

  if (loading && !data) return <div className="p-8 flex justify-center"><IconLoader className="animate-spin w-8 h-8 text-green-600" /></div>;
  if (error) return <div className="p-8 text-red-600">Error loading dashboard: {error}</div>;
  if (!data) return null;

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-8 pb-20">
      {/* Header & Filter */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
            <h1 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
                <IconShield size={32} className="text-green-700" />
                Intelligence Center
            </h1>
            <p className="text-gray-500 mt-1">Operational oversight and analytics</p>
        </div>
        
        <div className="flex items-center gap-2 bg-white p-2 rounded-lg shadow-sm border border-gray-200">
            <IconCalendar size={18} className="text-gray-400" />
            <input 
                type="date" 
                value={dateRange.start}
                onChange={e => setDateRange(prev => ({ ...prev, start: e.target.value }))}
                className="border-none text-sm focus:ring-0 text-gray-600"
            />
            <span className="text-gray-400">-</span>
            <input 
                type="date" 
                value={dateRange.end}
                onChange={e => setDateRange(prev => ({ ...prev, end: e.target.value }))}
                className="border-none text-sm focus:ring-0 text-gray-600"
            />
            <button onClick={() => fetchDashboardData()} className="p-1 hover:bg-gray-100 rounded">
                <IconFilter size={18} className="text-gray-500" />
            </button>
            <button onClick={() => window.print()} className="ml-2 px-3 py-1.5 rounded bg-gray-900 text-white text-sm hover:bg-gray-800">
                Print Interrupted Report
            </button>
        </div>
      </div>

      {/* 1. Executive Snapshot */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="Total Revenue" value={formatCurrency(data.snapshot.revenue)} icon={<IconCurrencyDollar />} color="green" />
        <StatCard label="Net Profit" value={formatCurrency(data.snapshot.net_profit)} icon={<IconTrendingUp />} color="blue" />
        <StatCard label="Occupancy Rate" value={`${data.snapshot.occupancy_rate}%`} icon={<IconBed />} color="indigo" />
        <StatCard label="Active Guests" value={data.snapshot.active_guests} icon={<IconUsers />} color="purple" />
        <StatCard label="Pending Approvals" value={data.snapshot.pending_approvals} icon={<IconHistory />} color="orange" onClick={fetchPendingDetails} />
      </div>

      {/* Interrupted Stays Reporting */}
      <Section title="Interrupted Stays & Credits" icon={<IconAlertCircle />}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatCard label="Pending Interrupted Stays" value={interruptedSummary.pending} icon={<IconAlertCircle />} color="orange" />
          <StatCard label="Total Paused Credits" value={formatCurrency(interruptedSummary.totalCredit)} icon={<IconCurrencyDollar />} color="green" />
          <StatCard label="Resumed This Period" value={interruptedSummary.resumed} icon={<IconCheckSquare />} color="blue" />
          <StatCard label="Refunded Credits" value={interruptedSummary.refunded} icon={<IconHistory />} color="red" />
        </div>
      </Section>

      {/* 2. Financial Intelligence */}
      {['admin', 'manager'].includes(role || '') && (
      <Section title="Financial Performance" icon={<IconBarChart />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-4">
                <h3 className="font-semibold text-gray-700">Revenue by Collection</h3>
                {Object.entries(data.financial.breakdown).map(([key, val]) => (
                    <div key={key} className="flex items-center gap-4">
                        <div className="w-24 capitalize text-sm text-gray-600">{key.replace('_', ' ')}</div>
                        <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                            <div 
                                className="h-full bg-green-500" 
                                style={{ width: `${(val / data.snapshot.revenue) * 100}%` }}
                            />
                        </div>
                        <div className="w-20 text-right text-sm font-medium">{formatCurrency(val)}</div>
                    </div>
                ))}
            </div>
            <div className="bg-gray-50 p-6 rounded-xl flex flex-col justify-center items-center text-center">
                <p className="text-gray-500 mb-2">Total Income vs Expenses</p>
                <div className="text-3xl font-bold text-gray-900 mb-1">{formatCurrency(data.snapshot.revenue)}</div>
                <div className="text-sm text-red-500">Expenses: {formatCurrency(data.snapshot.expense)}</div>
                <div className="mt-4 text-xs text-gray-400">Net Profit Margin: {data.snapshot.revenue ? Math.round((data.snapshot.net_profit / data.snapshot.revenue) * 100) : 0}%</div>
            </div>
        </div>
      </Section>
      )}

      {/* 3. Rooms Intelligence */}
      {['admin', 'manager'].includes(role || '') && (
      <Section title="Rooms & Occupancy" icon={<IconBed />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Top Performing Rooms</h4>
                <div className="space-y-3">
                    {data.rooms.top.map((r, i) => (
                        <div key={i} className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-lg shadow-sm">
                            <div className="flex items-center gap-3">
                                <span className="w-6 h-6 flex items-center justify-center bg-green-100 text-green-700 font-bold text-xs rounded-full">{i + 1}</span>
                                <span className="font-medium">Room {roomNames[r.room_id] || 'Unknown Room'}</span>
                            </div>
                            <div className="text-right">
                                <div className="font-bold text-gray-900">{formatCurrency(r.revenue)}</div>
                                <div className="text-xs text-gray-500">{r.bookings} bookings</div>
                            </div>
                        </div>
                    ))}
                    {data.rooms.top.length === 0 && <p className="text-sm text-gray-400">No data available</p>}
                </div>
            </div>
            <div>
                <h4 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Underperforming Rooms</h4>
                <div className="space-y-3">
                    {data.rooms.worst.map((r, i) => (
                        <div key={i} className="flex justify-between items-center p-3 bg-white border border-gray-100 rounded-lg shadow-sm opacity-75">
                            <div className="flex items-center gap-3">
                                <span className="w-6 h-6 flex items-center justify-center bg-gray-100 text-gray-500 font-bold text-xs rounded-full">{i + 1}</span>
                                <span className="font-medium">Room {roomNames[r.room_id] || 'Unknown Room'}</span>
                            </div>
                            <div className="text-right">
                                <div className="font-bold text-gray-900">{formatCurrency(r.revenue)}</div>
                                <div className="text-xs text-gray-500">{r.bookings} bookings</div>
                            </div>
                        </div>
                    ))}
                    {data.rooms.worst.length === 0 && <p className="text-sm text-gray-400">No data available</p>}
                </div>
            </div>
        </div>
      </Section>
      )}

      {/* 4. Operations Health */}
      {['admin', 'supervisor'].includes(role || '') && (
      <Section title="Operations Health" icon={<IconClipboardList />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="border border-red-100 bg-red-50 rounded-xl p-4">
                <h3 className="font-bold text-red-800 flex items-center gap-2 mb-4">
                    <IconAlertCircle size={20} />
                    Shrinkage & Waste
                </h3>
                {data.ops.shrinkage.length > 0 ? (
                    <ul className="space-y-2">
                        {data.ops.shrinkage.map(item => (
                            <li key={item.id} className="text-sm bg-white p-2 rounded border border-red-100 flex justify-between">
                                <span>{item.data.item_name} ({item.data.quantity})</span>
                                <span className="text-red-600 font-medium capitalize">{item.data.reason}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-green-700 flex items-center gap-2">
                        <IconCheckSquare size={16} /> No shrinkage reported in this period.
                    </p>
                )}
            </div>

            <div className="border border-yellow-100 bg-yellow-50 rounded-xl p-4">
                <h3 className="font-bold text-yellow-800 flex items-center gap-2 mb-4">
                    <IconClipboardList size={20} />
                    Operational Anomalies
                </h3>
                {data.ops.anomalies.length > 0 ? (
                    <ul className="space-y-2">
                         {data.ops.anomalies.map(item => (
                            <li key={item.id} className="text-sm bg-white p-2 rounded border border-yellow-100">
                                <div className="font-medium capitalize">{item.data.type.replace('_', ' ')}</div>
                                <div className="text-xs text-gray-500">{new Date(item.created_at).toLocaleDateString()} - {item.data.reason || 'No reason provided'}</div>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-sm text-green-700 flex items-center gap-2">
                        <IconCheckSquare size={16} /> No anomalies detected.
                    </p>
                )}
            </div>
        </div>
      </Section>
      )}

      {/* 5. Risk & Oversight */}
      {['admin'].includes(role || '') && (
      <Section title="Risk & Oversight" icon={<IconShield />}>
        <Table>
            <TableHeader>
                <TableRow>
                    <TableHead>Event Type</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead>Status</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {[...data.risk.rejected, ...data.risk.cancelled].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).slice(0, 10).map(r => (
                    <TableRow key={r.id}>
                        <TableCell className="capitalize font-medium">
                            {r.deleted_at ? 'Cancellation' : 'Rejection'}
                        </TableCell>
                        <TableCell>{new Date(r.created_at).toLocaleDateString()}</TableCell>
                        <TableCell>
                            <span className="text-xs text-gray-500">ID: {r.id.slice(0, 8)}...</span>
                            {r.data?.reason && <div className="text-sm">{r.data.reason}</div>}
                        </TableCell>
                        <TableCell>
                            <span className={`px-2 py-1 rounded-full text-xs font-bold ${r.deleted_at ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'}`}>
                                {r.deleted_at ? 'Deleted' : 'Rejected'}
                            </span>
                        </TableCell>
                    </TableRow>
                ))}
                {[...data.risk.rejected, ...data.risk.cancelled].length === 0 && (
                    <TableRow>
                        <TableCell colSpan={4} className="text-center text-gray-500 py-4">No risk events found.</TableCell>
                    </TableRow>
                )}
            </TableBody>
        </Table>
      </Section>
      )}

      {/* Daily Activities Modal */}
      <Modal
        isOpen={showPendingModal}
        onClose={() => setShowPendingModal(false)}
        title="Daily Activities"
        size="lg"
      >
        {loadingPending ? (
            <div className="flex justify-center p-8"><IconLoader className="animate-spin text-green-600" /></div>
        ) : (
            <div className="max-h-[60vh] overflow-y-auto">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Date</TableHead>
                            <TableHead>Department</TableHead>
                            <TableHead>Type</TableHead>
                            <TableHead>Details</TableHead>
                            <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {pendingRecords.map(r => (
                            <TableRow key={r.id}>
                                <TableCell className="whitespace-nowrap text-xs text-gray-500">
                                    {new Date(r.created_at).toLocaleString()}
                                </TableCell>
                                <TableCell className="capitalize">{r.entity_type}</TableCell>
                                <TableCell className="capitalize">
                                    {r.data?.type?.replace(/_/g, ' ') || 'Record'}
                                </TableCell>
                                <TableCell>
                                    <div className="text-xs text-gray-600 max-w-xs truncate">
                                        {r.data?.type === 'room_reservation' ? (
                                            <span>
                                                <strong>{r.data.guest.name}</strong> - Room {r.data.room_number} <br/>
                                                {r.data.check_in_date} to {r.data.check_out_date}
                                            </span>
                                        ) : (
                                            r.data?.description || r.data?.reason || JSON.stringify(r.data)
                                        )}
                                    </div>
                                </TableCell>
                                <TableCell className="text-right">
                                    <Button 
                                        size="sm" 
                                        variant="outline" 
                                        className="text-green-600 hover:bg-green-50 border-green-200 h-8"
                                        onClick={() => setConfirmingId(r.id)}
                                    >
                                        Approve
                                    </Button>
                                </TableCell>
                            </TableRow>
                        ))}
                        {pendingRecords.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={4} className="text-center text-gray-500 py-4">
                                    No pending approvals found.
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
                <div className="mt-4 flex justify-end">
                    <Button variant="outline" onClick={() => setShowPendingModal(false)}>Close</Button>
                </div>
            </div>
        )}
      </Modal>

      <ConfirmationModal
        isOpen={!!confirmingId}
        onClose={() => setConfirmingId(null)}
        onConfirm={handleApprove}
        title="Confirm Approval"
        message="Are you sure you want to approve this record?"
        confirmLabel="Approve"
        confirmVariant="primary"
        loading={isApproving}
      />

    </div>
  );
}

function StatCard({ label, value, icon, color, onClick }: any) {
    const colors: any = {
        green: 'bg-green-50 text-green-600 border-green-500',
        blue: 'bg-blue-50 text-blue-600 border-blue-500',
        indigo: 'bg-indigo-50 text-indigo-600 border-indigo-500',
        purple: 'bg-purple-50 text-purple-600 border-purple-500',
        orange: 'bg-orange-50 text-orange-600 border-orange-500',
        red: 'bg-red-50 text-red-600 border-red-500',
    };

    return (
        <Card 
            className={`p-4 border-l-4 shadow-sm hover:shadow-md transition-all ${onClick ? 'cursor-pointer' : 'cursor-default'} ${colors[color].replace('bg-', 'border-')}`}
            onClick={onClick}
        >
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
                    <h3 className="text-2xl font-bold text-gray-900 mt-1">{value}</h3>
                </div>
                <div className={`p-2 rounded-lg ${colors[color].split(' ')[0]} ${colors[color].split(' ')[1]}`}>
                    {icon}
                </div>
            </div>
        </Card>
    );
}

function Section({ title, icon, children }: any) {
    return (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3 bg-gray-50">
                <div className="text-gray-400">{icon}</div>
                <h2 className="text-lg font-bold text-gray-800">{title}</h2>
            </div>
            <div className="p-6">
                {children}
            </div>
        </div>
    );
}
