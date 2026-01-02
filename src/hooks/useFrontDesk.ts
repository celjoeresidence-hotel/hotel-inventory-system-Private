import { useState, useEffect, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import type { FrontDeskRecordData, RoomStatus } from '../types/frontDesk';

export interface BookingWithId {
  id: string; // The record ID
  original_id: string;
  data: FrontDeskRecordData;
  created_at: string;
  room_number?: string; // Enriched
}

export function useFrontDesk() {
  const [rooms, setRooms] = useState<RoomStatus[]>([]);
  const [activeBookings, setActiveBookings] = useState<BookingWithId[]>([]);
  const [pastBookings, setPastBookings] = useState<BookingWithId[]>([]);
  const [checkoutRecords, setCheckoutRecords] = useState<BookingWithId[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!isSupabaseConfigured || !supabase) return;
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch Rooms
      const { data: roomsData, error: roomsError } = await supabase
        .from('rooms')
        .select('id, room_number, room_name, room_type, price_per_night, is_active')
        .eq('is_active', true)
        .order('room_number');

      if (roomsError) throw roomsError;

      // 2. Fetch Front Desk Records (Bookings & Checkouts)
      const { data: recordsData, error: recordsError } = await supabase
        .from('operational_records')
        .select('id, original_id, data, created_at, status')
        .eq('entity_type', 'front_desk')
        .in('status', ['approved', 'pending']);

      if (recordsError) throw recordsError;

      // 3. Process Data
      const active: BookingWithId[] = [];
      const past: BookingWithId[] = [];
      const checkouts: BookingWithId[] = [];
      const checkedOutBookingIds = new Set<string>();

      // Identify checkouts first
      recordsData?.forEach((rec) => {
        const d = rec.data as FrontDeskRecordData;
        if (d.type === 'checkout_record') {
           const booking: BookingWithId = {
            id: rec.id,
            original_id: rec.original_id,
            data: d,
            created_at: rec.created_at,
            room_number: (d as any).room_number || 'Unknown'
          };
          checkouts.push(booking);

          if ((d as any).booking_id) {
            checkedOutBookingIds.add((d as any).booking_id);
          }
        }
      });

      setCheckoutRecords(checkouts);

      // Map rooms for enrichment
      const roomMap = new Map<string, string>();
      roomsData?.forEach((r) => roomMap.set(String(r.id), r.room_number));

      // Sort bookings
      recordsData?.forEach((rec) => {
        const d = rec.data as FrontDeskRecordData;
        if (d.type === 'room_booking' && d.stay && d.guest) {
          const booking: BookingWithId = {
            id: rec.id,
            original_id: rec.original_id,
            data: d,
            created_at: rec.created_at,
            room_number: d.stay.room_id ? roomMap.get(String(d.stay.room_id)) : 'Unknown'
          };

          if (checkedOutBookingIds.has(rec.id) || checkedOutBookingIds.has(rec.original_id)) {
            past.push(booking);
          } else {
            active.push(booking);
          }
        }
      });

      setActiveBookings(active);
      setPastBookings(past);

      // 4. Build Room Status
      const roomStatusList: RoomStatus[] = (roomsData || []).map((r) => {
        // Find if occupied
        const booking = active.find(b => String(b.data.stay?.room_id) === String(r.id));
        
        let status: RoomStatus['status'] = 'available';
        let current_guest = undefined;
        let check_out_date = undefined;

        if (booking) {
          status = 'occupied';
          current_guest = booking.data.guest?.full_name;
          check_out_date = booking.data.stay?.check_out;
          
          const today = new Date().toISOString().split('T')[0];
          if (booking.data.stay?.check_in && booking.data.stay.check_in > today) {
            status = 'reserved';
          }
        }

        return {
          id: String(r.id),
          room_number: r.room_number,
          room_name: r.room_name,
          room_type: r.room_type,
          price_per_night: Number(r.price_per_night),
          status,
          current_guest,
          check_out_date
        };
      });

      setRooms(roomStatusList);

    } catch (err: any) {
      console.error('Error fetching front desk data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return { rooms, activeBookings, pastBookings, checkoutRecords, loading, error, refresh: fetchData };
}
