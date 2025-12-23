import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'daily' | 'monthly'>('daily');
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [month, setMonth] = useState<string>(() => new Date().toISOString().slice(0, 7)); // YYYY-MM

  useEffect(() => {
    async function fetchData() {
      if (!isManager && !isAdmin) return;
      if (!supabase) return;

      setLoading(true);
      setError(null);
      try {
        const { data, error } = await supabase
          .from('operational_records')
          .select('*')
          .eq('status', 'approved');

        if (error) throw error;

        // Parse and ensure numbers
        const safeRecords = (data ?? []).map((r: any) => ({
          id: r.id,
          entity_type: r.entity_type,
          status: r.status,
          data: r.data,
          financial_amount: Number(r.financial_amount ?? 0),
          created_at: r.created_at,
        }));
        setRecords(safeRecords);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [isManager, isAdmin]);

  // Process data to build maps and calculate stats
  const processedData = useMemo(() => {
    // 1. Build Item and Category Maps from latest config records
    const itemMap: Record<string, ConfigItem> = {};
    const categoryMap: Record<string, ConfigCategory> = {};

    // Sort by created_at asc to ensure we overwrite with latest? 
    // Actually we need latest version. For simplicity, we scan all and keep updating, assuming chronological order in DB usually implies ID order or we sort by created_at.
    // The fetch didn't sort, so let's sort first.
    const sortedRecords = [...records].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    sortedRecords.forEach(r => {
      const type = r.data?.type;
      if (type === 'config_category') {
        const name = r.data.category_name ?? r.data.name;
        if (name) {
          categoryMap[name] = {
            name,
            assigned_to: r.data.assigned_to
          };
        }
      } else if (type === 'config_item') {
        const name = r.data.item_name;
        if (name) {
          itemMap[name] = {
            item_name: name,
            category: r.data.category,
            unit_price: Number(r.data.unit_price ?? 0)
          };
        }
      }
    });

    // Helper to determine collection from item/entity
    const getCollection = (entityType: string, itemName?: string): string => {
      if (entityType === 'bar') return 'Bar';
      if (entityType === 'kitchen') return 'Restaurant';
      if (entityType === 'front_desk') return 'Rooms';
      
      if (entityType === 'storekeeper') {
        // Check item -> category -> assigned_to
        if (itemName && itemMap[itemName]) {
          const catName = itemMap[itemName].category;
          if (catName && categoryMap[catName]) {
            const assigned = categoryMap[catName].assigned_to;
            // assigned can be array ['bar'] or object {bar: true}
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
        // If not mapped to bar/kitchen, default to Provisions or check for Rooms?
        // Assuming Provisions for now for unmapped store items
        return 'Provisions';
      }
      return 'Provisions';
    };

    // 2. Aggregate Financials
    const summary: Record<string, CollectionSummary> = {};
    COLLECTIONS.forEach(c => {
      summary[c] = { name: c, income: 0, expenditure: 0, net: 0 };
    });

    sortedRecords.forEach(r => {
      // Determine record date
      // Prefer data.date (user entered) over created_at
      // data.date is usually YYYY-MM-DD
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

      // Calculate amounts
      let income = 0;
      let expenditure = 0;
      let collection = 'Provisions'; // Default

      // Handle Income (Bar, Kitchen, Front Desk)
      if (r.entity_type === 'bar' || r.entity_type === 'kitchen' || r.entity_type === 'front_desk') {
        income = r.financial_amount;
        collection = getCollection(r.entity_type);
      }
      // Handle Expenditure (Storekeeper Issued)
      else if (r.entity_type === 'storekeeper' && r.data?.type === 'stock_issued') {
        const itemName = r.data.item_name;
        const qty = Number(r.data.quantity ?? 0);
        const price = itemMap[itemName]?.unit_price ?? 0;
        expenditure = qty * price;
        collection = getCollection(r.entity_type, itemName);
      }

      // Add to summary
      if (summary[collection]) {
        summary[collection].income += income;
        summary[collection].expenditure += expenditure;
      }
    });

    // Calculate Net
    Object.values(summary).forEach(s => {
      s.net = s.income - s.expenditure;
    });

    return Object.values(summary);
  }, [records, activeTab, date, month]);

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
      <div style={{ padding: 20, textAlign: 'center' }}>
        <h2>Access Denied</h2>
        <p>Only Managers and Administrators can view financial reports.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ margin: 0 }}>Financial Reports</h1>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            onClick={() => setActiveTab('daily')}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #ddd',
              background: activeTab === 'daily' ? '#007bff' : '#fff',
              color: activeTab === 'daily' ? '#fff' : '#333',
              cursor: 'pointer'
            }}
          >
            Daily
          </button>
          <button 
            onClick={() => setActiveTab('monthly')}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              border: '1px solid #ddd',
              background: activeTab === 'monthly' ? '#007bff' : '#fff',
              color: activeTab === 'monthly' ? '#fff' : '#333',
              cursor: 'pointer'
            }}
          >
            Monthly
          </button>
        </div>
      </div>

      <div style={{ marginBottom: '24px', background: '#f9f9f9', padding: '16px', borderRadius: '8px', display: 'flex', gap: '16px', alignItems: 'center' }}>
        {activeTab === 'daily' ? (
          <div>
            <label style={{ marginRight: '8px', fontWeight: 'bold' }}>Select Date:</label>
            <input 
              type="date" 
              value={date} 
              onChange={(e) => setDate(e.target.value)}
              style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </div>
        ) : (
          <div>
            <label style={{ marginRight: '8px', fontWeight: 'bold' }}>Select Month:</label>
            <input 
              type="month" 
              value={month} 
              onChange={(e) => setMonth(e.target.value)}
              style={{ padding: '6px', borderRadius: '4px', border: '1px solid #ccc' }}
            />
          </div>
        )}
      </div>

      {loading && <p>Loading financial data...</p>}
      {error && <p style={{ color: 'red' }}>Error: {error}</p>}

      {!loading && !error && (
        <>
          {/* Summary Table */}
          <div style={{ overflowX: 'auto', marginBottom: '32px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', background: '#fff', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' }}>
              <thead>
                <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Collection</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Income</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Expenditure</th>
                  <th style={{ padding: '12px', textAlign: 'right' }}>Net</th>
                </tr>
              </thead>
              <tbody>
                {processedData.map((row) => (
                  <tr key={row.name} style={{ borderBottom: '1px solid #eee' }}>
                    <td style={{ padding: '12px', fontWeight: '500' }}>{row.name}</td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#28a745' }}>
                      {row.income.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', color: '#dc3545' }}>
                      {row.expenditure.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'right', fontWeight: 'bold', color: row.net >= 0 ? '#28a745' : '#dc3545' }}>
                      {row.net.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </td>
                  </tr>
                ))}
                {/* Totals Row */}
                <tr style={{ background: '#f0f0f0', borderTop: '2px solid #ccc', fontWeight: 'bold' }}>
                  <td style={{ padding: '12px' }}>TOTAL</td>
                  <td style={{ padding: '12px', textAlign: 'right', color: '#28a745' }}>
                    {totals.income.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', color: '#dc3545' }}>
                    {totals.expenditure.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', color: totals.net >= 0 ? '#28a745' : '#dc3545' }}>
                    {totals.net.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Percentage Impact Visualization (Monthly only or both? User said "Monthly percentage impact", but useful for both) */}
          <div style={{ marginTop: '24px' }}>
            <h3>Net Income Impact (% of Total Net)</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {processedData.map(row => {
                // Avoid division by zero
                const totalNetAbs = Math.max(Math.abs(totals.net), 1); 
                const percentage = (row.net / totalNetAbs) * 100;
                const isPositive = row.net >= 0;
                const width = Math.min(Math.abs(percentage), 100); // Cap at 100% for visual sanity if total is small
                
                return (
                  <div key={row.name} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '120px', fontWeight: '500' }}>{row.name}</div>
                    <div style={{ flex: 1, background: '#e9ecef', borderRadius: '4px', height: '24px', position: 'relative' }}>
                      <div 
                        style={{
                          width: `${width}%`,
                          height: '100%',
                          background: isPositive ? '#28a745' : '#dc3545',
                          borderRadius: '4px',
                          transition: 'width 0.3s ease'
                        }}
                      />
                    </div>
                    <div style={{ width: '80px', textAlign: 'right', fontSize: '0.9em', color: '#666' }}>
                      {percentage.toFixed(1)}%
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
