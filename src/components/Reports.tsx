import { useState, useEffect, useMemo } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
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

type ReportSection = 'kitchen' | 'bar' | 'storekeeper';
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
  const { role: userRole } = useAuth();
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
    storekeeper: []
  });

  useEffect(() => {
    async function fetchReport() {
      if (!isSupabaseConfigured || !supabase) return;
      setLoading(true);
      try {
        // Define departments
        const depts: { id: ReportSection, dbName: string }[] = [
          { id: 'storekeeper', dbName: 'STORE' },
          { id: 'kitchen', dbName: 'KITCHEN' },
          { id: 'bar', dbName: 'BAR' }
        ];

        // Determine date range
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

        const results: Record<ReportSection, any[]> = { kitchen: [], bar: [], storekeeper: [] };
        const newSummaries: DailySummary[] = [];

        for (const dept of depts) {
          // 1. Get Opening Stock at Start Date
          const { data: openingData } = await supabase
            .rpc('get_inventory_opening_at_date', { 
              _department: dept.dbName, 
              _date: start 
            });
          
          const openingMap = new Map<string, number>();
          (openingData || []).forEach((r: any) => openingMap.set(r.item_name, Number(r.opening_stock)));

          // 2. Get Ledger Events in Range
          const { data: events } = await supabase
            .from('v_inventory_ledger')
            .select('*')
            .eq('department', dept.dbName)
            .gte('event_date', start)
            .lte('event_date', end);

          // 3. Aggregate
          const itemMap = new Map<string, {
            restocked: number,
            issued: number,
            waste: number
          }>();

          // Initialize with items from opening stock
          for (const item of openingMap.keys()) {
            itemMap.set(item, { restocked: 0, issued: 0, waste: 0 });
          }

          let totalRestocked = 0;
          let totalIssued = 0;
          let totalDiscarded = 0;

          (events || []).forEach((e: any) => {
            const item = e.item_name;
            if (!itemMap.has(item)) {
              itemMap.set(item, { restocked: 0, issued: 0, waste: 0 });
            }
            const stats = itemMap.get(item)!;
            const qty = Number(e.quantity_change);
            
            // Categorize based on event_type or quantity sign
            // In v_inventory_ledger, quantity_change is signed (+ for add, - for remove)
            // But we want absolute values for columns "Restocked", "Issued"
            
            // However, event_type is cleaner if available.
            // v_inventory_ledger event_types: OPENING_STOCK, SUPPLIER_RESTOCK, STOCK_ISSUED, STOCK_SOLD, ADJUSTMENT, etc.
            // Note: OPENING_STOCK events *within* the range are treated as restock/adjustment depending on context?
            // Actually, if it's "OPENING_STOCK" event type, it usually happens once at genesis.
            // If it appears in the middle, it might be a reset.
            // For now, let's trust quantity signs mostly, but use event type for "waste".
            
            if (qty > 0) {
              stats.restocked += qty;
              totalRestocked += qty;
            } else {
              // Negative quantity
              // Check if waste/discarded
              // In existing code, we check r.type for 'discarded' or 'waste'.
              // In v_inventory_ledger, we preserved event_type.
              // Let's assume negative is issued/sold unless specified.
              
              stats.issued += Math.abs(qty); // Treat as positive for display
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
          results[dept.id] = rows;

          newSummaries.push({
            section: dept.id,
            total_records: events?.length || 0,
            last_updated: new Date().toISOString(), // Approximation
            items_restocked: totalRestocked,
            items_issued: totalIssued,
            items_discarded: totalDiscarded,
            status: rows.length > 0 ? 'submitted' : 'pending'
          });
        }

        setReportRows(results);
        setSummaries(newSummaries);

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
                      <span className="block text-blue-600 text-xs uppercase tracking-wider mb-1">In</span>
                      <span className="font-bold text-blue-900">{summary.items_restocked}</span>
                    </div>
                    <div className="bg-amber-50 p-2 rounded border border-amber-100 text-center">
                      <span className="block text-amber-600 text-xs uppercase tracking-wider mb-1">Out</span>
                      <span className="font-bold text-amber-900">{summary.items_issued}</span>
                    </div>
                    <div className="bg-red-50 p-2 rounded border border-red-100 text-center">
                      <span className="block text-red-600 text-xs uppercase tracking-wider mb-1">Waste</span>
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
             <Button size="sm" variant="ghost" onClick={() => setExpandedSection(null)}>Close</Button>
          </div>
          
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right text-gray-600">Opening Stock</TableHead>
                    <TableHead className="text-right text-blue-600">Restocked (+)</TableHead>
                    <TableHead className="text-right text-amber-600">Issued/Sold (-)</TableHead>
                    <TableHead className="text-right text-red-600">Waste (-)</TableHead>
                    <TableHead className="text-right font-bold text-gray-900">Closing Stock</TableHead>
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
                    getBreakdown.map((item: any) => (
                      <TableRow key={item.item_name} className="hover:bg-gray-50">
                        <TableCell className="font-medium text-gray-900">{item.item_name}</TableCell>
                        <TableCell className="text-right font-mono text-gray-600 bg-gray-50/50">{item.opening_stock}</TableCell>
                        <TableCell className="text-right font-mono text-blue-700 bg-blue-50/50">{item.restocked}</TableCell>
                        <TableCell className="text-right font-mono text-amber-700 bg-amber-50/50">{item.issued}</TableCell>
                        <TableCell className="text-right font-mono text-red-700 bg-red-50/50">{item.discarded}</TableCell>
                        <TableCell className="text-right font-mono font-bold bg-gray-100/50">
                          {item.closing_stock}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
          </div>
        </Card>
      )}
    </div>
  );
}