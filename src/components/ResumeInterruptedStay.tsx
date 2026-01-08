import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import type { RoomStatus } from '../types/frontDesk';
import { IconSearch } from './ui/Icons';
import { format } from 'date-fns';
import { useAuth } from '../context/AuthContext';

interface ResumeInterruptedStayProps {
  isOpen: boolean;
  onClose: () => void;
  rooms: RoomStatus[];
  onSuccess: () => void;
}

export default function ResumeInterruptedStay({ isOpen, onClose, rooms, onSuccess }: ResumeInterruptedStayProps) {
  const { role, ensureActiveSession } = useAuth();
  const [searchName, setSearchName] = useState('');
  const [credits, setCredits] = useState<any[]>([]);
  const [selectedCredit, setSelectedCredit] = useState<any | null>(null);
  const [roomChoice, setRoomChoice] = useState<'same' | 'new'>('same');
  const [newRoomId, setNewRoomId] = useState<string>('');
  const [days, setDays] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setCredits([]);
    setSelectedCredit(null);
    setSearchName('');
    setRoomChoice('same');
    setNewRoomId('');
    setDays(0);
    setError(null);
  }, [isOpen]);

  async function searchCredits() {
    setLoading(true);
    setError(null);
    try {
      const { data } = await supabase!
        .from('operational_records')
        .select('id, created_at, data, status')
        .eq('entity_type', 'front_desk')
        .contains('data', { type: 'interrupted_stay_credit' });
      const rows = (data || []).filter((r: any) => String(r.data?.guest_name || '').toLowerCase().includes(searchName.toLowerCase()));
      setCredits(rows);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function resume() {
    if (role !== 'front_desk') {
      setError('Only Front Desk can resume interrupted stays.');
      return;
    }
    if (!selectedCredit) return;
    setLoading(true);
    setError(null);
    try {
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) { setError('Session expired. Please sign in again.'); setLoading(false); return; }

      const credit = selectedCredit.data || {};
      const targetRoomId = roomChoice === 'same' ? rooms.find(r => r.room_number === credit.room_number)?.id : newRoomId;
      if (!targetRoomId) { setError('Select a valid room'); setLoading(false); return; }

      const today = format(new Date(), 'yyyy-MM-dd');
      const targetRoom = rooms.find(r => r.id === targetRoomId);
      if (targetRoom?.housekeeping_status !== 'clean') { setError('Selected room is not clean. Please choose a cleaned room.'); setLoading(false); return; }

      // Check reservation conflicts for the resumption window
      const start = today;
      const end = format(new Date(new Date().setDate(new Date().getDate() + Math.max(1, days))), 'yyyy-MM-dd');
      const { data: resRows } = await supabase!
        .from('operational_records')
        .select('id, data, status')
        .eq('entity_type', 'front_desk')
        .is('deleted_at', null)
        .filter('data->>type', 'eq', 'room_reservation')
        .filter('data->>room_id', 'eq', String(targetRoomId));
      const hasConflict = (resRows || []).some((r: any) => {
        if (r.status !== 'approved') return false;
        const s = `${r.data.check_in_date}T${(r.data.start_time || '14:00')}:00`;
        const e = `${r.data.check_out_date}T${(r.data.end_time || '11:00')}:00`;
        const reqS = `${start}T14:00:00`;
        const reqE = `${end}T11:00:00`;
        return s < reqE && e > reqS;
      });
      if (hasConflict) { setError('Selected room has a conflicting reservation. Choose another room or adjust days.'); setLoading(false); return; }

      const rate = Number(targetRoom?.price_per_night || 0);
      const nights = days > 0 ? days : Math.ceil(Number(credit.credit_remaining || 0) / (rate || 1));
      const totalCost = rate * nights;
      const balanceImpact = totalCost - Number(credit.credit_remaining || 0);

      // Append a booking segment using remaining credit
      const { error: insErr } = await supabase!.from('operational_records').insert({
        entity_type: 'front_desk',
        data: {
          type: 'room_booking',
          booking_id: crypto.randomUUID(),
          original_id: selectedCredit.data?.booking_id || selectedCredit.id,
          guest: { full_name: credit.guest_name },
          stay: {
            room_id: targetRoomId,
            check_in: today,
            check_out: format(new Date(new Date().setDate(new Date().getDate() + nights)), 'yyyy-MM-dd'),
            adults: 1,
            children: 0
          },
          pricing: {
            room_rate: rate,
            nights,
            total_room_cost: totalCost
          },
          payment: {
            paid_amount: Math.min(totalCost, Number(credit.credit_remaining || 0)),
            payment_method: 'transfer',
            balance: Math.max(0, balanceImpact)
          },
          meta: {
            resumed_from_interruption: true,
            source_credit_id: selectedCredit.id
          },
          status: 'checked_in'
        },
        financial_amount: 0,
        status: 'approved'
      });
      if (insErr) throw insErr;
      
      // Mark the interrupted credit as resumed (non-destructive status update)
      const { error: updErr } = await supabase!
        .from('operational_records')
        .update({
          status: 'converted',
          data: {
            ...selectedCredit.data,
            can_resume: false,
            status: 'resumed',
            resumed_at: new Date().toISOString()
          }
        })
        .eq('id', selectedCredit.id);
      if (updErr) throw updErr;
      
      onSuccess();
      onClose();
    } catch (e: any) {
      setError(e.message || 'Failed to resume interrupted stay');
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <div className="p-6 border-b border-gray-100">
          <h3 className="text-xl font-bold text-gray-900">Resume Interrupted Stay</h3>
        </div>

        <div className="p-6 space-y-6">
          {role !== 'front_desk' && (
            <div className="p-3 bg-yellow-50 text-yellow-700 text-sm rounded-lg">
              Only Front Desk users can perform resumption actions.
            </div>
          )}
          <div className="flex items-center gap-2">
            <IconSearch className="w-4 h-4 text-gray-400" />
            <Input value={searchName} onChange={(e) => setSearchName(e.target.value)} placeholder="Search guest name" />
            <Button variant="outline" onClick={searchCredits} disabled={loading}>Search</Button>
          </div>

          {error && <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Interrupted Credits</label>
              <div className="border rounded-lg p-2 max-h-48 overflow-y-auto">
                {credits.length === 0 ? (
                  <div className="text-sm text-gray-500">No credits found</div>
                ) : credits.map((r: any) => (
                  <label key={r.id} className={`block p-2 rounded cursor-pointer ${selectedCredit?.id === r.id ? 'bg-green-50 border border-green-200' : 'hover:bg-gray-50'}`}>
                    <input type="radio" name="credit" className="mr-2" checked={selectedCredit?.id === r.id} onChange={() => setSelectedCredit(r)} />
                    <span className="text-sm text-gray-800">{r.data?.guest_name} • Room {r.data?.room_number} • ₦{Number(r.data?.credit_remaining || 0).toLocaleString()}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Room Choice</label>
              <Select
                value={roomChoice}
                onChange={(e) => setRoomChoice(e.target.value as any)}
                options={[
                  { value: 'same', label: 'Same Room' },
                  { value: 'new', label: 'New Room' }
                ]}
                fullWidth
              />
              {roomChoice === 'new' && (
                <Select
                  value={newRoomId}
                  onChange={(e) => setNewRoomId(e.target.value)}
                  options={rooms.map(r => ({ value: r.id, label: `${r.room_number} (${r.room_type || '—'})` }))}
                  fullWidth
                />
              )}
              <Input type="number" value={days} onChange={(e) => setDays(Number(e.target.value))} label="Days to apply" placeholder="Optional" />
            </div>
          </div>

        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button className="flex-1" onClick={resume} isLoading={loading} disabled={loading || !selectedCredit || role !== 'front_desk'}>Resume Stay</Button>
        </div>
      </div>
    </div>
  );
}
