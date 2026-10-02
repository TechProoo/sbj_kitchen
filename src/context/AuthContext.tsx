import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api, ApiError } from '../lib/api';
import { readJson, removeKey, writeJson } from '../lib/storage';
import {
  hasStoredSession,
  isSupabaseConfigured,
  supabase,
} from '../lib/supabase';
import type { StaffUser } from '../lib/types';

/// The last profile the API vouched for. Opening the board with no connection
/// cannot ask the API who is signed in, so it trusts this, but only alongside a
/// session that is still saved on the device.
const PROFILE_KEY = 'sbj.kitchen.profile';

interface AuthContextValue {
  user: StaffUser | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  configured: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<StaffUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /// Supabase says who signed in; the API says whether they are staff. Both
  /// have to agree before the board opens.
  const loadProfile = useCallback(async () => {
    try {
      const profile = await api.me();
      if (!profile.role) {
        setError('This account is not registered as kitchen staff.');
        removeKey(PROFILE_KEY);
        setUser(null);
        await supabase.auth.signOut();
        return;
      }
      writeJson(PROFILE_KEY, profile);
      setUser(profile);
      setError(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 0) {
        const saved = readJson<StaffUser | null>(PROFILE_KEY, null);
        if (saved && hasStoredSession()) {
          setUser(saved);
          setError(null);
          return;
        }
      }
      setUser(null);
      if (err instanceof ApiError && err.status !== 401) setError(err.message);
    }
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      // No session can also mean "expired and could not refresh because there
      // is no internet", so a saved login is worth a try before the form.
      if (data.session || hasStoredSession()) await loadProfile();
      if (active) setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Only an explicit sign-out ends the session here. A missing session
        // on its own can just be an expired token that cannot refresh offline.
        if (event === 'SIGNED_OUT') {
          setUser(null);
          return;
        }
        if (
          session &&
          (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED')
        ) {
          void loadProfile();
        }
      },
    );

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        throw signInError;
      }

      await loadProfile();
    },
    [loadProfile],
  );

  const signOut = useCallback(async () => {
    removeKey(PROFILE_KEY);
    await supabase.auth.signOut();
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      error,
      signIn,
      signOut,
      configured: isSupabaseConfigured,
    }),
    [user, loading, error, signIn, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider');
  return context;
}
