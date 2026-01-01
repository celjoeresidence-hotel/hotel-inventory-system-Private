import { useState } from 'react';
import FrontDeskForm from './FrontDeskForm';
import RoomBookingForm from './RoomBookingForm';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { IconChevronLeft, IconUserCheck, IconCalendar } from './ui/Icons';

export default function FrontDeskDashboard() {
  const [view, setView] = useState<'menu' | 'checkin' | 'booking'>('menu');

  if (view === 'checkin') {
    return (
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setView('menu')} className="flex items-center gap-2 pl-0 hover:bg-transparent hover:text-green-700">
            <IconChevronLeft className="w-5 h-5" />
            <span className="text-lg font-medium">Back to Dashboard</span>
          </Button>
        </div>
        <Card className="p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 border-b border-gray-100 pb-4">Guest Check-In</h2>
          <FrontDeskForm />
        </Card>
      </div>
    );
  }

  if (view === 'booking') {
    return (
      <div className="max-w-4xl mx-auto p-4 space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" onClick={() => setView('menu')} className="flex items-center gap-2 pl-0 hover:bg-transparent hover:text-green-700">
            <IconChevronLeft className="w-5 h-5" />
            <span className="text-lg font-medium">Back to Dashboard</span>
          </Button>
        </div>
        <Card className="p-6">
          <h2 className="text-2xl font-bold text-gray-900 mb-6 border-b border-gray-100 pb-4">Room Booking</h2>
          <RoomBookingForm />
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto p-6 md:p-8 space-y-8">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Front Desk Dashboard</h1>
        <p className="text-gray-500">Manage guest check-ins and room bookings</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl mx-auto">
        <Card 
          className="p-8 flex flex-col items-center justify-center text-center hover:shadow-lg transition-all cursor-pointer group border-2 hover:border-green-500/20"
          onClick={() => setView('checkin')}
        >
          <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
            <IconUserCheck className="w-10 h-10 text-green-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-3">Guest Check-In</h3>
          <p className="text-gray-500 leading-relaxed">
            Process new guest arrivals, assign rooms, and handle initial payments.
          </p>
          <Button className="mt-8 w-full" onClick={(e) => { e.stopPropagation(); setView('checkin'); }}>
            Start Check-In
          </Button>
        </Card>

        <Card 
          className="p-8 flex flex-col items-center justify-center text-center hover:shadow-lg transition-all cursor-pointer group border-2 hover:border-green-500/20"
          onClick={() => setView('booking')}
        >
          <div className="w-20 h-20 bg-green-50 rounded-full flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
            <IconCalendar className="w-10 h-10 text-green-600" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-3">Room Booking</h3>
          <p className="text-gray-500 leading-relaxed">
            Create future room reservations and manage booking details.
          </p>
          <Button className="mt-8 w-full" onClick={(e) => { e.stopPropagation(); setView('booking'); }}>
            New Booking
          </Button>
        </Card>
      </div>
    </div>
  );
}