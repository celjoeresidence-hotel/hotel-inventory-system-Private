import type { LedgerEntry, LedgerSummary } from '../types/frontDesk';

/**
 * Normalizes various operational records into a unified LedgerEntry format.
 * This ensures backward compatibility with existing records while supporting the new Ledger system.
 */
export function normalizeLedger(
  booking: any, // The main booking record
  relatedRecords: any[] // Related operational_records (penalties, payments, etc.)
): LedgerEntry[] {
  const entries: LedgerEntry[] = [];

  // 1. Initial Room Charge (from Booking)
  // Treat the initial booking pricing as the first "Room Charge" debit
  if (booking && booking.data && booking.data.pricing) {
    entries.push({
      id: booking.id + '_room_charge',
      date: booking.created_at, // Use booking creation time
      type: 'debit',
      category: 'room_charge',
      amount: Number(booking.data.pricing.total_room_cost || 0),
      description: `Room Charge (${booking.data.pricing.nights} nights @ ${booking.data.pricing.room_rate})`,
      staff_id: booking.submitted_by
    });
  }

  // 2. Initial Payment (from Booking)
  // If the booking included an initial payment
  if (booking && booking.data && booking.data.payment && booking.data.payment.paid_amount > 0) {
    entries.push({
      id: booking.id + '_initial_payment',
      date: booking.data.payment.payment_date || booking.created_at,
      type: 'credit',
      category: 'payment',
      amount: Number(booking.data.payment.paid_amount || 0),
      description: `Initial Payment (${booking.data.payment.payment_method})`,
      staff_id: booking.submitted_by
    });
  }

  // 3. Process Related Records
  relatedRecords.forEach(record => {
    const data = record.data as any; // Using any for flexibility with legacy data
    
    // Skip if it's the booking itself (already handled)
    if (record.id === booking.id) return;

    if (data.type === 'penalty_fee') {
      entries.push({
        id: record.id,
        date: record.created_at,
        type: 'debit',
        category: 'penalty',
        amount: Number(data.amount || 0),
        description: data.reason || 'Penalty Fee',
        staff_id: record.submitted_by
      });
    } else if (data.type === 'payment_record') {
      entries.push({
        id: record.id,
        date: record.created_at,
        type: 'credit',
        category: 'payment',
        amount: Number(data.amount || 0),
        description: data.reason || 'Payment Received',
        staff_id: record.submitted_by
      });
    } else if (data.type === 'discount_applied') {
      // Discounts are credits (reduce balance)
      entries.push({
        id: record.id,
        date: record.created_at,
        type: 'credit',
        category: 'discount',
        amount: Number(data.amount || 0),
        description: data.reason || 'Discount Applied',
        staff_id: record.submitted_by
      });
    } else if (data.type === 'refund_record') {
      entries.push({
        id: record.id,
        date: record.created_at,
        type: 'credit',
        category: 'refund',
        amount: Number(data.amount || 0),
        description: data.reason || 'Refund',
        staff_id: record.submitted_by
      });
    } else if (data.type === 'checkout_record') {
       // Checkouts might have a "final_payment"
       if (data.checkout && data.checkout.final_payment > 0) {
          entries.push({
            id: record.id + '_final_payment',
            date: data.checkout.checkout_date,
            type: 'credit',
            category: 'payment',
            amount: Number(data.checkout.final_payment),
            description: 'Final Settlement at Checkout',
            staff_id: record.submitted_by
          });
       }
    } else if (data.type === 'stay_extension') {
        // Extension charges
        if (data.extension && data.extension.additional_cost > 0) {
            entries.push({
                id: record.id + '_extension',
                date: record.created_at,
                type: 'debit',
                category: 'room_charge',
                amount: Number(data.extension.additional_cost),
                description: `Stay Extension (${data.extension.nights_added} nights to ${data.extension.new_check_out})`,
                staff_id: record.submitted_by
            });
        }
    } else if (data.type === 'room_booking' && data.stay) {
        // Linked Booking (Transfer) - Add its room charge
        // Only if it's NOT the main booking (already checked at start of loop)
        if (data.pricing && data.pricing.total_room_cost > 0) {
             entries.push({
                id: record.id + '_transfer_charge',
                date: record.created_at,
                type: 'debit',
                category: 'room_charge',
                amount: Number(data.pricing.total_room_cost),
                description: `Room Charge (Transferred to ${data.stay.room_id})`,
                staff_id: record.submitted_by
            });
        }
    }
  });

  // Sort by date (oldest first)
  return entries.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Calculates the current balance from a list of ledger entries.
 */
export function calculateLedgerSummary(entries: LedgerEntry[]): LedgerSummary {
  let totalCharges = 0;
  let totalPayments = 0;

  entries.forEach(entry => {
    if (entry.type === 'debit') {
      totalCharges += entry.amount;
    } else {
      totalPayments += entry.amount;
    }
  });

  return {
    totalCharges,
    totalPayments,
    balance: totalCharges - totalPayments
  };
}
