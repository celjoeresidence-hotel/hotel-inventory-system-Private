import { useEffect, useState } from 'react';
import { supabase } from '../supabaseClient';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { IconLoader } from './ui/Icons';
import type { RoomStatus } from '../types/frontDesk';

interface InterruptedStayDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  record: any | null;
  rooms: RoomStatus[];
}

export default function InterruptedStayDetailsModal({ isOpen, onClose, record, rooms }: InterruptedStayDetailsModalProps) {
  const [loading, setLoading] = useState(false);
  const [penalties, setPenalties] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);

  useEffect(() => {
    if (!isOpen || !record) return;
    (async () => {
      setLoading(true);
      try {
        const guestName = record.data?.guest_name || record.data?.guest?.full_name || '';
        const originalId = record.original_id || record.id;

        const { data: penaltyRows } = await supabase!
          .from('operational_records')
          .select('id, data, created_at')
          .eq('entity_type', 'front_desk')
          .contains('data', { type: 'penalty_fee' })
          .is('deleted_at', null);
        const filteredPenalties = (penaltyRows || []).filter((r: any) => {
          const linked = String(r.data?.guest?.full_name || '').toLowerCase() === String(guestName).toLowerCase();
          const byOriginal = String(r.original_id || '') === String(originalId);
          return linked || byOriginal;
        });

        const { data: noteRows } = await supabase!
          .from('operational_records')
          .select('id, data, created_at, submitted_by')
          .eq('entity_type', 'front_desk')
          .contains('data', { type: 'operational_note' })
          .is('deleted_at', null);
        const filteredNotes = (noteRows || []).filter((r: any) => {
          const byOriginal = String(r.original_id || '') === String(originalId);
          const linkedName = String(r.data?.guest_name || '').toLowerCase() === String(guestName).toLowerCase();
          return byOriginal || linkedName;
        });

        setPenalties(filteredPenalties);
        setNotes(filteredNotes);
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, record]);

  if (!isOpen || !record) return null;
  const d = record.data || {};
  const room = rooms.find(r => r.room_number === d.room_number);
  const fullName = d.guest_name || d.guest?.full_name || '';
  const phone = d.guest_phone || d.guest?.phone || '';
  const email = d.guest_email || d.guest?.email || '';
  const nationality = d.guest_nationality || '';
  const checkInDate = d.check_in_date || d.stay?.check_in || '';
  const checkInTime = d.check_in_time || '';
  const interruptedDate = d.interrupted_at?.split('T')[0] || d.interruption_date || '';
  const interruptedTime = d.interrupted_at?.split('T')[1]?.slice(0,5) || '';
  const expectedReturnDate = d.expected_return_date || '';
  const expectedReturnTime = d.expected_return_time || '';
  const totalPaid = Number(d.total_paid || 0);
  const amountUsed = Number(d.amount_used || d.days_used || 0);
  const remainingCredit = Number(d.credit_remaining || 0);
  const outstanding = Math.max(0, Number(d.outstanding_balance || 0));

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Interrupted Stay Details" size="lg">
      <div className="space-y-6">
        {loading && <div className="text-sm text-gray-500 flex items-center gap-2"><IconLoader className="w-4 h-4 animate-spin" /> Loading linked records...</div>}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-md">
          <div>
            <div className="text-xs text-gray-500">Guest</div>
            <div className="font-semibold text-gray-900">{fullName}</div>
            <div className="text-xs text-gray-600">{phone}</div>
            {email && <div className="text-xs text-gray-600">{email}</div>}
            {nationality && <div className="text-xs text-gray-600">Nationality: {nationality}</div>}
          </div>
          <div>
            <div className="text-xs text-gray-500">Room</div>
            <div className="font-semibold text-gray-900">Room {d.room_number} {room?.room_name ? `• ${room.room_name}` : ''}</div>
            <div className="text-xs text-gray-600">{room?.room_type}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border rounded-md p-4">
            <div className="font-medium text-gray-900 mb-2">Original Stay</div>
            <div className="text-sm text-gray-700">Check-in: {checkInDate} {checkInTime || ''}</div>
            <div className="text-sm text-gray-700">Interrupted: {interruptedDate} {interruptedTime || ''}</div>
            {(expectedReturnDate || expectedReturnTime) && (
              <div className="text-sm text-gray-700">Expected Return: {expectedReturnDate} {expectedReturnTime || ''}</div>
            )}
          </div>
          <div className="border rounded-md p-4">
            <div className="font-medium text-gray-900 mb-2">Financials</div>
            <div className="text-sm text-gray-700">Total Paid: ₦{totalPaid.toLocaleString()}</div>
            <div className="text-sm text-gray-700">Amount Used: {amountUsed}</div>
            <div className="text-sm text-gray-700">Remaining Credit: ₦{remainingCredit.toLocaleString()}</div>
            <div className="text-sm text-gray-700">Outstanding Balance: ₦{outstanding.toLocaleString()}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border rounded-md p-4">
            <div className="font-medium text-gray-900 mb-2">Linked Fines</div>
            {penalties.length === 0 ? (
              <div className="text-sm text-gray-500">No fines recorded</div>
            ) : (
              <ul className="space-y-1 text-sm">
                {penalties.map(p => (
                  <li key={p.id} className="flex justify-between">
                    <span>{p.data?.reason || 'Penalty'}</span>
                    <span className="font-medium">₦{Number(p.data?.amount || 0).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="border rounded-md p-4">
            <div className="font-medium text-gray-900 mb-2">Follow-up Notes</div>
            {notes.length === 0 ? (
              <div className="text-sm text-gray-500">No notes yet</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {notes.map(n => (
                  <li key={n.id}>
                    <div className="text-gray-800">{n.data?.note || ''}</div>
                    <div className="text-xs text-gray-500">By: {n.data?.staff_name || 'Staff'} • {n.data?.department || 'Frontdesk'} • {new Date(n.created_at).toLocaleString()}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => window.print()}>Print</Button>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}
