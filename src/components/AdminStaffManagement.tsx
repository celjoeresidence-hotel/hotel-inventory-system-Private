import { useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Select } from './ui/Select';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { Checkbox } from './ui/Checkbox';
import { 
  Table, 
  TableHeader, 
  TableBody, 
  TableRow, 
  TableHead, 
  TableCell 
} from './ui/Table';
import { 
  IconPlus, 
  IconEdit, 
  IconCheck, 
  IconX, 
  IconLoader, 
  IconUsers, 
  IconShield, 
  IconSearch,
  IconAlertCircle
} from './ui/Icons';

interface StaffProfile {
  id: string;
  user_id: string;
  full_name: string;
  role: 'admin' | 'manager' | 'supervisor' | 'front_desk' | 'kitchen' | 'bar' | 'storekeeper';
  department: string | null;
  is_active: boolean;
  created_at: string;
}

const ROLES: { value: StaffProfile['role']; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'manager', label: 'Manager' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'front_desk', label: 'Front Desk' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'bar', label: 'Bar' },
  { value: 'storekeeper', label: 'Storekeeper' },
];

export default function AdminStaffManagement() {
  // Allow all roles to view; RLS ensures staff-only users see only their own profile
  return <AdminStaffManagementInner />;
}

function AdminStaffManagementInner() {
  const { isAdmin, isManager, isSupervisor } = useAuth();
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [toggleLoadingId, setToggleLoadingId] = useState<string | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<StaffProfile | null>(null);

  // Form state
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<StaffProfile['role']>('front_desk');
  const [department, setDepartment] = useState('');
  const [userId, setUserId] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  
  // Search state
  const [searchTerm, setSearchTerm] = useState('');

  const modalTitle = useMemo(() => (editing ? 'Edit Staff Member' : 'Add Staff Member'), [editing]);

  const canAdd = isAdmin || isManager;
  const canEdit = isAdmin || isManager;
  const isReadOnly = isSupervisor;

  useEffect(() => {
    let mounted = true;
    async function fetchStaff() {
      setLoading(true);
      setError(null);
      if (!isSupabaseConfigured || !supabase) {
        if (mounted) {
          setError('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
          setStaff([]);
          setLoading(false);
        }
        return;
      }
      const { data, error } = await supabase!
         .from('staff_profiles')
         .select('id, user_id, full_name, role, department, is_active, created_at')
         .order('created_at', { ascending: false });
      if (!mounted) return;
      if (error) {
        setError(error.message || 'Failed to load staff');
        setStaff([]);
      } else {
        const existing = (data as StaffProfile[]) || [];
        setStaff(existing);
        // Auto-backfill missing staff_profiles from profiles for Admin/Manager
        if ((isAdmin || isManager) && existing) {
          const existingUserIds = new Set<string>(existing.map((s) => s.user_id));
          type ProfileRow = { id: string; full_name: string | null; role: StaffProfile['role']; email: string | null };
          const { data: profilesData, error: profilesErr } = await supabase!
            .from('profiles')
            .select('id, full_name, role, email');
          if (!profilesErr && profilesData) {
            const missing = (profilesData as ProfileRow[]).filter((p) => !existingUserIds.has(p.id));
            if (missing.length > 0) {
              const { error: insertErr } = await supabase!
                .from('staff_profiles')
                .insert(
                  missing.map((p) => ({
                    user_id: p.id,
                    full_name: (p.full_name ?? p.email ?? 'Unknown').trim(),
                    role: p.role,
                    department: p.role, // seed department to role label for initial visibility
                    is_active: true,
                  }))
                );
              if (!insertErr) {
                // Reload staff list after backfill
                const { data: reloadData, error: reloadErr } = await supabase!
                  .from('staff_profiles')
                  .select('id, user_id, full_name, role, department, is_active, created_at')
                  .order('created_at', { ascending: false });
                if (!reloadErr && reloadData) {
                  setStaff((reloadData as StaffProfile[]) || []);
                }
              }
            }
          }
        }
      }
      setLoading(false);
    }
    fetchStaff();
    return () => { mounted = false; };
  }, [isAdmin, isManager]); // Added dependencies to re-run if auth role changes

  function openAddModal() {
    if (!isAdmin && !isManager) return; // Admin and Manager can add staff
    setEditing(null);
    setFullName('');
    setRole('front_desk');
    setDepartment('');
    setUserId('');
    setIsActive(true);
    setFormError(null);
    setIsModalOpen(true);
  }

  function openEditModal(item: StaffProfile) {
    if (isSupervisor) return; // Supervisor is read-only
    setEditing(item);
    // Full name and user_id not editable per requirements
    setFullName(item.full_name);
    setRole(item.role);
    setDepartment(item.department || '');
    setUserId(item.user_id);
    setIsActive(item.is_active);
    setFormError(null);
    setIsModalOpen(true);
  }

  async function handleSave() {
    setSaving(true);
    setFormError(null);
    if (!isSupabaseConfigured || !supabase) {
      setFormError('Supabase is not configured. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      setSaving(false);
      return;
    }
    try {
      if (editing) {
        if (isSupervisor) {
          throw new Error('Supervisors have read-only access.');
        }
        if (isAdmin || isManager) {
          // Admin/Manager: can edit role, department, active only. user_id cannot be changed.
          const { error } = await supabase!
            .from('staff_profiles')
            .update({ role, department: department || null, is_active: isActive })
            .eq('id', editing.id);
          if (error) throw new Error(error.message);
        } else {
          throw new Error('Permission denied.');
        }
      } else {
        // Create: Admin and Manager
        if (!isAdmin && !isManager) throw new Error('Only Admin or Manager can add staff.');
        if (!fullName.trim()) throw new Error('Full name is required');
        if (!userId.trim()) throw new Error('User ID (Supabase auth uid) is required');
        const { error } = await supabase!
           .from('staff_profiles')
           .insert([{ full_name: fullName.trim(), role, department: department || null, user_id: userId.trim(), is_active: isActive }]);
        if (error) throw new Error(error.message);
      }
      // Refresh list
      const { data, error: loadErr } = await supabase!
         .from('staff_profiles')
         .select('id, user_id, full_name, role, department, is_active, created_at')
         .order('created_at', { ascending: false });
      if (loadErr) throw new Error(loadErr.message);
      setStaff((data as StaffProfile[]) || []);
      setIsModalOpen(false);
    } catch (e: any) {
      setFormError(e?.message || 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(row: StaffProfile) {
    if (!(isAdmin || isManager)) return;
    if (!isSupabaseConfigured || !supabase) {
      setError('Supabase is not configured.');
      return;
    }
    try {
      setToggleLoadingId(row.id);
      const { error } = await supabase!
        .from('staff_profiles')
        .update({ is_active: !row.is_active })
        .eq('id', row.id);
      if (error) throw new Error(error.message);
      // Update local state instantly
      setStaff((prev) => prev.map((s) => s.id === row.id ? { ...s, is_active: !row.is_active } : s));
    } catch (e: any) {
      setError(e?.message || 'Failed to toggle active state');
    } finally {
      setToggleLoadingId(null);
    }
  }

  const filteredStaff = useMemo(() => {
    return staff.filter(s => 
      s.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.role.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (s.department && s.department.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [staff, searchTerm]);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <IconUsers className="w-6 h-6 text-gray-500" />
            Staff Management
          </h1>
          <p className="text-gray-500 text-sm mt-1">Manage staff profiles, roles, and access</p>
        </div>
        
        <div className="flex items-center gap-2">
          {canAdd && (
            <Button onClick={openAddModal} className="gap-2">
              <IconPlus className="w-4 h-4" />
              Add Staff
            </Button>
          )}
          {isReadOnly && (
            <Badge variant="warning" className="flex items-center gap-1">
              <IconShield className="w-3 h-3" />
              Read-only Access
            </Badge>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-error-light border border-error-light text-error px-4 py-3 rounded-md flex items-start gap-2 animate-fadeIn">
          <IconAlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      <Card className="overflow-hidden border border-gray-200 shadow-sm">
        <div className="p-4 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
          <IconSearch className="w-4 h-4 text-gray-400" />
          <input 
            type="text" 
            placeholder="Search staff by name, role, or department..." 
            className="bg-transparent border-none focus:ring-0 text-sm w-full text-gray-700 placeholder-gray-400"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px] sticky left-0 z-20 bg-gray-50 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">Full Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center text-gray-500">
                      <IconLoader className="w-8 h-8 animate-spin text-green-600 mb-2" />
                      <p>Loading staff profiles...</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : filteredStaff.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center">
                    <div className="flex flex-col items-center justify-center text-gray-500">
                      <IconUsers className="w-12 h-12 text-gray-300 mb-3" />
                      <p className="text-lg font-medium text-gray-900">No staff found</p>
                      {searchTerm && <p className="text-sm">Try adjusting your search terms.</p>}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                filteredStaff.map((s) => (
                  <TableRow key={s.id} className="hover:bg-gray-50/50">
                    <TableCell className="font-medium text-gray-900">
                      {s.full_name}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="capitalize">
                        {s.role.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-500">
                      {s.department || '—'}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.is_active ? 'success' : 'default'}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-gray-500 text-xs">
                      {new Date(s.created_at).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {canEdit && (
                        <div className="flex items-center justify-end gap-2">
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            onClick={() => openEditModal(s)}
                            title="Edit Staff"
                          >
                            <IconEdit className="w-4 h-4 text-gray-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => toggleActive(s)}
                            disabled={toggleLoadingId === s.id}
                            title={s.is_active ? "Deactivate" : "Activate"}
                            className={s.is_active ? "text-error hover:text-error hover:bg-error-light" : "text-green-600 hover:text-green-700 hover:bg-green-50"}
                          >
                            {toggleLoadingId === s.id ? (
                              <IconLoader className="w-4 h-4 animate-spin" />
                            ) : s.is_active ? (
                              <IconX className="w-4 h-4" />
                            ) : (
                              <IconCheck className="w-4 h-4" />
                            )}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </Card>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={modalTitle}
        size="md"
      >
        <div className="space-y-4">
          {formError && (
            <div className="bg-error-light border border-error-light text-error px-4 py-3 rounded-md flex items-start gap-2 text-sm">
              <IconAlertCircle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <p>{formError}</p>
            </div>
          )}
          
          <Input
            label="Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            disabled={!!editing}
            placeholder="John Doe"
            helperText={editing ? "Name cannot be changed after creation." : undefined}
            fullWidth
          />
          
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as StaffProfile['role'])}
            disabled={!canEdit}
            options={ROLES}
            fullWidth
          />
          
          <Input
            label="Department"
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            disabled={!canEdit}
            placeholder="e.g. Front Office, Housekeeping"
            fullWidth
          />
          
          <Input
            label="User ID (Supabase Auth UID)"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={!!editing}
            placeholder="uuid-string-here"
            helperText={editing ? "User ID cannot be changed." : "This links the staff profile to a login account."}
            fullWidth
          />

          <div className="pt-2">
            <Checkbox
              id="isActive"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
              disabled={!canEdit}
              label="Account is Active"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100 mt-4">
            <Button variant="ghost" onClick={() => setIsModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            {!isSupervisor && (
              <Button onClick={handleSave} disabled={saving} isLoading={saving}>
                {editing ? 'Save Changes' : 'Create Profile'}
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
