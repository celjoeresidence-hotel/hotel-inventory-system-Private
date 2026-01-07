import { useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { Button } from './ui/Button';
import { IconPlus, IconFilter, IconCalendar } from './ui/Icons';
import { useAuth } from '../context/AuthContext';

interface Housekeeper {
  id: string;
  name: string;
  active: boolean;
  notes?: string | null;
}

interface RoomOption {
  id: string;
  room_number: string;
  room_name?: string;
  room_type?: string;
}

interface HousekeepingReportRow {
  id: string;
  created_at: string;
  data: any;
  status: string;
}

const housekeepingStatuses = ['cleaned', 'dirty', 'maintenance', 'inspected'] as const;
type HKStatus = typeof housekeepingStatuses[number];

export default function HousekeepingTab({ onSubmitted }: { onSubmitted?: () => void }) {
  const [housekeepers, setHousekeepers] = useState<Housekeeper[]>([]);
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, ensureActiveSession } = useAuth();

  const [housekeeperId, setHousekeeperId] = useState('');
  const [housekeeperName, setHousekeeperName] = useState('');
  const [roomIds, setRoomIds] = useState<string[]>([]);
  const [status, setStatus] = useState<HKStatus>('inspected');
  const [roomCondition, setRoomCondition] = useState<'ok' | 'damaged' | 'needs_attention'>('ok');
  const [maintenanceRequired, setMaintenanceRequired] = useState<boolean>(false);
  const [notes, setNotes] = useState('');
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().split('T')[0]);

  const [recentReports, setRecentReports] = useState<HousekeepingReportRow[]>([]);
  const [filterDate, setFilterDate] = useState('');
  const [filterHK, setFilterHK] = useState('');
  const [filterRoom, setFilterRoom] = useState('');
  const [newHKName, setNewHKName] = useState('');
  const [addingHK, setAddingHK] = useState(false);
  const [useRecordsHK, setUseRecordsHK] = useState(false);

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) return;
    let mounted = true;
    async function load() {
      setLoading(true);
      try {
        const client = supabase!;
        let hk: any[] | null = null;
        let hkErr = null as any;
        try {
          const res = await client
            .from('housekeepers')
            .select('id, name, active, notes')
            .eq('active', true)
            .order('name');
          hk = res.data;
          hkErr = res.error;
        } catch (e: any) {
          hkErr = e;
        }
        if (hkErr) {
          // Fallback: use operational_records with type = 'housekeeper'
          const { data: hkRec, error: hkRecErr } = await client
            .from('operational_records')
            .select('id, data')
            .eq('entity_type', 'front_desk')
            .contains('data', { type: 'housekeeper' })
            .order('created_at', { ascending: true });
          if (hkRecErr) throw hkRecErr;
          hk = (hkRec || []).map((r: any) => ({
            id: String(r.id),
            name: String(r.data?.name || 'Unknown'),
            active: (r.data?.active ?? true) as boolean,
            notes: r.data?.notes ?? null
          }));
          setUseRecordsHK(true);
        } else {
          setUseRecordsHK(false);
        }

        const { data: rm, error: rmErr } = await client
          .from('rooms')
          .select('id, room_number, room_name, room_type')
          .eq('is_active', true)
          .order('room_number');
        if (rmErr) throw rmErr;

        const { data: recs, error: recErr } = await client
          .from('operational_records')
          .select('id, created_at, status, data')
          .eq('entity_type', 'front_desk')
          .contains('data', { type: 'housekeeping_report' })
          .order('created_at', { ascending: false })
          .limit(50);
        if (recErr) throw recErr;

        if (!mounted) return;
        setHousekeepers((hk || []) as any);
        setRooms((rm || []).map((r: any) => ({ id: String(r.id), room_number: r.room_number, room_name: r.room_name, room_type: r.room_type })));
        setRecentReports((recs || []) as any);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const hk = housekeepers.find(h => h.id === housekeeperId);
    setHousekeeperName(hk?.name || '');
  }, [housekeeperId, housekeepers]);

  const canSubmit = useMemo(() => {
    return housekeeperId && roomIds.length > 0 && status && reportDate;
  }, [housekeeperId, roomIds, status, reportDate]);

  async function submit() {
    if (!isSupabaseConfigured || !supabase) return;
    setError(null);
    setLoading(true);
    try {
      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) { setError('Session expired. Please sign in again to continue.'); return; }
      const client = supabase!;
      const payloads = roomIds.map((rid) => ({
        entity_type: 'front_desk',
        data: {
          type: 'housekeeping_report',
          room_id: rid,
          housekeeping_status: status,
          room_condition: roomCondition,
          maintenance_required: maintenanceRequired,
          notes: notes || null,
          housekeeper_id: housekeeperId,
          housekeeper_name: housekeeperName,
          report_date: reportDate
        },
        financial_amount: 0
      }));
      const { error: insErr } = await client.from('operational_records').insert(payloads);
      if (insErr) throw insErr;
      setRoomIds([]);
      setStatus('inspected');
      setRoomCondition('ok');
      setMaintenanceRequired(false);
      setNotes('');
      if (onSubmitted) onSubmitted();
      // reload recent
      const { data: recs, error: recErr } = await client
        .from('operational_records')
        .select('id, created_at, status, data')
        .eq('entity_type', 'front_desk')
        .contains('data', { type: 'housekeeping_report' })
        .order('created_at', { ascending: false })
        .limit(50);
      if (!recErr) setRecentReports((recs || []) as any);

      // Auto-process pending transfers when room is cleaned/inspected
      if (status === 'cleaned' || status === 'inspected') {
        for (const rid of roomIds) {
          // Find latest transfer where this room was previous_room_id
          const { data: transfers } = await client
            .from('operational_records')
            .select('id, data, created_at, submitted_by')
            .eq('entity_type', 'front_desk')
            .contains('data', { type: 'room_transfer' })
            .eq('data->transfer->previous_room_id', rid)
            .order('created_at', { ascending: false })
            .limit(1);
          
          const tr = transfers?.[0];
          if (!tr) continue;
          const tdata: any = tr.data || {};
          const bookingId = tdata.booking_id;
          const newRoomId = tdata.transfer?.new_room_id;
          const transferDate = String(tdata.transfer?.transfer_date || new Date().toISOString().split('T')[0]);

          // Avoid duplicate processing: check for a completion marker
          const { count: completionCount } = await client
            .from('operational_records')
            .select('*', { count: 'exact', head: true })
            .eq('entity_type', 'front_desk')
            .contains('data', { type: 'transfer_completion' })
            .eq('data->booking_id', bookingId);
          if ((completionCount || 0) > 0) continue;

          // Fetch original booking for guest and end date
          const { data: original } = await client
            .from('operational_records')
            .select('*')
            .eq('id', bookingId)
            .limit(1)
            .single();
          const odata: any = original?.data || {};
          const guest = odata.guest;
          const originalStay = odata.stay;
          const originalId = original?.original_id || odata.original_id || bookingId;
          if (!guest || !originalStay?.check_out || !newRoomId) continue;

          // Check if a new booking segment already exists for the new room
          const { count: existingNew } = await client
            .from('operational_records')
            .select('*', { count: 'exact', head: true })
            .eq('entity_type', 'front_desk')
            .contains('data', { type: 'room_booking' })
            .eq('original_id', originalId)
            .eq('data->stay->room_id', newRoomId)
            .eq('data->stay->check_in', transferDate);
          if ((existingNew || 0) > 0) {
            // Mark completion to avoid reprocessing
            await client.from('operational_records').insert({
              entity_type: 'front_desk',
              data: {
                type: 'transfer_completion',
                booking_id: bookingId,
                previous_room_id: rid,
                new_room_id: newRoomId,
                completed_date: reportDate
              },
              financial_amount: 0,
              submitted_by: user?.id
            });
            continue;
          }

          // Fetch room rate for new room
          const { data: roomData } = await client
            .from('rooms')
            .select('id, price_per_night')
            .eq('id', newRoomId)
            .limit(1)
            .single();
          const newRate = Number(roomData?.price_per_night || odata.pricing?.room_rate || 0);

          // Calculate nights between transferDate and original check_out
          const start = new Date(transferDate);
          const end = new Date(originalStay.check_out);
          const nights = Math.max(0, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
          const totalCost = newRate * nights;

          // Create new booking segment and mark as checked_in
          await client.from('operational_records').insert({
            entity_type: 'front_desk',
            data: {
              type: 'room_booking',
              booking_id: crypto.randomUUID(),
              original_id: originalId,
              guest,
              stay: {
                room_id: newRoomId,
                check_in: transferDate,
                check_out: originalStay.check_out,
                adults: originalStay.adults,
                children: originalStay.children
              },
              pricing: {
                room_rate: newRate,
                nights,
                total_room_cost: totalCost
              },
              payment: {
                paid_amount: 0,
                payment_method: 'transfer',
                balance: 0
              },
              status: 'checked_in'
            },
            financial_amount: 0,
            submitted_by: user?.id,
            status: 'approved'
          });

          // Insert completion marker for audit safety
          await client.from('operational_records').insert({
            entity_type: 'front_desk',
            data: {
              type: 'transfer_completion',
              booking_id: bookingId,
              previous_room_id: rid,
              new_room_id: newRoomId,
              completed_date: reportDate
            },
            financial_amount: 0,
            submitted_by: user?.id
          });
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function addHousekeeper() {
    if (!isSupabaseConfigured || !supabase) return;
    if (!newHKName.trim()) return;
    setAddingHK(true);
    setError(null);
    try {
      const client = supabase!;
      if (useRecordsHK) {
        const { error } = await client.from('operational_records').insert({
          entity_type: 'front_desk',
          data: {
            type: 'housekeeper',
            name: newHKName.trim(),
            active: true,
            notes: null
          },
          financial_amount: 0
        });
        if (error) throw error;
        const { data: hkRec } = await client
          .from('operational_records')
          .select('id, data')
          .eq('entity_type', 'front_desk')
          .contains('data', { type: 'housekeeper' })
          .order('created_at', { ascending: true });
        const mapped = (hkRec || []).map((r: any) => ({
          id: String(r.id),
          name: String(r.data?.name || 'Unknown'),
          active: (r.data?.active ?? true) as boolean,
          notes: r.data?.notes ?? null
        }));
        setHousekeepers(mapped);
      } else {
        const { error } = await client.from('housekeepers').insert({
          name: newHKName.trim(),
          active: true,
          notes: null,
          created_by: user?.id
        });
        if (error) throw error;
        const { data: hk } = await client
          .from('housekeepers')
          .select('id, name, active, notes')
          .eq('active', true)
          .order('name');
        setHousekeepers((hk || []) as any);
      }
      setNewHKName('');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAddingHK(false);
    }
  }

  const filteredReports = recentReports.filter((r) => {
    const d = r.data || {};
    const matchDate = filterDate ? String(d.report_date) === filterDate : true;
    const matchHK = filterHK ? String(d.housekeeper_id) === filterHK : true;
    const matchRoom = filterRoom ? String(d.room_id) === filterRoom : true;
    return matchDate && matchHK && matchRoom;
  });
 
  const roomsMap = useMemo(() => {
    const m: Record<string, string> = {};
    rooms.forEach(rr => {
      m[rr.id] = rr.room_type ? `${rr.room_number} (${rr.room_type})` : rr.room_number;
    });
    return m;
  }, [rooms]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Housekeeping Reports</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { /* no-op refresh; handled by parent */ }} disabled={loading}>
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Add Housekeeper</label>
              <input
                type="text"
                value={newHKName}
                onChange={(e) => setNewHKName(e.target.value)}
                placeholder="Full name"
                className="w-full border border-gray-300 rounded-lg p-2"
              />
            </div>
            <div className="flex items-end">
              <Button onClick={addHousekeeper} disabled={addingHK || !newHKName.trim()} className="bg-green-600 hover:bg-green-700 text-white">
                Add
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Housekeeper</label>
              <select className="w-full border border-gray-300 rounded-lg p-2"
                value={housekeeperId}
                onChange={(e) => setHousekeeperId(e.target.value)}
              >
                <option value="">Select housekeeper</option>
                {housekeepers.map(h => (
                  <option key={h.id} value={h.id}>{h.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Report Date</label>
              <div className="relative">
                <IconCalendar className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input type="date" className="w-full pl-9 border border-gray-300 rounded-lg p-2"
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rooms</label>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
              {rooms.map(r => {
                const checked = roomIds.includes(r.id);
                return (
                  <label key={r.id} className={`border rounded-lg p-2 cursor-pointer flex items-center gap-2 ${checked ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'}`}>
                    <input type="checkbox" checked={checked} onChange={(e) => {
                      if (e.target.checked) setRoomIds([...roomIds, r.id]);
                      else setRoomIds(roomIds.filter(id => id !== r.id));
                    }} />
                    <span className="text-sm font-medium text-gray-700">
                      {r.room_number}
                      {r.room_name ? ` • ${r.room_name}` : ''}
                      {r.room_type ? ` (${r.room_type})` : ''}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select className="w-full border border-gray-300 rounded-lg p-2"
                value={status}
                onChange={(e) => setStatus(e.target.value as HKStatus)}
              >
                {housekeepingStatuses.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Room Condition</label>
              <select className="w-full border border-gray-300 rounded-lg p-2"
                value={roomCondition}
                onChange={(e) => setRoomCondition(e.target.value as any)}
              >
                <option value="ok">ok</option>
                <option value="damaged">damaged</option>
                <option value="needs_attention">needs_attention</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input id="maintenance" type="checkbox" checked={maintenanceRequired} onChange={(e) => setMaintenanceRequired(e.target.checked)} />
              <label htmlFor="maintenance" className="text-sm font-medium text-gray-700">Maintenance Required</label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <textarea className="w-full border border-gray-300 rounded-lg p-2" rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={submit} disabled={!canSubmit || loading} className="bg-green-600 hover:bg-green-700 text-white gap-2">
              <IconPlus className="w-4 h-4" />
              Submit Report
            </Button>
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">Recent Submissions</h3>
            <IconFilter className="w-4 h-4 text-gray-400" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            <select className="border border-gray-300 rounded-lg p-2" value={filterHK} onChange={(e) => setFilterHK(e.target.value)}>
              <option value="">All Housekeepers</option>
              {housekeepers.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
            <select className="border border-gray-300 rounded-lg p-2" value={filterRoom} onChange={(e) => setFilterRoom(e.target.value)}>
              <option value="">All Rooms</option>
              {rooms.map(r => <option key={r.id} value={r.id}>{r.room_type ? `${r.room_number} (${r.room_type})` : r.room_number}</option>)}
              </select>
            <input type="date" className="border border-gray-300 rounded-lg p-2" value={filterDate} onChange={(e) => setFilterDate(e.target.value)} />
          </div>
          <div className="divide-y divide-gray-100 border border-gray-200 rounded-lg">
            {filteredReports.length === 0 ? (
              <div className="p-6 text-gray-500 text-sm">No recent reports.</div>
            ) : filteredReports.map((r) => {
              const d = r.data || {};
              return (
                <div key={r.id} className="p-4 flex items-start justify-between">
                  <div>
                    <div className="text-sm text-gray-900 font-medium">
                      Room {roomsMap[String(d.room_id)] || d.room_number || 'Unknown Room'} • {String(d.housekeeping_status)}
                    </div>
                    <div className="text-xs text-gray-600">
                      {d.housekeeper_name} • {d.report_date} • {d.room_condition}{d.maintenance_required ? ' • maintenance' : ''}
                    </div>
                    {d.notes && <div className="text-sm text-gray-700 mt-1">{d.notes}</div>}
                  </div>
                  <div className="text-xs uppercase px-2 py-1 rounded-full bg-gray-100 text-gray-700">{r.status}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
