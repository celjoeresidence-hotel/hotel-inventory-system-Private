import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Card } from './ui/Card';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { RecordDetails } from './RecordDetails';
import { 
  Table, 
  TableHeader, 
  TableBody, 
  TableRow, 
  TableHead, 
  TableCell 
} from './ui/Table';
import { 
  IconAlertCircle, 
  IconCheckCircle, 
  IconClipboardList, 
  IconCoffee, 
  IconGlass, 
  IconHome, 
  IconBox,
  IconTrendingUp
} from './ui/Icons';

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
    return new Date(iso).toLocaleString('en-NG', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return iso ?? '—';
  }
}

function formatCurrency(amount: number | null | undefined) {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return '₦0.00';
  return `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function ManagerDashboard() {
  const { role, session, isConfigured, ensureActiveSession } = useAuth();
  const canUse = useMemo(() => Boolean(role === 'manager' && isConfigured && session && supabase), [role, isConfigured, session]);

  const [rows, setRows] = useState<OperationalRecordRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<OperationalRecordRow | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  // Metrics State
  const [metricsToday, setMetricsToday] = useState<any>(null);
  const [metricsMonth, setMetricsMonth] = useState<any>(null);

  useEffect(() => {
    async function fetchDashboardData() {
      if (!canUse) return;
      setError(null);
      setLoading(true);
      try {
        const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
        if (!ok) {
          setError('Session expired. Please sign in again.');
          setLoading(false);
          return;
        }

        const todayStr = new Date().toISOString().split('T')[0];
        const startOfMonthStr = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

        // Parallel requests
        const [
          { data: todayData, error: todayError },
          { data: monthData, error: monthError },
          { data: rowsData, error: rowsError }
        ] = await Promise.all([
          // 1. Metrics for Today
          supabase!.rpc('get_dashboard_metrics', {
            _start_date: todayStr,
            _end_date: todayStr
          }),
          // 2. Metrics for Month
          supabase!.rpc('get_dashboard_metrics', {
            _start_date: startOfMonthStr,
            _end_date: todayStr
          }),
          // 3. Recent Records
          supabase!
            .from('operational_records')
            .select('*')
            .eq('status', 'approved')
            .order('created_at', { ascending: false })
            .limit(100)
        ]);

        if (todayError) throw todayError;
        if (monthError) throw monthError;
        if (rowsError) throw rowsError;

        setMetricsToday(todayData);
        setMetricsMonth(monthData);

        const safeRows = (rowsData ?? []).map((r: any) => ({
          id: String(r.id),
          entity_type: String(r.entity_type ?? ''),
          status: String(r.status ?? ''),
          data: r.data ?? null,
          financial_amount: typeof r.financial_amount === 'number' ? r.financial_amount : Number(r.financial_amount ?? 0),
          created_at: r.created_at ?? null,
          reviewed_at: r.reviewed_at ?? null,
        })) as OperationalRecordRow[];
        setRows(safeRows);

      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchDashboardData();
  }, [canUse]);

  // Use metrics from RPC
  const roomsRevenueToday = metricsToday?.total_revenue ?? 0;
  const roomsMonthlyRevenue = metricsMonth?.total_revenue ?? 0;
  
  const barCountToday = metricsToday?.bar_orders ?? 0;
  const barCountMonth = metricsMonth?.bar_orders ?? 0;

  const kitchenCountToday = metricsToday?.kitchen_orders ?? 0;
  // const kitchenCountMonth = metricsMonth?.kitchen_orders ?? 0; 

  const storekeeperCountToday = metricsToday?.store_moves ?? 0;
  // const storekeeperCountMonth = metricsMonth?.store_moves ?? 0;

  if (role !== 'manager') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8 animate-fade-in">
        <div className="bg-error-light text-error p-4 rounded-full mb-4 shadow-sm">
          <IconAlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Restricted</h2>
        <p className="text-gray-500 max-w-md">You must be a manager to view this dashboard.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto p-4 md:p-8 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Manager Dashboard</h1>
          <p className="text-gray-500 mt-1">Overview of daily operations and approved records.</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-gray-500 bg-white px-3 py-1.5 rounded-full shadow-sm border border-gray-100">
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          Live Data
        </div>
      </div>

      {error && (
        <div className="bg-error-light border border-error-light text-error px-4 py-3 rounded-lg flex items-start gap-3 shadow-sm">
          <IconAlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="p-5 flex flex-col justify-between hover:shadow-lg transition-all duration-300 border-t-4 border-t-green-500 shadow-md">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Rooms Revenue</p>
              <p className="text-xs text-gray-400">Today</p>
            </div>
            <div className="p-2.5 bg-green-50 text-green-600 rounded-xl">
              <IconHome className="w-6 h-6" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-2xl font-bold text-gray-900">{formatCurrency(roomsRevenueToday)}</h3>
          </div>
          <div className="mt-2 text-xs text-gray-500 border-t pt-2 border-gray-100 flex justify-between items-center">
             <span>Month Total</span>
             <span className="font-semibold text-green-700">{formatCurrency(roomsMonthlyRevenue)}</span>
          </div>
        </Card>

        <Card className="p-5 flex flex-col justify-between hover:shadow-lg transition-all duration-300 border-t-4 border-t-green-500 shadow-md">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Bar Orders</p>
              <p className="text-xs text-gray-400">Today</p>
            </div>
            <div className="p-2.5 bg-green-50 text-green-600 rounded-xl">
              <IconGlass className="w-6 h-6" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-2xl font-bold text-gray-900">{barCountToday}</h3>
            <span className="text-sm text-gray-500">approved</span>
          </div>
           <div className="mt-2 text-xs text-gray-500 border-t pt-2 border-gray-100 flex justify-between items-center">
             <span>Month Total</span>
             <span className="font-semibold text-green-700">{barCountMonth}</span>
          </div>
        </Card>

        <Card className="p-5 flex flex-col justify-between hover:shadow-lg transition-all duration-300 border-t-4 border-t-green-500 shadow-md">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Kitchen Orders</p>
              <p className="text-xs text-gray-400">Today</p>
            </div>
            <div className="p-2.5 bg-green-50 text-green-600 rounded-xl">
              <IconCoffee className="w-6 h-6" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-2xl font-bold text-gray-900">{kitchenCountToday}</h3>
            <span className="text-sm text-gray-500">approved</span>
          </div>
           <div className="mt-2 text-xs text-gray-500 border-t pt-2 border-gray-100 flex items-center gap-1">
             <IconTrendingUp className="w-3 h-3 text-green-500" />
             <span>Active today</span>
          </div>
        </Card>

        <Card className="p-5 flex flex-col justify-between hover:shadow-lg transition-all duration-300 border-t-4 border-t-green-500 shadow-md">
          <div className="flex justify-between items-start mb-4">
            <div>
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wider">Stock Moves</p>
              <p className="text-xs text-gray-400">Today</p>
            </div>
            <div className="p-2.5 bg-green-50 text-green-600 rounded-xl">
              <IconBox className="w-6 h-6" />
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-2xl font-bold text-gray-900">{storekeeperCountToday}</h3>
            <span className="text-sm text-gray-500">approved</span>
          </div>
           <div className="mt-2 text-xs text-gray-500 border-t pt-2 border-gray-100 flex items-center gap-1">
             <IconCheckCircle className="w-3 h-3 text-green-500" />
             <span>Inventory updated</span>
          </div>
        </Card>
      </div>

      {/* Recent Records Table */}
      <Card className="overflow-hidden border-0 shadow-md">
        <div className="p-6 border-b border-gray-100 bg-white flex items-center justify-between">
          <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <IconClipboardList className="w-5 h-5 text-gray-500" />
            Recent Approved Activity
          </h3>
          <span className="text-xs font-medium px-2.5 py-1 bg-gray-100 text-gray-600 rounded-md">
            Last 100 records
          </span>
        </div>
        
        {loading ? (
          <div className="p-16 text-center text-gray-500 flex flex-col items-center justify-center">
            <div className="w-10 h-10 border-4 border-green-600 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="font-medium">Loading records...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px] sticky left-0 z-20 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Sector</TableHead>
                  <TableHead>Record Type</TableHead>
                  <TableHead>Details</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-32 text-center text-gray-500">
                      No approved operational records found.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((r) => {
                    const sector = r.entity_type || '—';
                    const recordTypeKey: string | undefined = r.data?.type || r.data?.record_type;
                    const recordType = recordTypeKey === 'guest_check_in'
                      ? 'Guest Check-In'
                      : recordTypeKey === 'room_booking'
                        ? 'Room Booking'
                        : recordTypeKey === 'stock_issued'
                        ? 'Stock Issued'
                        : recordTypeKey === 'stock_received'
                        ? 'Stock Received'
                        : recordTypeKey?.replace(/_/g, ' ') || '—';
                        
                    // Determine primary detail text
                    let detailText = '—';
                    let subDetailText = '';
                    
                    if (sector === 'front_desk') {
                       detailText = r.data?.guest?.full_name || 'Guest';
                       subDetailText = `Room ${r.data?.room_number || r.data?.stay?.room_id || '—'}`;
                    } else if (sector === 'storekeeper') {
                       detailText = r.data?.item_name || 'Item';
                       subDetailText = `Qty: ${r.data?.quantity || 0}`;
                    } else {
                       detailText = r.data?.item_name || r.data?.details || '—';
                       subDetailText = r.data?.quantity ? `Qty: ${r.data?.quantity}` : '';
                    }

                    // Determine reference (room number, or just ID)
                    const reference = r.id.substring(0, 8);
                    
                    const amount = r.financial_amount ?? 0;
                    const approvedDate = r.reviewed_at ?? r.created_at;
                    
                    // Unified green palette: use 'success' (green) or 'default' (gray/greenish)
                    const sectorVariant: "default" | "success" | "warning" | "error" | "outline" = 'success';

                    return (
                      <TableRow 
                        key={r.id} 
                        className="group hover:bg-green-50/30 cursor-pointer transition-colors"
                        onClick={() => {
                          setSelectedRecord(r);
                          setShowDetails(true);
                        }}
                      >
                        <TableCell className="sticky left-0 z-10 bg-white group-hover:bg-green-50 transition-colors shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                          <Badge variant={sectorVariant}>
                            {sector.replace('_', ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium text-gray-900 capitalize">
                          {recordType}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col">
                            <span className="text-gray-900 font-medium">{detailText}</span>
                            {subDetailText && (
                              <span className="text-xs text-gray-500">{subDetailText}</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-gray-500 font-mono text-xs">
                          #{reference}
                        </TableCell>
                        <TableCell className="font-bold text-gray-900">
                          {amount > 0 ? formatCurrency(amount) : '—'}
                        </TableCell>
                        <TableCell className="text-gray-500 text-xs">
                          {formatDate(approvedDate)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      <Modal
        isOpen={showDetails && !!selectedRecord}
        onClose={() => setShowDetails(false)}
        title="Record Details"
      >
        {selectedRecord && <RecordDetails record={selectedRecord as any} />}
        <div className="flex justify-end pt-4">
          <button
            onClick={() => setShowDetails(false)}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors font-medium text-sm"
          >
            Close
          </button>
        </div>
      </Modal>
    </div>
  );
}
