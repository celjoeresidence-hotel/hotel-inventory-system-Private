import { useMemo, useState } from 'react';
import { isSupabaseConfigured, supabase } from '../supabaseClient';
import type { FrontDeskRecordData } from '../types/frontDesk';
import { validateFrontDeskData } from '../utils/frontDeskValidation';

// Helper to format ISO date (YYYY-MM-DD)
const toISODate = (d: Date) => d.toISOString().split('T')[0];

export default function FrontDeskForm() {
  const today = useMemo(() => new Date(), []);

  const [full_name, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [room_id, setRoomId] = useState('');
  const [check_in, setCheckIn] = useState(toISODate(today));
  const [check_out, setCheckOut] = useState(toISODate(new Date(today.getTime() + 24 * 60 * 60 * 1000))); // +1 day
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);

  const [room_rate, setRoomRate] = useState(0);

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

  const [paid_amount, setPaidAmount] = useState(0);
  const [payment_method, setPaymentMethod] = useState<'transfer' | 'POS'>('transfer');
  const [payment_reference, setPaymentReference] = useState<string | null>('');

  const balance = useMemo(() => Number((total_room_cost - paid_amount).toFixed(2)), [total_room_cost, paid_amount]);

  const [notes, setNotes] = useState<string | null>('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const created_at_local = useMemo(() => new Date().toISOString(), []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }

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
      guest: { full_name, phone },
      stay: { room_id, check_in, check_out, adults, children },
      pricing: { room_rate, nights, total_room_cost },
      payment: { paid_amount, payment_method, payment_reference: payment_reference || null, balance },
      meta: { notes: notes || null, created_at_local },
    };

    const validation = validateFrontDeskData(payload);
    if (!validation.valid) {
      setError(validation.errors.join('\n'));
      return;
    }

    setSubmitting(true);
    try {
      const { error: insertError } = await supabase
        .from('operational_records')
        .insert({
          entity_type: 'front_desk',
          data: payload,
          financial_amount: payload.pricing.total_room_cost,
        });
      if (insertError) throw insertError;
      setSuccess('Record submitted successfully.');
      // Clear form optionally
      // setFullName(''); setPhone(''); setRoomId(''); setPaidAmount(0); setRoomRate(0); setNotes('');
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="fd-form" style={{ maxWidth: 720, margin: '0 auto', textAlign: 'left' }}>
      <h2>Front Desk Record Submission</h2>

      {error && (
        <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
          <strong>Error:</strong>
          <div style={{ whiteSpace: 'pre-wrap' }}>{error}</div>
        </div>
      )}

      {success && (
        <div style={{ background: '#e5ffe5', color: '#0a0', padding: '8px 12px', borderRadius: 6, marginBottom: 12 }}>
          {success}
        </div>
      )}

      <fieldset style={{ border: '1px solid #ccc', padding: 12, marginBottom: 16 }}>
        <legend>Guest Details</legend>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Full Name
          <input type="text" value={full_name} onChange={(e) => setFullName(e.target.value)} required style={{ width: '100%' }} />
        </label>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Phone
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required style={{ width: '100%' }} />
        </label>
      </fieldset>

      <fieldset style={{ border: '1px solid #ccc', padding: 12, marginBottom: 16 }}>
        <legend>Stay Details</legend>
        <label style={{ display: 'block', marginBottom: 8 }}>
          Room ID
          <input type="text" value={room_id} onChange={(e) => setRoomId(e.target.value)} required style={{ width: '100%' }} />
        </label>
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 1 }}>
            Check-in
            <input type="date" value={check_in} onChange={(e) => setCheckIn(e.target.value)} required />
          </label>
          <label style={{ flex: 1 }}>
            Check-out
            <input type="date" value={check_out} onChange={(e) => setCheckOut(e.target.value)} required />
          </label>
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <label style={{ flex: 1 }}>
            Adults
            <input type="number" min={0} value={adults} onChange={(e) => setAdults(Number(e.target.value))} required />
          </label>
          <label style={{ flex: 1 }}>
            Children
            <input type="number" min={0} value={children} onChange={(e) => setChildren(Number(e.target.value))} required />
          </label>
        </div>
      </fieldset>

      <fieldset style={{ border: '1px solid #ccc', padding: 12, marginBottom: 16 }}>
        <legend>Pricing</legend>
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 1 }}>
            Room Rate
            <input type="number" min={0} step="0.01" value={room_rate} onChange={(e) => setRoomRate(Number(e.target.value))} required />
          </label>
          <label style={{ flex: 1 }}>
            Nights
            <input type="number" min={0} value={nights} readOnly />
          </label>
        </div>
        <label style={{ display: 'block', marginTop: 8 }}>
          Total Room Cost
          <input type="number" min={0} step="0.01" value={total_room_cost} readOnly />
        </label>
      </fieldset>

      <fieldset style={{ border: '1px solid #ccc', padding: 12, marginBottom: 16 }}>
        <legend>Payment</legend>
        <div style={{ display: 'flex', gap: 12 }}>
          <label style={{ flex: 1 }}>
            Paid Amount
            <input type="number" min={0} step="0.01" value={paid_amount} onChange={(e) => setPaidAmount(Number(e.target.value))} required />
          </label>
          <label style={{ flex: 1 }}>
            Payment Method
            <select value={payment_method} onChange={(e) => setPaymentMethod(e.target.value as 'transfer' | 'POS')} required>
              <option value="transfer">Transfer</option>
              <option value="POS">POS</option>
            </select>
          </label>
        </div>
        <label style={{ display: 'block', marginTop: 8 }}>
          Payment Reference (optional)
          <input type="text" value={payment_reference ?? ''} onChange={(e) => setPaymentReference(e.target.value)} placeholder="Txn ID or POS slip #" />
        </label>
        <label style={{ display: 'block', marginTop: 8 }}>
          Balance
          <input type="number" min={0} step="0.01" value={balance} readOnly />
        </label>
      </fieldset>

      <fieldset style={{ border: '1px solid #ccc', padding: 12, marginBottom: 16 }}>
        <legend>Notes</legend>
        <label style={{ display: 'block' }}>
          <textarea value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} rows={3} style={{ width: '100%' }} placeholder="Optional notes" />
        </label>
      </fieldset>

      <button type="submit" disabled={submitting} style={{ width: '100%', padding: '12px 16px' }}>
        {submitting ? 'Submitting...' : 'Submit Record'}
      </button>
    </form>
  );
}