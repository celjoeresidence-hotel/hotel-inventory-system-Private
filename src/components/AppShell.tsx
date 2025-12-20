import { useMemo, useState } from 'react';
import FrontDeskDashboard from './FrontDeskDashboard';
import { useAuth } from '../context/AuthContext';
import SupervisorInbox from './SupervisorInbox';
import AdminRooms from './AdminRooms';
import ManagerDashboard from './ManagerDashboard';
import KitchenStockForm from './KitchenStockForm';
import BarStockForm from './BarStockForm';
import StorekeeperStockForm from './StorekeeperStockForm';
import AdminStaffManagement from './AdminStaffManagement';
import InventorySetup from './InventorySetup';
import InventoryCatalog from './InventoryCatalog';
import AuditLog from './AuditLog';

export default function AppShell() {
  const { role, logout, user, isAdmin, isManager, isSupervisor } = useAuth();

  // Build menu items based on role
  const menu = useMemo(() => {
    if (isAdmin) {
      return [
        { key: 'rooms', label: 'Rooms' },
        { key: 'staff', label: 'Staff Management' },
        { key: 'inventory_catalog', label: 'Inventory Catalog' },
        { key: 'inventory_setup', label: 'Inventory Setup' },
        { key: 'audit_log', label: 'Audit Log' },
      ] as const;
    }
    if (isManager) {
      return [
        { key: 'manager', label: 'Manager Dashboard' },
        { key: 'staff', label: 'Staff Management' },
        { key: 'inventory_catalog', label: 'Inventory Catalog' },
        { key: 'inventory_setup', label: 'Inventory Setup' },
        { key: 'audit_log', label: 'Audit Log' },
      ] as const;
    }
    if (isSupervisor) {
      return [
        { key: 'pending_approvals', label: 'Pending Approvals' },
        { key: 'staff', label: 'Staff Management' },
        { key: 'inventory_setup', label: 'Inventory Setup' },
        { key: 'inventory_catalog', label: 'Inventory Catalog' },
      ] as const;
    }
    switch (role) {
      case 'front_desk':
        return [{ key: 'front_desk', label: 'Front Desk' }] as const;
      case 'kitchen':
        return [{ key: 'kitchen', label: 'Kitchen Stock' }] as const;
      case 'bar':
        return [{ key: 'bar', label: 'Bar Stock' }] as const;
      case 'storekeeper':
        return [{ key: 'storekeeper', label: 'Storekeeper Stock' }] as const;
      default:
        return [{ key: 'none', label: 'No role assigned' }] as const;
    }
  }, [role, isAdmin, isManager, isSupervisor]);

  const [activeKey, setActiveKey] = useState<string>(menu[0]?.key);

  function renderContent() {
    if (isAdmin) {
      if (activeKey === 'rooms') return <AdminRooms />;
      if (activeKey === 'staff') return <AdminStaffManagement />;
      if (activeKey === 'inventory_catalog') return <InventoryCatalog />;
      if (activeKey === 'inventory_setup') return <InventorySetup />;
      if (activeKey === 'audit_log') return <AuditLog />;
      return <AdminRooms />;
    }
    if (isManager) {
      if (activeKey === 'manager') return <ManagerDashboard />;
      if (activeKey === 'staff') return <AdminStaffManagement />;
      if (activeKey === 'inventory_catalog') return <InventoryCatalog />;
      if (activeKey === 'inventory_setup') return <InventorySetup />;
      if (activeKey === 'audit_log') return <AuditLog />;
      return <ManagerDashboard />;
    }
    if (isSupervisor) {
      if (activeKey === 'pending_approvals') return <SupervisorInbox />;
      if (activeKey === 'staff') return <AdminStaffManagement />;
      if (activeKey === 'inventory_setup') return <InventorySetup />;
      if (activeKey === 'inventory_catalog') return <InventoryCatalog />;
      return <SupervisorInbox />;
    }
    switch (activeKey) {
      case 'front_desk':
        return <FrontDeskDashboard />;
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
    <div className="app-layout" style={{ display: 'grid', gridTemplateColumns: '220px 1fr', minHeight: '100vh' }}>
      <aside className="sidebar" style={{ borderRight: '1px solid #eee', padding: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 20, marginBottom: 12 }}>Hotel IMS</div>
        <nav>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {menu.map((item) => (
              <li key={item.key} style={{ marginBottom: 8 }}>
                <button
                  className={`btn ${activeKey === item.key ? 'btn-primary' : ''}`}
                  style={{ width: '100%', textAlign: 'left' }}
                  onClick={() => setActiveKey(item.key)}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      </aside>
      <div className="content" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid #eee' }}>
          <h1 style={{ margin: 0, fontSize: 22 }}>Celjoe Residence</h1>
          <div>
            {user?.email && <span style={{ marginRight: 12 }}>Signed in as {user.email}</span>}
            <button className="btn" onClick={logout}>Logout</button>
          </div>
        </header>
        <main style={{ padding: 16 }}>{renderContent()}</main>
      </div>
    </div>
  );
}