import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import type { Session, User } from '@supabase/supabase-js';

export type AppRole = 'front_desk' | 'supervisor' | 'manager' | 'admin' | 'kitchen' | 'bar' | 'storekeeper' | null;

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  role: AppRole;
  staffId: string | null;
  department: string | null;
  fullName: string | null;
  isAdmin: boolean;
  isManager: boolean;
  isSupervisor: boolean;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  logout: () => Promise<void>;
  isConfigured: boolean;
  profileError?: string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchStaffProfile(userId: string) {
  if (!supabase) return { data: null, error: { message: 'Supabase not configured' } } as const;
  const { data, error } = await supabase
    .from('staff_profiles')
    .select('id, role, department, full_name, is_active')
    .eq('user_id', userId)
    .maybeSingle();
  return { data, error } as const;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole>(null);
  const [staffId, setStaffId] = useState<string | null>(null);
  const [department, setDepartment] = useState<string | null>(null);
  const [fullName, setFullName] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [profileError, setProfileError] = useState<string | null>(null);

  const isConfigured = useMemo(() => Boolean(isSupabaseConfigured && supabase), []);

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | null = null;
    async function init() {
      if (!isConfigured) {
        setLoading(false);
        return;
      }
      const { data, error } = await supabase!.auth.getSession();
      if (error) {
        setLoading(false);
        return;
      }
      const s = data?.session ?? null;
      if (mounted) {
        setSession(s);
        setUser(s?.user ?? null);
      }
      if (s?.user) {
        const { data: profile, error: pfErr } = await fetchStaffProfile(s.user.id);
        if (mounted) {
          if (pfErr) {
            console.warn('Profile fetch error:', pfErr.message);
            setProfileError(pfErr.message || 'Failed to fetch staff profile');
          } else if (!profile) {
            setProfileError('No staff profile row found for this user.');
          } else {
            setProfileError(null);
          }
          const fetchedRole = (profile?.role as AppRole) ?? null;
          setRole(fetchedRole);
          setStaffId(profile?.id ?? null);
          setDepartment(profile?.department ?? null);
          setFullName(profile?.full_name ?? null);
        }
      } else {
        if (mounted) {
          setRole(null);
          setStaffId(null);
          setDepartment(null);
          setFullName(null);
          setProfileError(null);
        }
      }
      if (mounted) setLoading(false);

      const { data: sub } = supabase!.auth.onAuthStateChange(async (_event, newSession) => {
        if (!mounted) return;
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          const { data: profile, error: pfErr } = await fetchStaffProfile(newSession.user.id);
          if (pfErr) {
            console.warn('Profile fetch error:', pfErr.message);
            setProfileError(pfErr.message || 'Failed to fetch staff profile');
          } else if (!profile) {
            setProfileError('No staff profile row found for this user.');
          } else {
            setProfileError(null);
          }
          const fetchedRole = (profile?.role as AppRole) ?? null;
          setRole(fetchedRole);
          setStaffId(profile?.id ?? null);
          setDepartment(profile?.department ?? null);
          setFullName(profile?.full_name ?? null);
        } else {
          setRole(null);
          setStaffId(null);
          setDepartment(null);
          setFullName(null);
          setProfileError(null);
        }
      });
      unsubscribe = sub?.subscription?.unsubscribe?.bind(sub.subscription) ?? null;
    }
    init();
    return () => {
      mounted = false;
      try {
        unsubscribe && unsubscribe();
      } catch {}
    };
  }, [isConfigured]);

  async function login(email: string, password: string): Promise<{ ok: boolean; message?: string }> {
    if (!isConfigured) return { ok: false, message: 'Supabase is not configured.' };
    const { data, error } = await supabase!.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: error.message };
    const newSession = data.session;
    setSession(newSession);
    setUser(newSession?.user ?? null);
    if (newSession?.user) {
      const { data: profile, error: pfErr } = await fetchStaffProfile(newSession.user.id);
      if (pfErr) {
        console.warn('Profile fetch error:', pfErr.message);
        setProfileError(pfErr.message || 'Failed to fetch staff profile');
      } else if (!profile) {
        setProfileError('No staff profile row found for this user.');
      } else {
        setProfileError(null);
      }
      const fetchedRole = (profile?.role as AppRole) ?? null;
      setRole(fetchedRole);
      setStaffId(profile?.id ?? null);
      setDepartment(profile?.department ?? null);
      setFullName(profile?.full_name ?? null);
    } else {
      setRole(null);
      setStaffId(null);
      setDepartment(null);
      setFullName(null);
      setProfileError(null);
    }
    return { ok: true };
  }

  async function logout() {
    if (!isConfigured) return;
    try {
      await supabase!.auth.signOut();
    } catch (e: any) {
      // Swallow network AbortError or other non-critical errors
      if (typeof e?.message === 'string') {
        console.warn('Logout warning:', e.message);
      }
    }
    setSession(null);
    setUser(null);
    setRole(null);
    setStaffId(null);
    setDepartment(null);
    setFullName(null);
    setProfileError(null);
  }

  const isAdmin = role === 'admin';
  const isManager = role === 'manager';
  const isSupervisor = role === 'supervisor';

  const value: AuthContextValue = {
    session,
    user,
    role,
    staffId,
    department,
    fullName,
    isAdmin,
    isManager,
    isSupervisor,
    loading,
    login,
    logout,
    isConfigured,
    profileError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}