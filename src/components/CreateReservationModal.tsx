import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { IconAlertCircle } from './ui/Icons';
import { 
  checkDoubleBooking, 
  generateReservationCode, 
  determineInitialStatus, 
  type ReservationData 
} from '../utils/reservationUtils';

interface CreateReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateReservationModal({ isOpen, onClose, onSuccess }: CreateReservationModalProps) {
  const { session, role } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Form State
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  
  const [roomId, setRoomId] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [startTime, setStartTime] = useState('14:00');
  const [endTime, setEndTime] = useState('11:00');
  const [deposit, setDeposit] = useState('');
  const [notes, setNotes] = useState('');
  
  const [rooms, setRooms] = useState<any[]>([]);
  const [checkingConflict, setCheckingConflict] = useState(false);
  const nights = useMemo(() => {
    if (!checkIn || !checkOut) return 0;
    const start = new Date(checkIn).getTime();
    const end = new Date(checkOut).getTime();
    const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    return Math.max(0, diffDays);
  }, [checkIn, checkOut]);
  const selectedRoom = useMemo(() => rooms.find(r => r.id === roomId), [rooms, roomId]);
  const pricePerNight = Number(selectedRoom?.price_per_night || 0);
  const totalRoomCost = pricePerNight * nights;

  useEffect(() => {
    if (isOpen) {
      fetchRooms();
      // Reset form
      setGuestName('');
      setGuestPhone('');
      setGuestEmail('');
      setRoomId('');
      setCheckIn('');
      setCheckOut('');
      setDeposit('');
      setNotes('');
      setError(null);
    }
  }, [isOpen]);

  const fetchRooms = async () => {
    if (!supabase) return;
    const { data } = await supabase
      .from('rooms')
      .select('id, room_number, room_type, price_per_night')
      .eq('is_active', true)
      .order('room_number');
    setRooms(data || []);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user) return;
    
    setError(null);
    setLoading(true);

    try {
      // 1. Validate Dates
      if (checkIn >= checkOut) {
        throw new Error('Check-out date must be after check-in date');
      }

      // 2. Check Conflicts
      setCheckingConflict(true);
      if (!supabase) throw new Error('Supabase client not initialized');
      
      const { isConflict, conflictingRecord } = await checkDoubleBooking(
        supabase, 
        roomId, 
        checkIn, 
        checkOut,
        startTime,
        endTime
      );
      setCheckingConflict(false);

      if (isConflict) {
        const conflictType =
          conflictingRecord &&
          conflictingRecord.data &&
          typeof conflictingRecord.data === 'object' &&
          conflictingRecord.data !== null &&
          'type' in conflictingRecord.data
            ? (conflictingRecord.data as { type: string }).type
            : undefined;
        throw new Error(
          `Room is not available for these dates. Conflict with ${conflictType === 'room_booking' ? 'Active Stay' : 'Existing Reservation'}.`
        );
      }

      // 3. Prepare Data
      const selectedRoomLocal = rooms.find(r => r.id === roomId);
      if (!selectedRoomLocal) throw new Error('Invalid room selected');

      const status = determineInitialStatus(checkIn, role || 'frontdesk');
      
      const reservationData: ReservationData = {
        type: 'room_reservation',
        reservation_code: generateReservationCode(),
        front_desk_staff_id: session.user.id,
        guest: {
          id: null, // New guest
          name: guestName,
          phone: guestPhone,
          email: guestEmail
        },
        room_id: roomId,
        room_number: selectedRoomLocal.room_number,
        room_type: selectedRoomLocal.room_type,
        check_in_date: checkIn,
        check_out_date: checkOut,
        start_time: startTime,
        end_time: endTime,
        expected_nights: nights,
        deposit_amount: Number(deposit) || 0,
        payment_status: Number(deposit) > 0 ? 'deposit_paid' : 'unpaid',
        status: status,
        created_by_role: role || 'frontdesk',
        created_by_user: session.user.id,
        notes: notes
      };

      // 4. Insert Record
      if (!supabase) throw new Error('Supabase client not initialized');
      const { error: insertError } = await supabase
        .from('operational_records')
        .insert({
          entity_type: 'front_desk',
          status: status, // Matches operational_records status column
          data: reservationData,
          financial_amount: Number(deposit) || 0
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
    <Modal isOpen={isOpen} onClose={onClose} title="Create New Reservation" size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm flex items-center gap-2">
            <IconAlertCircle size={16} />
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h4 className="font-medium text-gray-900 border-b pb-1">Guest Details</h4>
            <Input 
              label="Full Name" 
              value={guestName} 
              onChange={e => setGuestName(e.target.value)} 
              required 
            />
            <Input 
              label="Phone" 
              value={guestPhone} 
              onChange={e => setGuestPhone(e.target.value)} 
              required 
            />
            <Input 
              label="Email" 
              type="email" 
              value={guestEmail} 
              onChange={e => setGuestEmail(e.target.value)} 
            />
          </div>

          <div className="space-y-2">
            <h4 className="font-medium text-gray-900 border-b pb-1">Stay Details</h4>
            <div className="grid grid-cols-2 gap-2">
              <Input 
                label="Check In" 
                type="date" 
                value={checkIn} 
                onChange={e => setCheckIn(e.target.value)} 
                required 
                min={new Date().toISOString().split('T')[0]}
              />
              <Input 
                label="Check Out" 
                type="date" 
                value={checkOut} 
                onChange={e => setCheckOut(e.target.value)} 
                required 
                min={checkIn || new Date().toISOString().split('T')[0]}
              />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Input
                label="Start Time"
                type="time"
                value={startTime}
                onChange={e => setStartTime(e.target.value)}
                required
              />
              <Input
                label="End Time"
                type="time"
                value={endTime}
                onChange={e => setEndTime(e.target.value)}
                required
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Room</label>
              <select 
                className="w-full border-gray-300 rounded-md shadow-sm focus:border-green-500 focus:ring-green-500"
                value={roomId}
                onChange={e => setRoomId(e.target.value)}
                required
              >
                <option value="">Select a Room</option>
                {rooms.map(r => (
                  <option key={r.id} value={r.id}>
                    {r.room_number} - {r.room_type} ({r.price_per_night}/night)
                  </option>
                ))}
              </select>
            </div>

            <Input 
              label="Deposit Amount" 
              type="number" 
              value={deposit} 
              onChange={e => setDeposit(e.target.value)} 
              min="0"
            />
            <div className="bg-gray-50 border rounded-md p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Nights</span>
                <span className="font-medium">{nights}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Price / Night</span>
                <span className="font-medium">₦{pricePerNight.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Total Room Cost</span>
                <span className="font-bold text-gray-900">₦{totalRoomCost.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Deposit Entered</span>
                <span className="font-medium text-green-700">₦{(Number(deposit) || 0).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Remaining</span>
                <span className="font-medium">₦{Math.max(0, totalRoomCost - (Number(deposit) || 0)).toLocaleString()}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
          <textarea 
            className="w-full border-gray-300 rounded-md shadow-sm focus:border-green-500 focus:ring-green-500"
            rows={3}
            value={notes}
            onChange={e => setNotes(e.target.value)}
          />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={loading || checkingConflict} className="bg-green-600 hover:bg-green-700 text-white">
            {loading ? 'Creating...' : 'Create Reservation'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
