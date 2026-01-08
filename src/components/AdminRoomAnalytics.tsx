import { useState, useEffect } from 'react';
import { supabase } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { toast } from 'sonner';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { IconBarChart, IconSearch } from './ui/Icons';
import { format, startOfMonth } from 'date-fns';

interface RoomAnalytics {
  room_id: string;
  room_number: string;
  room_type: string;
  booking_count: number;
  total_revenue: number;
  nights_sold: number;
  occupancy_rate: number;
}

export default function AdminRoomAnalytics() {
  const { ensureActiveSession } = useAuth();
  const [analytics, setAnalytics] = useState<RoomAnalytics[]>([]);
  const [loading, setLoading] = useState(false);
  const [startDate, setStartDate] = useState(
    format(startOfMonth(new Date()), 'yyyy-MM-dd')
  );
  const [endDate, setEndDate] = useState(
    format(new Date(), 'yyyy-MM-dd')
  );

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      if (!supabase) throw new Error('Supabase client not initialized');

      const ok = await (ensureActiveSession?.() ?? Promise.resolve(true));
      if (!ok) {
        toast.error('Session expired. Please sign in again.');
        setLoading(false);
        return;
      }

      // Fetch Rooms
      const { data: roomsData, error: roomsError } = await supabase
        .from('rooms')
        .select('id, room_number, room_type')
        .eq('is_active', true);

      if (roomsError) throw roomsError;

      // Fetch Bookings (manually aggregated to avoid RPC enum issues)
      const { data: bookingsData, error: bookingsError } = await supabase
        .from('operational_records')
        .select('data')
        .eq('entity_type', 'front_desk')
        .eq('status', 'approved')
        .is('deleted_at', null)
        .filter('data->stay->>check_in', 'gte', startDate)
        .filter('data->stay->>check_in', 'lte', endDate);

      if (bookingsError) throw bookingsError;

      // Calculate days in period
      const start = new Date(startDate);
      const end = new Date(endDate);
      const daysInPeriod = Math.max(1, Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1);

      // Initialize stats map
      const statsMap = new Map<string, RoomAnalytics>();
      (roomsData || []).forEach((r: any) => {
        statsMap.set(r.id, {
          room_id: r.id,
          room_number: r.room_number,
          room_type: r.room_type,
          booking_count: 0,
          total_revenue: 0,
          nights_sold: 0,
          occupancy_rate: 0
        });
      });

      // Aggregate bookings
      (bookingsData || []).forEach((b: any) => {
        const stay = b.data?.stay;
        const pricing = b.data?.pricing;
        if (stay?.room_id && statsMap.has(stay.room_id)) {
          const stats = statsMap.get(stay.room_id)!;
          
          // Increment booking count
          stats.booking_count++;
          
          // Add revenue
          stats.total_revenue += Number(pricing?.total_room_cost || 0);
          
          // Calculate nights
          const checkIn = new Date(stay.check_in);
          const checkOut = new Date(stay.check_out);
          const nights = Math.max(1, Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24)));
          stats.nights_sold += nights;
        }
      });

      // Finalize calculations (Occupancy Rate) and sort
      const results = Array.from(statsMap.values()).map(stats => ({
        ...stats,
        occupancy_rate: Number(((stats.nights_sold / daysInPeriod) * 100).toFixed(2))
      })).sort((a, b) => b.total_revenue - a.total_revenue);

      setAnalytics(results);
    } catch (error: any) {
      console.error('Error fetching analytics:', error);
      toast.error(error.message || 'Failed to fetch analytics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []); // Fetch on mount

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Room Analytics</h1>
        <div className="flex flex-wrap items-center gap-3 bg-white p-2 rounded-lg border border-gray-200 shadow-sm">
           <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 font-medium">From:</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-green-500 outline-none"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500 font-medium">To:</span>
             <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1 text-sm focus:ring-2 focus:ring-green-500 outline-none"
            />
          </div>
          <Button size="sm" onClick={fetchAnalytics} disabled={loading}>
            <IconSearch className="w-4 h-4 mr-2" />
            Filter
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-6">
                <div className="text-2xl font-bold text-green-600">
                    {analytics.reduce((acc, curr) => acc + (Number(curr.total_revenue) || 0), 0).toLocaleString()}
                </div>
                <div className="text-sm text-gray-500 font-medium">Total Revenue</div>
          </Card>
          <Card className="p-6">
                <div className="text-2xl font-bold text-blue-600">
                    {analytics.reduce((acc, curr) => acc + (Number(curr.nights_sold) || 0), 0)}
                </div>
                 <div className="text-sm text-gray-500 font-medium">Total Nights Sold</div>
          </Card>
           <Card className="p-6">
                <div className="text-2xl font-bold text-purple-600">
                     {analytics.length > 0 
                        ? (analytics.reduce((acc, curr) => acc + (Number(curr.occupancy_rate) || 0), 0) / analytics.length).toFixed(1)
                        : 0
                     }%
                </div>
                 <div className="text-sm text-gray-500 font-medium">Avg Occupancy Rate</div>
          </Card>
      </div>

      <Card className="overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h3 className="flex items-center gap-2 font-bold text-gray-900">
            <IconBarChart className="w-5 h-5 text-gray-500" />
            Performance by Room
          </h3>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-50 text-gray-600 font-medium border-b border-gray-200">
                <tr>
                  <th className="py-3 px-4">Room</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4 text-right">Bookings</th>
                  <th className="py-3 px-4 text-right">Nights Sold</th>
                  <th className="py-3 px-4 text-right">Occupancy</th>
                  <th className="py-3 px-4 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loading ? (
                   <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-500">Loading analytics...</td>
                   </tr>
                ) : analytics.length === 0 ? (
                   <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-500">No data found for this period</td>
                   </tr>
                ) : (
                  analytics.map((room) => (
                    <tr key={room.room_id} className="hover:bg-gray-50 transition-colors">
                      <td className="py-3 px-4 font-medium text-gray-900">{room.room_number}</td>
                      <td className="py-3 px-4 text-gray-600 capitalize">{room.room_type}</td>
                      <td className="py-3 px-4 text-right text-gray-600">{room.booking_count}</td>
                      <td className="py-3 px-4 text-right text-gray-600">{room.nights_sold}</td>
                      <td className="py-3 px-4 text-right">
                         <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium
                            ${Number(room.occupancy_rate) >= 70 ? 'bg-green-100 text-green-800' : 
                              Number(room.occupancy_rate) >= 40 ? 'bg-yellow-100 text-yellow-800' : 
                              'bg-red-100 text-red-800'}`}>
                           {Number(room.occupancy_rate).toFixed(1)}%
                         </span>
                      </td>
                      <td className="py-3 px-4 text-right font-medium text-gray-900">
                        ₦{Number(room.total_revenue).toLocaleString()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
      </Card>
    </div>
  );
}
