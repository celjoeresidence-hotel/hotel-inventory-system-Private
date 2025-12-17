import { useState } from 'react';
import FrontDeskForm from './FrontDeskForm';
import RoomBookingForm from './RoomBookingForm';

export default function FrontDeskDashboard() {
  const [view, setView] = useState<'menu' | 'checkin' | 'booking'>('menu');

  if (view === 'checkin') {
    return (
      <div style={{ padding: 16 }}>
        <button onClick={() => setView('menu')} style={{ marginBottom: 16 }}>← Back</button>
        <h2 style={{ marginTop: 0 }}>Guest Check-In</h2>
        <FrontDeskForm />
      </div>
    );
  }

  if (view === 'booking') {
    return (
      <div style={{ padding: 16 }}>
        <button onClick={() => setView('menu')} style={{ marginBottom: 16 }}>← Back</button>
        <h2 style={{ marginTop: 0 }}>Room Booking</h2>
        <RoomBookingForm />
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 900, margin: '40px auto' }}>
      <h2 style={{ textAlign: 'center', marginBottom: 24 }}>Front Desk Dashboard</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <button
          onClick={() => setView('checkin')}
          style={{
            padding: '40px 24px',
            fontSize: 20,
            borderRadius: 12,
            border: '1px solid #ddd',
            cursor: 'pointer',
          }}
        >
          Guest Check-In
        </button>
        <button
          onClick={() => setView('booking')}
          style={{
            padding: '40px 24px',
            fontSize: 20,
            borderRadius: 12,
            border: '1px solid #ddd',
            cursor: 'pointer',
          }}
        >
          Room Booking
        </button>
      </div>
    </div>
  );
}