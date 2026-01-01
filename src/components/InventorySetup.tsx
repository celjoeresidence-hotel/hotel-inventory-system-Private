import { useState, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { Card } from './ui/Card';
import { IconSettings, IconBox } from './ui/Icons';
import InventoryStructureTab from './InventoryStructureTab';
import InventoryItemsTab from './InventoryItemsTab';

export default function InventorySetup() {
  const { session, isConfigured, isSupervisor, isManager, isAdmin } = useAuth();
  const canView = useMemo(() => Boolean(isConfigured && session && (isSupervisor || isManager || isAdmin)), [isConfigured, session, isSupervisor, isManager, isAdmin]);
  
  const [activeTab, setActiveTab] = useState<'structure' | 'items_stock'>('structure');

  if (!canView) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        You do not have permission to view this page.
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-500">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
            <div className="p-2 bg-green-100 text-green-700 rounded-lg">
              <IconSettings className="w-6 h-6" />
            </div>
            Inventory Setup
          </h1>
          <p className="text-sm text-gray-500 mt-1 ml-12">Configure categories, collections, and items</p>
        </div>
      </div>

      <Card className="p-1 bg-gray-100/50 backdrop-blur-sm border-0 rounded-xl inline-flex relative">
        <div 
          className="absolute transition-all duration-300 ease-out bg-white shadow-sm rounded-lg border border-gray-200"
          style={{
            top: '4px',
            bottom: '4px',
            left: activeTab === 'structure' ? '4px' : '50%',
            width: 'calc(50% - 4px)',
            transform: activeTab === 'items_stock' ? 'translateX(0)' : 'translateX(0)' 
          }}
        />
        <button
          onClick={() => setActiveTab('structure')}
          className={`
            relative z-10 flex-1 px-6 py-2.5 text-sm font-medium rounded-lg transition-colors duration-200 flex items-center justify-center gap-2
            ${activeTab === 'structure' ? 'text-green-700' : 'text-gray-600 hover:text-gray-900'}
          `}
        >
          <IconSettings className="w-4 h-4" />
          Structure
        </button>
        <button
          onClick={() => setActiveTab('items_stock')}
          className={`
            relative z-10 flex-1 px-6 py-2.5 text-sm font-medium rounded-lg transition-colors duration-200 flex items-center justify-center gap-2
            ${activeTab === 'items_stock' ? 'text-green-700' : 'text-gray-600 hover:text-gray-900'}
          `}
        >
          <IconBox className="w-4 h-4" />
          Items & Opening Stock
        </button>
      </Card>

      <div className="min-h-[400px]">
        {activeTab === 'structure' ? (
          <InventoryStructureTab />
        ) : (
          <InventoryItemsTab />
        )}
      </div>
    </div>
  );
}
