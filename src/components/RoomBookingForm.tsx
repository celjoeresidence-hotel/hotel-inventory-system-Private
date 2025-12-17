import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

interface BookingPayload {
  type: 'room_booking';
  room_id: string;
  start_date: string; // ISO date
  end_date: string;   // ISO date
  nights: number;
  rate_per_night: number;
  total_cost: number;
  notes?: string;
}

interface RoomOption {
  id: string;
  room_number: string;
  room_type: string;
  price_per_night: number;
}

export default function RoomBookingForm() {
  const { session, isConfigured } = useAuth();
  const [roomId, setRoomId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [ratePerNight, setRatePerNight] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  // Rooms state
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
    const rate = parseFloat(ratePerNight);
    if (isNaN(rate) || rate <= 0 || nights <= 0) return 0;
    return parseFloat((rate * nights).toFixed(2));
  }, [ratePerNight, nights]);

  useEffect(() => {
    async function fetchRooms() {
      setRoomsError(null);
      if (!isConfigured || !supabase) return;
      setRoomsLoading(true);
      try {
        const { data, error } = await supabase
          .from('rooms')
          .select('id, room_number, room_type, price_per_night')
          .eq('is_active', true)
          .order('room_number', { ascending: true });
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
    fetchRooms();
  }, [isConfigured]);

  const selectedRoom = useMemo(() => rooms.find((r) => r.id === roomId) ?? null, [rooms, roomId]);

  function validate(): string | null {
    if (!session || !isConfigured || !supabase) return 'You must be logged in.';
    if (roomsLoading) return 'Rooms are still loading, please wait.';
    if (!rooms || rooms.length === 0) return 'No rooms are available. Please contact an administrator.';
    if (!roomId.trim()) return 'Room selection is required.';
    if (!startDate) return 'Start date is required.';
    if (!endDate) return 'End date is required.';
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return 'Invalid dates.';
    if (e <= s) return 'End date must be after start date.';
    const rate = parseFloat(ratePerNight);
    if (isNaN(rate) || rate <= 0) return 'Rate per night must be a positive number.';
    if (nights <= 0) return 'Nights must be positive.';
    if (totalCost <= 0) return 'Total cost must be positive.';
    return null;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setSubmitting(true);
    try {
      const payload: any = {
        type: 'room_booking',
        room_id: roomId.trim(),
        room_number: selectedRoom?.room_number,
        room_type: selectedRoom?.room_type,
        start_date: startDate,
        end_date: endDate,
        nights,
        rate_per_night: parseFloat(ratePerNight),
        total_cost: totalCost,
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

      setSuccess('Booking recorded successfully.');
      // reset form
      setRoomId('');
      // reset auto rate
      setRatePerNight('');
      setStartDate('');
      setEndDate('');
      setRatePerNight('');
      setNotes('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ maxWidth: 700 }}>
      {/* rooms loading/error banner */}
      {roomsError && (
        <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
          {roomsError}
        </div>
      )}
      {error && (
        <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
          {error}
        </div>
      )}
      {success && (
        <div style={{ background: '#e6ffed', color: '#006b36', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
          {success}
        </div>
      )}

      <div style={{ marginBottom: 12 }}>
        <label>Room ID</label>
        <input
          type="text"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="e.g. 302"
          style={{ width: '100%', padding: 8 }}
        />
      </div>

      {/* Remove old free-text Room ID input and place room dropdown above dates */}

      {/* Booking dates */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label>Booking start date</label>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={{ width: '100%', padding: 8 }} />
        </div>
        <div>
          <label>Booking end date</label>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={{ width: '100%', padding: 8 }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div>
          <label>Nights</label>
          <input type="number" value={nights} readOnly style={{ width: '100%', padding: 8 }} />
        </div>
        <div>
          <label>Rate per night</label>
          <input
            type="number"
            step="0.01"
            value={ratePerNight}
            readOnly
            disabled
            style={{ width: '100%', padding: 8 }}
          />
        </div>
        <div>
          <label>Total booking cost</label>
          <input type="number" value={totalCost} readOnly style={{ width: '100%', padding: 8 }} />
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Room</label>
        {roomsLoading ? (
          <div>Loading rooms...</div>
        ) : (
          <select
            value={roomId}
            onChange={(e) => {
              const newId = e.target.value;
              setRoomId(newId);
              const r = rooms.find((x) => x.id === newId);
              if (r) {
                setRatePerNight(String(r.price_per_night));
              } else {
                setRatePerNight('');
              }
            }}
            style={{ width: '100%', padding: 8 }}
            disabled={!rooms || rooms.length === 0}
          >
            <option value="">Select a room</option>
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                {`${room.room_number} — ${room.room_type || '-'} — ₦${Number(room.price_per_night || 0).toLocaleString()}`}
              </option>
            ))}
          </select>
        )}
        {!roomsLoading && rooms.length === 0 && (
          <div style={{ color: '#900', marginTop: 4 }}>No rooms are available. Please contact an administrator.</div>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label>Notes (optional)</label>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ width: '100%', padding: 8 }} />
      </div>

      <button type="submit" disabled={submitting}>
        {submitting ? 'Submitting...' : 'Submit Booking'}
      </button>
    </form>
  );
}