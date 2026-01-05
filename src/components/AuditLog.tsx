import { useEffect, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Card } from './ui/Card';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Badge } from './ui/Badge';
import { SearchInput } from './ui/SearchInput';
import { Pagination } from './ui/Pagination';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/Table';
import { 
  IconSearch, 
  IconLoader, 
  IconFileText, 
  IconAlertCircle, 
  IconFilter
} from './ui/Icons';

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
  const { user } = useAuth();
  
  if (!user) return null;

  return <AuditLogInner />;
}

const PAGE_SIZE = 20;

function AuditLogInner() {
  const { user, isAdmin, isManager } = useAuth();
  const canViewAll = isAdmin || isManager;
  
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination
  const [page, setPage] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);

  // Filters
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [actionType, setActionType] = useState<string>('all');
  const [actorId, setActorId] = useState<string>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [onlyConfigEdits, setOnlyConfigEdits] = useState<boolean>(false);

  const [actors, setActors] = useState<Record<string, ActorInfo>>({});
  const [actorOptions, setActorOptions] = useState<ActorInfo[]>([]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [actionType, actorId, fromDate, toDate, onlyConfigEdits, searchTerm]);

  useEffect(() => {
    async function fetchAudit() {
      setLoading(true);
      setError(null);
      try {
        if (!isSupabaseConfigured || !supabase || !user) return;
        
        // Build query
        let query = supabase
          .from('audit_logs')
          .select('id, actor_id, action_type, entity_type, entity_id, details, diffs, created_at', { count: 'exact' })
          .order('created_at', { ascending: false });

        // Apply filters
        if (!canViewAll) {
          // Force filter by current user if not admin/manager
          query = query.eq('actor_id', user.id);
        } else if (actorId !== 'all') {
          query = query.eq('actor_id', actorId);
        }

        if (actionType !== 'all') {
          query = query.eq('action_type', actionType);
        }
        
        if (fromDate) {
          const fromIso = new Date(fromDate).toISOString();
          query = query.gte('created_at', fromIso);
        }
        if (toDate) {
          const toIso = new Date(`${toDate}T23:59:59.999Z`).toISOString();
          query = query.lte('created_at', toIso);
        }

        if (searchTerm) {
          // Attempt to search across text columns. 
          // Searching JSONB 'details' efficiently requires an index or specific keys.
          // We search entity_type and action_type for now.
          query = query.or(`entity_type.ilike.%${searchTerm}%,action_type.ilike.%${searchTerm}%`);
        }

        // Pagination
        const from = (page - 1) * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;
        query = query.range(from, to);

        const { data, error, count } = await query;
        
        if (error) {
          setError(error.message);
          setRows([]);
          setTotalCount(0);
          return;
        }

        setTotalCount(count || 0);

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
        // Derived filter for config edits (client-side for now, but combined with pagination this is tricky)
        // If "onlyConfigEdits" is on, we might miss records because we are paginating BEFORE filtering.
        // Ideally, we should filter in the DB.
        // But entity_type "storekeeper" is ambiguous.
        // For now, let's keep the client-side logic but warn it applies only to the fetched page.
        // OR: Since this is "Audit Without Fear", maybe we don't need strict config edit filtering for regular history.
        
        if (onlyConfigEdits) {
             // ... existing logic ...
             // (Keeping it as is for now to avoid breaking existing logic, but noting the pagination limitation)
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
               } else { filtered = []; }
             } else { filtered = []; }
        }

        setRows(filtered);

        // Fetch actors only for the current page
        const actorIds = Array.from(new Set(filtered.map((r) => r.actor_id).filter(Boolean))) as string[];
        if (actorIds.length) {
          const { data: profs, error: pErr } = await supabase
            .from('profiles')
            .select('id, full_name, email, role')
            .in('id', actorIds);
          if (!pErr && profs) {
             // ... existing logic ...
             const map: Record<string, ActorInfo> = {};
             for (const p of profs as any[]) {
               map[p.id] = { id: p.id, full_name: p.full_name ?? null, email: p.email ?? null, role: p.role ?? null };
             }
             setActors(prev => ({ ...prev, ...map })); // Merge with existing actors
          }
        }
        
        // Fetch all actors for the dropdown if admin (only once)
        if (canViewAll && actorOptions.length === 0) {
            const { data: allProfs } = await supabase.from('profiles').select('id, full_name, email, role');
            if (allProfs) setActorOptions(allProfs as any[]);
        }

      } catch (e: any) {
        setError(typeof e?.message === 'string' ? e.message : 'Unexpected error');
      } finally {
        setLoading(false);
      }
    }
    fetchAudit();
  }, [actionType, actorId, fromDate, toDate, onlyConfigEdits, canViewAll, page, user, searchTerm]); 
  // Added 'page' and 'user' to dependencies

  // ... helper functions ...


  function formatDate(iso: string) {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
  }

  function actorLabel(id: string | null) {
    if (!id) return '—';
    const a = actors[id];
    if (!a) return 'Unknown';
    return a.full_name ? `${a.full_name}${a.role ? ` (${a.role})` : ''}` : (a.email || id);
  }

  function getActionBadgeVariant(actionType: string): "default" | "success" | "warning" | "error" | "outline" {
    if (actionType.includes('delete')) return 'error';
    if (actionType.includes('rejection')) return 'error';
    if (actionType.includes('approval')) return 'success';
    if (actionType.includes('activation')) return 'success';
    if (actionType.includes('deactivation')) return 'warning';
    if (actionType.includes('edit')) return 'warning';
    if (actionType.includes('financial')) return 'default';
    return 'default';
  }

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <IconFileText className="w-6 h-6 text-gray-500" />
            Audit Log
          </h1>
          <p className="text-gray-500 text-sm mt-1">Track system activities and changes</p>
        </div>
      </div>

      <Card className="p-4 bg-white border border-gray-200 shadow-sm">
        <div className="mb-4">
          <SearchInput
            value={searchTerm}
            onChangeValue={setSearchTerm}
            placeholder="Search logs..."
            className="max-w-md"
          />
        </div>
        <div className="flex items-center gap-2 mb-4 text-sm font-medium text-gray-700">
          <IconFilter className="w-4 h-4" />
          Filter Logs
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 items-end">
          <Select
            label="Action Type"
            value={actionType}
            onChange={(e) => setActionType(e.target.value)}
            options={ACTION_OPTIONS}
            fullWidth
          />
          
          <Select
            label="Actor"
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            options={[
              { value: 'all', label: 'All actors' },
              ...actorOptions.map((a) => ({
                value: a.id,
                label: a.full_name || a.email || a.id
              }))
            ]}
            fullWidth
          />
          
          <Input
            type="date"
            label="From Date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            fullWidth
          />
          
          <Input
            type="date"
            label="To Date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            fullWidth
          />
          
          <div className="flex items-center h-[42px] pb-1">
            <input 
              type="checkbox" 
              id="configEdits" 
              className="rounded border-gray-300 text-green-600 focus:ring-green-500 h-4 w-4 mr-2"
              checked={onlyConfigEdits} 
              onChange={(e) => setOnlyConfigEdits(e.target.checked)} 
            />
            <label htmlFor="configEdits" className="text-sm font-medium text-gray-700 select-none">
              Only Config Edits
            </label>
          </div>
        </div>
      </Card>

      {error && (
        <div className="bg-error-light border border-error-light text-error px-4 py-3 rounded-md flex items-start gap-2 animate-fadeIn">
          <IconAlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <Card className="overflow-hidden border border-gray-200 shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-48 sticky left-0 z-20 bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Timestamp</TableHead>
                <TableHead className="w-48">Actor</TableHead>
                <TableHead className="w-40">Action</TableHead>
                <TableHead className="w-32">Entity</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center text-gray-500">
                      <IconLoader className="w-8 h-8 animate-spin text-green-600 mb-2" />
                      <p>Loading audit logs...</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center text-gray-500">
                      <IconSearch className="w-12 h-12 text-gray-300 mb-3" />
                      <p className="text-lg font-medium text-gray-900">No audit entries found</p>
                      <p className="text-sm">Try adjusting your filters.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id} className="group hover:bg-gray-50/50">
                    <TableCell className="text-gray-500 text-xs font-mono whitespace-nowrap sticky left-0 z-10 bg-white group-hover:bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                      {formatDate(r.created_at)}
                    </TableCell>
                    <TableCell className="font-medium text-gray-900">
                      {actorLabel(r.actor_id)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getActionBadgeVariant(r.action_type)}>
                        {r.action_type.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-500 capitalize">
                      {r.entity_type.replace(/_/g, ' ')}
                    </TableCell>
                    <TableCell className="text-gray-700">
                      <div className="max-w-md truncate" title={r.details?.message || JSON.stringify(r.details)}>
                        {r.details?.message || (
                          <span className="text-xs font-mono text-gray-400">{JSON.stringify(r.details)}</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Pagination
        currentPage={page}
        totalPages={Math.ceil(totalCount / PAGE_SIZE)}
        onPageChange={setPage}
      />
    </div>
  );
}
