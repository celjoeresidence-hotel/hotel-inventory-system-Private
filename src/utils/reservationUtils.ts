import { SupabaseClient } from '@supabase/supabase-js';

export interface ReservationData {
  type: 'room_reservation';
  reservation_code: string;
  front_desk_staff_id?: string;
  guest: {
    id: string | null;
    name: string;
    phone: string;
    email: string;
  };
  room_id: string;
  room_number: string;
  room_type: string;
  check_in_date: string;
  check_out_date: string;
  expected_nights: number;
  deposit_amount: number;
  payment_status: 'unpaid' | 'deposit_paid' | 'fully_paid';
  status: 'pending' | 'approved' | 'converted' | 'cancelled' | 'expired';
  created_by_role: string;
  created_by_user: string;
  notes: string;
}

export const generateReservationCode = () => {
  const year = new Date().getFullYear();
  const random = Math.floor(10000 + Math.random() * 90000);
  return `RES-${year}-${random}`;
};

export const checkDoubleBooking = async (
  client: SupabaseClient,
  roomId: string,
  checkIn: string,
  checkOut: string,
  excludeReservationId?: string
): Promise<{ isConflict: boolean; conflictingRecord?: any }> => {
  // Helper to check overlap using robust string comparison (YYYY-MM-DD)
  const isOverlap = (startA: string, endA: string, startB: string, endB: string) => {
    const sA = startA.split('T')[0];
    const eA = endA.split('T')[0];
    const sB = startB.split('T')[0];
    const eB = endB.split('T')[0];
    return sA < eB && eA > sB;
  };

  // 1. Check Active Stays (room_booking)
  // Fetch all approved bookings for this room, then filter in JS to avoid DB date string issues
  const { data: stays, error: stayError } = await client
    .from('operational_records')
    .select('id, data')
    .eq('entity_type', 'front_desk')
    .in('status', ['approved'])
    .filter('data->>type', 'eq', 'room_booking')
    .filter('data->stay->>room_id', 'eq', roomId)
    .is('deleted_at', null);

  if (stayError) throw stayError;

  const conflictStay = stays?.find(r => {
    const rStart = r.data.stay?.check_in;
    const rEnd = r.data.stay?.check_out;
    return rStart && rEnd && isOverlap(checkIn, checkOut, rStart, rEnd);
  });

  if (conflictStay) return { isConflict: true, conflictingRecord: conflictStay };

  // 2. Check Approved Reservations (room_reservation)
  let query = client
    .from('operational_records')
    .select('id, data')
    .eq('entity_type', 'front_desk')
    .in('status', ['approved'])
    .filter('data->>type', 'eq', 'room_reservation')
    .filter('data->>room_id', 'eq', roomId)
    .is('deleted_at', null);

  if (excludeReservationId) {
    query = query.neq('id', excludeReservationId);
  }

  const { data: reservations, error: resError } = await query;

  if (resError) throw resError;

  const conflictRes = reservations?.find(r => {
    const rStart = r.data.check_in_date;
    const rEnd = r.data.check_out_date;
    return rStart && rEnd && isOverlap(checkIn, checkOut, rStart, rEnd);
  });

  if (conflictRes) return { isConflict: true, conflictingRecord: conflictRes };

  return { isConflict: false };
};

export const determineInitialStatus = (
  checkInDate: string,
  role: string
): 'approved' | 'pending' => {
  // Admin/Manager override -> Approved
  if (['admin', 'manager'].includes(role)) return 'approved';

  // Same day -> Approved (Requirement: "Same-day reservations → auto-approved")
  const today = new Date().toISOString().split('T')[0];
  if (checkInDate === today) return 'approved';
  
  // Future reservations -> Pending
  return 'pending';
};

export const convertReservationToStay = async (
  client: SupabaseClient,
  reservation: any,
  staffId: string
) => {
  // 1. Create Guest Record / Room Booking
  // The system uses 'room_booking' for stays.
  // Structure inferred from existing code (useFrontDesk.ts)
  
  const bookingData = {
    type: 'room_booking',
    front_desk_staff_id: staffId,
    guest: {
      full_name: reservation.data.guest.name,
      phone: reservation.data.guest.phone,
      email: reservation.data.guest.email,
      id: reservation.data.guest.id
    },
    stay: {
      room_id: reservation.data.room_id,
      check_in: reservation.data.check_in_date,
      check_out: reservation.data.check_out_date,
      adults: 1, // Default
      children: 0
    },
    meta: {
      source_reservation_id: reservation.id,
      notes: reservation.data.notes
    }
  };

  const { data: newBooking, error: createError } = await client
    .from('operational_records')
    .insert({
      entity_type: 'front_desk',
      status: 'approved', // Stays are approved
      data: bookingData,
      financial_amount: reservation.data.deposit_amount || 0
    })
    .select()
    .single();

  if (createError) throw createError;

  // 1b. Create Guest Record (linked)
  const guestPayload = {
    type: 'guest_record',
    front_desk_staff_id: staffId,
    guest: bookingData.guest,
    stay: bookingData.stay,
    meta: { 
      notes: reservation.data.notes, 
      source_reservation_id: reservation.id 
    },
  };

  const { error: insertError2 } = await client
    .from('operational_records')
    .insert({
      entity_type: 'front_desk',
      data: guestPayload,
      financial_amount: 0,
      original_id: newBooking.id,
    });
  if (insertError2) throw insertError2;

  // 2. Update Reservation Status
  const { error: updateError } = await client
    .from('operational_records')
    .update({
      status: 'converted',
      data: {
        ...reservation.data,
        status: 'converted',
        converted_to_booking_id: newBooking.id
      }
    })
    .eq('id', reservation.id);

  if (updateError) throw updateError;

  return newBooking;
};
