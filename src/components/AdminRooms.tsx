import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

interface RoomRow {
  id: number | string;
  room_number: string;
  room_type: string;
  price_per_night: number;
  is_active: boolean;
}

function numberOrZero(n: any): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export default function AdminRooms() {
  const { role, isConfigured, session } = useAuth();

  const isAdmin = useMemo(() => role === 'admin' && Boolean(isConfigured && session && supabase), [role, isConfigured, session]);

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Add form state
  const [addOpen, setAddOpen] = useState<boolean>(false);
  const [addRoomNumber, setAddRoomNumber] = useState<string>('');
  const [addRoomType, setAddRoomType] = useState<string>('');
  const [addPrice, setAddPrice] = useState<string>('');
  const [addSubmitting, setAddSubmitting] = useState<boolean>(false);

  // Edit state
  const [editId, setEditId] = useState<number | string | null>(null);
  const [editRoomNumber, setEditRoomNumber] = useState<string>('');
  const [editRoomType, setEditRoomType] = useState<string>('');
  const [editPrice, setEditPrice] = useState<string>('');
  const [editSubmitting, setEditSubmitting] = useState<boolean>(false);

  // Toggle state loading per row
  const [toggleLoadingId, setToggleLoadingId] = useState<number | string | null>(null);

  useEffect(() => {
    async function fetchRooms() {
      setError(null);
      if (!isAdmin) {
        setRooms([]);
        return;
      }
      setLoading(true);
      try {
        const { data, error } = await supabase!
          .from('rooms')
          .select('*')
          .order('room_number', { ascending: true });
        if (error) {
          setError(error.message);
          return;
        }
        setRooms((data ?? []).map((r: any) => ({
          id: r.id,
          room_number: r.room_number,
          room_type: r.room_type,
          price_per_night: numberOrZero(r.price_per_night),
          is_active: Boolean(r.is_active),
        })));
      } finally {
        setLoading(false);
      }
    }
    fetchRooms();
  }, [isAdmin]);

  function resetAddForm() {
    setAddRoomNumber('');
    setAddRoomType('');
    setAddPrice('');
    setAddSubmitting(false);
  }

  function resetEditForm() {
    setEditId(null);
    setEditRoomNumber('');
    setEditRoomType('');
    setEditPrice('');
    setEditSubmitting(false);
  }

  function validateRoomFields(room_number: string, price_str: string) {
    if (!room_number || room_number.trim().length === 0) {
      return 'Room number is required.';
    }
    const price = numberOrZero(price_str);
    if (price < 0) {
      return 'Price per night must be greater than or equal to 0.';
    }
    return null;
  }

  function handleDuplicateErrorMessage(msg: string | undefined, code?: string): string {
    if (code === '23505') return 'Room number must be unique. This room already exists.';
    const text = (msg ?? '').toLowerCase();
    if (text.includes('duplicate key') || text.includes('unique constraint')) {
      return 'Room number must be unique. This room already exists.';
    }
    return msg ?? 'Unknown error occurred.';
  }

  async function addRoom() {
    if (!isAdmin) return;
    setError(null);
    const validationError = validateRoomFields(addRoomNumber, addPrice);
    if (validationError) {
      setError(validationError);
      return;
    }
    setAddSubmitting(true);
    try {
      const payload = {
        room_number: addRoomNumber.trim(),
        room_type: addRoomType.trim(),
        price_per_night: numberOrZero(addPrice),
        is_active: true,
      };
      const { data, error } = await supabase!
        .from('rooms')
        .insert([payload])
        .select()
        .single();
      if (error) {
        setError(handleDuplicateErrorMessage(error.message, (error as any).code));
        return;
      }
      const newRow: RoomRow = {
        id: (data as any).id,
        room_number: (data as any).room_number,
        room_type: (data as any).room_type,
        price_per_night: numberOrZero((data as any).price_per_night),
        is_active: Boolean((data as any).is_active),
      };
      setRooms((prev) => {
        const next = [...prev, newRow];
        next.sort((a, b) => String(a.room_number).localeCompare(String(b.room_number)));
        return next;
      });
      resetAddForm();
      setAddOpen(false);
    } finally {
      setAddSubmitting(false);
    }
  }

  function startEdit(row: RoomRow) {
    setError(null);
    setEditId(row.id);
    setEditRoomNumber(row.room_number);
    setEditRoomType(row.room_type ?? '');
    setEditPrice(String(row.price_per_night ?? ''));
  }

  async function saveEdit() {
    if (!isAdmin || editId == null) return;
    setError(null);
    const validationError = validateRoomFields(editRoomNumber, editPrice);
    if (validationError) {
      setError(validationError);
      return;
    }
    setEditSubmitting(true);
    try {
      const payload = {
        room_number: editRoomNumber.trim(),
        room_type: editRoomType.trim(),
        price_per_night: numberOrZero(editPrice),
      };
      const { data, error } = await supabase!
        .from('rooms')
        .update(payload)
        .eq('id', editId)
        .select()
        .single();
      if (error) {
        setError(handleDuplicateErrorMessage(error.message, (error as any).code));
        return;
      }
      setRooms((prev) => prev.map((r) => (r.id === editId ? {
        id: (data as any).id,
        room_number: (data as any).room_number,
        room_type: (data as any).room_type,
        price_per_night: numberOrZero((data as any).price_per_night),
        is_active: Boolean((data as any).is_active),
      } : r)));
      resetEditForm();
    } finally {
      setEditSubmitting(false);
    }
  }

  async function toggleActive(row: RoomRow) {
    if (!isAdmin) return;
    setError(null);
    setToggleLoadingId(row.id);
    try {
      const { data, error } = await supabase!
        .from('rooms')
        .update({ is_active: !row.is_active })
        .eq('id', row.id)
        .select()
        .single();
      if (error) {
        setError(error.message);
        return;
      }
      setRooms((prev) => prev.map((r) => (r.id === row.id ? {
        id: (data as any).id,
        room_number: (data as any).room_number,
        room_type: (data as any).room_type,
        price_per_night: numberOrZero((data as any).price_per_night),
        is_active: Boolean((data as any).is_active),
      } : r)));
    } finally {
      setToggleLoadingId(null);
    }
  }

  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 700, margin: '40px auto', textAlign: 'center' }}>
        <h2>Access denied</h2>
        <p>You must be an administrator to manage rooms.</p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: '24px auto' }}>
      <h2>Admin Room Management</h2>

      {error && (
        <div style={{ background: '#ffe5e5', color: '#900', padding: '8px 12px', borderRadius: 6, marginTop: 8 }}>
          {error}
        </div>
      )}

      <div style={{ marginTop: 12, marginBottom: 12 }}>
        {!addOpen ? (
          <button onClick={() => setAddOpen(true)}>Add Room</button>
        ) : (
          <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
            <h3 style={{ marginTop: 0 }}>Add New Room</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <div>
                <label>Room Number</label>
                <input value={addRoomNumber} onChange={(e) => setAddRoomNumber(e.target.value)} />
              </div>
              <div>
                <label>Room Type</label>
                <input value={addRoomType} onChange={(e) => setAddRoomType(e.target.value)} />
              </div>
              <div>
                <label>Price per Night</label>
                <input type="number" value={addPrice} onChange={(e) => setAddPrice(e.target.value)} />
              </div>
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
              <button onClick={addRoom} disabled={addSubmitting}>{addSubmitting ? 'Saving...' : 'Save'}</button>
              <button onClick={() => { resetAddForm(); setAddOpen(false); }} disabled={addSubmitting}>Cancel</button>
            </div>
          </div>
        )}
      </div>

      <div>
        {loading ? (
          <div>Loading rooms...</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Room Number</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Room Type</th>
                <th style={{ textAlign: 'right', borderBottom: '1px solid #ddd', padding: 8 }}>Price per Night</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Status</th>
                <th style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((r) => (
                <tr key={String(r.id)}>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                    {editId === r.id ? (
                      <input value={editRoomNumber} onChange={(e) => setEditRoomNumber(e.target.value)} />
                    ) : (
                      r.room_number
                    )}
                  </td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                    {editId === r.id ? (
                      <input value={editRoomType} onChange={(e) => setEditRoomType(e.target.value)} />
                    ) : (
                      r.room_type ?? '-'
                    )}
                  </td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8, textAlign: 'right' }}>
                    {editId === r.id ? (
                      <input type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} />
                    ) : (
                      r.price_per_night
                    )}
                  </td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                    {r.is_active ? 'Active' : 'Inactive'}
                  </td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                    {editId === r.id ? (
                      <>
                        <button onClick={saveEdit} disabled={editSubmitting}>{editSubmitting ? 'Saving...' : 'Save'}</button>
                        <button onClick={resetEditForm} disabled={editSubmitting} style={{ marginLeft: 8 }}>Cancel</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => startEdit(r)} style={{ marginRight: 8 }}>Edit</button>
                        <button onClick={() => toggleActive(r)} disabled={toggleLoadingId === r.id}>
                          {toggleLoadingId === r.id ? 'Working...' : r.is_active ? 'Deactivate' : 'Activate'}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {rooms.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ padding: 12, textAlign: 'center', color: '#666' }}>No rooms found.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}