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

      // 2. Fetch Front Desk Records (Bookings, Checkouts, Housekeeping)
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
      const reservations: any[] = []; // Store reservations
      const housekeepingReports: any[] = []; // Store housekeeping reports (latest per room used for status)
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

      // Sort bookings & reservations
      recordsData?.forEach((rec) => {
        const d = rec.data as any; // Use any to support room_reservation
        
        // Handle Active Bookings (Stays)
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
        
        // Handle Reservations
        if (d.type === 'room_reservation') {
           reservations.push({ ...rec, data: d });
        }

        // Handle Housekeeping Reports
        if (d.type === 'housekeeping_report') {
          housekeepingReports.push({ ...rec, data: d });
        }
      });

      setActiveBookings(active);
      setPastBookings(past);

      // 4. Build Room Status
      const today = new Date().toISOString().split('T')[0];
      
      const roomStatusList: RoomStatus[] = (roomsData || []).map((r) => {
        // Find if occupied (Active Booking)
        const booking = active.find(b => String(b.data.stay?.room_id) === String(r.id));
        
        // Find if reserved (Approved Reservation overlapping today)
        const reservation = reservations.find(res => {
            if (res.status !== 'approved') return false;
            if (String(res.data.room_id) !== String(r.id)) return false;
            
            // Check overlap with today
            // If check_in <= today < check_out
            return res.data.check_in_date <= today && res.data.check_out_date > today;
        });

        let status: RoomStatus['status'] = 'available';
        let current_guest = undefined;
        let check_out_date = undefined;

        if (booking) {
          status = 'occupied';
          current_guest = booking.data.guest?.full_name;
          check_out_date = booking.data.stay?.check_out;
        } else if (reservation) {
          status = 'reserved';
          current_guest = reservation.data.guest.name;
          check_out_date = reservation.data.check_out_date;
        } else {
          // Consider latest housekeeping report
          const latestHK = housekeepingReports
            .filter(h => String(h.data.room_id) === String(r.id))
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
          if (latestHK) {
            const hkStatus = String(latestHK.data.housekeeping_status || '').toLowerCase();
            if (hkStatus === 'dirty') {
              status = 'cleaning';
            } else if (hkStatus === 'maintenance') {
              status = 'maintenance';
            } else if (hkStatus === 'inspected' || hkStatus === 'cleaned') {
              status = 'available';
            } else {
              status = 'pending';
            }
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
