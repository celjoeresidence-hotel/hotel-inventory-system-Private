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
  IconPrinter,
  IconPieChart,
  IconList
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

interface DetailRecord {
  id: string;
  type: string;
  item_name: string;
  quantity: number;
  notes?: string;
  created_at: string;
  data: any;
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
  const [details, setDetails] = useState<Record<ReportSection, DetailRecord[]>>({
    kitchen: [],
    bar: [],
    storekeeper: []
  });
  const [expandedSection, setExpandedSection] = useState<ReportSection | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'breakdown'>('list');

  useEffect(() => {
    async function fetchReport() {
      if (!isSupabaseConfigured || !supabase) return;
      setLoading(true);
      try {
        let query = supabase
          .from('operational_records')
          .select('id, entity_type, data, created_at, status, deleted_at')
          .eq('status', 'approved')
          .is('deleted_at', null)
          .in('entity_type', ['kitchen', 'bar', 'storekeeper']);

        // Apply filters based on queryMode
        if (queryMode === 'day') {
          query = query.eq('data->>date', startDate);
        } else if (queryMode === 'range') {
          query = query.gte('data->>date', startDate).lte('data->>date', endDate);
        } else if (queryMode === 'month') {
          query = query.like('data->>date', `${month}%`);
        } else if (queryMode === 'year') {
          query = query.like('data->>date', `${year}%`);
        }

        const { data, error } = await query.order('created_at', { ascending: true });

        if (error) throw error;

        // Process data
        const grouped: Record<string, DetailRecord[]> = { kitchen: [], bar: [], storekeeper: [] };
        
        (data || []).forEach((r: any) => {
          const type = r.entity_type as ReportSection;
          if (grouped[type]) {
            grouped[type].push({
              id: r.id,
              type: r.data?.type,
              item_name: r.data?.item_name,
              quantity: Number(r.data?.quantity || 0),
              notes: r.data?.notes,
              created_at: r.created_at,
              data: r.data
            });
          }
        });

        setDetails(grouped as Record<ReportSection, DetailRecord[]>);

        // Generate summaries
        const newSummaries: DailySummary[] = (['kitchen', 'bar', 'storekeeper'] as ReportSection[]).map(section => {
          const records = grouped[section] || [];
          if (records.length === 0) {
            return {
              section,
              total_records: 0,
              last_updated: '',
              items_restocked: 0,
              items_issued: 0,
              items_discarded: 0,
              status: 'pending'
            };
          }

          let restocked = 0;
          let issued = 0;
          let discarded = 0;
          let lastTs = 0;

          records.forEach(r => {
            const ts = new Date(r.created_at).getTime();
            if (ts > lastTs) lastTs = ts;

            const t = r.type;
            if (t?.includes('restock')) restocked += r.quantity; // Sum quantities instead of counting records for more meaningful summary
            else if (t?.includes('issued') || t?.includes('sold')) issued += r.quantity;
            else if (t?.includes('discarded') || t?.includes('waste')) discarded += r.quantity;
          });

          return {
            section,
            total_records: records.length,
            last_updated: lastTs > 0 ? new Date(lastTs).toISOString() : '',
            items_restocked: restocked,
            items_issued: issued, 
            items_discarded: discarded,
            status: 'submitted'
          };
        });

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
      setViewMode('list'); // Reset view mode when opening
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
    const records = details[expandedSection];
    const breakdown: Record<string, { restocked: number, issued: number, discarded: number }> = {};
    
    records.forEach(r => {
      const name = r.item_name || 'Unknown Item';
      if (!breakdown[name]) {
        breakdown[name] = { restocked: 0, issued: 0, discarded: 0 };
      }
      
      const t = r.type;
      if (t?.includes('restock')) breakdown[name].restocked += r.quantity;
      else if (t?.includes('issued') || t?.includes('sold')) breakdown[name].issued += r.quantity;
      else if (t?.includes('discarded') || t?.includes('waste')) breakdown[name].discarded += r.quantity;
    });

    return Object.entries(breakdown)
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.issued - a.issued); // Sort by usage (issued)
  }, [details, expandedSection]);

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
               
               <div className="flex bg-white rounded-md border border-gray-200 p-1">
                 <button
                   onClick={(e) => { e.stopPropagation(); setViewMode('list'); }}
                   className={`px-3 py-1 text-xs font-medium rounded-sm flex items-center gap-1 transition-colors ${viewMode === 'list' ? 'bg-green-100 text-green-800' : 'text-gray-600 hover:bg-gray-50'}`}
                 >
                   <IconList className="w-3 h-3" /> Records
                 </button>
                 <button
                   onClick={(e) => { e.stopPropagation(); setViewMode('breakdown'); }}
                   className={`px-3 py-1 text-xs font-medium rounded-sm flex items-center gap-1 transition-colors ${viewMode === 'breakdown' ? 'bg-green-100 text-green-800' : 'text-gray-600 hover:bg-gray-50'}`}
                 >
                   <IconPieChart className="w-3 h-3" /> Breakdown
                 </button>
               </div>
             </div>
             <Button size="sm" variant="ghost" onClick={() => setExpandedSection(null)}>Close</Button>
          </div>
          
          <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
            {viewMode === 'list' ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date & Time</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Quantity</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {details[expandedSection].length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                        No records found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    details[expandedSection].map((r) => (
                      <TableRow key={r.id} className="hover:bg-gray-50">
                        <TableCell className="font-mono text-gray-500 text-xs">
                          {new Date(r.created_at).toLocaleDateString()} {new Date(r.created_at).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-normal text-xs">
                            {r.type?.replace('stock_', '').replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-medium text-gray-900">{r.item_name}</TableCell>
                        <TableCell className="text-right font-mono font-medium">{r.quantity}</TableCell>
                        <TableCell className="text-gray-500 italic max-w-xs truncate">{r.notes || '—'}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item Name</TableHead>
                    <TableHead className="text-right text-blue-600">Total In (Restocked)</TableHead>
                    <TableHead className="text-right text-amber-600">Total Out (Issued/Sold)</TableHead>
                    <TableHead className="text-right text-red-600">Total Waste (Discarded)</TableHead>
                    <TableHead className="text-right">Net Change</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {getBreakdown.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-gray-500">
                        No data available for breakdown.
                      </TableCell>
                    </TableRow>
                  ) : (
                    getBreakdown.map((item) => (
                      <TableRow key={item.name} className="hover:bg-gray-50">
                        <TableCell className="font-medium text-gray-900">{item.name}</TableCell>
                        <TableCell className="text-right font-mono text-blue-700 bg-blue-50/50">{item.restocked}</TableCell>
                        <TableCell className="text-right font-mono text-amber-700 bg-amber-50/50">{item.issued}</TableCell>
                        <TableCell className="text-right font-mono text-red-700 bg-red-50/50">{item.discarded}</TableCell>
                        <TableCell className="text-right font-mono font-bold">
                          {item.restocked - item.issued - item.discarded > 0 ? '+' : ''}
                          {item.restocked - item.issued - item.discarded}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}