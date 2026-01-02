import { useState } from 'react';
import type { BookingWithId } from '../hooks/useFrontDesk';
import { Badge } from './ui/Badge';
import { IconSearch, IconCalendar } from './ui/Icons';

interface FrontDeskHistoryProps {
  bookings: BookingWithId[];
  loading: boolean;
}

export default function FrontDeskHistory({ bookings, loading }: FrontDeskHistoryProps) {
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  
  const filtered = bookings.filter(b => {
    const term = search.toLowerCase();
    const matchesSearch = (
      b.data.guest?.full_name.toLowerCase().includes(term) ||
      b.room_number?.toLowerCase().includes(term)
    );

    let matchesDate = true;
    if (startDate && endDate) {
        const checkOutDate = new Date(b.data.stay?.check_out || '');
        const start = new Date(startDate);
        const end = new Date(endDate);
        // Include end date in range
        end.setHours(23, 59, 59, 999);
        matchesDate = checkOutDate >= start && checkOutDate <= end;
    } else if (startDate) {
        const checkOutDate = new Date(b.data.stay?.check_out || '');
        const start = new Date(startDate);
        matchesDate = checkOutDate >= start;
    } else if (endDate) {
         const checkOutDate = new Date(b.data.stay?.check_out || '');
         const end = new Date(endDate);
         end.setHours(23, 59, 59, 999);
         matchesDate = checkOutDate <= end;
    }

    return matchesSearch && matchesDate;
  }).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  if (loading) return <div className="p-8 text-center text-gray-500">Loading history...</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="flex gap-2 items-center w-full sm:w-auto">
           <div className="relative flex-1 sm:w-64">
             <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
             <input
               type="text"
               placeholder="Search history..."
               className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none"
               value={search}
               onChange={(e) => setSearch(e.target.value)}
             />
           </div>
           
           <div className="flex items-center gap-2">
             <input
               type="date"
               className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none text-sm"
               value={startDate}
               onChange={(e) => setStartDate(e.target.value)}
               placeholder="Start Date"
             />
             <span className="text-gray-400">-</span>
             <input
               type="date"
               className="px-3 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 outline-none text-sm"
               value={endDate}
               onChange={(e) => setEndDate(e.target.value)}
               placeholder="End Date"
             />
           </div>
        </div>
        <div className="text-sm text-gray-500">
          {filtered.length} Past Record{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 font-semibold text-gray-700">Guest</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Room</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Stay Period</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Total Paid</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    No history found.
                  </td>
                </tr>
              ) : (
                filtered.map((booking) => (
                  <tr key={booking.id} className="hover:bg-gray-50/50">
                    <td className="px-6 py-4">
                      <div className="font-medium text-gray-900">{booking.data.guest?.full_name}</div>
                      <div className="text-xs text-gray-500">{booking.data.guest?.phone}</div>
                    </td>
                    <td className="px-6 py-4">
                      <Badge variant="outline">{booking.room_number}</Badge>
                    </td>
                    <td className="px-6 py-4 text-gray-600">
                      <div className="flex items-center gap-2">
                        <IconCalendar className="w-4 h-4 text-gray-400" />
                        <span>{booking.data.stay?.check_in} — {booking.data.stay?.check_out}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 font-medium text-gray-900">
                      ₦{booking.data.pricing?.total_room_cost.toLocaleString()}
                    </td>
                    <td className="px-6 py-4">
                      <Badge className="bg-gray-100 text-gray-600 border-gray-200">
                        Checked Out
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
