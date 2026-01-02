import { useFrontDeskAnalytics } from '../hooks/useFrontDeskAnalytics';
import type { BookingWithId } from '../hooks/useFrontDesk';
import { Card } from './ui/Card';
import { IconTrendingUp, IconTrendingDown, IconDollarSign, IconClock } from './ui/Icons';

interface FrontDeskAnalyticsViewProps {
  checkoutRecords: BookingWithId[];
  pastBookings: BookingWithId[];
  totalRooms: number;
}

export default function FrontDeskAnalyticsView({ checkoutRecords, pastBookings, totalRooms }: FrontDeskAnalyticsViewProps) {
  const {
    dailyRevenue,
    monthlyRevenue,
    totalRevenue,
    averageStayDuration,
    totalCheckouts
  } = useFrontDeskAnalytics(checkoutRecords, pastBookings, totalRooms);

  // Helper to format currency
  const formatMoney = (amount: number) => `₦${amount.toLocaleString()}`;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-100 text-green-600 rounded-full">
              <IconDollarSign className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Total Revenue</p>
              <h3 className="text-2xl font-bold text-gray-900">{formatMoney(totalRevenue)}</h3>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-100 text-blue-600 rounded-full">
              <IconTrendingUp className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Total Checkouts</p>
              <h3 className="text-2xl font-bold text-gray-900">{totalCheckouts}</h3>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-purple-100 text-purple-600 rounded-full">
              <IconClock className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Avg. Stay Duration</p>
              <h3 className="text-2xl font-bold text-gray-900">{averageStayDuration.toFixed(1)} Days</h3>
            </div>
          </div>
        </Card>

        {/* Placeholder for Occupancy or other metric */}
        <Card className="p-6">
          <div className="flex items-center gap-4">
             <div className="p-3 bg-orange-100 text-orange-600 rounded-full">
              <IconTrendingDown className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-gray-500">Avg. Revenue/Stay</p>
              <h3 className="text-2xl font-bold text-gray-900">
                {totalCheckouts > 0 ? formatMoney(totalRevenue / totalCheckouts) : '₦0'}
              </h3>
            </div>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Daily Revenue (Last 7 Days)</h3>
          <div className="overflow-x-auto">
             <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-2 font-medium text-gray-700">Date</th>
                    <th className="px-4 py-2 font-medium text-gray-700">Checkouts</th>
                    <th className="px-4 py-2 font-medium text-gray-700 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {dailyRevenue.slice(-7).map((d) => (
                    <tr key={d.date}>
                      <td className="px-4 py-2 text-gray-600">{d.date}</td>
                      <td className="px-4 py-2 text-gray-600">{d.count}</td>
                      <td className="px-4 py-2 font-medium text-gray-900 text-right">{formatMoney(d.revenue)}</td>
                    </tr>
                  ))}
                  {dailyRevenue.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-gray-500">No data available</td>
                    </tr>
                  )}
                </tbody>
             </table>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Monthly Revenue</h3>
           <div className="overflow-x-auto">
             <table className="w-full text-left text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="px-4 py-2 font-medium text-gray-700">Month</th>
                    <th className="px-4 py-2 font-medium text-gray-700 text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {monthlyRevenue.map((m) => (
                    <tr key={m.month}>
                      <td className="px-4 py-2 text-gray-600">{m.month}</td>
                      <td className="px-4 py-2 font-medium text-gray-900 text-right">{formatMoney(m.revenue)}</td>
                    </tr>
                  ))}
                   {monthlyRevenue.length === 0 && (
                    <tr>
                      <td colSpan={2} className="px-4 py-8 text-center text-gray-500">No data available</td>
                    </tr>
                  )}
                </tbody>
             </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
