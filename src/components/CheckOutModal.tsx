import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/Button';
import { IconAlertCircle } from './ui/Icons';
import type { BookingWithId } from '../hooks/useFrontDesk';
import type { PaymentMethod } from '../types/frontDesk';

interface CheckOutModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingWithId | null;
  onSuccess: () => void;
}

export default function CheckOutModal({ isOpen, onClose, booking, onSuccess }: CheckOutModalProps) {
  const { staffId } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Payment State
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('transfer');
  const [notes, setNotes] = useState('');
  
  // Real-time Balance State
  const [realTimeBalance, setRealTimeBalance] = useState<{totalDue: number, alreadyPaid: number, balance: number, penalties: number, discounts: number} | null>(null);

  useEffect(() => {
    if (isOpen && booking) {
        fetchRealTimeBalance();
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

      let roomCost = booking.data.pricing?.total_room_cost || 0;
      let penalties = 0;
      let payments = booking.data.payment?.paid_amount || 0; // Initial payment
      let discounts = booking.data.pricing?.discount_amount || 0;

      data.forEach(rec => {
        const d = rec.data;
        if (d.type === 'penalty_fee') penalties += Number(d.amount || 0);
        if (d.type === 'payment_record') payments += Number(d.amount || 0);
        if (d.type === 'discount_applied') discounts += Number(d.amount || 0);
        // If there are previous partial checkouts or corrections, handle them?
        // For now assuming simple additive model.
      });

      const totalDue = roomCost + penalties - discounts;
      const balance = totalDue - payments;
      
      setRealTimeBalance({ totalDue, alreadyPaid: payments, balance, penalties, discounts });
  };

  const calculations = realTimeBalance; // Use real-time instead of memoized prop

  if (!booking || !calculations) return null;

  const handleConfirmCheckout = async () => {
    // Enforce 0 balance (unless paying the rest now)
    // If balance > 0, we assume the user is paying the FULL remainder now.
    // If they want to pay partial, they should use "Add Payment" in Guest Details.
    // Here, "Confirm Checkout" implies settling the account.
    
    setLoading(true);
    setError(null);

    try {
      // Create Checkout Record
      const checkoutPayload = {
        type: 'checkout_record',
        booking_id: booking.id, // Link to booking
        front_desk_staff_id: staffId,
        checkout: {
          checkout_date: new Date().toISOString(),
          total_due: calculations.totalDue,
          final_payment: calculations.balance, // PAYING THE FULL BALANCE
          payment_method: paymentMethod,
          notes: notes
        },
        meta: {
          created_at_local: new Date().toISOString(),
          notes: `Checked out by staff ${staffId}`
        }
      };

      if (!supabase) throw new Error('Supabase client not initialized');
      
      // 1. Insert Checkout Record
      const { error: insertError } = await supabase!
        .from('operational_records')
        .insert({
          entity_type: 'front_desk',
          data: checkoutPayload,
          financial_amount: Math.max(0, calculations.balance), // Ensure non-negative to satisfy DB constraint
          submitted_by: staffId, 
          status: 'approved' // Migration 0013 allows this
        });

      if (insertError) throw insertError;

      // 2. Also insert a "Payment Record" if balance > 0 (to close the books)
      if (calculations.balance > 0) {
        const paymentPayload = {
          type: 'payment_record',
          booking_id: booking.id,
          front_desk_staff_id: staffId,
          amount: calculations.balance,
          payment_method: paymentMethod,
          reason: 'Final Settlement at Checkout',
          meta: { created_at_local: new Date().toISOString() }
        };
        await supabase!.from('operational_records').insert({
           entity_type: 'front_desk',
           data: paymentPayload
        });
      }

      // 3. Mark Booking as 'checked_out' (Optional, if you want to update the source record status)
      await supabase!.from('operational_records').update({
        status: 'approved' // Or keep approved, maybe add a 'checked_out' flag inside data?
      }).eq('id', booking.id);
      
      // Update the booking data to status: 'checked_out'
      // This requires reading the current data, modifying it, and updating.
      // But since 'operational_records' is append-heavy, maybe we just rely on the checkout_record.
      // However, to remove it from "Active Guests", we might want to update the status column or data.status.
      
      // Let's update the status column of the BOOKING record to 'completed' or 'checked_out'
      await supabase!.from('operational_records').update({
         status: 'archived' // 'archived' or 'completed' to hide from Active list?
         // The ActiveGuestList filters by data->status != 'checked_out' usually.
         // Let's update the JSON data too.
      }).eq('id', booking.id);

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
              <span>Total Room Cost</span>
              <span>₦{booking.data.pricing?.total_room_cost?.toLocaleString()}</span>
            </div>
            {calculations.penalties > 0 && (
                 <div className="flex justify-between text-sm text-red-600">
                  <span>Penalties/Fines</span>
                  <span>+ ₦{calculations.penalties.toLocaleString()}</span>
                </div>
            )}
            {calculations.discounts > 0 && (
                 <div className="flex justify-between text-sm text-green-600">
                  <span>Discounts</span>
                  <span>- ₦{calculations.discounts.toLocaleString()}</span>
                </div>
            )}
            <div className="flex justify-between text-sm text-green-600">
              <span>Already Paid</span>
              <span>- ₦{calculations.alreadyPaid.toLocaleString()}</span>
            </div>
            <div className="border-t border-gray-200 pt-3 flex justify-between items-center">
              <span className="font-semibold text-gray-900">Outstanding Balance</span>
              <span className={`text-lg font-bold ${calculations.balance > 0 ? 'text-blue-600' : 'text-gray-900'}`}>
                ₦{calculations.balance.toLocaleString()}
              </span>
            </div>
          </div>

          {/* Payment Method */}
          {calculations.balance > 0 ? (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-gray-700">
                Payment Method for Balance (₦{calculations.balance.toLocaleString()})
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
            {calculations.balance > 0 ? `Pay & Checkout` : 'Confirm Checkout'}
          </Button>
        </div>
      </div>
    </div>
  );
}
