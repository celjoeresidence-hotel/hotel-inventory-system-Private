import { useState, useMemo } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
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

  // Calculations
  const calculations = useMemo(() => {
    if (!booking) return null;
    const { pricing, payment } = booking.data;
    if (!pricing || !payment) return null;

    // Check if overdue? 
    // For now, assume fixed price as per booking. 
    // If we wanted to recalculate based on ACTUAL stay duration, we would compare dates here.
    
    const totalDue = pricing.total_room_cost;
    const alreadyPaid = payment.paid_amount;
    const balance = payment.balance; // Should be total - paid

    return { totalDue, alreadyPaid, balance };
  }, [booking]);

  if (!booking || !calculations) return null;

  const handleConfirmCheckout = async () => {
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
          final_payment: calculations.balance, // Assuming they pay the rest now
          payment_method: paymentMethod,
          notes: notes
        },
        meta: {
          created_at_local: new Date().toISOString(),
          notes: `Checked out by staff ${staffId}`
        }
      };

      if (!supabase) throw new Error('Supabase client not initialized');
      const { error: insertError } = await supabase
        .from('operational_records')
        .insert({
          entity_type: 'front_desk',
          data: checkoutPayload,
          financial_amount: calculations.balance, // Record the revenue of the final payment
          submitted_by: staffId, // RLS should handle this if authenticated
          status: 'approved' // Auto-approve checkouts? Or pending?
          // If RLS forces pending, it will be pending. 
        });

      if (insertError) throw insertError;

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
          {error && (
            <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm flex items-center gap-2">
              <IconAlertCircle className="w-4 h-4" />
              {error}
            </div>
          )}

          <div className="space-y-3 bg-gray-50 p-4 rounded-lg">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Total Bill</span>
              <span className="font-medium">₦{calculations.totalDue.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Already Paid</span>
              <span className="text-green-600 font-medium">- ₦{calculations.alreadyPaid.toLocaleString()}</span>
            </div>
            <div className="border-t border-gray-200 pt-2 flex justify-between text-base font-bold">
              <span>Outstanding Balance</span>
              <span className={calculations.balance > 0 ? 'text-red-600' : 'text-gray-900'}>
                ₦{calculations.balance.toLocaleString()}
              </span>
            </div>
          </div>

          {calculations.balance > 0 && (
            <div className="space-y-4">
              <h4 className="font-medium text-gray-900">Final Payment</h4>
              <Select
                label="Payment Method"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
              >
                <option value="transfer">Transfer</option>
                <option value="POS">POS</option>
                <option value="cash">Cash</option>
              </Select>
            </div>
          )}

          <Input
            label="Notes (Optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any damage or issues?"
          />

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={onClose} className="w-full">
              Cancel
            </Button>
            <Button 
              onClick={handleConfirmCheckout} 
              disabled={loading} 
              className="w-full bg-red-600 hover:bg-red-700 text-white"
            >
              {loading ? 'Processing...' : `Confirm Checkout ${calculations.balance > 0 ? `(Pay ₦${calculations.balance})` : ''}`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
