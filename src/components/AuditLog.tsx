import { useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

interface AuditRow {
  id: string;
  actor_id: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string;
  details: any;
  diffs: any | null;
  created_at: string;
}

interface ActorInfo { id: string; full_name: string | null; email?: string | null; role?: string | null }

const ACTION_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All actions' },
  { value: 'approvals', label: 'Approvals' },
  { value: 'rejections', label: 'Rejections' },
  { value: 'financial_changes', label: 'Financial changes' },
  { value: 'data_edits', label: 'Data edits' },
  { value: 'administrative_actions', label: 'Administrative actions' },
  { value: 'soft_delete', label: 'Soft deletes' },
  { value: 'hard_delete', label: 'Hard deletes' },
  { value: 'staff_activation', label: 'Staff activation' },
  { value: 'staff_deactivation', label: 'Staff deactivation' },
  { value: 'staff_profile_edits', label: 'Staff profile edits' },
  { value: 'staff_profile_created', label: 'Staff profile created' },
];

export default function AuditLog() {
  const { isAdmin, isManager } = useAuth();
  const canView = isAdmin || isManager;

  if (!canView) {
    return (
      <div style={{ maxWidth: 800, margin: '40px auto', textAlign: 'center' }}>
        <h2>Access denied</h2>
        <p>You do not have permission to view this page.</p>
      </div>
    );
  }

  return <AuditLogInner />;
}

function AuditLogInner() {
  const { isAdmin, isManager } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [actionType, setActionType] = useState<string>('all');
  const [actorId, setActorId] = useState<string>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [onlyConfigEdits, setOnlyConfigEdits] = useState<boolean>(false);

  const [actors, setActors] = useState<Record<string, ActorInfo>>({});
  const [actorOptions, setActorOptions] = useState<ActorInfo[]>([]);

  const canView = useMemo(() => isAdmin || isManager, [isAdmin, isManager]);

  useEffect(() => {
    async function fetchAudit() {
      setLoading(true);
      setError(null);
      try {
        if (!isSupabaseConfigured || !supabase || !canView) return;
        let query = supabase
          .from('audit_logs')
          .select('id, actor_id, action_type, entity_type, entity_id, details, diffs, created_at')
          .order('created_at', { ascending: false });

        if (actionType !== 'all') {
          query = query.eq('action_type', actionType);
        }
        if (actorId !== 'all') {
          query = query.eq('actor_id', actorId);
        }
        if (fromDate) {
          const fromIso = new Date(fromDate).toISOString();
          query = query.gte('created_at', fromIso);
        }
        if (toDate) {
          const toIso = new Date(`${toDate}T23:59:59.999Z`).toISOString();
          query = query.lte('created_at', toIso);
        }

        const { data, error } = await query;
        if (error) {
          setError(error.message);
          setRows([]);
          return;
        }
        const list = (data ?? []).map((r: any) => ({
          id: r.id,
          actor_id: r.actor_id ?? null,
          action_type: r.action_type,
          entity_type: r.entity_type,
          entity_id: r.entity_id,
          details: r.details ?? {},
          diffs: r.diffs ?? null,
          created_at: r.created_at,
        })) as AuditRow[];

        let filtered = list;
        // Derived filter for config edits (operational_records with data.type in config_*)
        if (onlyConfigEdits) {
          const storeOps = filtered.filter((r) => r.entity_type === 'storekeeper');
          const ids = Array.from(new Set(storeOps.map((r) => r.entity_id)));
          if (ids.length) {
            const { data: opData, error: opErr } = await supabase
              .from('operational_records')
              .select('id, data')
              .in('id', ids);
            if (!opErr && opData) {
              const typeMap: Record<string, string | undefined> = {};
              for (const row of opData as any[]) {
                typeMap[String(row.id)] = (row.data?.type ?? row.data?.record_type) as string | undefined;
              }
              filtered = storeOps.filter((r) => {
                const t = (typeMap[r.entity_id] || '').toLowerCase();
                return t === 'config_category' || t === 'config_collection' || t === 'config_item' || t === 'opening_stock';
              });
            } else {
              filtered = [];
            }
          } else {
            filtered = [];
          }
        }

        setRows(filtered);

        const actorIds = Array.from(new Set(filtered.map((r) => r.actor_id).filter(Boolean))) as string[];
        if (actorIds.length) {
          const { data: profs, error: pErr } = await supabase
            .from('profiles')
            .select('id, full_name, email, role')
            .in('id', actorIds);
          if (!pErr && profs) {
            const map: Record<string, ActorInfo> = {};
            for (const p of profs as any[]) {
              map[p.id] = { id: p.id, full_name: p.full_name ?? null, email: p.email ?? null, role: p.role ?? null };
            }
            setActors(map);
            setActorOptions(profs as any[]);
          } else {
            setActors({});
            setActorOptions([]);
          }
        } else {
          setActors({});
          setActorOptions([]);
        }
      } catch (e: any) {
        setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
      } finally {
        setLoading(false);
      }
    }
    fetchAudit();
  }, [actionType, actorId, fromDate, toDate, onlyConfigEdits, canView]);

  function formatDate(iso: string) {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  function actorLabel(id: string | null) {
    if (!id) return '—';
    const a = actors[id];
    if (!a) return id;
    return a.full_name ? `${a.full_name}${a.role ? ` (${a.role})` : ''}` : (a.email || id);
  }

  return (
    <div className="page">
      <h1 className="page-title">Audit Log</h1>
      <div className="toolbar" style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 8, alignItems: 'end' }}>
        <div>
          <label className="form-label">Action type</label>
          <select className="input" value={actionType} onChange={(e) => setActionType(e.target.value)}>
            {ACTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">Actor</label>
          <select className="input" value={actorId} onChange={(e) => setActorId(e.target.value)}>
            <option value="all">All actors</option>
            {actorOptions.map((a) => (
              <option key={a.id} value={a.id}>{a.full_name || a.email || a.id}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="form-label">From date</label>
          <input className="input" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </div>
        <div>
          <label className="form-label">To date</label>
          <input className="input" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </div>
        <div>
          <label className="form-label">Filters</label>
          <label className="toggle">
            <input type="checkbox" checked={onlyConfigEdits} onChange={(e) => setOnlyConfigEdits(e.target.checked)} />
            <span>Only Config edits</span>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="table-loading"><div className="spinner" aria-label="Loading" /> Loading...</div>
      ) : error ? (
        <div className="error-box">{error}</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">No audit entries found.</div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Actor</th>
                <th>Action</th>
                <th>Entity</th>
                <th>Summary</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.created_at)}</td>
                  <td>{actorLabel(r.actor_id)}</td>
                  <td>{r.action_type}</td>
                  <td>{r.entity_type}</td>
                  <td>
                    <div style={{ maxWidth: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {String(r.details?.message || '')}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}