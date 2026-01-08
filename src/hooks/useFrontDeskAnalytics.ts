import { useMemo } from 'react';
import type { BookingWithId } from './useFrontDesk';

export interface DailyRevenue {
  date: string;
  revenue: number;
  count: number;
}

export interface MonthlyRevenue {
  month: string; // YYYY-MM
  revenue: number;
}

export interface FrontDeskAnalytics {
  dailyRevenue: DailyRevenue[];
  monthlyRevenue: MonthlyRevenue[];
  totalRevenue: number;
  averageStayDuration: number;
  occupancyRate: number; // Current approximate
  totalCheckouts: number;
}

export function useFrontDeskAnalytics(
  checkoutRecords: BookingWithId[],
  pastBookings: BookingWithId[]
): FrontDeskAnalytics {
  return useMemo(() => {
    const dailyMap = new Map<string, { revenue: number; count: number }>();
    const monthlyMap = new Map<string, number>();
    let totalRevenue = 0;
    let totalStayDuration = 0;
    let validDurationCount = 0;

    // Process checkout records for revenue
    checkoutRecords.forEach((rec) => {
      const checkoutData = rec.data.checkout;
      if (checkoutData) {
        const date = checkoutData.checkout_date; // YYYY-MM-DD
        const amount = checkoutData.final_payment || 0;
        
        // Daily
        const currentDaily = dailyMap.get(date) || { revenue: 0, count: 0 };
        dailyMap.set(date, {
          revenue: currentDaily.revenue + amount,
          count: currentDaily.count + 1
        });

        // Monthly
        const month = date.substring(0, 7); // YYYY-MM
        const currentMonthly = monthlyMap.get(month) || 0;
        monthlyMap.set(month, currentMonthly + amount);

        totalRevenue += amount;
      }
    });

    // Process past bookings for duration stats
    pastBookings.forEach((b) => {
      if (b.data.stay) {
        const start = new Date(b.data.stay.check_in);
        const end = new Date(b.data.stay.check_out);
        const duration = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
        if (duration > 0) {
          totalStayDuration += duration;
          validDurationCount++;
        }
      }
    });

    const averageStayDuration = validDurationCount > 0 ? totalStayDuration / validDurationCount : 0;

    // Sort daily revenue
    const dailyRevenue: DailyRevenue[] = Array.from(dailyMap.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Sort monthly revenue
    const monthlyRevenue: MonthlyRevenue[] = Array.from(monthlyMap.entries())
      .map(([month, revenue]) => ({ month, revenue }))
      .sort((a, b) => a.month.localeCompare(b.month));

    // Simple occupancy approximation (Active bookings / Total Rooms)
    // Note: This is "Current Occupancy". For historical occupancy, we'd need more complex logic.
    // We assume the caller passes the *current* total rooms count.
    // But wait, this hook only receives past/checkout data? 
    // Ideally it should also receive active count for current occupancy.
    // Let's assume we can calculate it or it's passed. 
    // Actually, let's just return 0 here and let the component calculate current occupancy from activeBookings.length
    // OR we can pass activeBookings count.
    // For now, let's stick to financial analytics from checkouts.
    
    return {
      dailyRevenue,
      monthlyRevenue,
      totalRevenue,
      averageStayDuration,
      occupancyRate: 0, // Placeholder, calculate in component
      totalCheckouts: checkoutRecords.length
    };
  }, [checkoutRecords, pastBookings]);
}
