import { useState } from 'react';
import { useFrontDesk } from '../hooks/useFrontDesk';
import RoomStatusGrid from './RoomStatusGrid';
import ActiveGuestList from './ActiveGuestList';
import FrontDeskStats from './FrontDeskStats';
import FrontDeskHistory from './FrontDeskHistory';
import FrontDeskAnalyticsView from './FrontDeskAnalyticsView';
import AuditLog from './AuditLog';
import HousekeepingTab from './HousekeepingTab.tsx';
import { Button } from './ui/Button';
import { 
  IconLayout, 
  IconUsers, 
  IconHistory, 
  IconRefresh, 
  IconBarChart,
  IconShield,
  IconBroom
} from './ui/Icons';

type FrontDeskOversightRole = 'supervisor' | 'manager' | 'admin';
type Tab = 'dashboard' | 'guests' | 'history' | 'analytics' | 'audit' | 'housekeeping';

interface FrontDeskOversightProps {
  role: FrontDeskOversightRole;
}

export default function FrontDeskOversight({ role }: FrontDeskOversightProps) {
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const { rooms, activeBookings, pastBookings, checkoutRecords, loading, refresh } = useFrontDesk();

  const canViewAnalytics = role === 'manager' || role === 'admin';
  const canViewAudit = role === 'admin';

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Front Desk Oversight</h1>
          <p className="text-gray-500">
            {role === 'supervisor' && 'Supervisor View (Read-Only)'}
            {role === 'manager' && 'Manager View (Analytics & Oversight)'}
            {role === 'admin' && 'Admin View (Full Oversight & Audit)'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={refresh} disabled={loading} className="gap-2">
            <IconRefresh className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Data
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
          
          {canViewAnalytics && (
            <button
              onClick={() => setActiveTab('analytics')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                activeTab === 'analytics'
                  ? 'border-green-600 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <IconBarChart className="w-5 h-5" />
              Analytics
            </button>
          )}

          {canViewAudit && (
             <button
              onClick={() => setActiveTab('audit')}
              className={`pb-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
                activeTab === 'audit'
                  ? 'border-green-600 text-green-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <IconShield className="w-5 h-5" />
              Audit Log
            </button>
          )}
          <button
            onClick={() => setActiveTab('housekeeping')}
            className={`pb-4 px-1 border-b-2 font-medium text-sm flex items-center gap-2 transition-colors ${
              activeTab === 'housekeeping'
                ? 'border-green-600 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <IconBroom className="w-5 h-5" />
            Housekeeping
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
              <ActiveGuestList bookings={activeBookings.slice(0, 5)} loading={loading} onRefresh={refresh} readOnly={true} />
            </div>
          </div>
        )}

        {activeTab === 'guests' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-gray-900">Guest Management (Read-Only)</h2>
            <ActiveGuestList bookings={activeBookings} loading={loading} onRefresh={refresh} readOnly={true} />
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-gray-900">Check-Out History</h2>
            <FrontDeskHistory bookings={pastBookings} loading={loading} />
          </div>
        )}

        {activeTab === 'analytics' && canViewAnalytics && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-gray-900">Financial & Performance Analytics</h2>
            <FrontDeskAnalyticsView 
              checkoutRecords={checkoutRecords} 
              pastBookings={pastBookings}
              totalRooms={rooms.length}
            />
          </div>
        )}

        {activeTab === 'audit' && canViewAudit && (
           <div className="space-y-6">
             <AuditLog />
           </div>
        )}
        {activeTab === 'housekeeping' && (
          <div className="space-y-6">
            <HousekeepingTab onSubmitted={refresh} />
          </div>
        )}
      </div>
    </div>
  );
}
