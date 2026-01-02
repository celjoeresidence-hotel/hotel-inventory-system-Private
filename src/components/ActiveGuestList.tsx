import { useState } from 'react';
import type { BookingWithId } from '../hooks/useFrontDesk';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { IconSearch, IconLogOut, IconEye } from './ui/Icons';
import CheckOutModal from './CheckOutModal';
import GuestDetailsModal from './GuestDetailsModal';

interface ActiveGuestListProps {
  bookings: BookingWithId[];
  loading: boolean;
  onRefresh: () => void;
  readOnly?: boolean;
}

export default function ActiveGuestList({ bookings, loading, onRefresh, readOnly }: ActiveGuestListProps) {
  const [search, setSearch] = useState('');
  const [selectedBooking, setSelectedBooking] = useState<BookingWithId | null>(null);
  const [detailsBooking, setDetailsBooking] = useState<BookingWithId | null>(null);

  const filtered = bookings.filter(b => {
    const term = search.toLowerCase();
    return (
      b.data.guest?.full_name.toLowerCase().includes(term) ||
      b.room_number?.toLowerCase().includes(term)
    );
  });

  if (loading) {
    return <div className="p-8 text-center text-gray-500">Loading active guests...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="relative w-full sm:w-72">
          <IconSearch className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
          <input
            type="text"
            placeholder="Search guest or room..."
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent outline-none transition-all"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="text-sm text-gray-500 font-medium">
          {filtered.length} Active Guest{filtered.length !== 1 ? 's' : ''}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-4 font-semibold text-gray-700">Guest</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Room</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Check-In</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Check-Out</th>
                <th className="px-6 py-4 font-semibold text-gray-700">Balance</th>
                <th className="px-6 py-4 font-semibold text-gray-700 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500">
                    No active guests found.
                  </td>
                </tr>
              ) : (
                filtered.map((booking) => {
                  const isOverdue = booking.data.stay?.check_out && new Date(booking.data.stay.check_out) < new Date(new Date().toDateString());
                  return (
                    <tr key={booking.id} className="hover:bg-gray-50/50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-700 font-bold text-xs">
                            {booking.data.guest?.full_name.charAt(0)}
                          </div>
                          <div>
                            <div className="font-medium text-gray-900">{booking.data.guest?.full_name}</div>
                            <div className="text-xs text-gray-500">{booking.data.guest?.phone}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <Badge variant="outline" className="font-mono">
                          {booking.room_number}
                        </Badge>
                      </td>
                      <td className="px-6 py-4 text-gray-600">
                        {booking.data.stay?.check_in}
                      </td>
                      <td className="px-6 py-4">
                        <div className={isOverdue ? 'text-red-600 font-medium flex items-center gap-1' : 'text-gray-600'}>
                          {booking.data.stay?.check_out}
                          {isOverdue && <span className="text-xs bg-red-100 px-1.5 py-0.5 rounded">Overdue</span>}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-medium">
                        {booking.data.payment?.balance && booking.data.payment.balance > 0 ? (
                          <span className="text-red-600">₦{booking.data.payment.balance.toLocaleString()}</span>
                        ) : (
                          <span className="text-green-600">Paid</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex justify-end gap-2">
                            <Button 
                                size="sm" 
                                variant="outline"
                                onClick={() => setDetailsBooking(booking)}
                                title="View Details"
                            >
                                <IconEye className="w-4 h-4"/>
                            </Button>
                            {!readOnly && (
                                <Button
                                size="sm"
                                onClick={() => setSelectedBooking(booking)}
                                className="gap-2"
                                >
                                <IconLogOut className="w-4 h-4" />
                                Check Out
                                </Button>
                            )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      <CheckOutModal
        isOpen={!!selectedBooking}
        onClose={() => setSelectedBooking(null)}
        booking={selectedBooking}
        onSuccess={() => {
          setSelectedBooking(null);
          onRefresh();
        }}
      />
      
      <GuestDetailsModal
        isOpen={!!detailsBooking}
        onClose={() => setDetailsBooking(null)}
        booking={detailsBooking}
        onUpdate={() => {
            onRefresh();
        }}
      />
    </div>
  );
}
