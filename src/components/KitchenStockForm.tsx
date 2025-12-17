import { useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

import type { KitchenStockData } from '../types/kitchen';

export default function KitchenStockForm() {
  const { role, session, isConfigured } = useAuth();

  // Role gating: only render for kitchen; otherwise no queries and show access denied
  if (role !== 'kitchen') {
    return (
      <div style={{ maxWidth: 720, margin: '24px auto' }}>
        <h2>Access denied</h2>
        <p>You must be kitchen staff to submit daily stock records.</p>
      </div>
    );
  }

  const [date, setDate] = useState<string>('');
  const [itemName, setItemName] = useState<string>('');
  const [openingStock, setOpeningStock] = useState<number>(0);
  const [restocked, setRestocked] = useState<number>(0);
  const [sold, setSold] = useState<number>(0);
  const closingStock = useMemo(() => {
    const raw = (Number(openingStock) || 0) + (Number(restocked) || 0) - (Number(sold) || 0);
    return raw;
  }, [openingStock, restocked, sold]);
  const [notes, setNotes] = useState<string>('');

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const validate = (): string | null => {
    if (!date) return 'Date is required';
    if (!itemName.trim()) return 'Item name is required';

    const o = Number(openingStock);
    const r = Number(restocked);
    const s = Number(sold);

    if (!Number.isFinite(o) || o < 0) return 'Opening stock must be a number greater than or equal to 0';
    if (!Number.isFinite(r) || r < 0) return 'Restocked quantity must be a number greater than or equal to 0';
    if (!Number.isFinite(s) || s < 0) return 'Sold quantity must be a number greater than or equal to 0';

    const computed = o + r - s;
    if (s > o + r) return 'Sold quantity cannot exceed opening stock plus restocked quantity';
    if (computed < 0) return 'Closing stock cannot be negative';

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!isConfigured || !session || !supabase) {
      setError('Authentication required. Please sign in.');
      return;
    }

    const vErr = validate();
    if (vErr) {
      setError(vErr);
      return;
    }

    const payload: { entity_type: string; data: KitchenStockData; financial_amount: number } = {
      entity_type: 'kitchen',
      data: {
        date,
        item_name: itemName.trim(),
        opening_stock: Number(openingStock) || 0,
        restocked: Number(restocked) || 0,
        sold: Number(sold) || 0,
        closing_stock: Number(closingStock) || 0,
        notes: notes?.trim() ? notes.trim() : undefined,
      },
      financial_amount: 0,
    };

    try {
      setSubmitting(true);
      const { error: insertError } = await supabase
        .from('operational_records')
        .insert([payload]);
      if (insertError) {
        setError(insertError.message);
        return;
      }
      setSuccess('Daily stock submitted for supervisor approval.');
      // Reset form after successful submission
      setDate('');
      setItemName('');
      setOpeningStock(0);
      setRestocked(0);
      setSold(0);
      setNotes('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 720, margin: '24px auto' }}>
      <h2>Kitchen Staff — Daily Stock Submission</h2>
      <form onSubmit={handleSubmit} style={{ display: 'grid', gap: 12, marginTop: 12 }}>
        <div>
          <label style={{ display: 'block', marginBottom: 6 }}>Date *</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
            disabled={submitting}
            style={{ width: '100%', padding: '8px 10px' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 6 }}>Item name *</label>
          <input
            type="text"
            value={itemName}
            onChange={(e) => setItemName(e.target.value)}
            required
            disabled={submitting}
            placeholder="e.g. Rice"
            style={{ width: '100%', padding: '8px 10px' }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6 }}>Opening stock (≥ 0)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={openingStock}
              onChange={(e) => setOpeningStock(Number(e.target.value))}
              disabled={submitting}
              style={{ width: '100%', padding: '8px 10px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 6 }}>Restocked (≥ 0)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={restocked}
              onChange={(e) => setRestocked(Number(e.target.value))}
              disabled={submitting}
              style={{ width: '100%', padding: '8px 10px' }}
            />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6 }}>Sold (≥ 0)</label>
            <input
              type="number"
              min={0}
              step={1}
              value={sold}
              onChange={(e) => setSold(Number(e.target.value))}
              disabled={submitting}
              style={{ width: '100%', padding: '8px 10px' }}
            />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 6 }}>Closing stock (auto)</label>
            <input
              type="number"
              value={closingStock}
              readOnly
              disabled
              style={{ width: '100%', padding: '8px 10px', background: '#f6f6f6' }}
            />
            <small style={{ color: '#666' }}>closing_stock = opening_stock + restocked - sold</small>
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: 6 }}>Notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            disabled={submitting}
            rows={3}
            style={{ width: '100%', padding: '8px 10px' }}
          />
        </div>

        {error && (
          <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6 }}>
            {error}
          </div>
        )}
        {success && (
          <div style={{ background: '#e6ffed', color: '#0a7f3b', padding: '8px 12px', borderRadius: 6 }}>
            {success}
          </div>
        )}

        <div>
          <button type="submit" disabled={submitting} style={{ padding: '10px 14px' }}>
            {submitting ? 'Submitting…' : 'Submit Daily Stock'}
          </button>
        </div>
      </form>
    </div>
  );
}