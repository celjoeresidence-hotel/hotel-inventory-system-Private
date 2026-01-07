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
  const [dashboardStats, setDashboardStats] = useState<{ totalPaymentsToday: number }>({ totalPaymentsToday: 0 });
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
        .select('id, original_id, data, created_at, status, deleted_at')
        .eq('entity_type', 'front_desk')
        .in('status', ['approved', 'pending'])
        .is('deleted_at', null);

      if (recordsError) throw recordsError;

      // 3. Process Data
      const active: BookingWithId[] = [];
      const past: BookingWithId[] = [];
      const checkouts: BookingWithId[] = [];
      const reservations: any[] = []; // Store reservations
      const housekeepingReports: any[] = []; // Store housekeeping reports (latest per room used for status)
      const checkedOutBookingIds = new Set<string>();
      
      let paymentsToday = 0;
      const todayStr = new Date().toISOString().split('T')[0];

      // Identify checkouts first
      recordsData?.forEach((rec) => {
        const d = rec.data as FrontDeskRecordData;
        
        // Calculate daily payments
        const recDate = (d as any).date || (d as any).payment_date || (d as any).checkout_date || rec.created_at;
        if (recDate && recDate.startsWith(todayStr)) {
            if ((d as any).type === 'payment_record') {
                paymentsToday += Number((d as any).amount || 0);
            }
            if (d.type === 'checkout_record') {
                paymentsToday += Number(d.checkout?.final_payment || (d as any).final_payment || 0);
            }
        }

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
      setDashboardStats({ totalPaymentsToday: paymentsToday });

      // Map rooms for enrichment
      const roomMap = new Map<string, string>();
      roomsData?.forEach((r) => roomMap.set(String(r.id), r.room_number));

      // Precompute extension and transfer maps for segment logic
      const extensionMap = new Map<string, string>();
      const transferEndMap = new Map<string, string>();
      const interruptionEndMap = new Map<string, string>();
      const interruptedCreditsByRoom = new Map<string, boolean>();
      const resumedCreditIds = new Set<string>();
      const refundedCreditIds = new Set<string>();
      recordsData?.forEach((rec) => {
        const d = rec.data as any;
        if (d?.type === 'stay_extension' && d?.booking_id && d?.extension?.new_check_out) {
          const prev = extensionMap.get(String(d.booking_id));
          const next = String(d.extension.new_check_out);
          if (!prev || next > prev) extensionMap.set(String(d.booking_id), next);
        }
        if (d?.type === 'room_transfer' && d?.booking_id && d?.transfer?.transfer_date) {
          const prev = transferEndMap.get(String(d.booking_id));
          const next = String(d.transfer.transfer_date);
          if (!prev || next > prev) transferEndMap.set(String(d.booking_id), next);
        }
        if (d?.type === 'stay_interruption' && d?.booking_id && d?.interruption_date) {
          const prev = interruptionEndMap.get(String(d.booking_id));
          const next = String(d.interruption_date);
          if (!prev || next > prev) interruptionEndMap.set(String(d.booking_id), next);
        }
        if (d?.type === 'room_booking' && d?.meta?.resumed_from_interruption && d?.meta?.source_credit_id) {
          resumedCreditIds.add(String(d.meta.source_credit_id));
        }
        if (d?.type === 'refund_record' && d?.source_credit_id) {
          refundedCreditIds.add(String(d.source_credit_id));
        }
        if (
          d?.type === 'interrupted_stay_credit' &&
          d?.room_number &&
          d?.can_resume === true &&
          String((d?.status || '')).toLowerCase() !== 'resumed' &&
          !resumedCreditIds.has(String(rec.id)) &&
          !refundedCreditIds.has(String(rec.id)) &&
          Number(d?.credit_remaining || 0) > 0
        ) {
          // Map room id via roomsData later; for now store room_number marker
          interruptedCreditsByRoom.set(String(d.room_number), true);
        }
      });

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

          // Apply segment logic: effective check_out
          const ext = extensionMap.get(String(booking.id)) || extensionMap.get(String(booking.original_id));
          const transferEnd = transferEndMap.get(String(booking.id)) || transferEndMap.get(String(booking.original_id));
          const interruptionEnd = interruptionEndMap.get(String(booking.id)) || interruptionEndMap.get(String(booking.original_id));
          if (d.stay) {
            const effectiveStay = { ...d.stay };
            if (ext && (!transferEnd || ext > transferEnd)) {
              effectiveStay.check_out = ext;
            }
            if (transferEnd) {
              effectiveStay.check_out = transferEnd;
            }
            if (interruptionEnd) {
              effectiveStay.check_out = interruptionEnd;
            }
            booking.data = { ...booking.data, stay: effectiveStay };
          }

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
      const now = new Date();
      const nowStr = `${now.toISOString().split('T')[0]}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`;
      const today = new Date().toISOString().split('T')[0];
      
      const roomStatusList: RoomStatus[] = (roomsData || []).map((r) => {
        // Find if occupied (Active Booking)
        const booking = active.find(b => String(b.data.stay?.room_id) === String(r.id));
        
        // Find if reserved (Approved Reservation overlapping today)
        const reservation = reservations.find(res => {
            if (res.status !== 'approved') return false;
            if (String(res.data.room_id) !== String(r.id)) return false;
            const start = `${res.data.check_in_date}T${(res.data.start_time || '14:00')}:00`;
            const end = `${res.data.check_out_date}T${(res.data.end_time || '11:00')}:00`;
            return start <= nowStr && end > nowStr;
        });

        // Find upcoming reservation (Approved, starting after today or currently active but in future)
        // We want the *next* one starting today or later, but if it's the current 'reservation' (active today), we might want the *next* one after that?
        // Requirement: "Upcoming reservation (if any)".
        // If the room is currently reserved (active today), the "upcoming" one is the *next* one.
        // If the room is available, the "upcoming" one is the first one in future.
        const upcomingRes = reservations
            .filter(res => {
                if (res.status !== 'approved') return false;
                if (String(res.data.room_id) !== String(r.id)) return false;
                const start = `${res.data.check_in_date}T${(res.data.start_time || '14:00')}:00`;
                return start > nowStr; 
            })
            .sort((a, b) => {
              const aStart = new Date(`${a.data.check_in_date}T${(a.data.start_time || '14:00')}:00`).getTime();
              const bStart = new Date(`${b.data.check_in_date}T${(b.data.start_time || '14:00')}:00`).getTime();
              return aStart - bStart;
            })[0];


        let status: RoomStatus['status'] = 'available';
        let current_guest = undefined;
        let check_out_date = undefined;
        let housekeeping_status: RoomStatus['housekeeping_status'] = 'not_reported';
        let interrupted = false;
        let pending_resumption = false;

        // Determine Housekeeping Status from latest report
        const latestHK = housekeepingReports
        .filter(h => String(h.data.room_id) === String(r.id))
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
        
        if (latestHK) {
            const hkStatus = String(latestHK.data.housekeeping_status || '').toLowerCase();
            if (hkStatus === 'dirty') {
                housekeeping_status = 'dirty';
            } else if (hkStatus === 'inspected' || hkStatus === 'cleaned') {
                housekeeping_status = 'clean';
            }
        }

        if (booking) {
          status = 'occupied';
          current_guest = booking.data.guest?.full_name;
          check_out_date = booking.data.stay?.check_out;
          // If interruption end is today or before today, treat as available
          const intEnd = interruptionEndMap.get(String(booking.id)) || interruptionEndMap.get(String(booking.original_id));
          if (intEnd && intEnd <= today) {
            status = 'available';
            current_guest = undefined;
          }
          interrupted = Boolean(intEnd && intEnd <= today);
        } else if (reservation) {
          status = 'reserved';
          current_guest = reservation.data.guest.name;
          check_out_date = `${reservation.data.check_out_date} ${reservation.data.end_time || '11:00'}`;
        } else {
          // Determine status based on housekeeping/maintenance if not occupied/reserved
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

        // Pending resumption if there's interrupted credit for this room number
        if (interruptedCreditsByRoom.get(String(r.room_number))) {
          pending_resumption = true;
        }

        return {
          id: String(r.id),
          room_number: r.room_number,
          room_name: r.room_name,
          room_type: r.room_type,
          price_per_night: Number(r.price_per_night),
          status,
          current_guest,
          check_out_date,
          housekeeping_status,
          interrupted,
          pending_resumption,
          upcoming_reservation: upcomingRes ? {
            guest_name: upcomingRes.data.guest.name,
            check_in: `${upcomingRes.data.check_in_date} ${upcomingRes.data.start_time || '14:00'}`,
            check_out: `${upcomingRes.data.check_out_date} ${upcomingRes.data.end_time || '11:00'}`
          } : undefined
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
    const interval = setInterval(() => {
      fetchData();
    }, 60000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return { rooms, activeBookings, pastBookings, checkoutRecords, dashboardStats, loading, error, refresh: fetchData };
}
