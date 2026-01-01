import { useEffect, useState } from 'react';
import { supabase } from '../../supabaseClient';
import { Select } from './Select';

interface StaffSelectProps {
  role?: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
  label?: string;
  disabled?: boolean;
}

export function StaffSelect({ role, value, onChange, required, className, label = "Select Staff Member", disabled }: StaffSelectProps) {

  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    async function fetchStaff() {
      setLoading(true);
      try {
        let query = supabase!
          .from('staff_profiles')
          .select('id, full_name')
          .eq('is_active', true)
          .order('full_name');

        if (role) {
          query = query.eq('role', role);
        }

        const { data } = await query;
        if (data) {
          setStaff(data);
        }
      } catch (error) {
        console.error('Error fetching staff:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStaff();
  }, [role]);

  return (
    <Select
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required={required}
      className={className}
      disabled={loading || disabled}
    >
      <option value="">-- Select Staff --</option>
      {staff.map((s) => (
        <option key={s.id} value={s.full_name}>
          {s.full_name}
        </option>
      ))}
    </Select>
  );
}
