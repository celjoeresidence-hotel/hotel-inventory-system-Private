import { useMemo } from 'react';
import type { BookingWithId } from '../hooks/useFrontDesk';
import type { RoomStatus } from '../types/frontDesk';
import { Card } from './ui/Card';
import { IconUserCheck, IconHome, IconCreditCard, IconAlertCircle } from './ui/Icons';

interface FrontDeskStatsProps {
  activeBookings: BookingWithId[];
  rooms: RoomStatus[];
  financialStats?: { totalPaymentsToday: number };
}

export default function FrontDeskStats({ activeBookings, rooms, financialStats }: FrontDeskStatsProps) {
  const today = new Date().toISOString().split('T')[0];

  const stats = useMemo(() => {
    const arrivals = activeBookings.filter(b => b.data.stay?.check_in === today).length;
    const departures = activeBookings.filter(b => b.data.stay?.check_out === today).length;
    
    const occupied = rooms.filter(r => r.status === 'occupied').length;
    const totalRooms = rooms.length;
    const occupancyRate = totalRooms > 0 ? Math.round((occupied / totalRooms) * 100) : 0;

    // Calculate Total Outstanding (Receivables)
    const totalOutstanding = activeBookings.reduce((sum, b) => {
        return sum + (b.data.payment?.balance || 0);
    }, 0);

    return { arrivals, departures, occupancyRate, totalOutstanding };
  }, [activeBookings, rooms, today]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
      <Card className="p-6 border-l-4 border-l-green-500">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm font-medium text-gray-500">Today's Check-ins</p>
            <h3 className="text-3xl font-bold text-gray-900 mt-2">{stats.arrivals}</h3>
          </div>
          <div className="p-3 bg-green-50 rounded-lg">
            <IconUserCheck className="w-6 h-6 text-green-600" />
          </div>
        </div>
      </Card>

      <Card className="p-6 border-l-4 border-l-blue-500">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm font-medium text-gray-500">Occupancy Rate</p>
            <h3 className="text-3xl font-bold text-gray-900 mt-2">{stats.occupancyRate}%</h3>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg">
            <IconHome className="w-6 h-6 text-blue-600" />
          </div>
        </div>
      </Card>

      <Card className="p-6 border-l-4 border-l-yellow-500">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm font-medium text-gray-500">Payments Today</p>
            <h3 className="text-3xl font-bold text-gray-900 mt-2">₦{(financialStats?.totalPaymentsToday || 0).toLocaleString()}</h3>
          </div>
          <div className="p-3 bg-yellow-50 rounded-lg">
            <IconCreditCard className="w-6 h-6 text-yellow-600" />
          </div>
        </div>
      </Card>

      <Card className="p-6 border-l-4 border-l-red-500">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm font-medium text-gray-500">Total Outstanding</p>
            <h3 className="text-3xl font-bold text-gray-900 mt-2">₦{stats.totalOutstanding.toLocaleString()}</h3>
          </div>
          <div className="p-3 bg-red-50 rounded-lg">
            <IconAlertCircle className="w-6 h-6 text-red-600" />
          </div>
        </div>
      </Card>
    </div>
  );
}
