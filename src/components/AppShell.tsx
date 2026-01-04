import { useMemo, useState } from 'react';
import FrontDeskDashboard from './FrontDeskDashboard';
import FrontDeskOversight from './FrontDeskOversight';
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
import ManagerFinancials from './ManagerFinancials';
import Reports from './Reports';
import AdminRoomAnalytics from './AdminRoomAnalytics';
import AdminDashboard from './AdminDashboard';
import { 
  IconDashboard, 
  IconBox, 
  IconUsers, 
  IconFileText, 
  IconCheckSquare, 
  IconSettings, 
  IconLogOut, 
  IconMenu,
  IconHistory,
  IconClipboardList,
  IconLayout,
  IconBarChart
} from './ui/Icons';
import { Button } from './ui/Button';
import UpdateNotification from './UpdateNotification';
import logo from '../assets/logo.svg';

export default function AppShell() {
  const { role, logout, user, isAdmin, isManager, isSupervisor } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Build menu items based on role
  const menu = useMemo(() => {
    if (isAdmin) {
      return [
        { key: 'admin_dashboard', label: 'Dashboard', icon: <IconDashboard size={20} /> },
        { key: 'rooms', label: 'Rooms Management', icon: <IconCheckSquare size={20} /> },
        { key: 'room_analytics', label: 'Room Analytics', icon: <IconBarChart size={20} /> },
        { key: 'front_desk_oversight', label: 'Front Desk Oversight', icon: <IconLayout size={20} /> },
        { key: 'staff', label: 'Staff Management', icon: <IconUsers size={20} /> },
        { key: 'financials', label: 'Financial Reports', icon: <IconFileText size={20} /> },
        { key: 'reports', label: 'Daily Reports', icon: <IconClipboardList size={20} /> },
        { key: 'inventory_catalog', label: 'Inventory Catalog', icon: <IconBox size={20} /> },
        { key: 'inventory_setup', label: 'Inventory Setup', icon: <IconSettings size={20} /> },
        { key: 'audit_log', label: 'Audit Log', icon: <IconHistory size={20} /> },
      ] as const;
    }
    if (isManager) {
      return [
        { key: 'manager', label: 'Manager Dashboard', icon: <IconDashboard size={20} /> },
        { key: 'room_analytics', label: 'Room Analytics', icon: <IconBarChart size={20} /> },
        { key: 'front_desk_oversight', label: 'Front Desk Oversight', icon: <IconLayout size={20} /> },
        { key: 'financials', label: 'Financial Reports', icon: <IconFileText size={20} /> },
        { key: 'staff', label: 'Staff Management', icon: <IconUsers size={20} /> },
        { key: 'reports', label: 'Daily Reports', icon: <IconClipboardList size={20} /> },
        { key: 'inventory_catalog', label: 'Inventory Catalog', icon: <IconBox size={20} /> },
        { key: 'inventory_setup', label: 'Inventory Setup', icon: <IconSettings size={20} /> },
        { key: 'audit_log', label: 'Audit Log', icon: <IconHistory size={20} /> },
      ] as const;
    }
    if (isSupervisor) {
      return [
        { key: 'pending_approvals', label: 'Daily Activities', icon: <IconCheckSquare size={20} /> },
        { key: 'front_desk_monitor', label: 'Front Desk Monitor', icon: <IconLayout size={20} /> },
        { key: 'staff', label: 'Staff Management', icon: <IconUsers size={20} /> },
        { key: 'reports', label: 'Daily Reports', icon: <IconClipboardList size={20} /> },
        { key: 'inventory_setup', label: 'Inventory Setup', icon: <IconSettings size={20} /> },
        { key: 'inventory_catalog', label: 'Inventory Catalog', icon: <IconBox size={20} /> },
        { key: 'history', label: 'My History', icon: <IconHistory size={20} /> },
      ] as const;
    }
    switch (role) {
      case 'front_desk':
        return [
          { key: 'front_desk', label: 'Front Desk', icon: <IconDashboard size={20} /> },
          { key: 'history', label: 'My History', icon: <IconHistory size={20} /> }
        ] as const;
      case 'kitchen':
        return [
          { key: 'kitchen', label: 'Kitchen Stock', icon: <IconBox size={20} /> },
          { key: 'history', label: 'My History', icon: <IconHistory size={20} /> }
        ] as const;
      case 'bar':
        return [
          { key: 'bar', label: 'Bar Stock', icon: <IconBox size={20} /> },
          { key: 'history', label: 'My History', icon: <IconHistory size={20} /> }
        ] as const;
      case 'storekeeper':
        return [
          { key: 'storekeeper', label: 'Storekeeper Stock', icon: <IconBox size={20} /> },
          { key: 'history', label: 'My History', icon: <IconHistory size={20} /> }
        ] as const;
      default:
        return [{ key: 'none', label: 'No role assigned', icon: <IconLogOut size={20} /> }] as const;
    }
  }, [role, isAdmin, isManager, isSupervisor]);

  const [activeKey, setActiveKey] = useState<string>(menu[0]?.key);

  function renderContent() {
    if (isAdmin) {
      if (activeKey === 'admin_dashboard') return <AdminDashboard />;
      if (activeKey === 'rooms') return <AdminRooms />;
      if (activeKey === 'room_analytics') return <AdminRoomAnalytics />;
      if (activeKey === 'front_desk_oversight') return <FrontDeskOversight role="admin" />;
      if (activeKey === 'staff') return <AdminStaffManagement />;
      if (activeKey === 'financials') return <ManagerFinancials />;
      if (activeKey === 'reports') return <Reports />;
      if (activeKey === 'inventory_catalog') return <InventoryCatalog />;
      if (activeKey === 'inventory_setup') return <InventorySetup />;
      if (activeKey === 'audit_log') return <AuditLog />;
      return <AdminDashboard />;
    }
    if (isManager) {
      if (activeKey === 'manager') return <ManagerDashboard />;
      if (activeKey === 'admin_dashboard') return <AdminDashboard />;
      if (activeKey === 'room_analytics') return <AdminRoomAnalytics />;
      if (activeKey === 'front_desk_oversight') return <FrontDeskOversight role="manager" />;
      if (activeKey === 'financials') return <ManagerFinancials />;
      if (activeKey === 'staff') return <AdminStaffManagement />;
      if (activeKey === 'inventory_catalog') return <InventoryCatalog />;
      if (activeKey === 'inventory_setup') return <InventorySetup />;
      if (activeKey === 'audit_log') return <AuditLog />;
      if (activeKey === 'reports') return <Reports />;
      return <ManagerDashboard />;
    }
    if (isSupervisor) {
      if (activeKey === 'pending_approvals') return <SupervisorInbox />;
      if (activeKey === 'front_desk_monitor') return <FrontDeskOversight role="supervisor" />;
      if (activeKey === 'staff') return <AdminStaffManagement />;
      if (activeKey === 'inventory_setup') return <InventorySetup />;
      if (activeKey === 'inventory_catalog') return <InventoryCatalog />;
      if (activeKey === 'reports') return <Reports />;
      if (activeKey === 'history') return <AuditLog />;
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
      case 'history':
        return <AuditLog />;
      default:
        return (
          <div className="max-w-[700px] mx-auto my-10 text-center">
            <h2>No role assigned</h2>
            <p>Please contact your administrator.</p>
          </div>
        );
    }
  }

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const handleLogout = async () => {
    try {
      setIsLoggingOut(true);
      await logout();
    } finally {
      setIsLoggingOut(false);
    }
  };

  const NavContent = () => (
    <>
      <div className="h-16 flex items-center px-6 border-b border-gray-200 font-bold text-green-700 text-xl gap-3 bg-white">
        <img src={logo} alt="Brand" className="w-8 h-8" />
        <span>Hotel IMS</span>
      </div>
      <nav className="p-3 flex-1 overflow-y-auto space-y-1">
        {menu.map((item) => (
          <button
            key={item.key}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all w-full font-medium text-sm text-left
              ${activeKey === item.key 
                ? 'bg-green-50 text-green-700 shadow-sm ring-1 ring-green-100' 
                : 'text-gray-500 hover:bg-green-50 hover:text-green-700'
              }`}
            onClick={() => {
              setActiveKey(item.key);
              setMobileMenuOpen(false);
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
      <div className="p-4 border-t border-gray-200 bg-gray-50/50">
        <div className="text-xs font-medium text-gray-500 mb-3 px-1">
          Signed in as <strong className="text-gray-900">{user?.email?.split('@')[0]}</strong>
        </div>
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleLogout} 
          disabled={isLoggingOut}
          isLoading={isLoggingOut}
          type="button"
          className="w-full justify-center bg-white hover:bg-error-light hover:text-error hover:border-error-light transition-colors"
        >
          <IconLogOut className="w-4 h-4 mr-2" />
          Sign out
        </Button>
      </div>
    </>
  );

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-50">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-[260px] h-screen sticky top-0 bg-white border-r border-gray-200 flex-col z-30 shadow-sm">
        <NavContent />
      </aside>

      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-3 bg-white border-b border-gray-200 sticky top-0 z-20 shadow-sm">
         <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setMobileMenuOpen(true)}>
              <IconMenu size={24} />
            </Button>
            <span className="font-bold text-lg text-green-700">Hotel IMS</span>
         </div>
         <div className="w-8" /> {/* Spacer for balance */}
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <>
          <div className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-50 w-72 bg-white flex flex-col shadow-2xl transition-transform duration-300 transform translate-x-0">
             <NavContent />
          </aside>
        </>
      )}

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-h-screen overflow-x-hidden">
        
        {/* Page Content */}
        <main className="flex-1 p-4 md:p-8 max-w-7xl mx-auto w-full animate-in fade-in duration-300">
          {renderContent()}
        </main>
        
        <footer className="mt-auto py-6 text-center text-gray-400 text-sm border-t border-gray-100 bg-white/50">
          © {new Date().getFullYear()} Celjoe Residence. All rights reserved.
        </footer>
      </div>
      <UpdateNotification />
    </div>
  );
}
