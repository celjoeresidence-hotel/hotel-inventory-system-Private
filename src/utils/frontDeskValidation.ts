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

  // check_out must be later than check_in
  const nightsFromDates = diffDays(data.stay.check_in, data.stay.check_out);
  if (nightsFromDates <= 0) {
    errors.push('Check-out date must be later than check-in date.');
  }

  // nights must match the date difference
  if (data.pricing.nights !== nightsFromDates) {
    errors.push('Nights must equal the difference between check-in and check-out dates.');
  }

  // total_room_cost = room_rate * nights
  const expectedTotal = Number((data.pricing.room_rate * data.pricing.nights).toFixed(2));
  if (Number(data.pricing.total_room_cost.toFixed(2)) !== expectedTotal) {
    errors.push('Total room cost must equal room_rate multiplied by nights.');
  }

  // balance = total_room_cost - paid_amount
  const expectedBalance = Number((data.pricing.total_room_cost - data.payment.paid_amount).toFixed(2));
  if (Number(data.payment.balance.toFixed(2)) !== expectedBalance) {
    errors.push('Balance must equal total_room_cost minus paid_amount.');
  }

  // payment_method must be "transfer" or "POS"
  const validMethods: PaymentMethod[] = ['transfer', 'POS'];
  if (!validMethods.includes(data.payment.payment_method)) {
    errors.push('Payment method must be either "transfer" or "POS".');
  }

  // paid_amount cannot exceed total_room_cost
  if (data.payment.paid_amount > data.pricing.total_room_cost) {
    errors.push('Paid amount cannot exceed total room cost.');
  }

  // Basic non-empty checks for required strings and numeric non-negativity
  if (!data.guest.full_name.trim()) errors.push('Guest full name is required.');
  if (!data.guest.phone.trim()) errors.push('Guest phone is required.');
  if (!data.stay.room_id.trim()) errors.push('Room ID is required.');

  const numericFields: Array<[string, number]> = [
    ['adults', data.stay.adults],
    ['children', data.stay.children],
    ['room_rate', data.pricing.room_rate],
    ['nights', data.pricing.nights],
    ['total_room_cost', data.pricing.total_room_cost],
    ['paid_amount', data.payment.paid_amount],
    ['balance', data.payment.balance],
  ];
  numericFields.forEach(([label, value]) => {
    if (value < 0 || Number.isNaN(value)) {
      errors.push(`${label} must be a non-negative number.`);
    }
  });

  // ISO date format basic check
  if (isNaN(parseDate(data.stay.check_in).getTime())) errors.push('check_in must be a valid ISO date string.');
  if (isNaN(parseDate(data.stay.check_out).getTime())) errors.push('check_out must be a valid ISO date string.');
  if (isNaN(parseDate(data.meta.created_at_local).getTime())) errors.push('created_at_local must be a valid ISO datetime string.');

  return { valid: errors.length === 0, errors };
}