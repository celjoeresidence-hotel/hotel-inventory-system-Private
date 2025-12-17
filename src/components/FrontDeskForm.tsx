import { useEffect, useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import type { FrontDeskRecordData, PaymentMethod, PaymentType } from '../types/frontDesk';
import { validateFrontDeskData } from '../utils/frontDeskValidation';

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
  // const [success, setSuccess] = useState<string | null>(null);

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
// (line removed – setSuccess is not declared in this component)

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
    <div className="fd-form" style={{ maxWidth: 900, margin: '24px auto', textAlign: 'left', fontFamily: 'Montserrat, system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, sans-serif' }}>
      {!locked ? (
        <form onSubmit={handleSubmit}>
          <h2 style={{ marginBottom: 8 }}>Front Desk Room Booking</h2>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <span style={{ padding: '6px 10px', borderRadius: 999, background: step === 1 ? '#1B5E20' : '#eee', color: step === 1 ? '#fff' : '#333' }}>Step 1: Room Booking</span>
            <span style={{ padding: '6px 10px', borderRadius: 999, background: step === 2 ? '#1B5E20' : '#eee', color: step === 2 ? '#fff' : '#333' }}>Step 2: Guest & Payment</span>
          </div>

          {error && (
            <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
              <strong>Error:</strong>
              <div style={{ whiteSpace: 'pre-wrap' }}>{error}</div>
            </div>
          )}

          {step === 1 && (
            <fieldset style={{ border: '1px solid #ddd', padding: 16, marginBottom: 16, background: '#fff', borderRadius: 8 }}>
              <legend>Room Booking</legend>

              {roomsError && (
                <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
                  {roomsError}
                </div>
              )}

              <label style={{ display: 'block', marginBottom: 8 }}>
                Room
                <select value={room_id} onChange={(e) => setRoomId(e.target.value)} required style={{ width: '100%', padding: 10 }} disabled={roomsLoading || rooms.length === 0}>
                  <option value="">Select a room</option>
                  {rooms.map((r) => (
                    <option key={String(r.id)} value={String(r.id)}>
                      {r.room_number} — ₦{Number(r.price_per_night).toFixed(2)} / night
                    </option>
                  ))}
                </select>
                {!roomsLoading && rooms.length === 0 && (
                  <div style={{ color: '#900', marginTop: 4 }}>No active rooms available</div>
                )}
                {step1Errors.room_id && <div style={{ color: '#900', marginTop: 4 }}>{step1Errors.room_id}</div>}
              </label>

              <div style={{ display: 'flex', gap: 12 }}>
                <label style={{ flex: 1 }}>
                  Check-in date
                  <input type="date" value={check_in} onChange={(e) => setCheckIn(e.target.value)} required style={{ width: '100%', padding: 10 }} />
                  {step1Errors.check_in && <div style={{ color: '#900', marginTop: 4 }}>{step1Errors.check_in}</div>}
                </label>
                <label style={{ flex: 1 }}>
                  Check-out date
                  <input type="date" value={check_out} onChange={(e) => setCheckOut(e.target.value)} required style={{ width: '100%', padding: 10 }} />
                  {step1Errors.check_out && <div style={{ color: '#900', marginTop: 4 }}>{step1Errors.check_out}</div>}
                </label>
              </div>

              <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                <label style={{ flex: 1 }}>
                  Nights (auto)
                  <input type="number" min={0} value={nights} readOnly style={{ width: '100%', padding: 10 }} />
                  {step1Errors.nights && <div style={{ color: '#900', marginTop: 4 }}>{step1Errors.nights}</div>}
                </label>
                <label style={{ flex: 1 }}>
                  Price per night (read-only)
                  <input type="number" min={0} step="0.01" value={room_rate} readOnly style={{ width: '100%', padding: 10 }} />
                  {step1Errors.room_rate && <div style={{ color: '#900', marginTop: 4 }}>{step1Errors.room_rate}</div>}
                </label>
              </div>

              <label style={{ display: 'block', marginTop: 8 }}>
                Total (auto)
                <input type="number" min={0} step="0.01" value={total_room_cost} readOnly style={{ width: '100%', padding: 10 }} />
              </label>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 16 }}>
                <span />
                <button type="button" onClick={goNext} style={{ padding: '12px 16px', background: '#1B5E20', color: '#fff', border: 0, borderRadius: 8 }}>
                  Next: Guest & Payment
                </button>
              </div>
            </fieldset>
          )}

          {step === 2 && (
            <fieldset style={{ border: '1px solid #ddd', padding: 16, marginBottom: 16, background: '#fff', borderRadius: 8 }}>
              <legend>Guest & Payment</legend>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <label>
                  Guest full name
                  <input type="text" value={full_name} onChange={(e) => setFullName(e.target.value)} required style={{ width: '100%', padding: 10 }} />
                  {step2Errors.full_name && <div style={{ color: '#900', marginTop: 4 }}>{step2Errors.full_name}</div>}
                </label>
                <label>
                  Phone
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required style={{ width: '100%', padding: 10 }} />
                  {step2Errors.phone && <div style={{ color: '#900', marginTop: 4 }}>{step2Errors.phone}</div>}
                </label>
                <label>
                  Email (optional)
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%', padding: 10 }} />
                </label>
                <label>
                  ID reference (optional)
                  <input type="text" value={id_reference} onChange={(e) => setIdReference(e.target.value)} style={{ width: '100%', padding: 10 }} />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                <label>
                  Adults count
                  <input type="number" min={0} value={adults} onChange={(e) => setAdults(Number(e.target.value))} required style={{ width: '100%', padding: 10 }} />
                  {step2Errors.adults && <div style={{ color: '#900', marginTop: 4 }}>{step2Errors.adults}</div>}
                </label>
                <label>
                  Children count
                  <input type="number" min={0} value={children} onChange={(e) => setChildren(Number(e.target.value))} required style={{ width: '100%', padding: 10 }} />
                  {step2Errors.children && <div style={{ color: '#900', marginTop: 4 }}>{step2Errors.children}</div>}
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                <label>
                  Payment method
                  <select value={payment_method} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)} required style={{ width: '100%', padding: 10 }}>
                    <option value="transfer">Transfer</option>
                    <option value="POS">POS</option>
                  </select>
                  {step2Errors.payment_method && <div style={{ color: '#900', marginTop: 4 }}>{step2Errors.payment_method}</div>}
                </label>
                <label>
                  Payment type
                  <select value={payment_type} onChange={(e) => setPaymentType(e.target.value as PaymentType)} required style={{ width: '100%', padding: 10 }}>
                    <option value="full">Full</option>
                    <option value="part">Part</option>
                  </select>
                  {step2Errors.payment_type && <div style={{ color: '#900', marginTop: 4 }}>{step2Errors.payment_type}</div>}
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                <label>
                  Amount paid
                  <input type="number" min={0} step="0.01" value={paid_amount} onChange={(e) => setPaidAmount(Number(e.target.value))} required style={{ width: '100%', padding: 10 }} />
                  {step2Errors.paid_amount && <div style={{ color: '#900', marginTop: 4 }}>{step2Errors.paid_amount}</div>}
                </label>
                <label>
                  Payment date
                  <input type="date" value={payment_date} onChange={(e) => setPaymentDate(e.target.value)} required style={{ width: '100%', padding: 10 }} />
                  {step2Errors.payment_date && <div style={{ color: '#900', marginTop: 4 }}>{step2Errors.payment_date}</div>}
                </label>
              </div>

              <label style={{ display: 'block', marginTop: 8 }}>
                Payment reference (optional)
                <input type="text" value={payment_reference ?? ''} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Txn ID or POS slip #" style={{ width: '100%', padding: 10 }} />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 8 }}>
                <label>
                  Outstanding balance (auto)
                  <input type="number" min={0} step="0.01" value={balance} readOnly style={{ width: '100%', padding: 10 }} />
                </label>
                <label>
                  Front Desk Staff Responsible
                  <select value={frontDeskStaffId} onChange={(e) => setFrontDeskStaffId(e.target.value)} required disabled={isStaffDropdownDisabled} style={{ width: '100%', padding: 10 }}>
                    <option value="">Select staff</option>
                    {frontDeskStaffOptions.map((s) => (
                      <option key={s.id} value={s.id}>{s.full_name}</option>
                    ))}
                  </select>
                  {step2Errors.front_desk_staff_id && <div style={{ color: '#900', marginTop: 4 }}>{step2Errors.front_desk_staff_id}</div>}
                </label>
              </div>

              <label style={{ display: 'block', marginTop: 8 }}>
                Notes (optional)
                <textarea value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ width: '100%', padding: 10 }} placeholder="Optional notes" />
              </label>

              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 16 }}>
                <button type="button" onClick={goBack} style={{ padding: '12px 16px', background: '#eee', color: '#333', border: 0, borderRadius: 8 }}>Back</button>
                <button type="submit" disabled={submitting} style={{ padding: '12px 16px', background: '#1B5E20', color: '#fff', border: 0, borderRadius: 8 }}>
                  {submitting ? 'Submitting...' : 'Submit for Approval'}
                </button>
              </div>
            </fieldset>
          )}
        </form>
      ) : (
        <div style={{ maxWidth: 700, margin: '40px auto', textAlign: 'center' }}>
          <h2>Submitted for Supervisor Approval</h2>
          <p>Your room booking and guest record have been submitted and are pending review.</p>
        </div>
      )}
    </div>
  );
}