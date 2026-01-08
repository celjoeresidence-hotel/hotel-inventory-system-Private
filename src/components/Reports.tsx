import { useState, useEffect, useMemo } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { Card } from './ui/Card';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { 
  IconFileText, 
  IconChevronDown,
  IconChevronRight,
  IconPrinter
} from './ui/Icons';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell
} from './ui/Table';

type ReportSection = 'kitchen' | 'bar' | 'storekeeper' | 'housekeeping' | 'front_desk';
type QueryMode = 'day' | 'range' | 'month' | 'year';

interface DailySummary {
  section: ReportSection;
  total_records: number;
  last_updated: string;
  items_restocked: number;
  items_issued: number; // or sold for bar
  items_discarded: number; // for kitchen/bar
  status: 'submitted' | 'pending'; // Inferred from presence of records
}

export default function Reports() {
  const { role: userRole, ensureActiveSession } = useAuth();
  const [queryMode, setQueryMode] = useState<QueryMode>('day');
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [year, setYear] = useState<string>(() => new Date().getFullYear().toString());

  const [loading, setLoading] = useState<boolean>(false);
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [expandedSection, setExpandedSection] = useState<ReportSection | null>(null);

  const [reportRows, setReportRows] = useState<Record<ReportSection, any[]>>({
    kitchen: [],
    bar: [],
    storekeeper: [],
    housekeeping: [],
    front_desk: []
  });
  const [roomDisplayMap, setRoomDisplayMap] = useState<Record<string, string>>({});
  const [dailyEvents, setDailyEvents] = useState<Record<Exclude<ReportSection, 'housekeeping' | 'front_desk'>, any[]>>({
    kitchen: [],
    bar: [],
    storekeeper: []
  });
  const [staffDisplay, setStaffDisplay] = useState<Record<string, { full_name: string; role?: string | null; department?: string | null }>>({});
  const [openingStockMap, setOpeningStockMap] = useState<Record<Exclude<ReportSection, 'housekeeping' | 'front_desk'>, Record<string, number>>>({
    kitchen: {},
    bar: {},
    storekeeper: {}
  });
  const [anomalies, setAnomalies] = useState<Record<Exclude<ReportSection, 'housekeeping' | 'front_desk'>, string[]>>({
    kitchen: [],
    bar: [],
    storekeeper: []
  });

  useEffect(() => {
    async function fetchReport() {
      if (!isSupabaseConfigured || !supabase) return;
      setLoading(true);
      try {
        const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
        if (!ok) {
            toast.error('Session expired. Please sign in again.');
            setLoading(false);
            return;
        }

        const depts: { id: ReportSection, dbName: string }[] = [
          { id: 'storekeeper', dbName: 'STORE' },
          { id: 'kitchen', dbName: 'KITCHEN' },
          { id: 'bar', dbName: 'BAR' }
        ];

        let start = startDate;
        let end = endDate;
        if (queryMode === 'day') {
          end = start;
        } else if (queryMode === 'month') {
          start = `${month}-01`;
          const [y, m] = month.split('-').map(Number);
          end = new Date(y, m, 0).toISOString().split('T')[0]; // Last day of month
        } else if (queryMode === 'year') {
          start = `${year}-01-01`;
          end = `${year}-12-31`;
        }

        const results: Record<ReportSection, any[]> = { kitchen: [], bar: [], storekeeper: [], housekeeping: [], front_desk: [] };
        const newSummaries: DailySummary[] = [];

        // 1. Fetch Inventory Data in Parallel
        const inventoryPromise = Promise.all(depts.map(async (dept) => {
          const [openingRes, eventsRes] = await Promise.all([
            supabase!.rpc('get_inventory_opening_at_date', { _department: dept.dbName, _date: start }),
            supabase!.from('v_inventory_ledger')
              .select('item_name, quantity_change, event_type, unit_price, total_value, submitted_by, staff_name, created_at')
              .eq('department', dept.dbName)
              .gte('event_date', start)
              .lte('event_date', end)
          ]);

          const openingData = openingRes.data || [];
          const events = eventsRes.data || [];
          
          // Aggregation
          const openingMap = new Map<string, number>();
          openingData.forEach((r: any) => openingMap.set(r.item_name, Number(r.opening_stock)));
          
          const itemMap = new Map<string, { restocked: number, issued: number, waste: number }>();
          for (const item of openingMap.keys()) {
            itemMap.set(item, { restocked: 0, issued: 0, waste: 0 });
          }
          
          let totalRestocked = 0;
          let totalIssued = 0;
          const totalDiscarded = 0;
          
          events.forEach((e: any) => {
            const item = e.item_name;
            if (!itemMap.has(item)) itemMap.set(item, { restocked: 0, issued: 0, waste: 0 });
            const stats = itemMap.get(item)!;
            const qty = Number(e.quantity_change);
            if (qty > 0) {
              stats.restocked += qty;
              totalRestocked += qty;
            } else {
              stats.issued += Math.abs(qty);
              totalIssued += Math.abs(qty);
            }
          });
          
          const rows: any[] = [];
          for (const [item, stats] of itemMap.entries()) {
            const open = openingMap.get(item) ?? 0;
            const close = open + stats.restocked - stats.issued; // issued is abs val
            rows.push({
              item_name: item,
              opening_stock: open,
              restocked: stats.restocked,
              issued: stats.issued,
              discarded: stats.waste,
              closing_stock: close
            });
          }
          rows.sort((a, b) => a.item_name.localeCompare(b.item_name));

          const summary: DailySummary = {
            section: dept.id,
            total_records: events.length,
            last_updated: new Date().toISOString(),
            items_restocked: totalRestocked,
            items_issued: totalIssued,
            items_discarded: totalDiscarded,
            status: rows.length > 0 ? 'submitted' : 'pending'
          };

          // Daily Details Logic
          let dailyEvs: any[] = [];
          const dailyOpenMap: Record<string, number> = {};
          const anomaliesList: string[] = [];

          if (queryMode === 'day') {
             dailyEvs = events.map((e: any) => ({
                created_at: e.created_at,
                event_type: e.event_type,
                item_name: e.item_name,
                quantity_change: Number(e.quantity_change) || 0,
                unit_price: Number(e.unit_price) || null,
                total_value: Number(e.total_value) || null,
                submitted_by: e.submitted_by,
                staff_name: e.staff_name
             }));
             openingMap.forEach((v, k) => dailyOpenMap[k] = v);

             // Item Anomalies
             const byItem = new Map<string, { open: number, delta: number }>();
             dailyEvs.forEach(e => {
                const open = dailyOpenMap[e.item_name] || 0;
                const entry = byItem.get(e.item_name) || { open, delta: 0 };
                entry.delta += e.quantity_change;
                byItem.set(e.item_name, entry);
             });
             for (const [name, st] of byItem.entries()) {
                if (st.open + st.delta < 0) {
                   anomaliesList.push(`Negative closing stock for ${name}: ${st.open + st.delta}`);
                }
             }
          }

          return { deptId: dept.id, rows, summary, dailyEvs, dailyOpenMap, anomaliesList, events };
        }));

        // 2. Fetch Housekeeping in Parallel
        const hkPromise = supabase!.from('operational_records')
          .select('id, created_at, status, data')
          .eq('entity_type', 'front_desk')
          .contains('data', { type: 'housekeeping_report' })
          .gte('data->>report_date', start)
          .lte('data->>report_date', end);

        // 3. Fetch Front Desk Events (Extensions & Transfers)
        const fdPromise = supabase!.from('operational_records')
          .select('id, created_at, status, data, submitted_by')
          .eq('entity_type', 'front_desk')
          .in('data->>type', ['stay_extension', 'room_transfer'])
          .gte('data->>date', start)
          .lte('data->>date', end);

        const [invResults, hkRes, fdRes] = await Promise.all([inventoryPromise, hkPromise, fdPromise]);

        // Process Inventory Results
        const allEventsForIdentity: any[] = [];
        const finalAnomalies: Record<string, string[]> = { kitchen: [], bar: [], storekeeper: [] };
        const finalDailyEvents: Record<string, any[]> = { kitchen: [], bar: [], storekeeper: [] };
        const finalOpeningMap: Record<string, Record<string, number>> = { kitchen: {}, bar: {}, storekeeper: {} };

        invResults.forEach(r => {
            results[r.deptId] = r.rows;
            newSummaries.push(r.summary);
            if (r.dailyEvs.length > 0) finalDailyEvents[r.deptId] = r.dailyEvs;
            if (Object.keys(r.dailyOpenMap).length > 0) finalOpeningMap[r.deptId] = r.dailyOpenMap;
            finalAnomalies[r.deptId as Exclude<ReportSection, 'housekeeping'>] = r.anomaliesList;
            if (r.events) allEventsForIdentity.push(...r.events);
        });

        // Cross-Department Anomalies
        if (queryMode === 'day') {
             const storeEvs = invResults.find(r => r.deptId === 'storekeeper')?.events || [];
             const barEvs = invResults.find(r => r.deptId === 'bar')?.events || [];
             const kitEvs = invResults.find(r => r.deptId === 'kitchen')?.events || [];
             
             const recvMap = new Map<string, number>();
             [...barEvs, ...kitEvs].forEach(e => {
                 if (e.event_type === 'RECEIVED_FROM_STORE') {
                     recvMap.set(e.item_name, (recvMap.get(e.item_name) || 0) + Number(e.quantity_change || 0));
                 }
             });
             
             const storeIssued = storeEvs.filter((e: any) => e.event_type === 'ISSUED_TO_DEPT');
             const storeNotes = finalAnomalies['storekeeper'] || [];
             
             storeIssued.forEach((si: any) => {
                 const issuedQty = Math.abs(Number(si.quantity_change || 0));
                 const receivedQty = Math.abs(recvMap.get(si.item_name) || 0);
                 if (issuedQty !== receivedQty) {
                     storeNotes.push(`Mismatch for ${si.item_name}: issued ${issuedQty}, received ${receivedQty}`);
                 }
             });
             finalAnomalies['storekeeper'] = storeNotes;
        }

        // Process Housekeeping
        const hkRecords = hkRes.data || [];
        const hkRows = hkRecords.map((r: any) => {
            const d = r.data || {};
            return {
                id: r.id,
                created_at: r.created_at,
                record_status: r.status,
                report_date: d.report_date,
                room_id: d.room_id,
                room_number: d.room_number || null,
                housekeeping_status: d.housekeeping_status,
                room_condition: d.room_condition,
                maintenance_required: d.maintenance_required ? 'yes' : 'no',
                housekeeper_id: d.housekeeper_id,
                housekeeper_name: d.housekeeper_name,
                notes: d.notes || ''
            };
        }).sort((a: any, b: any) => new Date(b.report_date).getTime() - new Date(a.report_date).getTime());

        results.housekeeping = hkRows;
        
        // HK Summary
        const cleanedCount = hkRows.filter((r: any) => String(r.housekeeping_status).toLowerCase() === 'cleaned').length;
        const dirtyCount = hkRows.filter((r: any) => String(r.housekeeping_status).toLowerCase() === 'dirty').length;
        const maintenanceCount = hkRows.filter((r: any) => String(r.housekeeping_status).toLowerCase() === 'maintenance').length;
        
        newSummaries.push({
          section: 'housekeeping',
          total_records: hkRows.length,
          last_updated: hkRows.length > 0 ? hkRows[0].created_at : new Date().toISOString(),
          items_restocked: cleanedCount,
          items_issued: dirtyCount,
          items_discarded: maintenanceCount,
          status: hkRows.length > 0 ? 'submitted' : 'pending'
        });

        // Process Front Desk Events
        const fdRecords = fdRes.data || [];
        const fdRows = fdRecords.map((r: any) => {
          const d = r.data || {};
          const t = String(d.type || '').toLowerCase();
          const action = t === 'stay_extension' ? 'Stay Extension' : t === 'room_transfer' ? 'Room Transfer' : 'Interrupted Stay Credit';
          const details = t === 'stay_extension'
            ? `New checkout: ${d.extension?.new_check_out} • +${d.extension?.nights_added} night(s)`
            : t === 'room_transfer'
            ? `Room ${d.transfer?.previous_room_id} → ${d.transfer?.new_room_id} • ${d.transfer?.transfer_date}`
            : `Guest: ${d.guest_name} • Credit: ₦${Number(d.credit_remaining || 0).toLocaleString()}`;
          const impact = t === 'stay_extension'
            ? (Number(d.extension?.additional_cost || 0))
            : t === 'room_transfer'
            ? (Number(d.transfer?.new_charge_amount || 0) - Number(d.transfer?.refund_amount || 0))
            : Number(d.credit_remaining || 0);
          return {
            id: r.id,
            created_at: r.created_at,
            record_status: r.status,
            date: d.date,
            action,
            details,
            financial_impact: impact,
            submitted_by: r.submitted_by
          };
        }).sort((a: any, b: any) => new Date(a.date || a.created_at).getTime() - new Date(b.date || b.created_at).getTime());
        results.front_desk = fdRows;

        // FD Summary
        const extCount = fdRows.filter((r: any) => r.action === 'Stay Extension').length;
        const trfCount = fdRows.filter((r: any) => r.action === 'Room Transfer').length;
        const intrCount = fdRows.filter((r: any) => r.action === 'Interrupted Stay Credit').length;
        newSummaries.push({
          section: 'front_desk',
          total_records: fdRows.length,
          last_updated: fdRows.length > 0 ? (fdRows[fdRows.length - 1].created_at || fdRows[fdRows.length - 1].date) : new Date().toISOString(),
          items_restocked: extCount,
          items_issued: trfCount,
          items_discarded: intrCount,
          status: fdRows.length > 0 ? 'submitted' : 'pending'
        });

        // Batch Identity Resolution
        const userIds = new Set<string>();
        allEventsForIdentity.forEach(e => { if (e.submitted_by) userIds.add(e.submitted_by); });
        hkRows.forEach((r: any) => { if (r.housekeeper_id) userIds.add(r.housekeeper_id); });
        fdRows.forEach((r: any) => { if (r.submitted_by) userIds.add(r.submitted_by); });
        
        if (userIds.size > 0) {
           const ids = Array.from(userIds);
           const [profilesRes, staffRes] = await Promise.all([
               supabase!.from('profiles').select('id, full_name, role').in('id', ids),
               supabase!.from('staff_profiles').select('user_id, full_name, role, department').in('user_id', ids)
           ]);
           const map: Record<string, any> = {};
           (profilesRes.data || []).forEach((p: any) => { map[p.id] = { full_name: p.full_name || 'Unknown', role: p.role }; });
           (staffRes.data || []).forEach((s: any) => { 
               map[s.user_id] = { 
                   full_name: s.full_name || map[s.user_id]?.full_name || 'Unknown', 
                   role: s.role || map[s.user_id]?.role, 
                   department: s.department 
               }; 
           });
           setStaffDisplay(map);
        }

        // Batch Room Resolution
        const roomIds = [...new Set(hkRows.map((r: any) => r.room_id).filter(Boolean))];
        if (roomIds.length > 0) {
           const { data: rData } = await supabase!.from('rooms').select('id, room_number, room_type').in('id', roomIds);
           const map: Record<string, string> = {};
           rData?.forEach((r: any) => {
             map[r.id] = r.room_type ? `${r.room_number} (${r.room_type})` : String(r.room_number);
           });
           setRoomDisplayMap(map);
        } else {
           setRoomDisplayMap({});
        }

        setReportRows(results);
        setSummaries(newSummaries);
        setDailyEvents(finalDailyEvents as any);
        setOpeningStockMap(finalOpeningMap as any);
        setAnomalies(finalAnomalies as any);

      } catch (err) {
        console.error('Error fetching reports:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchReport();
  }, [queryMode, startDate, endDate, month, year]);

  const toggleExpand = (section: ReportSection) => {
    if (expandedSection === section) setExpandedSection(null);
    else {
      setExpandedSection(section);
      // setViewMode('list'); // Reset view mode when opening
    }
  };

  const sectionLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const getSectionIcon = (s: string) => {
    switch(s) {
      case 'kitchen': return '🍳';
      case 'bar': return '🍹';
      case 'storekeeper': return '📦';
      case 'housekeeping': return '🧹';
      case 'front_desk': return '🛎️';
      default: return '📄';
    }
  };

  const getBreakdown = useMemo(() => {
    if (!expandedSection) return [];
    return reportRows[expandedSection] || [];
  }, [reportRows, expandedSection]);

  const filteredSummaries = useMemo(() => {
    if (!userRole) return [];
    
    // Admin/Manager/Supervisor see all (or whatever RLS returns)
    if (['admin', 'manager', 'supervisor'].includes(userRole)) {
      return summaries;
    }

    // Others see only their section
    return summaries.filter(s => s.section === userRole);
  }, [summaries, userRole]);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <IconFileText className="w-6 h-6 text-green-600" />
            Operational Reports
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {queryMode === 'day' && `Daily report for ${startDate}`}
            {queryMode === 'range' && `Report from ${startDate} to ${endDate}`}
            {queryMode === 'month' && `Monthly report for ${month}`}
            {queryMode === 'year' && `Annual report for ${year}`}
          </p>
        </div>
        
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3 bg-white p-2 rounded-lg border border-gray-200 shadow-sm">
           <div className="w-32">
             <Select
               value={queryMode}
               onChange={(e) => setQueryMode(e.target.value as QueryMode)}
               fullWidth
               options={[
                 { value: 'day', label: 'Daily' },
                 { value: 'range', label: 'Date Range' },
                 { value: 'month', label: 'Monthly' },
                 { value: 'year', label: 'Yearly' },
               ]}
             />
           </div>

           {queryMode === 'day' && (
             <Input 
               type="date" 
               value={startDate} 
               onChange={(e) => setStartDate(e.target.value)}
               className="w-40"
             />
           )}

           {queryMode === 'range' && (
             <div className="flex items-center gap-2">
               <Input 
                 type="date" 
                 value={startDate} 
                 onChange={(e) => setStartDate(e.target.value)}
                 className="w-36"
               />
               <span className="text-gray-400">-</span>
               <Input 
                 type="date" 
                 value={endDate} 
                 onChange={(e) => setEndDate(e.target.value)}
                 className="w-36"
               />
             </div>
           )}

           {queryMode === 'month' && (
             <Input 
               type="month" 
               value={month} 
               onChange={(e) => setMonth(e.target.value)}
               className="w-40"
             />
           )}

           {queryMode === 'year' && (
             <Input 
               type="number" 
               min="2020"
               max="2030"
               value={year} 
               onChange={(e) => setYear(e.target.value)}
               className="w-24"
             />
           )}

          <Button variant="outline" onClick={() => window.print()} title="Print Report">
            <IconPrinter className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {loading ? (
           [1, 2, 3].map(i => (
             <Card key={i} className="p-6 flex flex-col items-center justify-center h-40 animate-pulse">
               <div className="w-10 h-10 bg-gray-200 rounded-full mb-3"></div>
               <div className="w-24 h-4 bg-gray-200 rounded mb-2"></div>
               <div className="w-16 h-3 bg-gray-200 rounded"></div>
             </Card>
           ))
        ) : (
          filteredSummaries.map((summary) => (
            <Card 
              key={summary.section} 
              className={`
                p-0 overflow-hidden transition-all duration-200 border cursor-pointer hover:shadow-md
                ${expandedSection === summary.section ? 'ring-2 ring-green-500 border-transparent' : 'border-gray-200'}
              `}
              onClick={() => toggleExpand(summary.section)}
            >
              <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                  <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center text-2xl border border-gray-100">
                    {getSectionIcon(summary.section)}
                  </div>
                  <Badge variant={summary.status === 'submitted' ? 'success' : 'default'}>
                    {summary.status === 'submitted' ? 'Data Available' : 'No Data'}
                  </Badge>
                </div>
                
                <h3 className="text-lg font-bold text-gray-900 mb-1">{sectionLabel(summary.section)}</h3>
                <p className="text-sm text-gray-500 mb-4">
                  {summary.status === 'submitted' 
                    ? `Last activity: ${new Date(summary.last_updated).toLocaleDateString()} ${new Date(summary.last_updated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` 
                    : 'No records found for this period'}
                </p>

                {summary.status === 'submitted' && (
                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div className="bg-blue-50 p-2 rounded border border-blue-100 text-center">
                      <span className="block text-blue-600 text-xs uppercase tracking-wider mb-1">
                        {summary.section === 'housekeeping' ? 'Cleaned' : summary.section === 'front_desk' ? 'Extensions' : 'In'}
                      </span>
                      <span className="font-bold text-blue-900">{summary.items_restocked}</span>
                    </div>
                    <div className="bg-amber-50 p-2 rounded border border-amber-100 text-center">
                      <span className="block text-amber-600 text-xs uppercase tracking-wider mb-1">
                        {summary.section === 'housekeeping' ? 'Dirty' : summary.section === 'front_desk' ? 'Transfers' : 'Out'}
                      </span>
                      <span className="font-bold text-amber-900">{summary.items_issued}</span>
                    </div>
                    <div className="bg-red-50 p-2 rounded border border-red-100 text-center">
                      <span className="block text-red-600 text-xs uppercase tracking-wider mb-1">
                        {summary.section === 'housekeeping' ? 'Maintenance' : summary.section === 'front_desk' ? 'Adjustments' : 'Waste'}
                      </span>
                      <span className="font-bold text-red-900">{summary.items_discarded}</span>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="bg-gray-50 p-3 border-t border-gray-100 flex items-center justify-center text-sm font-medium text-gray-600 hover:text-green-700 hover:bg-green-50 transition-colors">
                 {expandedSection === summary.section ? 'Hide Details' : 'View Details'}
                 {expandedSection === summary.section ? <IconChevronDown className="w-4 h-4 ml-1" /> : <IconChevronRight className="w-4 h-4 ml-1" />}
              </div>
            </Card>
          ))
        )}
      </div>

      {expandedSection && (
        <Card className="overflow-hidden animate-in slide-in-from-top-4 duration-300">
          <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
             <div className="flex items-center gap-4">
               <h3 className="font-bold text-gray-900 flex items-center gap-2">
                 <span>{getSectionIcon(expandedSection)}</span>
                 {sectionLabel(expandedSection)} Details
               </h3>
             </div>
             <div className="flex items-center gap-2">
               <Button size="sm" variant="outline" title="Print this department" onClick={() => window.print()}>Print</Button>
               <Button size="sm" variant="ghost" onClick={() => setExpandedSection(null)}>Close</Button>
             </div>
          </div>
          
          {expandedSection === 'housekeeping' ? (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Room</TableHead>
                    <TableHead>Housekeeper</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Condition</TableHead>
                    <TableHead>Maintenance</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Record Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getBreakdown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                        No data available for this period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    getBreakdown.map((row: any) => (
                      <TableRow key={row.id} className="hover:bg-gray-50">
                        <TableCell className="font-mono text-gray-700">{row.report_date}</TableCell>
                        <TableCell className="font-medium text-gray-900">{roomDisplayMap[row.room_id] || row.room_number || 'Unknown Room'}</TableCell>
                        <TableCell className="text-gray-800">{row.housekeeper_name}</TableCell>
                        <TableCell className="text-gray-800">{row.housekeeping_status}</TableCell>
                        <TableCell className="text-gray-800">{row.room_condition}</TableCell>
                        <TableCell className="text-gray-800">{row.maintenance_required}</TableCell>
                        <TableCell className="text-gray-700">{row.notes}</TableCell>
                        <TableCell className="text-xs uppercase px-2 py-1 rounded-full bg-gray-100 text-gray-700 inline-block">{row.record_status}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          ) : expandedSection === 'front_desk' ? (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Details</TableHead>
                    <TableHead className="text-right">Financial Impact</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getBreakdown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-gray-500">
                        No data available for this period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    getBreakdown.map((row: any) => {
                      const staff = row.submitted_by ? (staffDisplay[row.submitted_by]?.full_name || 'Unknown') : 'Unknown';
                      const dept = row.submitted_by ? staffDisplay[row.submitted_by]?.department : undefined;
                      return (
                        <TableRow key={row.id} className="hover:bg-gray-50">
                          <TableCell className="font-mono text-gray-700">
                            {new Date(row.created_at || row.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </TableCell>
                          <TableCell className="text-gray-800">{dept ? `${staff} (${dept})` : staff}</TableCell>
                          <TableCell className="font-medium text-gray-900">{row.action}</TableCell>
                          <TableCell className="text-gray-700">{row.details}</TableCell>
                          <TableCell className="text-right font-mono text-gray-900">{`₦${Number(row.financial_impact || 0).toLocaleString()}`}</TableCell>
                          <TableCell className="text-xs uppercase px-2 py-1 rounded-full bg-gray-100 text-gray-700 inline-block">{row.record_status}</TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Staff</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="text-right text-gray-600">Opening</TableHead>
                    <TableHead className="text-right text-blue-600">Quantity</TableHead>
                    <TableHead className="text-right text-gray-600">Value</TableHead>
                    <TableHead className="text-right font-bold text-gray-900">Closing</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {queryMode !== 'day' ? (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                        Switch to Daily mode to view auto-generated actions.
                      </TableCell>
                    </TableRow>
                  ) : (
                    (dailyEvents[expandedSection as Exclude<ReportSection, 'housekeeping' | 'front_desk'>] || []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={8} className="text-center py-8 text-gray-500">No actions recorded for this date.</TableCell>
                      </TableRow>
                    ) : (
                      (dailyEvents[expandedSection as Exclude<ReportSection, 'housekeeping' | 'front_desk'>] || []).map((ev: any, idx: number) => {
                        const open = openingStockMap[expandedSection as Exclude<ReportSection, 'housekeeping' | 'front_desk'>]?.[ev.item_name] ?? 0;
                        const closing = open + ev.quantity_change;
                        const staff = ev.submitted_by ? (staffDisplay[ev.submitted_by]?.full_name || ev.staff_name || 'Unknown') : (ev.staff_name || 'Unknown');
                        const dept = staffDisplay[ev.submitted_by || '']?.department;
                        return (
                          <TableRow key={`${ev.item_name}-${idx}`} className="hover:bg-gray-50">
                            <TableCell className="font-mono text-gray-700">{new Date(ev.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</TableCell>
                            <TableCell className="text-gray-800">{dept ? `${staff} (${dept})` : staff}</TableCell>
                            <TableCell className="font-medium text-gray-900">{ev.item_name}</TableCell>
                            <TableCell className="text-gray-700 capitalize">{String(ev.event_type).replace(/_/g, ' ').toLowerCase()}</TableCell>
                            <TableCell className="text-right font-mono text-gray-600">{open}</TableCell>
                            <TableCell className={`text-right font-mono ${ev.quantity_change >= 0 ? 'text-blue-700' : 'text-amber-700'}`}>{Math.abs(ev.quantity_change)}</TableCell>
                            <TableCell className="text-right font-mono text-gray-700">{ev.total_value ? `₦${Number(ev.total_value).toLocaleString()}` : '—'}</TableCell>
                            <TableCell className="text-right font-mono font-bold">{closing}</TableCell>
                          </TableRow>
                        );
                      })
                    )
                  )}
                </TableBody>
              </Table>
              {queryMode === 'day' && (anomalies[expandedSection as Exclude<ReportSection, 'housekeeping' | 'front_desk'>] || []).length > 0 && (
                <div className="p-4 border-t border-gray-100 text-sm text-gray-700">
                  <p className="font-semibold text-gray-900 mb-2">Anomaly Insights</p>
                  {(anomalies[expandedSection as Exclude<ReportSection, 'housekeeping' | 'front_desk'>] || []).map((n, i) => (
                    <div key={i} className="mb-1">• {n}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {queryMode === 'day' && ['admin', 'manager'].includes(userRole || '') && (
        <div className="flex justify-end mt-4">
          <Button variant="outline" onClick={() => window.print()} title="Print Combined Daily Report">Print Combined Daily</Button>
        </div>
      )}
    </div>
  );
}
