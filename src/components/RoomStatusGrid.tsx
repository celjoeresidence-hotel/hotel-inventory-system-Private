import { useState } from 'react';
import type { RoomStatus } from '../types/frontDesk';
import { IconSearch, IconBroom, IconCalendar, IconUser, IconAlertCircle } from './ui/Icons';

interface RoomStatusGridProps {
  rooms: RoomStatus[];
  loading: boolean;
}

export default function RoomStatusGrid({ rooms, loading }: RoomStatusGridProps) {
  const [filterStatus, setFilterStatus] = useState<'all' | 'available' | 'occupied' | 'reserved' | 'cleaning' | 'maintenance' | 'pending'>('all');
  const [search, setSearch] = useState('');

  const filtered = rooms.filter(r => {
    const matchesSearch = r.room_number.toLowerCase().includes(search.toLowerCase()) || 
                          r.room_type?.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = filterStatus === 'all' || r.status === filterStatus;
    return matchesSearch && matchesStatus;
  });

  const stats = {
    total: rooms.length,
    available: rooms.filter(r => r.status === 'available').length,
    occupied: rooms.filter(r => r.status === 'occupied').length,
    reserved: rooms.filter(r => r.status === 'reserved').length,
    cleaning: rooms.filter(r => r.status === 'cleaning').length,
    maintenance: rooms.filter(r => r.status === 'maintenance').length,
    pending: rooms.filter(r => r.status === 'pending').length,
  };

  const getStatusBadgeStyles = (status: string) => {
    switch (status) {
      case 'available': return 'bg-green-100 text-green-700 border-green-200';
      case 'occupied': return 'bg-red-100 text-red-700 border-red-200';
      case 'reserved': return 'bg-orange-100 text-orange-700 border-orange-200';
      case 'cleaning': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'maintenance': return 'bg-purple-100 text-purple-700 border-purple-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  const getHKStatusStyles = (status: string) => {
    switch (status) {
      case 'inspected': return 'text-green-700 bg-green-100 border-green-200 ring-1 ring-green-200';
      case 'clean': return 'text-blue-600 bg-blue-50 border-blue-100';
      case 'dirty': return 'text-red-600 bg-red-50 border-red-100';
      case 'not_reported': return 'text-gray-500 bg-gray-50 border-gray-100';
      default: return 'text-gray-400';
    }
  };

  const formatHKStatus = (status: string) => {
    switch (status) {
      case 'clean': return 'Clean';
      case 'dirty': return 'Dirty';
      case 'not_reported': return 'Not Reported';
      default: return status;
    }
  };

  if (loading) return <div className="p-8 text-center text-gray-500">Loading rooms...</div>;

  return (
    <div className="space-y-6">
      {/* Filters and Stats */}
      <div className="flex flex-col md:flex-row gap-4 justify-between items-start md:items-center">
        <div className="flex gap-2 overflow-x-auto pb-2 md:pb-0 no-scrollbar">
          <button
            onClick={() => setFilterStatus('all')}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterStatus === 'all' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            All Rooms ({stats.total})
          </button>
          <button
            onClick={() => setFilterStatus('available')}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterStatus === 'available' ? 'bg-green-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Available ({stats.available})
          </button>
          <button
            onClick={() => setFilterStatus('occupied')}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterStatus === 'occupied' ? 'bg-red-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Occupied ({stats.occupied})
          </button>
          <button
            onClick={() => setFilterStatus('reserved')}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterStatus === 'reserved' ? 'bg-orange-500 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Reserved ({stats.reserved})
          </button>
          <button
            onClick={() => setFilterStatus('cleaning')}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterStatus === 'cleaning' ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Cleaning ({stats.cleaning})
          </button>
          <button
            onClick={() => setFilterStatus('maintenance')}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterStatus === 'maintenance' ? 'bg-purple-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Maintenance ({stats.maintenance})
          </button>
          <button
            onClick={() => setFilterStatus('pending')}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${filterStatus === 'pending' ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}
          >
            Pending ({stats.pending})
          </button>
        </div>

        <div className="relative w-full md:w-64">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
             type="text"
            placeholder="Find room..."
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((room) => (
          <div 
            key={room.id}
            className={`
              relative p-4 rounded-xl border-2 transition-all hover:shadow-md cursor-default flex flex-col justify-between h-full bg-white
              ${room.status === 'available' ? 'border-green-100' : ''}
              ${room.status === 'occupied' ? 'border-red-100' : ''}
              ${room.status === 'reserved' ? 'border-orange-100' : ''}
              ${room.status === 'cleaning' ? 'border-blue-100' : ''}
              ${room.status === 'maintenance' ? 'border-purple-100' : ''}
              ${room.status === 'pending' ? 'border-gray-100' : ''}
            `}
          >
            {/* Header: Number & Status */}
            <div className="flex justify-between items-start mb-2">
              <div>
                <span className="text-2xl font-bold text-gray-900">
                  {room.room_number}
                </span>
                <div className="text-xs text-gray-500 font-medium">{room.room_name}</div>
              </div>
              <div className={`px-2 py-1 rounded text-xs font-bold uppercase tracking-wider border ${getStatusBadgeStyles(room.status)}`}>
                {room.status === 'maintenance' ? 'Out of Service' : room.status}
              </div>
            </div>

            {/* Body: Details */}
            <div className="space-y-3 mt-2 flex-grow">
              {/* Type */}
              <div className="text-sm text-gray-600 flex items-center gap-2">
                 <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded text-xs">{room.room_type}</span>
              </div>

              {/* Occupied Details */}
              {room.status === 'occupied' && (
                <div className="bg-red-50 p-2 rounded text-sm text-red-900 space-y-1">
                  <div className="flex items-center gap-2 font-medium">
                    <IconUser className="w-3 h-3" />
                    {room.current_guest}
                  </div>
                  {room.check_out_date && (
                    <div className={`text-xs pl-5 ${new Date().toISOString().split('T')[0] === room.check_out_date ? 'text-red-700 font-bold uppercase' : 'text-red-700'}`}>
                      {new Date().toISOString().split('T')[0] === room.check_out_date ? 'DUE OUT TODAY' : `Check-out: ${room.check_out_date}`}
                    </div>
                  )}
                </div>
              )}

              {/* Reserved Details */}
              {room.status === 'reserved' && (
                <div className="bg-orange-50 p-2 rounded text-sm text-orange-900 space-y-1">
                  <div className="flex items-center gap-2 font-medium">
                     <IconCalendar className="w-3 h-3" />
                     {room.current_guest}
                  </div>
                   {room.check_out_date && (
                    <div className="text-xs text-orange-700 pl-5">
                      Reserved until: {room.check_out_date}
                    </div>
                  )}
                </div>
              )}

              {/* Upcoming Reservation (if not already reserved status, or in addition) */}
              {room.upcoming_reservation && room.status !== 'reserved' && (
                <div className={`p-2 rounded text-sm space-y-1 ${
                  room.upcoming_reservation.check_in.split('T')[0] === new Date().toISOString().split('T')[0]
                  ? 'bg-blue-100 text-blue-900 border border-blue-200'
                  : 'bg-blue-50 text-blue-900'
                }`}>
                  <div className="flex items-center gap-2 font-medium">
                    <IconCalendar className="w-3 h-3" />
                    {room.upcoming_reservation.check_in.split('T')[0] === new Date().toISOString().split('T')[0] ? 'ARRIVING TODAY' : 'Upcoming:'} {room.upcoming_reservation.guest_name}
                  </div>
                  <div className={`text-xs pl-5 ${
                    room.upcoming_reservation.check_in.split('T')[0] === new Date().toISOString().split('T')[0]
                    ? 'font-bold text-blue-800'
                    : 'text-blue-700'
                  }`}>
                    Check-in: {room.upcoming_reservation.check_in.split('T')[0] === new Date().toISOString().split('T')[0] ? 'Today' : room.upcoming_reservation.check_in}
                  </div>
                </div>
              )}

              {/* Interrupted / Pending Resumption Indicators */}
              {(room.interrupted || room.pending_resumption) && (
                <div className="flex gap-2 mt-1">
                  {room.interrupted && (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded bg-yellow-50 text-yellow-700 border border-yellow-200">
                      Interrupted
                    </span>
                  )}
                  {room.pending_resumption && (
                    <span className="inline-block text-[10px] px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                      Pending Resumption
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Footer: Housekeeping */}
            <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-gray-500">
                <IconBroom className="w-3 h-3" />
                <span>Housekeeping:</span>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded border ${getHKStatusStyles(room.housekeeping_status)}`}>
                {formatHKStatus(room.housekeeping_status)}
              </span>
            </div>
            
            {/* Blocking Warning (Visual only here, logic in ActiveGuestList) */}
            {room.status === 'occupied' && room.housekeeping_status !== 'inspected' && (
               <div className="mt-2 text-[10px] text-red-500 flex items-center gap-1 justify-end font-medium">
                  <IconAlertCircle className="w-3 h-3" />
                  Checkout Blocked (Needs Inspection)
               </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
