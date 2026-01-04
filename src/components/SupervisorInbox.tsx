import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { Checkbox } from './ui/Checkbox';
import { 
  Table, 
  TableHeader, 
  TableBody, 
  TableHead, 
  TableRow, 
  TableCell 
} from './ui/Table';
import { RecordDetails, type OperationalRecordRow } from './RecordDetails';
import { 
  IconCheckCircle, 
  IconXCircle,
  IconAlertCircle,
  IconClock,
  IconList
} from './ui/Icons';

import { ConfirmationModal } from './ConfirmationModal';

function formatDate(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  } catch {
    return iso ?? '—';
  }
}

const DEPARTMENT_LABEL: Record<string, string> = {
  front_desk: 'Front Desk',
  kitchen: 'Kitchen',
  bar: 'Bar',
  storekeeper: 'Storekeeper',
};

export default function SupervisorInbox() {
  const { session, role, isConfigured } = useAuth();
  const [records, setRecords] = useState<OperationalRecordRow[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<OperationalRecordRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [actionLoading, setActionLoading] = useState<boolean>(false);
  const [rejectReason, setRejectReason] = useState<string>('');
  const [showReject, setShowReject] = useState<boolean>(false);
  const [showApproveConfirm, setShowApproveConfirm] = useState<boolean>(false);
  const [successMessage, setSuccessMessage] = useState<string>('');
  
  // Bulk Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Filters
  const [filterDept, setFilterDept] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  
  const [showDetails, setShowDetails] = useState<boolean>(false);
  const [profilesMap, setProfilesMap] = useState<Record<string, { full_name: string | null; role: string | null }>>({});

  const canUse = useMemo(() => Boolean(isConfigured && session && (role === 'supervisor' || role === 'manager' || role === 'admin')), [isConfigured, session, role]);

  const typeOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of records) {
      const t = (r as any)?.data?.type;
      if (t) s.add(String(t));
    }
    return Array.from(s);
  }, [records]);

  const filteredRecords = useMemo(() => {
    let res = records;
    if (typeFilter !== 'all') {
      if (typeFilter === 'none') res = res.filter((r) => !(r as any)?.data?.type);
      else res = res.filter((r) => String((r as any)?.data?.type ?? '') === typeFilter);
    }
    return res;
  }, [records, typeFilter]);

  const groupsByOriginal = useMemo(() => {
    const byOrig: Record<string, OperationalRecordRow[]> = {};
    for (const r of filteredRecords) {
      const key = (r.original_id ?? r.id) as string;
      if (!byOrig[key]) byOrig[key] = [];
      byOrig[key].push(r);
    }
    return byOrig;
  }, [filteredRecords]);

  const orderedGroupKeys = useMemo(() => Object.keys(groupsByOriginal).sort((a, b) => {
    const ra = groupsByOriginal[a]?.[0];
    const rb = groupsByOriginal[b]?.[0];
    return (rb?.created_at ? new Date(rb.created_at).getTime() : 0) - (ra?.created_at ? new Date(ra.created_at).getTime() : 0);
  }), [groupsByOriginal]);

  useEffect(() => {
    async function fetchPending() {
      setError(null);
      setLoadingList(true);
      try {
        const sb = supabase;
        if (!canUse || !sb) return;
        let query = sb
          .from('operational_records')
          .select('id, entity_type, status, data, created_at, original_id, submitted_by')
          .eq('status', 'pending');
        if (filterDept !== 'all') {
          query = query.eq('entity_type', filterDept);
        }
        if (fromDate) {
          const fromIso = new Date(fromDate).toISOString();
          query = query.gte('created_at', fromIso);
        }
        if (toDate) {
          const toIso = new Date(`${toDate}T23:59:59.999Z`).toISOString();
          query = query.lte('created_at', toIso);
        }
        const { data, error } = await query.order('created_at', { ascending: false });
        if (error) {
          setError(error.message);
          return;
        }
        const safe = (data ?? []).map((r: any) => ({
          id: r?.id,
          entity_type: r?.entity_type,
          status: r?.status,
          data: r?.data ?? null,
          created_at: r?.created_at ?? null,
          original_id: r?.original_id ?? null,
          submitted_by: r?.submitted_by ?? null,
        })) as OperationalRecordRow[];
        setRecords(safe);
        
        // Fetch profiles
        const ids = Array.from(new Set(safe.map((r) => r.submitted_by).filter(Boolean))) as string[];
        if (ids.length) {
          const { data: profs, error: pErr } = await sb.from('profiles').select('id, full_name, role').in('id', ids);
          if (!pErr && profs) {
            const map: Record<string, { full_name: string | null; role: string | null }> = {};
            for (const p of profs as any[]) {
              map[p.id] = { full_name: p.full_name ?? null, role: p.role ?? null };
            }
            setProfilesMap(map);
          }
        }
      } finally {
        setLoadingList(false);
      }
    }
    fetchPending();
  }, [canUse, filterDept, fromDate, toDate]);

  const handleSelectAll = () => {
    if (selectedIds.size === orderedGroupKeys.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(orderedGroupKeys));
    }
  };

  const toggleSelection = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedIds(newSet);
  };

  async function approveGroup(originalId: string) {
    await processGroups([originalId], 'approve');
  }

  async function rejectGroup(originalId: string) {
    if (!rejectReason.trim()) {
      setError('Rejection requires a reason.');
      return;
    }
    await processGroups([originalId], 'reject', rejectReason);
  }

  async function handleBulkApprove() {
    if (selectedIds.size === 0) return;
    setShowApproveConfirm(true);
  }

  async function confirmBulkApprove() {
    await processGroups(Array.from(selectedIds), 'approve');
    setShowApproveConfirm(false);
  }

  async function processGroups(originalIds: string[], action: 'approve' | 'reject', reason?: string) {
    const sb = supabase;
    if (!canUse || !sb) return;
    setError(null);
    setSuccessMessage('');
    setActionLoading(true);
    try {
      for (const oid of originalIds) {
        const group = groupsByOriginal[oid] || [];
        for (const rec of group) {
          if (action === 'approve') {
            const { error } = await sb.rpc('approve_record', { _id: rec.id });
            if (error) throw error;
          } else {
            const { error } = await sb.rpc('reject_record', { _id: rec.id, _reason: reason || 'Rejected via bulk action' });
            if (error) throw error;
          }
        }
      }
      
      // Remove processed from list
      const processedSet = new Set(originalIds);
      setRecords((prev) => prev.filter((r) => !processedSet.has((r.original_id ?? r.id) as string)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        originalIds.forEach(id => next.delete(id));
        return next;
      });
      
      setSelectedRecord(null);
      setShowReject(false);
      setRejectReason('');
      setSuccessMessage(`Successfully ${action}ed ${originalIds.length} submission(s).`);
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setActionLoading(false);
    }
  }

  const noRecords = orderedGroupKeys.length === 0;

  if (!canUse) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center p-8 animate-in fade-in">
        <div className="bg-error-light text-error p-4 rounded-full mb-4">
          <IconAlertCircle className="w-8 h-8" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
        <p className="text-gray-500 max-w-md">Only Supervisors, Managers, and Administrators can view this page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-[1400px] mx-auto p-4 md:p-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            <div className="p-2 bg-green-100 text-green-700 rounded-lg">
              <IconList className="w-6 h-6" />
            </div>
            Daily Activities
          </h1>
          <p className="text-gray-500 mt-1 ml-12">Review and manage operational record submissions</p>
        </div>
        
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 bg-green-50 px-4 py-2 rounded-lg border border-green-100 animate-in slide-in-from-right-4">
            <span className="text-sm font-medium text-green-900">{selectedIds.size} selected</span>
            <div className="h-4 w-px bg-green-200"></div>
            <Button size="sm" onClick={handleBulkApprove} disabled={actionLoading} className="bg-green-600 hover:bg-green-700 text-white">
              Approve All
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowReject(true)} disabled={actionLoading} className="text-error border-error-light hover:bg-error-light">
              Reject All
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="bg-error-light border border-error-light text-error px-4 py-3 rounded-lg flex items-start gap-3 animate-in slide-in-from-top-2">
          <IconAlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}
      
      {successMessage && (
        <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg flex items-start gap-3 animate-in slide-in-from-top-2">
          <IconCheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p>{successMessage}</p>
        </div>
      )}

      {/* Filters */}
      <Card className="p-4 bg-gray-50/50 border-gray-200">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
          <Select
            label="Department"
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            options={[
              { value: 'all', label: 'All Departments' },
              { value: 'front_desk', label: 'Front Desk' },
              { value: 'kitchen', label: 'Kitchen' },
              { value: 'bar', label: 'Bar' },
              { value: 'storekeeper', label: 'Storekeeper' },
            ]}
          />
          
          <Select
            label="Entity Type"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            options={[
              { value: 'all', label: 'All Types' },
              { value: 'none', label: 'Uncategorized' },
              ...typeOptions.map(t => ({ value: t, label: t }))
            ]}
          />

          <Input
            label="From Date"
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
          />

          <Input
            label="To Date"
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
      </Card>

      {/* Content */}
      <Card className="overflow-hidden border-0 shadow-sm ring-1 ring-gray-200">
        {loadingList ? (
          <div className="p-16 text-center text-gray-500 flex flex-col items-center">
            <div className="w-10 h-10 border-4 border-gray-200 border-t-green-600 rounded-full animate-spin mb-4" />
            <p className="font-medium">Loading pending records...</p>
          </div>
        ) : noRecords ? (
          <div className="p-16 text-center text-gray-500 flex flex-col items-center bg-gray-50/50">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center text-gray-300 shadow-sm mb-4">
              <IconCheckCircle className="w-8 h-8" />
            </div>
            <p className="font-medium text-gray-900 text-lg">All caught up!</p>
            <p className="text-gray-500 mt-1">No pending records found matching your filters.</p>
          </div>
        ) : (
          <>
            {/* Desktop Table View */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 sticky left-0 z-20 bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                      <Checkbox 
                        checked={selectedIds.size > 0 && selectedIds.size === orderedGroupKeys.length}
                        onChange={handleSelectAll}
                        className={selectedIds.size > 0 && selectedIds.size < orderedGroupKeys.length ? "opacity-50" : ""}
                      />
                    </TableHead>
                    <TableHead className="sticky left-10 z-20 bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Department</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Submitted By</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderedGroupKeys.map((orig) => {
                    const group = groupsByOriginal[orig] || [];
                    const first = group[0];
                    const submittedName = first?.submitted_by ? (profilesMap[first.submitted_by]?.full_name ?? 'Unknown') : 'Unknown';
                    const department = DEPARTMENT_LABEL[first?.entity_type ?? ''] ?? first?.entity_type ?? '—';
                    
                    const deptVariant = 'success';

                    return (
                      <TableRow key={orig} className={selectedIds.has(orig) ? 'bg-green-50/50' : ''}>
                        <TableCell className={`sticky left-0 z-10 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] ${selectedIds.has(orig) ? 'bg-green-50/50' : 'group-hover:bg-gray-50'}`}>
                          <Checkbox 
                            checked={selectedIds.has(orig)}
                            onChange={() => toggleSelection(orig)}
                          />
                        </TableCell>
                        <TableCell className={`sticky left-10 z-10 bg-white shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] ${selectedIds.has(orig) ? 'bg-green-50/50' : 'group-hover:bg-gray-50'}`}>
                          <Badge variant={deptVariant}>
                            {department}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-gray-900 font-medium capitalize">
                          {String(first?.data?.type ?? first?.entity_type ?? 'Record').replace(/_/g, ' ')}
                        </TableCell>
                        <TableCell className="text-gray-600">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-500">
                              {submittedName.charAt(0)}
                            </div>
                            {submittedName}
                          </div>
                        </TableCell>
                        <TableCell className="text-gray-500">
                          <div className="flex items-center gap-1.5">
                            <IconClock className="w-3.5 h-3.5" />
                            {formatDate(first?.created_at)}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => { setSelectedRecord(first ?? null); setShowDetails(true); }}
                              disabled={actionLoading}
                              className="text-gray-500 hover:text-green-700"
                            >
                              Details
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-green-600 hover:bg-green-50 border-green-200"
                              onClick={() => approveGroup(orig)}
                              disabled={actionLoading}
                              title="Approve"
                            >
                              <IconCheckCircle className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-error hover:bg-error-light border-error-light"
                              onClick={() => { setSelectedRecord(first ?? null); setShowReject(true); }}
                              disabled={actionLoading}
                              title="Reject"
                            >
                              <IconXCircle className="w-4 h-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile Card View */}
            <div className="md:hidden space-y-3">
              {orderedGroupKeys.map((orig) => {
                const group = groupsByOriginal[orig] || [];
                const first = group[0];
                const submittedName = first?.submitted_by ? (profilesMap[first.submitted_by]?.full_name ?? 'Unknown') : 'Unknown';
                const department = DEPARTMENT_LABEL[first?.entity_type ?? ''] ?? first?.entity_type ?? '—';
                
                const deptVariant = 'success';

                return (
                  <Card key={orig} className={`p-4 transition-all duration-200 ${selectedIds.has(orig) ? 'ring-2 ring-green-500 bg-green-50/50' : 'hover:shadow-md'}`}>
                    <div className="flex items-start gap-3 mb-3">
                      <Checkbox 
                        checked={selectedIds.has(orig)}
                        onChange={() => toggleSelection(orig)}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-start mb-1">
                          <Badge variant={deptVariant} size="sm">{department}</Badge>
                          <span className="text-xs text-gray-500 flex items-center gap-1">
                            <IconClock className="w-3 h-3" />
                            {formatDate(first?.created_at)}
                          </span>
                        </div>
                        <h4 className="font-medium text-gray-900 capitalize mb-1 truncate">
                          {String(first?.data?.type ?? first?.entity_type ?? 'Record').replace(/_/g, ' ')}
                        </h4>
                        <div className="flex items-center gap-1.5 text-xs text-gray-500">
                          <div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center text-[10px] font-bold text-gray-600">
                            {submittedName.charAt(0)}
                          </div>
                          <span className="truncate">{submittedName}</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex gap-2 pl-8">
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 h-9 text-xs"
                        onClick={() => { setSelectedRecord(first ?? null); setShowDetails(true); }}
                      >
                        Details
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        className="flex-1 bg-green-600 hover:bg-green-700 text-white h-9 text-xs shadow-sm border-transparent"
                        onClick={() => approveGroup(orig)}
                      >
                        Approve
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-9 px-0 text-error border-error-light hover:bg-error-light h-9 flex-shrink-0"
                        onClick={() => { setSelectedRecord(first ?? null); setShowReject(true); }}
                      >
                        <IconXCircle className="w-4 h-4" />
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {/* Details Modal */}
      <Modal
        isOpen={showDetails}
        onClose={() => setShowDetails(false)}
        title="Record Details"
        size="lg"
      >
        {selectedRecord && <RecordDetails record={selectedRecord} />}
        <div className="mt-6 flex justify-end gap-3 pt-4 border-t border-gray-100">
          <Button variant="outline" onClick={() => setShowDetails(false)}>Close</Button>
          <Button 
            className="bg-green-600 hover:bg-green-700 text-white shadow-sm"
            onClick={() => {
              approveGroup(selectedRecord?.original_id ?? selectedRecord?.id ?? '');
              setShowDetails(false);
            }}
          >
            Approve Record
          </Button>
        </div>
      </Modal>

      {/* Modals */}
      <ConfirmationModal
        isOpen={showApproveConfirm}
        onClose={() => setShowApproveConfirm(false)}
        onConfirm={confirmBulkApprove}
        title="Approve Items"
        message={`Are you sure you want to approve ${selectedIds.size} selected items?`}
        confirmLabel="Approve"
        confirmVariant="primary"
        loading={actionLoading}
      />

      {/* Reject Modal */}
      <Modal
        isOpen={showReject}
        onClose={() => { setShowReject(false); setRejectReason(''); }}
        title={selectedIds.size > 0 && !selectedRecord ? `Reject ${selectedIds.size} Submissions` : "Reject Submission"}
        size="md"
      >
        <div className="space-y-4">
          <div className="bg-error-light text-error p-3 rounded-lg text-sm flex items-start gap-2 border border-error-light">
            <IconAlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p>
              {selectedIds.size > 0 && !selectedRecord
                ? "You are about to reject multiple submissions. This action cannot be undone."
                : "You are about to reject this submission. Please provide a reason."}
            </p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rejection Reason *</label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all resize-none text-sm"
              placeholder="e.g., Incorrect stock count, missing details..."
              autoFocus
            />
          </div>
          
          <div className="flex justify-end gap-3 mt-4">
            <Button 
              variant="outline" 
              onClick={() => { setShowReject(false); setRejectReason(''); }}
            >
              Cancel
            </Button>
            <Button 
              variant="danger"
              className="border-transparent shadow-sm"
              onClick={() => {
                if (selectedIds.size > 0 && !selectedRecord) {
                  processGroups(Array.from(selectedIds), 'reject', rejectReason);
                } else {
                  rejectGroup(selectedRecord?.original_id ?? selectedRecord?.id ?? '');
                }
              }}
              disabled={actionLoading || !rejectReason.trim()}
            >
              Confirm Rejection
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
