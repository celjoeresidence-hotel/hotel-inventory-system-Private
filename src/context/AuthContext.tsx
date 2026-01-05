import { createContext, useContext, useEffect, useMemo, useState, useRef } from 'react';
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
  refreshSession?: () => Promise<boolean>;
  ensureActiveSession?: () => Promise<boolean>;
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
  const lastToken = useRef<string | undefined>(undefined);
  const lastRefresh = useRef<number>(0);

  const isConfigured = useMemo(() => Boolean(isSupabaseConfigured && supabase), []);

  useEffect(() => {
    // Handle visibility change to prevent aggressive refreshes
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        // Only refresh if more than 30 seconds have passed since last refresh
        if (now - lastRefresh.current > 30000) {
          lastRefresh.current = now;
          refreshSession?.();
        }
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleVisibilityChange);
    };
  }, []);

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
        console.warn('Auth session init error:', error.message);
        // If the refresh token is invalid, ensure we clear any stale local storage
        if (error.message.includes('Refresh Token Not Found') || error.message.includes('Invalid Refresh Token')) {
          await supabase!.auth.signOut().catch(() => {});
        }
        setLoading(false);
        return;
      }
      const s = data?.session ?? null;
      
      // Initial token tracking
      lastToken.current = s?.access_token;

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
        
        // Check if token actually changed to avoid unnecessary updates
        if (newSession?.access_token === lastToken.current) {
           return;
        }
        lastToken.current = newSession?.access_token;

        setSession(newSession);
        setUser(newSession?.user ?? null);
        if (newSession?.user) {
          // Only fetch profile if user ID changed or we don't have a role yet
          // Actually, let's play safe and fetch if session changed, but maybe we can optimize later.
          // For now, the token check above is the biggest win.
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
      unsubscribe = sub.subscription.unsubscribe;
    }
    init();

    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
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
      // Attempt to sign out from the server
      const { error } = await supabase!.auth.signOut();
      if (error) throw error;
    } catch (e: any) {
      // Ignore network errors or aborts during logout as we're clearing local state anyway
      const isNetworkError = e?.message?.includes('network') || e?.message?.includes('abort') || e?.message?.includes('fetch');
      if (!isNetworkError && typeof e?.message === 'string') {
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

  async function refreshSession(): Promise<boolean> {
    if (!isConfigured || !supabase) return false;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        if (error.message.includes('Refresh Token Not Found') || error.message.includes('Invalid Refresh Token')) {
          await supabase.auth.signOut().catch(() => {});
        }
        return false;
      }
      const s = data?.session ?? null;
      if (s?.access_token && s.access_token === lastToken.current) return Boolean(s);
      lastToken.current = s?.access_token;

      setSession(s);
      setUser(s?.user ?? null);
      if (s?.user) {
        const { data: profile, error: pfErr } = await fetchStaffProfile(s.user.id);
        if (pfErr) {
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
      return Boolean(s);
    } catch {
      return false;
    }
  }

  async function ensureActiveSession(): Promise<boolean> {
    const ok = await refreshSession();
    if (!ok) {
      setProfileError('Session expired. Please sign in again to continue.');
    }
    return ok;
  }

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
    refreshSession,
    ensureActiveSession,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
