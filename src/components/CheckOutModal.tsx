import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/Button';
import { differenceInCalendarDays, format } from 'date-fns';
import { IconAlertCircle } from './ui/Icons';
import type { BookingWithId } from '../hooks/useFrontDesk';
import type { PaymentMethod } from '../types/frontDesk';

import { normalizeLedger, calculateLedgerSummary } from '../utils/ledgerUtils';
import type { LedgerEntry, LedgerSummary } from '../types/frontDesk';

import type { RoomStatus } from '../types/frontDesk';

interface CheckOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingWithId | null;
  roomStatus?: RoomStatus;
  onSuccess: () => void;
}

export default function CheckOutModal({ isOpen, onClose, booking, roomStatus, onSuccess }: CheckOutModalProps) {
  const { staffId, ensureActiveSession } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Payment State
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('transfer');
  const [notes, setNotes] = useState('');
  const [checkoutType, setCheckoutType] = useState<'standard' | 'interrupted'>('standard');
  
  // Real-time Balance State
  const [ledgerSummary, setLedgerSummary] = useState<LedgerSummary | null>(null);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [showLedger, setShowLedger] = useState(false);

  useEffect(() => {
    if (isOpen && booking) {
        fetchRealTimeBalance();
        setCheckoutType('standard');
        setNotes('');
        setShowLedger(false);
    }
  }, [isOpen, booking]);

  const fetchRealTimeBalance = async () => {
      if (!booking) return;
      // Aggregate all financial records for this booking
      const { data, error } = await supabase!
        .from('operational_records')
        .select('*')
        .or(`data->>booking_id.eq.${booking.id},original_id.eq.${booking.original_id}`);
      
      if (error || !data) {
          console.error('Error fetching balance:', error);
          return;
      }

      const entries = normalizeLedger(booking, data);
      const summary = calculateLedgerSummary(entries);
      
      setLedgerEntries(entries);
      setLedgerSummary(summary);
  };

  if (!booking || !ledgerSummary) return null;

  const handleConfirmCheckout = async () => {
    // Enforce 0 balance (unless paying the rest now)
    // If balance > 0, we assume the user is paying the FULL remainder now.
    // If they want to pay partial, they should use "Add Payment" in Guest Details.
    // Here, "Confirm Checkout" implies settling the account.
    
    setLoading(true);
    setError(null);

    if (roomStatus && roomStatus.housekeeping_status !== 'clean') {
        setError(`Checkout blocked: Room is marked as ${roomStatus.housekeeping_status}. It must be cleaned first.`);
        setLoading(false);
        return;
    }

    try {
      // Create Checkout Record
      const checkoutPayload = {
        type: 'checkout_record',
        booking_id: booking.id, // Link to booking
        front_desk_staff_id: staffId,
        checkout: {
          checkout_date: new Date().toISOString(),
          checkout_type: checkoutType,
          total_due: ledgerSummary.totalCharges,
          final_payment: ledgerSummary.balance, // Default: PAY FULL BALANCE
          payment_method: paymentMethod,
          notes: notes
        },
        meta: {
          created_at_local: new Date().toISOString(),
          notes: `Checked out by staff ${staffId} (${checkoutType})`
        }
      };

      if (!supabase) throw new Error('Supabase client not initialized');
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) { setError('Session expired. Please sign in again to continue.'); return; }
      
      // 1. Insert Checkout Record
      const { error: insertError } = await supabase!
        .from('operational_records')
        .insert({
          entity_type: 'front_desk',
          data: checkoutPayload,
          financial_amount: Math.max(0, ledgerSummary.balance), // Ensure non-negative to satisfy DB constraint
          submitted_by: staffId, 
          status: 'approved' // Migration 0013 allows this
        });

      if (insertError) throw insertError;

      // 2. Also insert a "Payment Record" if balance > 0 (to close the books)
      if (ledgerSummary.balance > 0) {
        const paymentPayload = {
          type: 'payment_record',
          booking_id: booking.id,
          front_desk_staff_id: staffId,
          amount: ledgerSummary.balance,
          payment_method: paymentMethod,
          reason: 'Final Settlement at Checkout',
          meta: { created_at_local: new Date().toISOString() }
        };
        await supabase!.from('operational_records').insert({
           entity_type: 'front_desk',
           data: paymentPayload
        });
      }

      // 3. Mark Booking as 'checked_out' or 'interrupted'
      await supabase!.from('operational_records').update({
         status: 'archived',
         data: { ...booking.data, stay: { ...booking.data.stay, status: checkoutType === 'interrupted' ? 'interrupted' : 'checked_out' } }
      }).eq('id', booking.id);

      // 4. Interrupted Stay handling: end occupancy segment and create credit
      if (checkoutType === 'interrupted') {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const checkIn = booking.data.stay?.check_in ? new Date(booking.data.stay.check_in) : new Date();
        const usedDays = Math.max(0, differenceInCalendarDays(new Date(), checkIn));
        const roomRate = Number(booking.data.pricing?.room_rate || 0);
        const usedCost = roomRate * usedDays;
        const totalPaid = Number(ledgerSummary.totalPayments || 0);
        const creditRemaining = Math.max(0, totalPaid - usedCost);

        // 4a. Append stay_interruption record (segment end)
        await supabase!.from('operational_records').insert({
          entity_type: 'front_desk',
          data: {
            type: 'stay_interruption',
            booking_id: booking.id,
            interruption_date: todayStr,
            reason: notes || 'Emergency / Interrupted Stay'
          },
          financial_amount: 0,
          submitted_by: staffId,
          status: 'approved'
        });

        // 4b. Append interrupted_stay_credit record
        await supabase!.from('operational_records').insert({
          entity_type: 'front_desk',
          data: {
            type: 'interrupted_stay_credit',
            guest_id: booking.data.guest?.id_reference || null,
            guest_name: booking.data.guest?.full_name || 'Unknown Guest',
            department: 'frontdesk',
            room_number: booking.room_number,
            room_name: null,
            days_used: usedDays,
            total_paid: totalPaid,
            credit_remaining: creditRemaining,
            interrupted_at: new Date().toISOString(),
            can_resume: true,
            booking_id: booking.id
          },
          financial_amount: 0,
          submitted_by: staffId,
          status: 'approved'
        });
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Checkout error:', err);
      setError(err.message || 'Failed to process checkout');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 border-b border-gray-100">
          <h3 className="text-xl font-bold text-gray-900">Check Out Guest</h3>
          <p className="text-sm text-gray-500 mt-1">
            {booking.data.guest?.full_name} — Room {booking.room_number}
          </p>
        </div>

        <div className="p-6 space-y-6">
          {/* Financial Summary */}
          <div className="bg-gray-50 rounded-lg p-4 space-y-3">
            <div className="flex justify-between text-sm text-gray-600">
              <span>Total Charges</span>
              <span>₦{ledgerSummary.totalCharges.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm text-green-600">
              <span>Total Payments</span>
              <span>- ₦{ledgerSummary.totalPayments.toLocaleString()}</span>
            </div>
            
            <div className="pt-2 border-t border-gray-200 flex justify-between items-center font-bold text-lg">
              <span>Balance Due</span>
              <span className={ledgerSummary.balance > 0 ? 'text-red-600' : 'text-gray-900'}>
                ₦{ledgerSummary.balance.toLocaleString()}
              </span>
            </div>

             <button 
                type="button" 
                onClick={() => setShowLedger(!showLedger)}
                className="text-xs text-indigo-600 hover:text-indigo-800 underline w-full text-left mt-2"
             >
                {showLedger ? 'Hide Details' : 'Show Transaction History'}
             </button>

             {showLedger && (
                <div className="mt-2 space-y-2 text-xs border-t border-gray-200 pt-2 max-h-40 overflow-y-auto">
                    {ledgerEntries.map((entry) => (
                        <div key={entry.id} className="flex justify-between">
                            <span className="text-gray-500">{new Date(entry.date).toLocaleDateString()} - {entry.description}</span>
                            <span className={entry.type === 'credit' ? 'text-green-600' : 'text-gray-700'}>
                                {entry.type === 'credit' ? '-' : ''}₦{entry.amount.toLocaleString()}
                            </span>
                        </div>
                    ))}
                </div>
             )}
          </div>
          {/* Payment Method */}
          {ledgerSummary.balance > 0 ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">
                Payment Method for Balance (₦{ledgerSummary.balance.toLocaleString()})
              </label>
              <div className="grid grid-cols-3 gap-3">
                {(['transfer', 'POS', 'cash'] as PaymentMethod[]).map((method) => (
                  <button
                    key={method}
                    onClick={() => setPaymentMethod(method)}
                    className={`flex flex-col items-center justify-center p-3 rounded-lg border transition-all ${
                      paymentMethod === method
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-gray-200 hover:border-blue-200 hover:bg-gray-50'
                    }`}
                  >
                    <span className="capitalize text-sm font-medium">{method}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
             <div className="p-3 bg-green-50 text-green-700 rounded-lg text-center text-sm">
                Balance is cleared. Ready to checkout.
             </div>
          )}

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Checkout Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-lg border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 text-sm"
              rows={3}
              placeholder="Any additional comments..."
            />
          </div>

          {/* Checkout Type & Verification */}
          <div className="bg-orange-50 p-4 rounded-lg border border-orange-100 space-y-4">
             <div>
                <label className="block text-sm font-medium text-orange-900 mb-2">Checkout Type</label>
                <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input 
                            type="radio" 
                            name="checkoutType" 
                            value="standard" 
                            checked={checkoutType === 'standard'}
                            onChange={() => setCheckoutType('standard')}
                            className="text-orange-600 focus:ring-orange-500"
                        />
                        Standard Checkout
                    </label>
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                        <input 
                            type="radio" 
                            name="checkoutType" 
                            value="interrupted" 
                            checked={checkoutType === 'interrupted'}
                            onChange={() => setCheckoutType('interrupted')}
                            className="text-orange-600 focus:ring-orange-500"
                        />
                        Interrupted (Emergency)
                    </label>
                </div>
             </div>
             
             {roomStatus && roomStatus.housekeeping_status !== 'clean' && (
               <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm flex items-center gap-2">
                 <IconAlertCircle className="w-5 h-5" />
                 <div>
                   <span className="font-bold">Checkout Blocked</span>
                   <p className="text-xs">Housekeeping status: {roomStatus.housekeeping_status}</p>
                 </div>
               </div>
             )}
          </div>

          {error && (
            <div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg flex items-start gap-2">
              <IconAlertCircle className="w-5 h-5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-100 bg-gray-50 flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={onClose}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            className="flex-1"
            onClick={handleConfirmCheckout}
            isLoading={loading}
            disabled={loading} // We allow checkout if they pay the balance now.
          >
            {ledgerSummary.balance > 0 ? `Pay & Checkout` : 'Confirm Checkout'}
          </Button>
        </div>
      </div>
    </div>
  );
}
