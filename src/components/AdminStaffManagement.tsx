import { useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import { useAuth } from '../context/AuthContext';

interface StaffProfile {
  id: string;
  user_id: string;
  full_name: string;
  role: 'admin' | 'manager' | 'supervisor' | 'front_desk' | 'kitchen' | 'bar' | 'storekeeper';
  department: string | null;
  is_active: boolean;
  created_at: string;
}

const ROLES: StaffProfile['role'][] = ['admin','manager','supervisor','front_desk','kitchen','bar','storekeeper'];

export default function AdminStaffManagement() {
  const { isAdmin } = useAuth();

  // Access control: render-only guard, no queries if not admin
  if (!isAdmin) {
    return (
      <div style={{ maxWidth: 800, margin: '40px auto', textAlign: 'center' }}>
        <h2>Access denied</h2>
        <p>You do not have permission to view this page.</p>
      </div>
    );
  }

  return <AdminStaffManagementInner />;
}

function AdminStaffManagementInner() {
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

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

  const modalTitle = useMemo(() => (editing ? 'Edit Staff' : 'Add Staff'), [editing]);

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
        setStaff((data as StaffProfile[]) || []);
      }
      setLoading(false);
    }
    fetchStaff();
    return () => { mounted = false; };
  }, []);

  function openAddModal() {
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
    setEditing(item);
    // Full name is not editable per requirements; show but disable
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
        // Update: admin can edit role, department, active only. user_id cannot be changed.
        const { error } = await supabase!
          .from('staff_profiles')
          .update({ role, department: department || null, is_active: isActive })
          .eq('id', editing.id);
        if (error) throw new Error(error.message);
      } else {
        // Create: must provide full_name, role, department, user_id, is_active
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

  return (
    <div className="page">
      <h1 className="page-title">Staff Management</h1>

      <div className="toolbar">
        <button className="btn btn-primary" onClick={openAddModal}>Add Staff</button>
      </div>

      {loading ? (
        <div className="table-loading">
          <div className="spinner" aria-label="Loading" />
          <div>Loading staff...</div>
        </div>
      ) : error ? (
        <div className="error-box">{error}</div>
      ) : staff.length === 0 ? (
        <div className="empty-state">No staff profiles found.</div>
      ) : (
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Full Name</th>
                <th>Role</th>
                <th>Department</th>
                <th>Status</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {staff.map((s) => (
                <tr key={s.id}>
                  <td>{s.full_name}</td>
                  <td>{s.role}</td>
                  <td>{s.department || '-'}</td>
                  <td>{s.is_active ? 'Active' : 'Inactive'}</td>
                  <td>{new Date(s.created_at).toLocaleString()}</td>
                  <td>
                    <button className="btn btn-secondary" onClick={() => openEditModal(s)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {isModalOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h2 className="modal-title">{modalTitle}</h2>
            {formError && <div className="error-box" style={{ marginBottom: 12 }}>{formError}</div>}
            <div className="form-grid">
              <label className="form-label">Full name</label>
              <input className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={!!editing} />

              <label className="form-label">Role</label>
              <select className="input" value={role} onChange={(e) => setRole(e.target.value as StaffProfile['role'])}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>

              <label className="form-label">Department</label>
              <input className="input" value={department} onChange={(e) => setDepartment(e.target.value)} />

              <label className="form-label">User ID (Supabase auth uid)</label>
              <input className="input" value={userId} onChange={(e) => setUserId(e.target.value)} disabled={!!editing} />

              <label className="form-label">Active</label>
              <div>
                <label className="toggle">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  <span>Active</span>
                </label>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setIsModalOpen(false)} disabled={saving}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}