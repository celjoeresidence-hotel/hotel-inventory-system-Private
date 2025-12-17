import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

type Category = 'food' | 'drink' | 'provision';

interface CatalogCollection {
  name: string;
  items: string[];
}

interface CatalogTabData {
  collections: CatalogCollection[];
}

export default function InventoryCatalog() {
  const { session, isConfigured, isSupervisor, isManager, isAdmin } = useAuth();
  const canView = useMemo(() => Boolean(isConfigured && session && (isSupervisor || isManager || isAdmin)), [isConfigured, session, isSupervisor, isManager, isAdmin]);

  const [activeCat, setActiveCat] = useState<Category>('food');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [data, setData] = useState<Record<Category, CatalogTabData>>({ food: { collections: [] }, drink: { collections: [] }, provision: { collections: [] } });

  useEffect(() => {
    async function fetchCatalog(cat: Category) {
      setError(null);
      setLoading(true);
      try {
        if (!canView || !supabase) return;
        // Fetch collections for category
        const { data: colData, error: colErr } = await supabase
          .from('operational_records')
          .select('id, data, status')
          .eq('status', 'approved')
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'config_collection')
          .filter('data->>category', 'eq', cat);
        if (colErr) { setError(colErr.message); return; }
        const collections = (colData ?? []).map((r: any) => String(r.data?.collection_name ?? '')).filter(Boolean);

        // Fetch items for category
        const { data: itemData, error: itemErr } = await supabase
          .from('operational_records')
          .select('id, data, status')
          .eq('status', 'approved')
          .eq('entity_type', 'storekeeper')
          .filter('data->>type', 'eq', 'config_item')
          .filter('data->>category', 'eq', cat);
        if (itemErr) { setError(itemErr.message); return; }
        const items = (itemData ?? []).map((r: any) => ({ name: String(r.data?.item_name ?? ''), collection: String(r.data?.collection_name ?? '') })).filter((it) => it.name && it.collection);

        // Group items by collection
        const grouped: CatalogCollection[] = collections.map((cname) => ({
          name: cname,
          items: items.filter((it) => it.collection === cname).map((it) => it.name),
        })).filter((col) => col.items.length > 0);

        setData((prev) => ({ ...prev, [cat]: { collections: grouped } }));
      } finally {
        setLoading(false);
      }
    }
    fetchCatalog(activeCat);
  }, [activeCat, canView]);

  if (!canView) {
    return (
      <div style={{ maxWidth: 720, margin: '24px auto' }}>
        <h2>Access denied</h2>
        <p>You do not have permission to view this page.</p>
      </div>
    );
  }

  const tabTitle = (cat: Category) => (cat === 'food' ? 'Food' : cat === 'drink' ? 'Drinks' : 'Provisions');

  return (
    <div style={{ padding: 16, fontFamily: 'Montserrat, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif', background: '#fff' }}>
      <h2 style={{ marginTop: 0 }}>Inventory Catalog</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['food','drink','provision'] as Category[]).map((cat) => (
          <button key={cat} className={`btn ${activeCat === cat ? 'btn-primary' : ''}`} style={{ padding: '6px 10px', borderRadius: 6, background: activeCat === cat ? '#1B5E20' : '#eee', color: activeCat === cat ? '#fff' : '#333' }} onClick={() => setActiveCat(cat)}>
            {tabTitle(cat)}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>{error}</div>
      )}

      {loading ? (
        <div>Loading...</div>
      ) : (
        <div>
          {data[activeCat].collections.length === 0 ? (
            <div style={{ color: '#666' }}>No items defined yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 24 }}>
              {data[activeCat].collections.map((col) => (
                <section key={col.name} style={{ borderTop: '1px solid #e6f2e6', paddingTop: 12 }}>
                  <h3 style={{ color: '#1B5E20', marginTop: 0 }}>{col.name}</h3>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {col.items.map((name) => (
                      <li key={name} style={{ padding: '6px 0' }}>{name}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}