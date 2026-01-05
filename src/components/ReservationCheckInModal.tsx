import { useState } from 'react';
import { supabase } from '../supabaseClient';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { IconCheckCircle, IconLoader } from './ui/Icons';
import { useAuth } from '../context/AuthContext';

interface ReservationCheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: any;
  onSuccess: () => void;
}

export default function ReservationCheckInModal({ isOpen, onClose, booking, onSuccess }: ReservationCheckInModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { ensureActiveSession } = useAuth();

  if (!booking) return null;

  const handleCheckIn = async () => {
    setLoading(true);
    setError(null);
    try {
      const client = supabase;
      if (!client) throw new Error('Supabase client not initialized');
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) { setError('Session expired. Please sign in again to continue.'); return; }

      // 1. Update the booking to mark as checked_in
      // We store 'checked_in' status in metadata since enum is locked
      const updatedData = {
        ...booking.data,
        reservation_status: 'checked_in',
        checked_in_at: new Date().toISOString()
      };

      const { error: updateError } = await client
        .from('operational_records')
        .update({ data: updatedData })
        .eq('id', booking.id);

      if (updateError) throw updateError;

      // 2. Create a guest_record to signify active guest presence (if not already existing)
      // FrontDeskForm creates a guest_record linked by original_id. We should match that pattern.
      // Check if one exists first? Assuming not for a fresh check-in.
      
      const guestPayload = {
        type: 'guest_record',
        front_desk_staff_id: booking.data.front_desk_staff_id, // Carry over staff
        guest: booking.data.guest,
        stay: booking.data.stay,
        meta: { 
            notes: booking.data.meta?.notes, 
            source_booking_id: booking.id,
            checked_in_at: new Date().toISOString()
        },
      };

      const { error: insertError } = await client
        .from('operational_records')
        .insert({
          entity_type: 'front_desk',
          data: guestPayload,
          financial_amount: 0,
          original_id: booking.id, // Link to booking
          status: 'approved' // Auto-approve check-ins
        });

      if (insertError) throw insertError;

      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Check In Guest">
      <div className="space-y-4">
        <div className="bg-gray-50 p-4 rounded-md">
            <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                    <span className="block text-gray-500">Guest</span>
                    <span className="font-medium">{booking.data?.guest?.full_name}</span>
                </div>
                <div>
                    <span className="block text-gray-500">Room</span>
                    <span className="font-medium">{booking.room_number || 'Assigned'}</span>
                </div>
                <div>
                    <span className="block text-gray-500">Check In</span>
                    <span className="font-medium">{booking.data?.stay?.check_in}</span>
                </div>
                <div>
                    <span className="block text-gray-500">Check Out</span>
                    <span className="font-medium">{booking.data?.stay?.check_out}</span>
                </div>
            </div>
        </div>

        <div className="text-sm text-gray-600">
            Confirming check-in will mark the reservation as active and log the guest arrival.
        </div>

        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleCheckIn} disabled={loading} className="bg-green-600 hover:bg-green-700 text-white">
            {loading ? <IconLoader className="animate-spin w-4 h-4 mr-2" /> : <IconCheckCircle className="w-4 h-4 mr-2" />}
            Confirm Check In
          </Button>
        </div>
      </div>
    </Modal>
  );
}
