import { useState } from 'react';
import type { RoomStatus } from '../types/frontDesk';
import { IconSearch } from './ui/Icons';

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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
        {filtered.map((room) => (
          <div 
            key={room.id}
            className={`
              relative p-4 rounded-xl border-2 transition-all hover:shadow-md cursor-default group
              ${room.status === 'available' ? 'border-green-100 bg-green-50/30' : ''}
              ${room.status === 'occupied' ? 'border-red-100 bg-red-50/30' : ''}
              ${room.status === 'reserved' ? 'border-orange-100 bg-orange-50/30' : ''}
              ${room.status === 'cleaning' ? 'border-blue-100 bg-blue-50/30' : ''}
              ${room.status === 'maintenance' ? 'border-purple-100 bg-purple-50/30' : ''}
              ${room.status === 'pending' ? 'border-gray-100 bg-gray-50/30' : ''}
            `}
          >
            <div className="flex justify-between items-start mb-2">
              <span className={`text-2xl font-bold ${
                room.status === 'available' ? 'text-green-700' : 
                room.status === 'occupied' ? 'text-red-700' : 
                room.status === 'reserved' ? 'text-orange-700' : 'text-gray-700'
              }`}>
                {room.room_number}
              </span>
              <div className={`w-3 h-3 rounded-full ${
                room.status === 'available' ? 'bg-green-500' : 
                room.status === 'occupied' ? 'bg-red-500' : 
                room.status === 'reserved' ? 'bg-orange-500' :
                room.status === 'cleaning' ? 'bg-blue-500' :
                room.status === 'maintenance' ? 'bg-purple-500' :
                room.status === 'pending' ? 'bg-gray-500' : 'bg-gray-400'
              }`} />
            </div>
            
            <div className="text-xs text-gray-500 font-medium uppercase tracking-wider mb-4">
              {room.status}
            </div>

            <div className="space-y-1">
              <div className="text-sm font-medium text-gray-900 truncate">
                {(room.status === 'occupied' || room.status === 'reserved') ? room.current_guest : room.room_type}
              </div>
              <div className="text-xs text-gray-500">
                {room.status === 'occupied' && room.check_out_date ? 
                  `Out: ${room.check_out_date}` : 
                 room.status === 'reserved' && room.check_out_date ?
                  `Until: ${room.check_out_date}` :
                  `₦${room.price_per_night.toLocaleString()}`
                }
              </div>
            </div>
            
            {/* Tooltip for Reserved/Occupied */}
            {(room.status === 'reserved' || room.status === 'occupied') && (
                <div className="absolute inset-0 bg-transparent" title={`${room.status === 'reserved' ? 'Reserved' : 'Occupied'} by ${room.current_guest}\nUntil: ${room.check_out_date}`}></div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
