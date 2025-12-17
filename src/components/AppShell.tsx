import FrontDeskDashboard from './FrontDeskDashboard';
import { useAuth } from '../context/AuthContext';
import SupervisorInbox from './SupervisorInbox';
import FrontDeskForm from './FrontDeskForm';
import AdminRooms from './AdminRooms';
import ManagerDashboard from './ManagerDashboard';
import KitchenStockForm from './KitchenStockForm';
import BarStockForm from './BarStockForm';
import StorekeeperStockForm from './StorekeeperStockForm';

function Placeholder({ title }: { title: string }) {
  return (
    <div style={{ maxWidth: 700, margin: '40px auto', textAlign: 'center' }}>
      <h2>{title}</h2>
      <p style={{ color: '#666' }}>Coming Soon</p>
    </div>
  );
}

export default function AppShell() {
  const { role, logout, user } = useAuth();

  function renderByRole() {
    switch (role) {
      case 'front_desk':
        return <FrontDeskDashboard />;
      case 'supervisor':
        return <SupervisorInbox />;
      case 'manager':
        if (role === 'manager') {
          return <ManagerDashboard />;
        }
        return <Placeholder title="Manager Dashboard" />;
      case 'admin':
        return <AdminRooms />;
      case 'kitchen':
        return <KitchenStockForm />;
      case 'bar':
        return <BarStockForm />;
      case 'storekeeper':
        return <StorekeeperStockForm />;
      default:
        return (
          <div style={{ maxWidth: 700, margin: '40px auto', textAlign: 'center' }}>
            <h2>No role assigned</h2>
            <p>Please contact your administrator.</p>
          </div>
        );
    }
  }

  return (
    <div>
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px' }}>
        <h1>Hotel Front Desk</h1>
        <div>
          {user?.email && <span style={{ marginRight: 12 }}>Signed in as {user.email}</span>}
          <button onClick={logout}>Logout</button>
        </div>
      </header>
      <main style={{ padding: 16 }}>{renderByRole()}</main>
    </div>
  );
}