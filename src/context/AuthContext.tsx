import { createContext, useContext, useEffect, useMemo, useState, useRef, useCallback } from 'react';
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
  const refreshSessionRef = useRef<(() => Promise<boolean>) | null>(null);

  const isConfigured = useMemo(() => Boolean(isSupabaseConfigured && supabase), []);

  const clearState = useCallback(() => {
    setSession(null);
    setUser(null);
    setRole(null);
    setStaffId(null);
    setDepartment(null);
    setFullName(null);
    setProfileError(null);
    lastToken.current = undefined;
  }, []);

  const fetchAndSetProfile = useCallback(async (userId: string) => {
    const { data: profile, error: pfErr } = await fetchStaffProfile(userId);
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
  }, []);

  const processSession = useCallback(async (newSession: Session | null) => {
    if (!newSession) {
      clearState();
      return;
    }

    // Optimization: Check if token matches to avoid unnecessary updates
    if (newSession.access_token === lastToken.current) {
        return;
    }

    lastToken.current = newSession.access_token;
    setSession(newSession);
    setUser(newSession.user);

    if (newSession.user) {
      await fetchAndSetProfile(newSession.user.id);
    }
  }, [clearState, fetchAndSetProfile]);

  useEffect(() => {
    // Handle visibility change to prevent aggressive refreshes
    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        const now = Date.now();
        // Only refresh if more than 30 seconds have passed since last refresh
        if (now - lastRefresh.current > 30000) {
          lastRefresh.current = now;
          refreshSessionRef.current?.();
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

      try {
        const { data, error } = await supabase!.auth.getSession();
        
        if (error) {
          console.warn('Auth session init error:', error.message);
          // If the refresh token is invalid, ensure we clear any stale local storage
          if (error.message.includes('Refresh Token Not Found') || error.message.includes('Invalid Refresh Token')) {
            await supabase!.auth.signOut().catch(() => {});
          }
          if (mounted) setLoading(false);
          return;
        }

        if (mounted) {
           await processSession(data?.session ?? null);
           setLoading(false);
        }

      } catch (err) {
        console.error('Unexpected error during auth init:', err);
        if (mounted) setLoading(false);
      }

      const { data: sub } = supabase!.auth.onAuthStateChange(async (event, newSession) => {
        if (!mounted) return;
        
        if (event === 'SIGNED_OUT') {
           clearState();
           return;
        }

        // For other events (SIGNED_IN, TOKEN_REFRESHED, etc.), process the session
        await processSession(newSession);
      });
      
      unsubscribe = sub.subscription.unsubscribe;
    }

    init();

    return () => {
      mounted = false;
      if (unsubscribe) unsubscribe();
    };
  }, [isConfigured, processSession, clearState]);

  async function login(email: string, password: string): Promise<{ ok: boolean; message?: string }> {
    if (!isConfigured) return { ok: false, message: 'Supabase is not configured.' };
    const { data, error } = await supabase!.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: error.message };
    
    // Manually process session to ensure state is updated before returning
    await processSession(data.session);
    
    return { ok: true };
  }

  async function logout() {
    if (!isConfigured) return;
    try {
      const { error } = await supabase!.auth.signOut();
      if (error) throw error;
    } catch (e: unknown) {
      const message = typeof e === 'object' && e && 'message' in e ? String((e as { message?: string }).message) : undefined;
      const isNetworkError = message ? (message.includes('network') || message.includes('abort') || message.includes('fetch')) : false;
      if (!isNetworkError && message) {
        console.warn('Logout warning:', message);
      }
    }
    clearState();
  }

  const isAdmin = role === 'admin';
  const isManager = role === 'manager';
  const isSupervisor = role === 'supervisor';

  const refreshSession = useCallback(async (): Promise<boolean> => {
    if (!isConfigured || !supabase) return false;
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        if (error.message.includes('Refresh Token Not Found') || error.message.includes('Invalid Refresh Token')) {
          await supabase.auth.signOut().catch(() => {});
          clearState();
        }
        return false;
      }
      
      await processSession(data?.session ?? null);
      return Boolean(data?.session);
    } catch {
      return false;
    }
  }, [isConfigured, processSession, clearState]);

  useEffect(() => {
    refreshSessionRef.current = refreshSession;
  }, [refreshSession]);

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
