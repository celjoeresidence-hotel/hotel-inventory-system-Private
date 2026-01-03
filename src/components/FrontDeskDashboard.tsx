import { useState } from 'react';
import FrontDeskForm from './FrontDeskForm';
import { useFrontDesk } from '../hooks/useFrontDesk';
import RoomStatusGrid from './RoomStatusGrid';
import ActiveGuestList from './ActiveGuestList';
import FrontDeskStats from './FrontDeskStats';
import FrontDeskHistory from './FrontDeskHistory';
import { Button } from './ui/Button';
import { IconLayout, IconUserCheck, IconUsers, IconHistory, IconCalendar, IconRefresh } from './ui/Icons';
import ReservationList from './ReservationList';

type Tab = 'dashboard' | 'checkin' | 'guests' | 'history' | 'reservations';

export default function FrontDeskDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const { rooms, activeBookings, pastBookings, loading, refresh } = useFrontDesk();

  const handleCheckInSuccess = () => {
    refresh();
    setActiveTab('dashboard');
  };

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Front Desk</h1>
          <p className="text-gray-500">Hotel Management System</p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={refresh} disabled={loading} className="gap-2">
            <IconRefresh className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Data
          </Button>
          <Button onClick={() => setActiveTab('checkin')} className="bg-green-600 hover:bg-green-700 text-white shadow-sm">
            <IconUserCheck className="w-4 h-4 mr-2" />
            New Check-In
          </Button>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="border-b border-gray-200 overflow-x-auto no-scrollbar">
        <nav className="flex space-x-8 min-w-max">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`pb-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'dashboard'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <IconLayout className="w-5 h-5" />
            Dashboard
          </button>
          <button
            onClick={() => setActiveTab('guests')}
            className={`pb-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'guests'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <IconUsers className="w-5 h-5" />
            Active Guests
            <span className="bg-gray-100 text-gray-600 py-0.5 px-2 rounded-full text-xs">
              {activeBookings.length}
            </span>
          </button>
          <button
            onClick={() => setActiveTab('reservations')}
            className={`pb-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'reservations'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <IconCalendar className="w-5 h-5" />
            Reservations
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`pb-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'history'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <IconHistory className="w-5 h-5" />
            History
          </button>
          <button
            onClick={() => setActiveTab('checkin')}
            className={`pb-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'checkin'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <IconUserCheck className="w-5 h-5" />
            Check In
          </button>
        </nav>
      </div>

      {/* Content Area */}
      <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
        {activeTab === 'dashboard' && (
          <div className="space-y-8">
            <FrontDeskStats activeBookings={activeBookings} rooms={rooms} />
            
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">Room Status</h2>
              </div>
              <RoomStatusGrid rooms={rooms} loading={loading} />
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-gray-900">Recent Active Guests</h2>
                <Button variant="ghost" onClick={() => setActiveTab('guests')} className="text-green-600 hover:text-green-700 hover:bg-green-50">
                  View All Guests
                </Button>
              </div>
              <ActiveGuestList bookings={activeBookings.slice(0, 5)} loading={loading} onRefresh={refresh} />
            </div>
          </div>
        )}

        {activeTab === 'guests' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-gray-900">Guest Management</h2>
            <ActiveGuestList bookings={activeBookings} loading={loading} onRefresh={refresh} />
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-gray-900">Check-Out History</h2>
            <FrontDeskHistory bookings={pastBookings} loading={loading} />
          </div>
        )}

        {activeTab === 'reservations' && (
          <div className="max-w-6xl mx-auto">
             <ReservationList />
          </div>
        )}

        {activeTab === 'checkin' && (
          <div className="max-w-4xl mx-auto">
            <FrontDeskForm onSuccess={handleCheckInSuccess} />
          </div>
        )}
      </div>
    </div>
  );
}
