import { useState, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { Card } from './ui/Card';
import { Input } from './ui/Input';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { 
  IconFileText, 
  IconCalendar, 
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
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState<boolean>(false);
  const [summaries, setSummaries] = useState<DailySummary[]>([]);
  const [details, setDetails] = useState<Record<ReportSection, DetailRecord[]>>({
    kitchen: [],
    bar: [],
    storekeeper: []
  });
  const [expandedSection, setExpandedSection] = useState<ReportSection | null>(null);

  useEffect(() => {
    async function fetchDailyReport() {
      if (!isSupabaseConfigured || !supabase) return;
      setLoading(true);
      try {
        // Fetch all operational records for this date
        // We filter by data->>date
        const { data, error } = await supabase
          .from('operational_records')
          .select('id, entity_type, data, created_at, status, deleted_at')
          .eq('status', 'approved') // Only show approved records in reports
          .is('deleted_at', null)
          .eq('data->>date', date)
          .in('entity_type', ['kitchen', 'bar', 'storekeeper'])
          .order('created_at', { ascending: true });

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
            if (t?.includes('restock')) restocked++;
            else if (t?.includes('issued') || t?.includes('sold')) issued++;
            else if (t?.includes('discarded') || t?.includes('waste')) discarded++;
          });

          return {
            section,
            total_records: records.length,
            last_updated: lastTs > 0 ? new Date(lastTs).toISOString() : '',
            items_restocked: restocked,
            items_issued: issued, // simplified count of distinct items/actions
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

    fetchDailyReport();
  }, [date]);

  const toggleExpand = (section: ReportSection) => {
    if (expandedSection === section) setExpandedSection(null);
    else setExpandedSection(section);
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

  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <IconFileText className="w-6 h-6 text-green-600" />
            Daily Reports
          </h1>
          <p className="text-gray-500 text-sm mt-1">Consolidated view of daily hotel operations</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="relative">
            <IconCalendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input 
              type="date" 
              value={date} 
              onChange={(e) => setDate(e.target.value)}
              className="pl-9 w-40 font-medium"
            />
          </div>
          <Button variant="outline" onClick={() => window.print()}>
            <IconPrinter className="w-4 h-4 mr-2" />
            Print
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
          summaries.map((summary) => (
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
                    {summary.status === 'submitted' ? 'Submitted' : 'Pending'}
                  </Badge>
                </div>
                
                <h3 className="text-lg font-bold text-gray-900 mb-1">{sectionLabel(summary.section)}</h3>
                <p className="text-sm text-gray-500 mb-4">
                  {summary.status === 'submitted' 
                    ? `Last updated ${new Date(summary.last_updated).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}` 
                    : 'No records found for this date'}
                </p>

                {summary.status === 'submitted' && (
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-gray-50 p-2 rounded border border-gray-100">
                      <span className="block text-gray-400 text-xs uppercase tracking-wider">Entries</span>
                      <span className="font-semibold text-gray-900">{summary.total_records}</span>
                    </div>
                    <div className="bg-gray-50 p-2 rounded border border-gray-100">
                      <span className="block text-gray-400 text-xs uppercase tracking-wider">Actions</span>
                      <span className="font-semibold text-gray-900">
                        {summary.items_restocked + summary.items_issued + summary.items_discarded}
                      </span>
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
             <h3 className="font-bold text-gray-900 flex items-center gap-2">
               <span>{getSectionIcon(expandedSection)}</span>
               {sectionLabel(expandedSection)} Report Details
             </h3>
             <Button size="sm" variant="ghost" onClick={() => setExpandedSection(null)}>Close</Button>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
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
                        {new Date(r.created_at).toLocaleTimeString()}
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
          </div>
        </Card>
      )}
    </div>
  );
}