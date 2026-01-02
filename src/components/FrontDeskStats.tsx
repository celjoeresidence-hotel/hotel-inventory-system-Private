import { useMemo } from 'react';
import type { BookingWithId } from '../hooks/useFrontDesk';
import type { RoomStatus } from '../types/frontDesk';
import { Card } from './ui/Card';
import { IconUserCheck, IconLogOut, IconHome, IconCreditCard } from './ui/Icons';

interface FrontDeskStatsProps {
  activeBookings: BookingWithId[];
  rooms: RoomStatus[];
}

export default function FrontDeskStats({ activeBookings, rooms }: FrontDeskStatsProps) {
  const today = new Date().toISOString().split('T')[0];

  const stats = useMemo(() => {
    const arrivals = activeBookings.filter(b => b.data.stay?.check_in === today).length;
    const departures = activeBookings.filter(b => b.data.stay?.check_out === today).length;
    
    const occupied = rooms.filter(r => r.status === 'occupied').length;
    const totalRooms = rooms.length;
    const occupancyRate = totalRooms > 0 ? Math.round((occupied / totalRooms) * 100) : 0;

    // Estimate daily revenue (sum of price_per_night for all occupied rooms)
    // This is "Potential Revenue Today"
    const dailyRevenue = activeBookings.reduce((sum, b) => sum + (b.data.pricing?.room_rate || 0), 0);

    return { arrivals, departures, occupancyRate, dailyRevenue };
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

      <Card className="p-6 border-l-4 border-l-red-500">
        <div className="flex justify-between items-start">
          <div>
            <p className="text-sm font-medium text-gray-500">Due for Checkout</p>
            <h3 className="text-3xl font-bold text-gray-900 mt-2">{stats.departures}</h3>
          </div>
          <div className="p-3 bg-red-50 rounded-lg">
            <IconLogOut className="w-6 h-6 text-red-600" />
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
            <p className="text-sm font-medium text-gray-500">Active Daily Revenue</p>
            <h3 className="text-3xl font-bold text-gray-900 mt-2">₦{stats.dailyRevenue.toLocaleString()}</h3>
          </div>
          <div className="p-3 bg-yellow-50 rounded-lg">
            <IconCreditCard className="w-6 h-6 text-yellow-600" />
          </div>
        </div>
      </Card>
    </div>
  );
}
