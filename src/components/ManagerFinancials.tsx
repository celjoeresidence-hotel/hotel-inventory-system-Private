import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Card } from './ui/Card';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
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
  IconDollarSign, 
  IconCalendar, 
  IconPieChart,
  IconTrendingUp,
  IconTrendingDown,
  IconRefresh,
  IconArrowRight
} from './ui/Icons';

interface OperationalRecord {
  id: string;
  entity_type: string;
  status: string;
  data: any;
  financial_amount: number;
  created_at: string;
}

interface ConfigItem {
  item_name: string;
  category: string;
  unit_price: number;
}

interface ConfigCategory {
  name: string;
  assigned_to: string[] | Record<string, boolean> | null;
}

interface CollectionSummary {
  name: string;
  income: number;
  expenditure: number;
  net: number;
}

const COLLECTIONS = ['Restaurant', 'Bar', 'Rooms', 'Provisions'];

export default function ManagerFinancials() {
  const { role } = useAuth();
  const isManager = role === 'manager';
  const isAdmin = role === 'admin';

  const [records, setRecords] = useState<OperationalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [activeTab, setActiveTab] = useState<'daily' | 'monthly'>('daily');
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7)); // YYYY-MM
  
  const [selectedCollection, setSelectedCollection] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      if (!isManager && !isAdmin) return;
      if (!supabase) return;

      setLoading(true);
      setError(null);
      try {
        // Calculate date range
        let start: string, end: string;
        if (activeTab === 'daily') {
          start = `${date}T00:00:00`;
          end = `${date}T23:59:59`;
        } else {
          // Monthly
          const [y, m] = month.split('-').map(Number);
          const startDate = new Date(y, m - 1, 1);
          const endDate = new Date(y, m, 0); // Last day of month
          start = startDate.toISOString(); // UTC
          end = endDate.toISOString(); // UTC
          // Adjust for local if needed, but simple ISO string usually sufficient for created_at comparison
          // For event_date (date type), we just need the YYYY-MM-DD part
        }

        const dateOnlyStart = start.slice(0, 10);
        const dateOnlyEnd = end.slice(0, 10);

        // 1. Fetch Front Desk records (Legacy/Rooms) from operational_records
        const { data: opsData, error: opsError } = await supabase
          .from('operational_records')
          .select('*')
          .eq('entity_type', 'front_desk') // Only fetch Front Desk
          .eq('status', 'approved')
          .gte('created_at', start) // Approximation, ideally use data->date
          .lte('created_at', end);

        if (opsError) throw opsError;

        // 2. Fetch Inventory Ledger (Bar, Kitchen, Store)
        const { data: ledgerData, error: ledgerError } = await supabase
          .from('v_inventory_ledger')
          .select('*')
          .gte('event_date', dateOnlyStart)
          .lte('event_date', dateOnlyEnd);

        if (ledgerError) throw ledgerError;

        // 3. Normalize and Combine
        const safeOps = (opsData ?? []).map((r: any) => ({
          id: r.id,
          entity_type: r.entity_type,
          status: r.status,
          data: r.data,
          financial_amount: Number(r.financial_amount ?? 0),
          created_at: r.created_at,
        }));

        const safeLedger = (ledgerData ?? []).map((l: any) => {
            // Map ledger to OperationalRecord shape
            let entity_type = 'unknown';
            let financial_amount = 0;
            const data: any = { 
                item_name: l.item_name, 
                quantity: Math.abs(l.quantity_change),
                date: l.event_date,
                notes: l.notes
            };

            if (l.department === 'STORE') {
                entity_type = 'storekeeper';
                if (l.event_type === 'ISSUED_TO_DEPT') {
                    data.type = 'stock_issued';
                    // We don't have 'issued_to' in ledger, but getCollection handles it via item assignment
                } else if (l.event_type === 'SUPPLIER_RESTOCK') {
                    data.type = 'stock_restock';
                }
            } else if (l.department === 'BAR') {
                entity_type = 'bar';
                if (l.event_type === 'SOLD') {
                    financial_amount = Number(l.total_value ?? 0);
                }
            } else if (l.department === 'KITCHEN') {
                entity_type = 'kitchen';
                if (l.event_type === 'SOLD') {
                    financial_amount = Number(l.total_value ?? 0);
                }
            }

            return {
                id: l.record_id,
                entity_type,
                status: 'approved',
                data,
                financial_amount,
                created_at: l.created_at || l.event_date
            };
        });

        // Filter out irrelevant ledger entries (e.g. internal moves that don't affect financials directly in this view?)
        // ManagerFinancials uses:
        // - storekeeper stock_issued (Expenditure)
        // - bar/kitchen financial_amount (Income)
        // safeLedger already prepares these.

        setRecords([...safeOps, ...safeLedger]);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [isManager, isAdmin, refreshKey, activeTab, date, month]);

  // Process data to build maps and calculate stats
  // Now fetching config from new tables independently
  const [configMaps, setConfigMaps] = useState<{itemMap: Record<string, ConfigItem>, categoryMap: Record<string, ConfigCategory>}>({ itemMap: {}, categoryMap: {} });

  useEffect(() => {
    async function fetchConfig() {
        if (!supabase) return;
        try {
            // Fetch Categories
            const { data: catData } = await supabase.from('inventory_categories').select('*').is('deleted_at', null);
            const categoryMap: Record<string, ConfigCategory> = {};
            (catData || []).forEach((c: any) => {
                categoryMap[c.name] = {
                    name: c.name,
                    assigned_to: c.assigned_to
                };
            });

            // Fetch Items
            const { data: itemData } = await supabase.from('inventory_items').select('*').is('deleted_at', null);
            const itemMap: Record<string, ConfigItem> = {};
            (itemData || []).forEach((i: any) => {
                itemMap[i.item_name] = {
                    item_name: i.item_name,
                    category: i.category,
                    unit_price: i.unit_price ?? 0
                };
            });

            setConfigMaps({ itemMap, categoryMap });
        } catch (e) {
            console.error('Error fetching config for financials:', e);
        }
    }
    fetchConfig();
  }, []);

  const getCollection = useCallback((entityType: string, itemName?: string): string => {
    const { itemMap, categoryMap } = configMaps;
    
    if (entityType === 'bar') return 'Bar';
    if (entityType === 'kitchen') return 'Restaurant';
    if (entityType === 'front_desk') return 'Rooms';
    
    if (entityType === 'storekeeper') {
      // Check item -> category -> assigned_to
      if (itemName && itemMap[itemName]) {
        const catName = itemMap[itemName].category;
        if (catName && categoryMap[catName]) {
          const assigned = categoryMap[catName].assigned_to;
          let isBar = false;
          let isKitchen = false;
          
          if (Array.isArray(assigned)) {
            if (assigned.includes('bar')) isBar = true;
            if (assigned.includes('kitchen')) isKitchen = true;
          } else if (assigned && typeof assigned === 'object') {
            if (assigned['bar']) isBar = true;
            if (assigned['kitchen']) isKitchen = true;
          }

          if (isBar) return 'Bar';
          if (isKitchen) return 'Restaurant';
        }
      }
      return 'Provisions';
    }
    return 'Provisions';
  }, [configMaps]);

  const processedData = useMemo(() => {
    const { itemMap } = configMaps;
    const summary: Record<string, CollectionSummary> = {};
    COLLECTIONS.forEach(c => {
      summary[c] = { name: c, income: 0, expenditure: 0, net: 0 };
    });

    records.forEach(r => {
      // Determine record date
      const recordDateRaw = r.data?.date ?? r.created_at;
      if (!recordDateRaw) return;
      const recordDate = recordDateRaw.slice(0, 10);
      const recordMonth = recordDateRaw.slice(0, 7);

      // Filter by active tab
      if (activeTab === 'daily') {
        if (recordDate !== date) return;
      } else {
        if (recordMonth !== month) return;
      }

      let income = 0;
      let expenditure = 0;
      let collection = 'Provisions';

      if (r.entity_type === 'bar' || r.entity_type === 'kitchen' || r.entity_type === 'front_desk') {
        income = r.financial_amount;
        collection = getCollection(r.entity_type);
      } else if (r.entity_type === 'storekeeper' && r.data?.type === 'stock_issued') {
        const itemName = r.data.item_name;
        const qty = Number(r.data.quantity ?? 0);
        const price = itemMap[itemName]?.unit_price ?? 0;
        expenditure = qty * price;
        collection = getCollection(r.entity_type, itemName);
      }

      if (summary[collection]) {
        summary[collection].income += income;
        summary[collection].expenditure += expenditure;
      }
    });

    Object.values(summary).forEach(s => {
      s.net = s.income - s.expenditure;
    });

    return Object.values(summary);
  }, [records, activeTab, date, month, configMaps, getCollection]);

  const selectedCollectionDetails = useMemo(() => {
    if (!selectedCollection) return { income: [], expenditure: [] };
    const { itemMap } = configMaps;

    const incomeRecords: any[] = [];
    const expenditureRecords: any[] = [];

    records.forEach(r => {
      const recordDateRaw = r.data?.date ?? r.created_at;
      if (!recordDateRaw) return;
      const recordDate = recordDateRaw.slice(0, 10);
      const recordMonth = recordDateRaw.slice(0, 7);

      if (activeTab === 'daily') {
        if (recordDate !== date) return;
      } else {
        if (recordMonth !== month) return;
      }

      let collection = 'Provisions';
      if (r.entity_type === 'bar' || r.entity_type === 'kitchen' || r.entity_type === 'front_desk') {
        collection = getCollection(r.entity_type);
        if (collection === selectedCollection) {
          incomeRecords.push({
            id: r.id,
            date: recordDate,
            description: r.data.notes || `${r.entity_type === 'front_desk' ? 'Room Booking' : 'Daily Sales'}`,
            amount: r.financial_amount,
            type: r.entity_type
          });
        }
      } else if (r.entity_type === 'storekeeper' && r.data?.type === 'stock_issued') {
        const itemName = r.data.item_name;
        const qty = Number(r.data.quantity ?? 0);
        const price = itemMap[itemName]?.unit_price ?? 0;
        collection = getCollection(r.entity_type, itemName);
        
        if (collection === selectedCollection) {
          expenditureRecords.push({
            id: r.id,
            date: recordDate,
            item: itemName,
            quantity: qty,
            unitPrice: price,
            total: qty * price,
            issuedTo: r.data.issued_to || 'Unknown'
          });
        }
      }
    });

    return { 
      income: incomeRecords.sort((a,b) => b.amount - a.amount), 
      expenditure: expenditureRecords.sort((a,b) => b.total - a.total) 
    };
  }, [selectedCollection, records, activeTab, date, month, configMaps, getCollection]);

  // Totals for the table footer
  const totals = useMemo(() => {
    return processedData.reduce((acc, curr) => ({
      income: acc.income + curr.income,
      expenditure: acc.expenditure + curr.expenditure,
      net: acc.net + curr.net
    }), { income: 0, expenditure: 0, net: 0 });
  }, [processedData]);

  if (!isManager && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center p-8 animate-fade-in">
        <div className="bg-error-light text-error p-4 rounded-full mb-4 shadow-sm">
          <IconAlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
        <p className="text-gray-500 max-w-md">Only Managers and Administrators can view financial reports.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-[1600px] mx-auto p-4 md:p-8 animate-fade-in">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Financial Reports</h1>
          <p className="text-gray-500 mt-1">Income, expenditure, and net profit analysis.</p>
        </div>
        
        <div className="flex bg-gray-100 p-1 rounded-lg self-start md:self-auto border border-gray-200 shadow-inner items-center gap-1">
          <button
            onClick={() => setRefreshKey(k => k + 1)}
            className="p-2 text-gray-500 hover:text-green-700 hover:bg-white rounded-md transition-all duration-200 shadow-sm ring-1 ring-transparent hover:ring-black/5"
            title="Refresh Data"
          >
            <IconRefresh className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <div className="w-px h-6 bg-gray-300 mx-1"></div>
          <button
            onClick={() => setActiveTab('daily')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
              activeTab === 'daily' 
                ? 'bg-white text-green-700 shadow-sm ring-1 ring-black/5' 
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/50'
            }`}
          >
            Daily View
          </button>
          <button
            onClick={() => setActiveTab('monthly')}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
              activeTab === 'monthly' 
                ? 'bg-white text-green-700 shadow-sm ring-1 ring-black/5' 
                : 'text-gray-500 hover:text-gray-900 hover:bg-gray-200/50'
            }`}
          >
            Monthly View
          </button>
          </div>
        </div>

      <Card className="p-6 bg-white border border-gray-100 shadow-sm">
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-6">
          <div className="w-full sm:w-auto">
            {activeTab === 'daily' ? (
              <Input 
                type="date" 
                label="Select Date"
                value={date} 
                onChange={(e) => setDate(e.target.value)}
                className="w-full sm:w-56"
              />
            ) : (
              <Input 
                type="month" 
                label="Select Month"
                value={month} 
                onChange={(e) => setMonth(e.target.value)}
                className="w-full sm:w-56"
              />
            )}
          </div>
          <div className="text-sm text-gray-500 pb-3 flex items-center gap-2">
            <IconCalendar className="w-4 h-4 text-gray-400" />
            <span className="font-medium">
              Viewing report for {activeTab === 'daily' ? new Date(date).toLocaleDateString(undefined, { dateStyle: 'long' }) : new Date(month + '-01').toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </span>
          </div>
        </div>
      </Card>

      {loading && (
        <div className="p-16 text-center text-gray-500 flex flex-col items-center justify-center">
          <div className="w-10 h-10 border-4 border-green-600 border-t-transparent rounded-full animate-spin mb-4" />
          <p className="font-medium">Calculating financial data...</p>
        </div>
      )}
      
      {error && (
        <div className="bg-error-light border border-error-light text-error px-4 py-3 rounded-lg flex items-start gap-3 shadow-sm">
          <IconAlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p>Error: {error}</p>
        </div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Summary Table */}
          <Card className="lg:col-span-2 overflow-hidden border-0 shadow-md">
            <div className="p-6 border-b border-gray-100 bg-white flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <IconDollarSign className="w-5 h-5 text-gray-500" />
                Financial Summary
              </h3>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky left-0 bg-gray-50 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Collection</TableHead>
                    <TableHead className="text-right">Income</TableHead>
                    <TableHead className="text-right">Expenditure</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {processedData.map((row) => (
                    <TableRow 
                      key={row.name} 
                      className="cursor-pointer hover:bg-gray-50 transition-colors"
                      onClick={() => setSelectedCollection(row.name)}
                    >
                      <TableCell className="font-medium text-gray-900 sticky left-0 bg-white z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                        {row.name}
                      </TableCell>
                      <TableCell className="text-right text-green-600 font-medium">
                        ₦{row.income.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-error font-medium">
                        ₦{row.expenditure.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className={`text-right font-bold ${row.net >= 0 ? 'text-green-700' : 'text-error'}`}>
                        ₦{row.net.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <IconArrowRight className="w-4 h-4 text-gray-400" />
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  <TableRow className="bg-gray-50 font-bold hover:bg-gray-50">
                    <TableCell className="uppercase tracking-wider text-xs text-gray-500 sticky left-0 bg-gray-50 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Total</TableCell>
                    <TableCell className="text-right text-green-700 text-lg">
                      {totals.income.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right text-error text-lg">
                      {totals.expenditure.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className={`text-right text-lg ${totals.net >= 0 ? 'text-green-700' : 'text-error'}`}>
                      {totals.net.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Percentage Impact Visualization */}
          <Card className="h-fit border-0 shadow-md">
            <div className="p-6 border-b border-gray-100 bg-white">
              <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <IconPieChart className="w-5 h-5 text-gray-500" />
                Net Income Impact
              </h3>
            </div>
            <div className="p-6 space-y-6">
              {processedData.map(row => {
                const totalNetAbs = Math.max(Math.abs(totals.net), 1); 
                const percentage = (row.net / totalNetAbs) * 100;
                const isPositive = row.net >= 0;
                const width = Math.min(Math.abs(percentage), 100);
                
                return (
                  <div key={row.name} className="space-y-2">
                    <div className="flex justify-between items-center text-sm">
                      <span className="font-medium text-gray-700">{row.name}</span>
                      <span className={`font-bold ${isPositive ? 'text-green-600' : 'text-error'}`}>
                        {percentage.toFixed(1)}%
                      </span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-1000 ease-out ${
                          isPositive ? 'bg-solid-success' : 'bg-solid-error'
                        }`}
                        style={{ width: `${Math.max(width, 2)}%` }}
                      />
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                        {isPositive ? <IconTrendingUp className="w-3 h-3" /> : <IconTrendingDown className="w-3 h-3" />}
                        {isPositive ? 'Contributing Profit' : 'Contributing Loss'}
                    </div>
                  </div>
                );
              })}
              
              {processedData.length === 0 && (
                <div className="text-center text-gray-400 py-8">
                    No data to visualize
                </div>
              )}
            </div>
          </Card>
        </div>
      )}

      {/* Detail Modal */}
      <Modal
        isOpen={!!selectedCollection}
        onClose={() => setSelectedCollection(null)}
        title={`${selectedCollection} - Detailed Breakdown`}
        size="lg"
      >
        <div className="space-y-6">
          {/* Income Section */}
          <div>
            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-green-500"></span>
              Income Sources
            </h4>
            {selectedCollectionDetails.income.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedCollectionDetails.income.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">{r.date}</TableCell>
                        <TableCell className="text-sm text-gray-600">{r.description}</TableCell>
                        <TableCell className="text-right font-medium text-green-600">
                          {r.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-gray-50 font-bold">
                      <TableCell colSpan={2} className="text-right">Total Income</TableCell>
                      <TableCell className="text-right text-green-700">
                        {selectedCollectionDetails.income.reduce((sum, r) => sum + r.amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic">No income records found for this period.</p>
            )}
          </div>

          {/* Expenditure Section */}
          <div>
            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500"></span>
              Expenditure (Stock Issued)
            </h4>
            {selectedCollectionDetails.expenditure.length > 0 ? (
              <div className="border rounded-lg overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Item</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selectedCollectionDetails.expenditure.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm">{r.date}</TableCell>
                        <TableCell className="text-sm font-medium">{r.item}</TableCell>
                        <TableCell className="text-right text-sm">{r.quantity}</TableCell>
                        <TableCell className="text-right text-sm text-gray-500">₦{r.unitPrice.toFixed(2)}</TableCell>
                        <TableCell className="text-right font-medium text-error">
                          ₦{r.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-gray-50 font-bold">
                      <TableCell colSpan={4} className="text-right">Total Expenditure</TableCell>
                      <TableCell className="text-right text-error">
                        ₦{selectedCollectionDetails.expenditure.reduce((sum, r) => sum + r.total, 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            ) : (
              <p className="text-sm text-gray-500 italic">No expenditure records found for this period.</p>
            )}
          </div>
        </div>
      </Modal>

    </div>
  );
}
