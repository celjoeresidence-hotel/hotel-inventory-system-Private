import type { FrontDeskRecordData, PaymentMethod } from '../types/frontDesk';

// Utility to parse ISO date strings safely
const parseDate = (iso: string) => new Date(iso);

// Difference in days between two ISO date strings (midnight-agnostic)
const diffDays = (startISO: string, endISO: string) => {
  const start = parseDate(startISO);
  const end = parseDate(endISO);
  const msPerDay = 24 * 60 * 60 * 1000;
  // Normalize to midnight to avoid DST issues
  const startMidnight = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endMidnight = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  return Math.round((endMidnight.getTime() - startMidnight.getTime()) / msPerDay);
};

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateFrontDeskData(data: FrontDeskRecordData): ValidationResult {
  const errors: string[] = [];

  if (data.type === 'room_booking') {
    // 1. Ensure all required subsections exist
    if (!data.guest) errors.push('Guest data is missing.');
    if (!data.stay) errors.push('Stay data is missing.');
    if (!data.pricing) errors.push('Pricing data is missing.');
    if (!data.payment) errors.push('Payment data is missing.');

    // If critical sections are missing, return early
    if (errors.length > 0) return { valid: false, errors };

    // Now we can safely access them (using ! assertion or casting if TS doesn't narrow automatically)
    // However, TS should narrow if we access them in the scope where we checked they exist.
    // To make it easy for TS, let's alias them.
    const { guest, stay, pricing, payment } = data;
    
    // TS might still think they are optional because of the type definition.
    // We will use non-null assertion since we just checked them.
    const g = guest!;
    const s = stay!;
    const p = pricing!;
    const pay = payment!;

    // check_out must be later than check_in
    const nightsFromDates = diffDays(s.check_in, s.check_out);
    if (nightsFromDates <= 0) {
      errors.push('Check-out date must be later than check-in date.');
    }

    // nights must match the date difference
    if (p.nights !== nightsFromDates) {
      errors.push('Nights must equal the difference between check-in and check-out dates.');
    }

    // total_room_cost = (room_rate * nights) - discount_amount
    const rawTotal = Number((p.room_rate * p.nights).toFixed(2));
    const discount = p.discount_amount ? Number(p.discount_amount.toFixed(2)) : 0;
    const expectedTotal = Number((rawTotal - discount).toFixed(2));

    if (Number(p.total_room_cost.toFixed(2)) !== expectedTotal) {
      errors.push('Total room cost must equal (room_rate * nights) - discount_amount.');
    }

    // If original_price is provided, it must match rawTotal
    if (p.original_price !== undefined) {
      if (Number(p.original_price.toFixed(2)) !== rawTotal) {
        errors.push('Original price must equal room_rate * nights.');
      }
    }

    // balance = total_room_cost - paid_amount
    const expectedBalance = Number((p.total_room_cost - pay.paid_amount).toFixed(2));
    if (Number(pay.balance.toFixed(2)) !== expectedBalance) {
      errors.push('Balance must equal total_room_cost minus paid_amount.');
    }

    // payment_method validation
    const validMethods: PaymentMethod[] = ['transfer', 'POS', 'cash']; // Added 'cash' as it was in the UI
    if (!validMethods.includes(pay.payment_method)) {
      errors.push('Payment method must be "transfer", "POS", or "cash".');
    }

    // paid_amount cannot exceed total_room_cost
    if (pay.paid_amount > p.total_room_cost) {
      errors.push('Paid amount cannot exceed total room cost.');
    }

    // Basic non-empty checks
    if (!g.full_name.trim()) errors.push('Guest full name is required.');
    if (!g.phone.trim()) errors.push('Guest phone is required.');
    if (!s.room_id.trim()) errors.push('Room ID is required.');

    const numericFields: Array<[string, number]> = [
      ['adults', s.adults],
      ['children', s.children],
      ['room_rate', p.room_rate],
      ['nights', p.nights],
      ['total_room_cost', p.total_room_cost],
      ['paid_amount', pay.paid_amount],
      ['balance', pay.balance],
    ];
    numericFields.forEach(([label, value]) => {
      if (value < 0 || Number.isNaN(value)) {
        errors.push(`${label} must be a non-negative number.`);
      }
    });

    // ISO date format basic check
    if (isNaN(parseDate(s.check_in).getTime())) errors.push('check_in must be a valid ISO date string.');
    if (isNaN(parseDate(s.check_out).getTime())) errors.push('check_out must be a valid ISO date string.');

  } else if (data.type === 'checkout_record') {
    if (!data.checkout) {
      errors.push('Checkout data is missing.');
    } else {
      if (isNaN(parseDate(data.checkout.checkout_date).getTime())) {
        errors.push('Invalid checkout date.');
      }
      if (data.checkout.total_due < 0) errors.push('Total due cannot be negative.');
    }
  } else if (data.type === 'guest_record') {
    // Similar to room_booking but maybe less strict?
    // For now, let's enforce guest existence
    if (!data.guest) errors.push('Guest data is missing.');
  }

  // Common Meta check
  if (data.meta && isNaN(parseDate(data.meta.created_at_local).getTime())) {
    errors.push('created_at_local must be a valid ISO datetime string.');
  }

  return { valid: errors.length === 0, errors };
}
