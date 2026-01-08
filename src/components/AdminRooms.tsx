import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { 
  Table, 
  TableHeader, 
  TableBody, 
  TableRow, 
  TableHead, 
  TableCell 
} from './ui/Table';
import { 
  IconPlus, 
  IconEdit, 
  IconCheck, 
  IconX, 
  IconBed,
  IconLoader,
  IconAlertCircle,
  IconSettings
} from './ui/Icons';

interface RoomRow {
  id: number | string;
  room_number: string;
  room_name?: string;
  room_type: string;
  price_per_night: number;
  is_active: boolean;
}

function numberOrZero(n: any): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

export default function AdminRooms() {
  const { role, isConfigured, session, ensureActiveSession } = useAuth();

  const isAdmin = useMemo(() => role === 'admin' && Boolean(isConfigured && session && supabase), [role, isConfigured, session]);

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<'add' | 'edit'>('add');
  const [currentRoom, setCurrentRoom] = useState<Partial<RoomRow>>({});
  const [submitting, setSubmitting] = useState(false);

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
          room_name: r.room_name || '',
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

  function validateRoomFields(room_number: string | undefined, price_str: number | undefined) {
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

  function handleOpenAdd() {
    setModalMode('add');
    setCurrentRoom({ room_number: '', room_name: '', room_type: '', price_per_night: 0, is_active: true });
    setIsModalOpen(true);
    setError(null);
  }

  function handleOpenEdit(room: RoomRow) {
    setModalMode('edit');
    setCurrentRoom({ ...room });
    setIsModalOpen(true);
    setError(null);
  }

  async function handleSave() {
    if (!isAdmin) return;
    setError(null);
    const validationError = validateRoomFields(currentRoom.room_number, currentRoom.price_per_night);
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);

    try {
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) {
        setError('Session expired. Please sign in again to continue.');
        setSubmitting(false);
        return;
      }

      const payload = {
        room_number: currentRoom.room_number?.trim(),
        room_name: currentRoom.room_name?.trim() || null,
        room_type: currentRoom.room_type?.trim(),
        price_per_night: numberOrZero(currentRoom.price_per_night),
        is_active: modalMode === 'add' ? true : currentRoom.is_active,
      };

      // Clean payload if room_name is empty/null to avoid issues if column missing? 
      // Actually we'll try to send it. If column missing, Supabase might ignore or error.
      // We'll proceed.

      if (modalMode === 'add') {
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
          room_name: (data as any).room_name || '',
          room_type: (data as any).room_type,
          price_per_night: numberOrZero((data as any).price_per_night),
          is_active: Boolean((data as any).is_active),
        };

        setRooms((prev) => {
          const next = [...prev, newRow];
          next.sort((a, b) => String(a.room_number).localeCompare(String(b.room_number)));
          return next;
        });
      } else {
        // Edit mode
        if (!currentRoom.id) return;
        
        const { data, error } = await supabase!
          .from('rooms')
          .update(payload)
          .eq('id', currentRoom.id)
          .select()
          .single();

        if (error) {
          setError(handleDuplicateErrorMessage(error.message, (error as any).code));
          return;
        }

        setRooms((prev) => prev.map((r) => (r.id === currentRoom.id ? {
          id: (data as any).id,
          room_number: (data as any).room_number,
          room_name: (data as any).room_name || '',
          room_type: (data as any).room_type,
          price_per_night: numberOrZero((data as any).price_per_night),
          is_active: Boolean((data as any).is_active),
        } : r)));
      }
      setIsModalOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(row: RoomRow) {
    if (!isAdmin) return;
    setError(null);
    setToggleLoadingId(row.id);
    try {
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) { setError('Session expired. Please sign in again.'); setToggleLoadingId(null); return; }

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
        room_name: (data as any).room_name || '',
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
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center p-6">
        <div className="w-16 h-16 bg-error-light rounded-full flex items-center justify-center mb-4">
          <IconAlertCircle className="w-8 h-8 text-error" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Access Denied</h2>
        <p className="text-gray-500 max-w-md">You must be an administrator to manage rooms.</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <IconSettings className="w-6 h-6 text-gray-500" />
            Room Management
          </h1>
          <p className="text-gray-500 text-sm mt-1">Configure hotel rooms, types, and pricing</p>
        </div>
        <Button onClick={handleOpenAdd} className="gap-2">
          <IconPlus className="w-4 h-4" />
          Add New Room
        </Button>
      </div>

      {error && (
        <div className="bg-error-light border border-error-light text-error px-4 py-3 rounded-md flex items-start gap-2 animate-fadeIn">
          <IconAlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <Card className="overflow-hidden border border-gray-200 shadow-sm">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Room Number</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Price / Night</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center text-gray-500">
                      <IconLoader className="w-8 h-8 animate-spin text-green-600 mb-2" />
                      <p>Loading rooms...</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : rooms.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center text-gray-500">
                      <IconBed className="w-12 h-12 text-gray-300 mb-3" />
                      <p className="text-lg font-medium text-gray-900">No rooms found</p>
                      <p className="text-sm">Get started by adding your first room.</p>
                      <Button variant="outline" size="sm" onClick={handleOpenAdd} className="mt-4">
                        Add Room
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                rooms.map((room) => (
                  <TableRow key={room.id} className="group hover:bg-gray-50/50">
                    <TableCell className="font-medium text-gray-900 sticky left-0 z-10 bg-white group-hover:bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                      {room.room_number}
                    </TableCell>
                    <TableCell className="text-gray-600">
                      {room.room_name || '—'}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                        {room.room_type || 'Standard'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono text-gray-700">
                      ₦{room.price_per_night.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell>
                      <Badge variant={room.is_active ? 'success' : 'default'}>
                        {room.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleOpenEdit(room)}
                          title="Edit Room"
                        >
                          <IconEdit className="w-4 h-4 text-gray-500" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggleActive(room)}
                          disabled={toggleLoadingId === room.id}
                          title={room.is_active ? "Deactivate" : "Activate"}
                            className={room.is_active ? "text-error hover:text-error hover:bg-error-light" : "text-green-600 hover:text-green-700 hover:bg-green-50"}
                          >
                            {toggleLoadingId === room.id ? (
                            <IconLoader className="w-4 h-4 animate-spin" />
                          ) : room.is_active ? (
                            <IconX className="w-4 h-4" />
                          ) : (
                            <IconCheck className="w-4 h-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={modalMode === 'add' ? 'Add New Room' : 'Edit Room'}
        size="md"
      >
        <div className="space-y-4">
          <Input
            label="Room Number"
            value={currentRoom.room_number || ''}
            onChange={(e) => setCurrentRoom(prev => ({ ...prev, room_number: e.target.value }))}
            placeholder="e.g. 101, 205B"
            autoFocus
            fullWidth
          />
          
          <Input
            label="Room Name"
            value={currentRoom.room_name || ''}
            onChange={(e) => setCurrentRoom(prev => ({ ...prev, room_name: e.target.value }))}
            placeholder="e.g. Deluxe Ocean View"
            fullWidth
          />

          <Input
            label="Room Type"
            value={currentRoom.room_type || ''}
            onChange={(e) => setCurrentRoom(prev => ({ ...prev, room_type: e.target.value }))}
            placeholder="e.g. Single, Double, Suite"
            fullWidth
          />
          
          <Input
            label="Price per Night (₦)"
            type="number"
            value={currentRoom.price_per_night || ''}
            onChange={(e) => setCurrentRoom(prev => ({ ...prev, price_per_night: parseFloat(e.target.value) }))}
            placeholder="0.00"
            min="0"
            step="0.01"
            fullWidth
          />

          <div className="flex justify-end gap-3 pt-4">
            <Button variant="ghost" onClick={() => setIsModalOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={submitting} isLoading={submitting}>
              {modalMode === 'add' ? 'Create Room' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
