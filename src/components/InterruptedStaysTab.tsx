import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { IconLoader, IconSearch, IconCalendar, IconCheckCircle, IconX, IconNote } from './ui/Icons';
import InterruptedStayDetailsModal from './InterruptedStayDetailsModal';
import ResumeInterruptedStay from './ResumeInterruptedStay';
import type { RoomStatus } from '../types/frontDesk';
import { useAuth } from '../context/AuthContext';

interface InterruptedStaysTabProps {
  rooms: RoomStatus[];
  onRefresh: () => void;
}

export default function InterruptedStaysTab({ rooms, onRefresh }: InterruptedStaysTabProps) {
  const { role, fullName, department, ensureActiveSession } = useAuth();
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'today' | 'month' | 'pending' | 'range'>('pending');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detailsRecord, setDetailsRecord] = useState<any | null>(null);
  const [showResume, setShowResume] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteTarget, setNoteTarget] = useState<any | null>(null);

  async function fetchInterrupted() {
    setLoading(true);
    try {
      const { data } = await supabase!
        .from('operational_records')
        .select('id, original_id, data, status, submitted_by, created_at')
        .eq('entity_type', 'front_desk')
        .in('status', ['approved', 'pending', 'converted'])
        .is('deleted_at', null);
      const rows = (data || []).filter((r: any) => {
        const t = String(r.data?.type || '');
        return ['interrupted_stay', 'paused_stay', 'interrupted_stay_credit', 'stay_interruption'].includes(t);
      });
      setRecords(rows);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchInterrupted();
  }, []);

  const filtered = useMemo(() => {
    const today = new Date().toISOString().split('T')[0];
    const monthStr = today.slice(0,7);
    return records.filter((r: any) => {
      const name = String(r.data?.guest_name || r.data?.guest?.full_name || '').toLowerCase();
      const roomNo = String(r.data?.room_number || '').toLowerCase();
      const matchesSearch = name.includes(search.toLowerCase()) || roomNo.includes(search.toLowerCase());
      if (!matchesSearch) return false;
      // Hide resumed/converted credits from the section
      const logicStatus = String(r.data?.status || '').toLowerCase();
      if (['resumed', 'cancelled_interrupted'].includes(logicStatus)) return false;
      if (r.status === 'converted') return false;
      const interruptedAt = String(r.data?.interrupted_at || r.data?.interruption_date || r.created_at);
      const dateOnly = interruptedAt.split('T')[0];
      if (filter === 'today') return dateOnly === today;
      if (filter === 'month') return dateOnly.startsWith(monthStr);
      if (filter === 'pending') return Boolean(r.data?.can_resume);
      if (filter === 'range') {
        if (!from || !to) return true;
        return dateOnly >= from && dateOnly <= to;
      }
      return true;
    });
  }, [records, search, filter, from, to]);

  async function markCancelled(rec: any) {
    if (!['admin', 'manager'].includes(role || '')) {
      alert('Only Admin or Manager can mark an interrupted stay as cancelled.');
      return;
    }
    setActionLoading(rec.id);
    try {
      const { error } = await supabase!
        .from('operational_records')
        .update({
          status: 'expired',
          data: {
            ...rec.data,
            status: 'cancelled_interrupted'
          }
        })
        .eq('id', rec.id);
      if (error) throw error;
      onRefresh();
      fetchInterrupted();
    } catch (e: any) {
      alert(e.message || 'Failed to mark as cancelled');
    } finally {
      setActionLoading(null);
    }
  }

  async function convertToRefund(rec: any) {
    if (!['admin', 'manager'].includes(role || '')) {
      alert('Only Admin or Manager can convert remaining credit to refund.');
      return;
    }
    setActionLoading(rec.id);
    try {
      const amount = Number(rec.data?.credit_remaining || 0);
      if (amount <= 0) throw new Error('No remaining credit to refund');
      const { error } = await supabase!
        .from('operational_records')
        .insert({
          entity_type: 'front_desk',
          status: 'approved',
          data: {
            type: 'refund_record',
            source_credit_id: rec.id,
            guest_name: rec.data?.guest_name,
            room_number: rec.data?.room_number,
            amount
          },
          financial_amount: -amount,
          original_id: rec.original_id || rec.id
        });
      if (error) throw error;
      onRefresh();
      fetchInterrupted();
    } catch (e: any) {
      alert(e.message || 'Failed to convert credit to refund');
    } finally {
      setActionLoading(null);
    }
  }

  async function addNote() {
    if (!['supervisor', 'manager', 'admin'].includes(role || '')) {
      alert('Only Supervisor, Manager, or Admin can add follow-up notes.');
      return;
    }
    if (!noteTarget || !noteText.trim()) return;
    setActionLoading(noteTarget.id);
    try {
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) { alert('Session expired. Please sign in again.'); setActionLoading(null); return; }

      const { error } = await supabase!
        .from('operational_records')
        .insert({
          entity_type: 'front_desk',
          status: 'approved',
          data: {
            type: 'operational_note',
            note: noteText.trim(),
            staff_name: fullName || 'Staff',
            department: department || 'frontdesk',
            guest_name: noteTarget.data?.guest_name
          },
          original_id: noteTarget.original_id || noteTarget.id
        });
      if (error) throw error;
      setNoteText('');
      setNoteTarget(null);
      onRefresh();
      fetchInterrupted();
    } catch (e: any) {
      alert(e.message || 'Failed to add note');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-2 w-full md:w-auto">
          <IconSearch className="w-4 h-4 text-gray-400" />
          <input
            className="w-full md:w-80 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-green-500 outline-none"
            placeholder="Search guest or room..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={`px-3 py-1.5 rounded-full text-sm ${filter==='all'?'bg-gray-900 text-white':'bg-white border border-gray-200 text-gray-700'}`} onClick={()=>setFilter('all')}>All</button>
          <button className={`px-3 py-1.5 rounded-full text-sm ${filter==='today'?'bg-green-600 text-white':'bg-white border border-gray-200 text-gray-700'}`} onClick={()=>setFilter('today')}>Today</button>
          <button className={`px-3 py-1.5 rounded-full text-sm ${filter==='month'?'bg-green-600 text-white':'bg-white border border-gray-200 text-gray-700'}`} onClick={()=>setFilter('month')}>This Month</button>
          <button className={`px-3 py-1.5 rounded-full text-sm ${filter==='pending'?'bg-yellow-500 text-white':'bg-white border border-gray-200 text-gray-700'}`} onClick={()=>setFilter('pending')}>Pending Resumption</button>
          <button className={`px-3 py-1.5 rounded-full text-sm ${filter==='range'?'bg-gray-900 text-white':'bg-white border border-gray-200 text-gray-700'}`} onClick={()=>setFilter('range')}>Date Range</button>
        </div>
      </div>

      {filter === 'range' && (
        <div className="flex items-center gap-2">
          <IconCalendar className="w-4 h-4 text-gray-400" />
          <input type="date" className="border border-gray-200 rounded px-2 py-1 text-sm" value={from} onChange={(e)=>setFrom(e.target.value)} />
          <span className="text-sm text-gray-500">to</span>
          <input type="date" className="border border-gray-200 rounded px-2 py-1 text-sm" value={to} onChange={(e)=>setTo(e.target.value)} />
        </div>
      )}

      <div className="bg-white border rounded-md overflow-hidden">
        {loading ? (
          <div className="py-10 text-center text-gray-500">
            <IconLoader className="w-6 h-6 animate-spin mx-auto mb-2" />
            Loading interrupted stays...
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-10 text-center text-gray-500">No interrupted stays found.</div>
        ) : (
          <table className="min-w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-2">Guest</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-2">Room</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-2">Interrupted</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-2">Credit</th>
                <th className="text-left text-xs font-semibold text-gray-500 px-4 py-2">Status</th>
                <th className="text-right text-xs font-semibold text-gray-500 px-4 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                const name = r.data?.guest_name || r.data?.guest?.full_name;
                const phone = r.data?.guest_phone || r.data?.guest?.phone;
                const email = r.data?.guest_email || r.data?.guest?.email;
                const roomNo = r.data?.room_number;
                const interruptedAt = r.data?.interrupted_at || r.data?.interruption_date || r.created_at;
                const credit = Number(r.data?.credit_remaining || 0);
                const canResume = Boolean(r.data?.can_resume);
                return (
                  <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-900">{name}</div>
                      <div className="text-xs text-gray-500">{phone} {email ? `• ${email}` : ''}</div>
                    </td>
                    <td className="px-4 py-3">
                      Room {roomNo}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {new Date(interruptedAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      ₦{credit.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={canResume ? 'warning' : 'default'}>{canResume ? 'Pending Resumption' : 'Paused'}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setDetailsRecord(r)}>Details</Button>
                        {role === 'front_desk' && (
                          <Button size="sm" onClick={() => setShowResume(true)} className="bg-green-600 hover:bg-green-700 text-white">Resume</Button>
                        )}
                        {['supervisor', 'manager', 'admin'].includes(role || '') && (
                          <Button size="sm" variant="outline" className="text-gray-700" onClick={() => { setNoteTarget(r); }}>Notes</Button>
                        )}
                        {['admin', 'manager'].includes(role || '') && (
                          <Button size="sm" variant="ghost" className="text-red-600" onClick={() => markCancelled(r)} disabled={!!actionLoading}>
                          <IconX className="w-4 h-4" />
                        </Button>
                        )}
                        {['admin', 'manager'].includes(role || '') && (
                          <Button size="sm" variant="ghost" className="text-blue-600" onClick={() => convertToRefund(r)} disabled={!!actionLoading}>
                          <IconCheckCircle className="w-4 h-4" />
                        </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {detailsRecord && (
        <InterruptedStayDetailsModal isOpen={!!detailsRecord} onClose={() => setDetailsRecord(null)} record={detailsRecord} rooms={rooms} />
      )}

      <ResumeInterruptedStay
        isOpen={showResume}
        onClose={() => setShowResume(false)}
        rooms={rooms}
        onSuccess={() => {
          setShowResume(false);
          onRefresh();
          fetchInterrupted();
        }}
      />

      {noteTarget && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-md shadow-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2"><IconNote className="w-4 h-4" /> Add Follow-up Note</h3>
            <textarea className="w-full border-gray-300 rounded-md shadow-sm focus:border-green-500 focus:ring-green-500" rows={4} value={noteText} onChange={(e)=>setNoteText(e.target.value)} />
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="outline" onClick={() => setNoteTarget(null)}>Cancel</Button>
              <Button onClick={addNote} className="bg-green-600 hover:bg-green-700 text-white">Save Note</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
