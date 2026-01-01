import { useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import type { FrontDeskRecordData, PaymentMethod, PaymentType } from '../types/frontDesk';
import { validateFrontDeskData } from '../utils/frontDeskValidation';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { IconCheckCircle, IconAlertCircle, IconCalendar, IconUser, IconCreditCard, IconChevronRight, IconChevronLeft, IconBed, IconFileText } from './ui/Icons';

// Helper to format ISO date (YYYY-MM-DD)
const toISODate = (d: Date) => d.toISOString().split('T')[0];

interface RoomOption {
  id: string | number;
  room_number: string;
  price_per_night: number;
}

interface StaffOption {
  id: string;
  full_name: string;
}

export default function FrontDeskForm() {
  const { role, staffId, isConfigured } = useAuth();
  const today = useMemo(() => new Date(), []);

  // Wizard step state
  const [step, setStep] = useState<1 | 2>(1);
  const [locked, setLocked] = useState(false);

  // Step 1: Room Booking
  const [room_id, setRoomId] = useState('');
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [check_in, setCheckIn] = useState(toISODate(today));
  const [check_out, setCheckOut] = useState(toISODate(new Date(today.getTime() + 24 * 60 * 60 * 1000))); // +1 day
  const [room_rate, setRoomRate] = useState(0);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [roomsError, setRoomsError] = useState<string | null>(null);

  const nights = useMemo(() => {
    const start = new Date(check_in);
    const end = new Date(check_out);
    const msPerDay = 24 * 60 * 60 * 1000;
    const startMidnight = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    const endMidnight = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
    const diff = Math.round((endMidnight.getTime() - startMidnight.getTime()) / msPerDay);
    return Math.max(diff, 0);
  }, [check_in, check_out]);

  const total_room_cost = useMemo(() => Number((room_rate * nights).toFixed(2)), [room_rate, nights]);

  // Step 2: Guest & Payment
  const [full_name, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [id_reference, setIdReference] = useState('');
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);

  const [payment_method, setPaymentMethod] = useState<PaymentMethod>('transfer');
  const [payment_type, setPaymentType] = useState<PaymentType>('full');
  const [paid_amount, setPaidAmount] = useState(0);
  const [payment_date, setPaymentDate] = useState<string>(toISODate(today));
  const [payment_reference, setPaymentReference] = useState<string | null>('');

  const balance = useMemo(() => Number((total_room_cost - paid_amount).toFixed(2)), [total_room_cost, paid_amount]);

  // Staff attribution
  const [frontDeskStaffId, setFrontDeskStaffId] = useState<string>('');
  const [frontDeskStaffOptions, setFrontDeskStaffOptions] = useState<StaffOption[]>([]);

  const [notes, setNotes] = useState<string | null>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const created_at_local = useMemo(() => new Date().toISOString(), []);

  // Inline field errors per step
  const [step1Errors, setStep1Errors] = useState<Record<string, string>>({});
  const [step2Errors, setStep2Errors] = useState<Record<string, string>>({});

  // Load rooms (active only) and staff options
  useEffect(() => {
    let mounted = true;
    async function fetchRoomsAndStaff() {
      if (!isConfigured || !supabase) return;
      setRoomsError(null);
      setRoomsLoading(true);
      // Rooms
      const { data: roomData, error: roomErr } = await supabase
        .from('rooms')
        .select('id, room_number, price_per_night, is_active')
        .eq('is_active', true)
        .order('room_number', { ascending: true });
      if (mounted) {
        if (roomErr) {
          setRoomsError(roomErr.message);
          setRooms([]);
        } else {
          setRooms((roomData ?? []).map((r: any) => ({
            id: r.id,
            room_number: r.room_number,
            price_per_night: Number(r.price_per_night) || 0,
          })));
        }
      }
      setRoomsLoading(false);
      // Staff options
      const { data: staffData, error: staffErr } = await supabase
        .from('staff_profiles')
        .select('id, full_name, role, is_active')
        .eq('role', 'front_desk')
        .eq('is_active', true)
        .order('full_name', { ascending: true });
      if (mounted) {
        if (!staffErr) {
          setFrontDeskStaffOptions((staffData ?? []).map((s: any) => ({ id: s.id, full_name: s.full_name })));
          // Auto-select and lock if current user is front_desk
          if (role === 'front_desk' && staffId) {
            setFrontDeskStaffId(staffId);
          }
        }
      }
    }
    fetchRoomsAndStaff();
    return () => { mounted = false; };
  }, [isConfigured, role, staffId]);

  // When room changes, set rate from selection
  useEffect(() => {
    const selected = rooms.find((r) => String(r.id) === String(room_id));
    if (selected) {
      setRoomRate(Number(selected.price_per_night) || 0);
    }
  }, [room_id, rooms]);

  function validateStep1() {
    const errs: Record<string, string> = {};
    if (!room_id) errs.room_id = 'Room is required.';
    if (!check_in) errs.check_in = 'Check-in date is required.';
    if (!check_out) errs.check_out = 'Check-out date is required.';
    // check_out after check_in
    const start = new Date(check_in);
    const end = new Date(check_out);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      errs.check_out = 'Check-out date must be after check-in date.';
    }
    if (nights <= 0) errs.nights = 'Nights must be at least 1.';
    if (room_rate < 0) errs.room_rate = 'Price per night must be non-negative.';
    setStep1Errors(errs);
    return Object.keys(errs).length === 0;
  }

  function validateStep2() {
    const errs: Record<string, string> = {};
    if (!full_name.trim()) errs.full_name = 'Guest full name is required.';
    if (!phone.trim()) errs.phone = 'Phone is required.';
    if (adults < 0) errs.adults = 'Adults must be >= 0.';
    if (children < 0) errs.children = 'Children must be >= 0.';
    if (paid_amount < 0) errs.paid_amount = 'Amount paid must be >= 0.';
    if (paid_amount > total_room_cost) errs.paid_amount = 'Amount paid cannot exceed total.';
    if (!payment_method) errs.payment_method = 'Payment method is required.';
    if (!payment_type) errs.payment_type = 'Payment type is required.';
    if (!payment_date || isNaN(new Date(payment_date).getTime())) errs.payment_date = 'Payment date is invalid.';
    if (!frontDeskStaffId) errs.front_desk_staff_id = 'Front desk staff responsible is required.';
    setStep2Errors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (locked) return;
    setError(null);

    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }

    // Step validations
    const ok1 = validateStep1();
    const ok2 = validateStep2();
    if (!ok1) { setStep(1); return; }
    if (!ok2) { setStep(2); return; }

    // Enforce authenticated submission
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      setError('Authentication check failed. Please try again.');
      return;
    }
    if (!sessionData?.session) {
      setError('You must be logged in to submit records');
      return;
    }

    const payload: FrontDeskRecordData = {
      type: 'room_booking',
      front_desk_staff_id: frontDeskStaffId,
      guest: { full_name, phone, email: email || undefined, id_reference: id_reference || undefined },
      stay: { room_id, check_in, check_out, adults, children },
      pricing: { room_rate, nights, total_room_cost },
      payment: { paid_amount, payment_method, payment_type, payment_date, payment_reference: payment_reference || null, balance },
      meta: { notes: notes || null, created_at_local },
    };

    const validation = validateFrontDeskData(payload);
    if (!validation.valid) {
      setError(validation.errors.join('\n'));
      return;
    }

    setSubmitting(true);
    try {
      // Insert room_booking record first
      const { data: roomRec, error: insertError1 } = await supabase
        .from('operational_records')
        .insert({
          entity_type: 'front_desk',
          data: payload,
          financial_amount: payload.pricing.total_room_cost,
          // status defaults to pending via trigger
        })
        .select()
        .single();
      if (insertError1) throw insertError1;

      const originalId = (roomRec as any)?.original_id ?? (roomRec as any)?.id;
      if (!originalId) throw new Error('Failed to obtain original_id for linking.');

      // Insert guest_record linked via original_id, with zero financials
      const guestPayload = {
        type: 'guest_record',
        front_desk_staff_id: frontDeskStaffId,
        guest: { full_name, phone, email: email || undefined, id_reference: id_reference || undefined },
        stay: { room_id, check_in, check_out, adults, children },
        meta: { notes: notes || null, created_at_local },
      };

      const { error: insertError2 } = await supabase
        .from('operational_records')
        .insert({
          entity_type: 'front_desk',
          data: guestPayload,
          financial_amount: 0,
          original_id: originalId,
        });
      if (insertError2) throw insertError2;

      // success message handled by locked state instead
      setLocked(true);
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  }

  function goNext() {
    if (validateStep1()) setStep(2);
  }
  function goBack() {
    setStep(1);
  }

  const isStaffDropdownDisabled = role === 'front_desk' && Boolean(staffId);

  return (
    <div className="max-w-5xl mx-auto font-sans text-left p-4 md:p-6">
      <div className="flex items-center space-x-3 mb-6">
        <div className="bg-green-50 p-2 rounded-lg">
          <IconCalendar className="w-6 h-6 text-green-600" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Check-In Guest</h2>
          <p className="text-gray-500 text-sm">Process a new guest arrival</p>
        </div>
      </div>

      {!locked ? (
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Progress Steps */}
          <div className="flex items-center justify-center mb-8">
            <div className={`flex items-center gap-3 transition-colors duration-300 ${step === 1 ? 'text-green-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 text-sm font-bold transition-all duration-300 ${step === 1 ? 'border-green-600 bg-green-600 text-white shadow-md' : 'border-gray-300 bg-white text-gray-500'}`}>
                1
              </div>
              <span className="font-medium">Room & Stay</span>
            </div>
            <div className="w-24 h-0.5 bg-gray-200 mx-4 relative">
              <div className={`absolute left-0 top-0 h-full bg-green-600 transition-all duration-500 ${step === 2 ? 'w-full' : 'w-0'}`} />
            </div>
            <div className={`flex items-center gap-3 transition-colors duration-300 ${step === 2 ? 'text-green-600' : 'text-gray-400'}`}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 text-sm font-bold transition-all duration-300 ${step === 2 ? 'border-green-600 bg-green-600 text-white shadow-md' : 'border-gray-300 bg-white text-gray-500'}`}>
                2
              </div>
              <span className="font-medium">Guest & Payment</span>
            </div>
          </div>

          {error && (
            <div className="bg-error-light text-error p-4 rounded-lg flex items-start gap-3 border border-error-light animate-in slide-in-from-top-2">
              <IconAlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-bold">Error</p>
                <p className="whitespace-pre-wrap text-sm">{error}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Left Column: Form Content */}
            <div className="lg:col-span-2 space-y-6">
              {step === 1 && (
                <Card className="animate-in fade-in slide-in-from-left-4 duration-300 border-0 shadow-sm ring-1 ring-gray-200">
                  <div className="flex items-center gap-2 mb-6 border-b border-gray-100 pb-4">
                    <IconBed className="w-5 h-5 text-gray-500" />
                    <h3 className="text-lg font-semibold text-gray-800">Room Selection</h3>
                  </div>

                  {roomsError && (
                    <div className="bg-error-light text-error p-3 rounded-md mb-6 text-sm border border-error-light flex items-center gap-2">
                      <IconAlertCircle className="w-4 h-4" />
                      {roomsError}
                    </div>
                  )}

                  <div className="space-y-6">
                    <Select
                      label="Select Room"
                      value={room_id}
                      onChange={(e) => setRoomId(e.target.value)}
                      disabled={roomsLoading || rooms.length === 0}
                      error={step1Errors.room_id}
                      required
                      helperText={!roomsLoading && rooms.length === 0 ? "No active rooms available" : undefined}
                      fullWidth
                    >
                      <option value="">Choose a room...</option>
                      {rooms.map((r) => (
                        <option key={String(r.id)} value={String(r.id)}>
                          {r.room_number} — ₦{Number(r.price_per_night).toLocaleString()} / night
                        </option>
                      ))}
                    </Select>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <Input
                        type="date"
                        label="Check-in Date"
                        value={check_in}
                        onChange={(e) => setCheckIn(e.target.value)}
                        required
                        error={step1Errors.check_in}
                        fullWidth
                      />
                      <Input
                        type="date"
                        label="Check-out Date"
                        value={check_out}
                        onChange={(e) => setCheckOut(e.target.value)}
                        required
                        error={step1Errors.check_out}
                        fullWidth
                      />
                    </div>
                  </div>
                </Card>
              )}

              {step === 2 && (
                <Card className="animate-in fade-in slide-in-from-right-4 duration-300 border-0 shadow-sm ring-1 ring-gray-200">
                  <div className="space-y-8">
                    {/* Guest Section */}
                    <div>
                      <div className="flex items-center gap-2 mb-6 border-b border-gray-100 pb-4">
                        <IconUser className="w-5 h-5 text-gray-500" />
                        <h3 className="text-lg font-semibold text-gray-800">Guest Information</h3>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Input
                          label="Full Name"
                          value={full_name}
                          onChange={(e) => setFullName(e.target.value)}
                          required
                          placeholder="e.g. John Doe"
                          error={step2Errors.full_name}
                          fullWidth
                        />
                        <Input
                          label="Phone Number"
                          type="tel"
                          value={phone}
                          onChange={(e) => setPhone(e.target.value)}
                          required
                          placeholder="e.g. 08012345678"
                          error={step2Errors.phone}
                          fullWidth
                        />
                        <Input
                          label="Email Address"
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="Optional"
                          fullWidth
                        />
                        <Input
                          label="ID Reference"
                          value={id_reference}
                          onChange={(e) => setIdReference(e.target.value)}
                          placeholder="Passport / NIN / DL (Optional)"
                          fullWidth
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-6 mt-6">
                        <Input
                          type="number"
                          label="Adults"
                          min={0}
                          value={adults}
                          onChange={(e) => setAdults(Number(e.target.value))}
                          required
                          error={step2Errors.adults}
                          fullWidth
                        />
                        <Input
                          type="number"
                          label="Children"
                          min={0}
                          value={children}
                          onChange={(e) => setChildren(Number(e.target.value))}
                          required
                          error={step2Errors.children}
                          fullWidth
                        />
                      </div>
                    </div>

                    {/* Payment Section */}
                    <div>
                      <div className="flex items-center gap-2 mb-6 border-b border-gray-100 pb-4">
                        <IconCreditCard className="w-5 h-5 text-gray-500" />
                        <h3 className="text-lg font-semibold text-gray-800">Payment Details</h3>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <Select
                          label="Payment Method"
                          value={payment_method}
                          onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}
                          required
                          error={step2Errors.payment_method}
                          fullWidth
                        >
                          <option value="transfer">Transfer</option>
                          <option value="POS">POS</option>
                          <option value="cash">Cash</option>
                        </Select>
                        <Select
                          label="Payment Type"
                          value={payment_type}
                          onChange={(e) => setPaymentType(e.target.value as PaymentType)}
                          required
                          error={step2Errors.payment_type}
                          fullWidth
                        >
                          <option value="full">Full Payment</option>
                          <option value="part">Part Payment</option>
                        </Select>
                        <Input
                          type="number"
                          label="Amount Paid (₦)"
                          min={0}
                          step="0.01"
                          value={paid_amount}
                          onChange={(e) => setPaidAmount(Number(e.target.value))}
                          required
                          error={step2Errors.paid_amount}
                          fullWidth
                        />
                        <Input
                          type="date"
                          label="Payment Date"
                          value={payment_date}
                          onChange={(e) => setPaymentDate(e.target.value)}
                          required
                          error={step2Errors.payment_date}
                          fullWidth
                        />
                      </div>
                      <div className="mt-6">
                         <Input
                          label="Payment Reference"
                          value={payment_reference ?? ''}
                          onChange={(e) => setPaymentReference(e.target.value)}
                          placeholder="Txn ID, POS slip number, etc. (Optional)"
                          fullWidth
                        />
                      </div>
                    </div>
                    
                    {/* Additional Details */}
                    <div>
                      <div className="flex items-center gap-2 mb-6 border-b border-gray-100 pb-4">
                        <IconFileText className="w-5 h-5 text-gray-500" />
                        <h3 className="text-lg font-semibold text-gray-800">Additional Details</h3>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                        <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                          <label className="block text-sm font-medium text-gray-500 mb-1">Outstanding Balance</label>
                          <div className={`text-2xl font-bold ${balance > 0 ? 'text-error' : 'text-green-600'}`}>
                            ₦{balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </div>
                        </div>
                        
                        <Select
                          label="Staff Responsible"
                          value={frontDeskStaffId}
                          onChange={(e) => setFrontDeskStaffId(e.target.value)}
                          required
                          disabled={isStaffDropdownDisabled}
                          error={step2Errors.front_desk_staff_id}
                          fullWidth
                        >
                          <option value="">Select staff member</option>
                          {frontDeskStaffOptions.map((s) => (
                            <option key={s.id} value={s.id}>{s.full_name}</option>
                          ))}
                        </Select>
                      </div>

                      <div className="space-y-2">
                        <label className="block text-sm font-medium text-gray-700">Additional Notes</label>
                        <textarea 
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-all text-sm"
                          rows={3}
                          value={notes ?? ''}
                          onChange={(e) => setNotes(e.target.value)}
                          placeholder="Any special requests or comments..."
                        />
                      </div>
                    </div>
                  </div>
                </Card>
              )}
            </div>

            {/* Right Column: Summary & Navigation */}
            <div className="lg:col-span-1 space-y-6">
              <div className="sticky top-6 space-y-6">
                <Card className="bg-gray-50/50 border-gray-200 shadow-sm">
                  <h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-4 border-b border-gray-200 pb-2">Booking Summary</h3>
                  
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">Rate per Night</span>
                      <span className="font-medium">₦{room_rate.toLocaleString()}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">Nights</span>
                      <span className="font-medium">{nights}</span>
                    </div>
                    {step === 2 && (
                       <div className="flex justify-between text-green-600">
                        <span>Paid Amount</span>
                        <span className="font-medium">- ₦{paid_amount.toLocaleString()}</span>
                      </div>
                    )}
                    
                    <div className="pt-3 border-t border-gray-200 flex justify-between items-center">
                      <span className="font-bold text-gray-900">Total Due</span>
                      <span className="text-xl font-bold text-green-600">
                         ₦{(total_room_cost - (step === 2 ? paid_amount : 0)).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                     <div className="flex justify-between text-xs text-gray-500 mt-1">
                        <span>Total Cost</span>
                        <span>₦{total_room_cost.toLocaleString()}</span>
                      </div>
                  </div>
                </Card>

                <div className="flex flex-col gap-3">
                  {step === 1 ? (
                    <Button 
                      onClick={goNext} 
                      className="w-full justify-center shadow-md hover:shadow-lg transition-shadow"
                      size="lg"
                    >
                      Next Step
                      <IconChevronRight className="w-4 h-4 ml-2" />
                    </Button>
                  ) : (
                    <>
                      <Button 
                        onClick={(e) => handleSubmit(e)} 
                        className="w-full justify-center shadow-md hover:shadow-lg transition-shadow bg-green-600 hover:bg-green-700 text-white"
                        size="lg"
                        isLoading={submitting}
                        disabled={submitting}
                      >
                        <IconCheckCircle className="w-4 h-4 mr-2" />
                        Complete Check-In
                      </Button>
                      <Button 
                        onClick={goBack} 
                        variant="outline"
                        className="w-full justify-center"
                        disabled={submitting}
                      >
                        <IconChevronLeft className="w-4 h-4 mr-2" />
                        Back to Room
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </form>
      ) : (
        <Card className="text-center py-16 animate-in zoom-in-50 duration-500">
           <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-6">
             <IconCheckCircle className="w-10 h-10" />
           </div>
           <h2 className="text-3xl font-bold text-gray-900 mb-2">Check-In Successful!</h2>
           <p className="text-gray-500 mb-8">The guest has been checked in and the room is now occupied.</p>
           
           <Button 
             onClick={() => window.location.reload()} 
             className="min-w-[200px]"
             size="lg"
           >
             Process Another Guest
           </Button>
        </Card>
      )}
    </div>
  );
}
