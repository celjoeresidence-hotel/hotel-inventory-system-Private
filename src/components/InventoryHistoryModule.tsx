import React, { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from './ui/Table';
import { Badge } from './ui/Badge';
import { Pagination } from './ui/Pagination';
import { SearchInput } from './ui/SearchInput';
import { Card } from './ui/Card';
import { 
  IconDownload, 
  IconPrinter, 
  IconFilter, 
  IconTrendingUp,
  IconTrendingDown,
  IconPackage,
  IconDollarSign
} from './ui/Icons';

interface HistoryRecord {
  record_id: string;
  created_at: string;
  event_date: string;
  department: string;
  item_name: string;
  category: string;
  collection: string;
  unit: string;
  event_type: string;
  quantity_change: number;
  opening_stock: number;
  closing_stock: number;
  unit_price: number;
  total_value: number;
  staff_name: string;
  submitted_by: string;
}

interface HistoryStats {
  total_restocked: number;
  total_issued_sold: number;
  net_value_change: number;
}

interface InventoryHistoryModuleProps {
  role: 'storekeeper' | 'bar' | 'kitchen';
}

const PAGE_SIZE = 50;

export const InventoryHistoryModule: React.FC<InventoryHistoryModuleProps> = ({ role }) => {
  const { ensureActiveSession } = useAuth();
  // State
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<HistoryRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [stats, setStats] = useState<HistoryStats>({ total_restocked: 0, total_issued_sold: 0, net_value_change: 0 });
  
  // Filters
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [category, setCategory] = useState('');
  const [eventType, setEventType] = useState('');
  const [categories, setCategories] = useState<string[]>([]);

  // Fetch Categories for Filter
  useEffect(() => {
    async function fetchCats() {
      if (!supabase) return;
      
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) return;

      // We can fetch distinct categories from the history view itself or from config
      // For efficiency, let's just get distinct categories from history view for this role
      // Or use a known list if available. Let's try to get distinct categories.
      const { data } = await supabase
        .from('v_inventory_history')
        .select('category')
        .eq('department', role === 'storekeeper' ? 'STORE' : role === 'bar' ? 'BAR' : 'KITCHEN')
        .limit(1000); // Sample
        
      if (data) {
        const unique = Array.from(new Set(data.map((r: any) => r.category))).sort() as string[];
        setCategories(unique);
      }
    }
    fetchCats();
  }, [role]);

  // Fetch Data
  useEffect(() => {
    async function fetchData() {
      if (!supabase) return;
      setLoading(true);
      try {
        const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
        if (!ok) {
            toast.error('Session expired. Please sign in again.');
            setLoading(false);
            return;
        }

        // 1. Fetch Records
        const { data: listData, error: listError } = await supabase.rpc('get_inventory_history', {
          _role: role,
          _start_date: startDate || null,
          _end_date: endDate || null,
          _search: searchTerm || null,
          _category: category || null,
          _event_type: eventType || null,
          _page: page,
          _page_size: PAGE_SIZE
        });

        if (listError) throw listError;
        
        if (listData && listData.length > 0) {
          setRecords(listData);
          setTotalCount(Number(listData[0].total_count));
        } else {
          setRecords([]);
          setTotalCount(0);
        }

        // 2. Fetch Aggregates
        const { data: statsData, error: statsError } = await supabase.rpc('get_inventory_history_stats', {
          _role: role,
          _start_date: startDate || null,
          _end_date: endDate || null,
          _search: searchTerm || null,
          _category: category || null,
          _event_type: eventType || null
        });

        if (statsError) throw statsError;

        if (statsData && statsData.length > 0) {
          setStats(statsData[0]);
        }

      } catch (err) {
        console.error('Error fetching history:', err);
      } finally {
        setLoading(false);
      }
    }
    
    // Debounce search
    const timer = setTimeout(() => {
      fetchData();
    }, 500);
    return () => clearTimeout(timer);

  }, [role, page, searchTerm, startDate, endDate, category, eventType]);

  // Helpers
  const formatEventType = (type: string) => {
    return type.replace(/_/g, ' ').toUpperCase();
  };

  const getEventBadgeVariant = (type: string) => {
    if (['OPENING_STOCK', 'SUPPLIER_RESTOCK', 'RECEIVED_FROM_STORE'].includes(type)) return 'success';
    if (['ISSUED_TO_DEPT', 'SOLD', 'CONSUMED'].includes(type)) return 'warning'; // Using warning for out
    return 'default';
  };

  const handlePrint = () => {
    window.print();
  };

  const handleExport = () => {
    const headers = ['Date', 'Time', 'Item', 'Category', 'Action', 'Opening', 'Qty Change', 'Closing', 'Staff', 'Submitted By'];
    const csvContent = [
      headers.join(','),
      ...records.map(r => [
        r.event_date,
        new Date(r.created_at).toLocaleTimeString(),
        `"${r.item_name}"`,
        `"${r.category}"`,
        r.event_type,
        r.opening_stock,
        r.quantity_change,
        r.closing_stock,
        `"${r.staff_name}"`,
        `"${r.submitted_by}"`
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${role}_history_export_${new Date().toISOString().slice(0,10)}.csv`;
    link.click();
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Header & Controls */}
      <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <IconPackage className="w-6 h-6 text-blue-600" />
            {role === 'storekeeper' ? 'Store' : role === 'bar' ? 'Bar' : 'Kitchen'} History Ledger
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            Immutable record of all {role} operations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
           <Button variant="outline" onClick={handleExport} className="flex items-center gap-2 text-sm">
             <IconDownload className="w-4 h-4" /> Export CSV
           </Button>
           <Button variant="outline" onClick={handlePrint} className="flex items-center gap-2 text-sm">
             <IconPrinter className="w-4 h-4" /> Print
           </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 bg-green-50 border-green-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-100 rounded-lg text-green-700">
              <IconTrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Total Restocked</p>
              <p className="text-2xl font-bold text-gray-900">{stats.total_restocked.toLocaleString()}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-orange-50 border-orange-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg text-orange-700">
              <IconTrendingDown className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Total {role === 'storekeeper' ? 'Issued' : 'Sold/Consumed'}</p>
              <p className="text-2xl font-bold text-gray-900">{stats.total_issued_sold.toLocaleString()}</p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-blue-50 border-blue-100">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg text-blue-700">
              <IconDollarSign className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm text-gray-500 font-medium">Net Value Impact</p>
              <p className="text-2xl font-bold text-gray-900">₦{stats.net_value_change.toLocaleString()}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Filters Bar */}
      <div className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm space-y-4 sm:space-y-0 sm:flex sm:items-end gap-4">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs font-medium text-gray-500 mb-1">Search Items/Staff</label>
          <SearchInput 
            value={searchTerm} 
            onChangeValue={setSearchTerm} 
            placeholder="Search item, staff, ref..." 
          />
        </div>
        
        <div className="w-full sm:w-40">
           <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
           <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-10" />
        </div>

        <div className="w-full sm:w-40">
           <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
           <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="h-10" />
        </div>

        <div className="w-full sm:w-40">
           <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
           <Select value={category} onChange={e => setCategory(e.target.value)} className="h-10">
             <option value="">All Categories</option>
             {categories.map(c => <option key={c} value={c}>{c}</option>)}
           </Select>
        </div>

        <div className="w-full sm:w-40">
           <label className="block text-xs font-medium text-gray-500 mb-1">Action Type</label>
           <Select value={eventType} onChange={e => setEventType(e.target.value)} className="h-10">
             <option value="">All Actions</option>
             <option value="OPENING_STOCK">Opening Stock</option>
             {role === 'storekeeper' ? (
               <>
                 <option value="SUPPLIER_RESTOCK">Restock (Supplier)</option>
                 <option value="ISSUED_TO_DEPT">Issued</option>
               </>
             ) : (
               <>
                 <option value="RECEIVED_FROM_STORE">Received</option>
                 <option value={role === 'bar' ? 'SOLD' : 'CONSUMED'}>{role === 'bar' ? 'Sold' : 'Consumed'}</option>
               </>
             )}
           </Select>
        </div>
        
        <div className="pb-0.5">
           <Button variant="ghost" onClick={() => {
             setSearchTerm(''); setStartDate(''); setEndDate(''); setCategory(''); setEventType('');
           }} title="Clear Filters">
             <IconFilter className="w-5 h-5 text-gray-400 hover:text-red-500" />
           </Button>
        </div>
      </div>

      {/* Data Table */}
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-gray-50">
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Time</TableHead>
                <TableHead>Item Details</TableHead>
                <TableHead>Action</TableHead>
                <TableHead className="text-right">Opening</TableHead>
                <TableHead className="text-right">Change</TableHead>
                <TableHead className="text-right font-bold">Closing</TableHead>
                <TableHead>Staff</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-gray-500">
                    <div className="flex flex-col items-center">
                      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mb-2"></div>
                      Loading history...
                    </div>
                  </TableCell>
                </TableRow>
              ) : records.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-12 text-gray-500">
                    No history records found matching your filters.
                  </TableCell>
                </TableRow>
              ) : (
                records.map((r) => (
                  <TableRow key={`${r.record_id}-${r.created_at}`} className="hover:bg-gray-50 transition-colors">
                    <TableCell className="whitespace-nowrap font-medium text-gray-700">
                      {new Date(r.event_date).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-xs text-gray-500 whitespace-nowrap">
                      {new Date(r.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-gray-900">{r.item_name}</span>
                        <span className="text-xs text-gray-500">{r.category} • {r.unit}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getEventBadgeVariant(r.event_type)}>
                        {formatEventType(r.event_type)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-gray-500 font-mono text-xs">
                      {Number(r.opening_stock).toLocaleString()}
                    </TableCell>
                    <TableCell className={`text-right font-bold font-mono ${r.quantity_change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {r.quantity_change > 0 ? '+' : ''}{Number(r.quantity_change).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-bold text-gray-900 font-mono bg-gray-50/50">
                      {Number(r.closing_stock).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="text-sm text-gray-700">{r.staff_name}</span>
                        <span className="text-xs text-gray-400">by {r.submitted_by}</span>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Pagination */}
        {totalCount > 0 && (
          <div className="border-t border-gray-100 p-4 flex justify-center">
            <Pagination
              currentPage={page}
              totalPages={Math.ceil(totalCount / PAGE_SIZE)}
              onPageChange={setPage}
            />
          </div>
        )}
      </Card>
    </div>
  );
};
