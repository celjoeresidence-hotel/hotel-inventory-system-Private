import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { 
  IconCalendar, 
  IconBed, 
  IconCurrencyDollar, 
  IconNote, 
  IconCheckCircle,
  IconAlertCircle,
  IconLoader,
  IconUser
} from './ui/Icons';

interface RoomOption {
  id: string;
  room_number: string;
  room_type: string;
  price_per_night: number;
}

export default function RoomBookingForm() {
  const { session, isConfigured, ensureActiveSession } = useAuth();
  
  // Form State
  const [roomId, setRoomId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ratePerNight, setRatePerNight] = useState<number>(0);
  const [notes, setNotes] = useState('');
  
  // Guest State
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [guestEmail, setGuestEmail] = useState('');

  // UI State
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  
  // Data State
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [roomsLoading, setRoomsLoading] = useState<boolean>(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);

  const nights = useMemo(() => {
    if (!startDate || !endDate) return 0;
    const s = new Date(startDate);
    const e = new Date(endDate);
    const ms = e.getTime() - s.getTime();
    if (isNaN(ms) || ms <= 0) return 0;
    return Math.ceil(ms / (1000 * 60 * 60 * 24));
  }, [startDate, endDate]);

  const totalCost = useMemo(() => {
    if (ratePerNight <= 0 || nights <= 0) return 0;
    return Number((ratePerNight * nights).toFixed(2));
  }, [ratePerNight, nights]);

  useEffect(() => {
    async function fetchAvailableRooms() {
      setRoomsError(null);
      if (!isConfigured || !supabase) return;
      
      // Only fetch if we have valid dates
      if (!startDate || !endDate) {
        setRooms([]);
        return;
      }
      
      const s = new Date(startDate);
      const e = new Date(endDate);
      if (isNaN(s.getTime()) || isNaN(e.getTime()) || e <= s) {
         setRooms([]);
         return;
      }

      setRoomsLoading(true);
      try {
        const { data, error } = await supabase
          .rpc('get_available_rooms', { 
            _check_in: startDate, 
            _check_out: endDate 
          });

        if (error) {
          setRoomsError(error.message);
          setRooms([]);
          return;
        }
        
        const mapped: RoomOption[] = (data ?? []).map((r: any) => ({
          id: String(r.id),
          room_number: String(r.room_number ?? ''),
          room_type: String(r.room_type ?? ''),
          price_per_night: Number(r.price_per_night ?? 0),
        }));
        setRooms(mapped);
      } finally {
        setRoomsLoading(false);
      }
    }
    fetchAvailableRooms();
  }, [isConfigured, startDate, endDate]);

  const selectedRoom = useMemo(() => rooms.find((r) => r.id === roomId) ?? null, [rooms, roomId]);

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (!session || !isConfigured || !supabase) errs.general = 'You must be logged in.';
    if (roomsLoading) errs.general = 'Rooms are still loading, please wait.';
    if (!rooms || rooms.length === 0) errs.general = 'No active rooms available';
    
    if (!roomId.trim()) errs.roomId = 'Room selection is required.';
    
    if (!startDate) errs.startDate = 'Start date is required.';
    if (!endDate) errs.endDate = 'End date is required.';
    
    const s = new Date(startDate);
    const e = new Date(endDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    if (startDate && isNaN(s.getTime())) errs.startDate = 'Invalid start date.';
    if (endDate && isNaN(e.getTime())) errs.endDate = 'Invalid end date.';
    
    if (startDate && !isNaN(s.getTime()) && s < now) errs.startDate = 'Start date cannot be in the past.';
    if (startDate && endDate && !isNaN(s.getTime()) && !isNaN(e.getTime()) && e <= s) {
      errs.endDate = 'End date must be after start date.';
    }

    if (!guestName.trim()) errs.guestName = 'Guest name is required.';
    if (!guestPhone.trim()) errs.guestPhone = 'Guest phone is required.';

    if (ratePerNight <= 0) errs.general = 'Rate per night must be a positive number.';
    if (nights <= 0 && !errs.startDate && !errs.endDate) errs.general = 'Nights must be positive.';
    
    setFieldErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    
    if (!validate()) return;

    setSubmitting(true);
    try {
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) {
        setError('Session expired. Please sign in again to continue.');
        return;
      }

      // 1. Pre-check availability
      const { data: isAvailable, error: availError } = await supabase!
        .rpc('check_room_availability', {
          _room_id: roomId,
          _check_in: startDate,
          _check_out: endDate
        });

      if (availError) {
        setError(availError.message);
        return;
      }
      
      if (!isAvailable) {
        setError('Selected room is no longer available for these dates.');
        // Refresh availability
        const { data: newRooms } = await supabase!
          .rpc('get_available_rooms', { 
            _check_in: startDate, 
            _check_out: endDate 
          });
        if (newRooms) {
           const mapped: RoomOption[] = newRooms.map((r: any) => ({
             id: String(r.id),
             room_number: String(r.room_number ?? ''),
             room_type: String(r.room_type ?? ''),
             price_per_night: Number(r.price_per_night ?? 0),
           }));
           setRooms(mapped);
        }
        return;
      }

      const payload: any = {
        type: 'room_booking',
        room_id: roomId.trim(),
        room_number: selectedRoom?.room_number,
        room_type: selectedRoom?.room_type,
        start_date: startDate,
        end_date: endDate,
        nights,
        rate_per_night: ratePerNight,
        total_cost: totalCost,
        guest_name: guestName.trim(),
        guest_phone: guestPhone.trim(),
        guest_email: guestEmail.trim() || undefined,
        notes: notes.trim() || undefined,
      };

      const insertBody = {
        entity_type: 'front_desk',
        data: payload,
        financial_amount: totalCost,
      };

      const { error } = await supabase!
        .from('operational_records')
        .insert(insertBody);

      if (error) {
        setError(error.message);
        return;
      }

      setSuccess('Booking submitted for supervisor approval.');
      // reset form
      setRoomId('');
      setRatePerNight(0);
      setStartDate('');
      setEndDate('');
      setNotes('');
      setGuestName('');
      setGuestPhone('');
      setGuestEmail('');
      setFieldErrors({});
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center space-x-3 mb-2">
        <div className="bg-green-50 p-2 rounded-lg">
          <IconCalendar className="w-6 h-6 text-green-600" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">New Room Booking</h2>
          <p className="text-gray-500 text-sm">Create a future reservation</p>
        </div>
      </div>

      <Card className="p-6 md:p-8 shadow-sm border border-gray-100">
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Status Messages */}
          {roomsError && (
            <div className="bg-error-light border border-error-light text-error px-4 py-3 rounded-md flex items-start gap-2">
              <IconAlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <p>{roomsError}</p>
            </div>
          )}
          
          {(error || fieldErrors.general) && (
            <div className="bg-error-light border border-error-light text-error px-4 py-3 rounded-md flex items-start gap-2 animate-fadeIn">
              <IconAlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <p>{error || fieldErrors.general}</p>
            </div>
          )}

          {success && (
            <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-md flex items-start gap-2 animate-fadeIn">
              <IconCheckCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <p>{success}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left Column: Details */}
            <div className="space-y-8">
              {/* Room Selection Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 flex items-center gap-2">
                  <IconBed className="w-5 h-5 text-gray-500" />
                  Room Details
                </h3>
                
                <div className="space-y-4">
                  {roomsLoading ? (
                    <div className="flex items-center justify-center py-8 text-gray-500 bg-gray-50 rounded-lg border border-dashed border-gray-200">
                      <IconLoader className="w-6 h-6 animate-spin mr-2" />
                      Loading available rooms...
                    </div>
                  ) : (
                    <Select
                      label="Select Room"
                      value={roomId}
                      onChange={(e) => {
                        const newId = e.target.value;
                        setRoomId(newId);
                        const r = rooms.find((x) => x.id === newId);
                        if (r) {
                          setRatePerNight(Number(r.price_per_night));
                        } else {
                          setRatePerNight(0);
                        }
                      }}
                      disabled={roomsLoading || !rooms || rooms.length === 0}
                      error={fieldErrors.roomId || ((!rooms || rooms.length === 0) && !roomsLoading ? "No rooms available" : undefined)}
                      options={[
                        { value: "", label: "Select a room..." },
                        ...rooms.map((room) => ({
                          value: room.id,
                          label: `${room.room_number} — ${room.room_type || '-'} — ₦${Number(room.price_per_night || 0).toLocaleString()}`
                        }))
                      ]}
                      fullWidth
                    />
                  )}
                </div>
              </div>

              {/* Date Selection Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 flex items-center gap-2">
                  <IconCalendar className="w-5 h-5 text-gray-500" />
                  Stay Duration
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Input
                    type="date"
                    label="Check-in Date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    min={new Date().toISOString().split('T')[0]}
                    required
                    error={fieldErrors.startDate}
                    fullWidth
                  />
                  <Input
                    type="date"
                    label="Check-out Date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    min={startDate || new Date().toISOString().split('T')[0]}
                    required
                    error={fieldErrors.endDate}
                    fullWidth
                  />
                </div>
              </div>

              {/* Guest Details Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-gray-800 border-b pb-2 flex items-center gap-2">
                  <IconUser className="w-5 h-5 text-gray-500" />
                  Guest Information
                </h3>
                
                <div className="space-y-4">
                  <Input
                    label="Guest Full Name"
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="e.g. John Doe"
                    required
                    error={fieldErrors.guestName}
                    fullWidth
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <Input
                      label="Phone Number"
                      type="tel"
                      value={guestPhone}
                      onChange={(e) => setGuestPhone(e.target.value)}
                      placeholder="e.g. 08012345678"
                      required
                      error={fieldErrors.guestPhone}
                      fullWidth
                    />
                    <Input
                      label="Email Address"
                      type="email"
                      value={guestEmail}
                      onChange={(e) => setGuestEmail(e.target.value)}
                      placeholder="Optional"
                      fullWidth
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Summary & Actions */}
            <div className="space-y-8">
              {/* Cost Calculation Section */}
              <div className="bg-gray-50 p-6 rounded-lg border border-gray-100 space-y-6 sticky top-6">
                <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                  <IconCurrencyDollar className="w-5 h-5 text-gray-500" />
                  Booking Summary
                </h3>
                
                <div className="space-y-4">
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-gray-600">Room</span>
                    <span className="font-medium text-gray-900">{selectedRoom?.room_number || '—'}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-gray-600">Rate per Night</span>
                    <span className="font-medium text-gray-900">₦{ratePerNight.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between items-center py-2 border-b border-gray-200">
                    <span className="text-gray-600">Total Nights</span>
                    <span className="font-medium text-gray-900">{nights}</span>
                  </div>
                  
                  <div className="flex justify-between items-center pt-4">
                    <span className="text-lg font-bold text-gray-800">Total Cost</span>
                    <span className="text-2xl font-bold text-green-700">
                      ₦{totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>

                {/* Additional Notes */}
                <div className="space-y-2 pt-4">
                  <label className="block text-sm font-medium text-gray-700 flex items-center gap-2">
                    <IconNote className="w-4 h-4" />
                    Notes (Optional)
                  </label>
                  <textarea 
                    className="w-full rounded-lg border border-gray-300 shadow-sm focus:border-green-500 focus:ring-2 focus:ring-green-500/20 min-h-[100px] p-3 text-sm bg-white transition-all outline-none"
                    placeholder="Special requests, guest preferences, etc."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                  />
                </div>

                {/* Submit Button */}
                <div className="pt-4">
                  <Button 
                    type="submit" 
                    disabled={submitting || roomsLoading} 
                    isLoading={submitting}
                    size="lg"
                    className="w-full shadow-lg hover:shadow-xl transition-shadow"
                  >
                    Confirm Booking
                  </Button>
                  <p className="text-xs text-center text-gray-500 mt-3">
                    This will create a pending reservation record.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
}
