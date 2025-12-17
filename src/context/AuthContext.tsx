import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase, isSupabaseConfigured } from '../supabaseClient';
import type { Session, User } from '@supabase/supabase-js';

export type AppRole = 'front_desk' | 'supervisor' | 'manager' | 'admin' | 'kitchen' | 'bar' | 'storekeeper' | null;

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  role: AppRole;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; message?: string }>;
  logout: () => Promise<void>;
  isConfigured: boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

async function fetchUserRole(userId: string): Promise<AppRole> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('Failed to fetch user role:', error.message);
    return null;
  }
  const role = (data?.role as AppRole) ?? null;
  if (
    role !== 'front_desk' &&
    role !== 'supervisor' &&
    role !== 'manager' &&
    role !== 'admin' &&
    role !== 'kitchen' &&
    role !== 'bar' &&
    role !== 'storekeeper'
  ) {
    return null;
  }
  return role;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<AppRole>(null);
  const [loading, setLoading] = useState<boolean>(true);

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
        setLoading(false);
      }
      if (s?.user) {
        const fetchedRole = await fetchUserRole(s.user.id);
        if (mounted) setRole(fetchedRole);
      } else {
        if (mounted) setRole(null);
      }
      const { data: sub } = supabase!.auth.onAuthStateChange(async (_event, newSession) => {
        if (!mounted) return;
        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          const fetchedRole = await fetchUserRole(newSession.user.id);
          setRole(fetchedRole);
        } else {
          setRole(null);
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
      const fetchedRole = await fetchUserRole(newSession.user.id);
      setRole(fetchedRole);
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
  }

  const value: AuthContextValue = {
    session,
    user,
    role,
    loading,
    login,
    logout,
    isConfigured,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}