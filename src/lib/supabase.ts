import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/// Credentials land in .env once the Supabase project exists. Until then the
/// app should say so plainly rather than crash on a null client.
export const isSupabaseConfigured = Boolean(url && anonKey);

export const AUTH_STORAGE_KEY = 'sbj.kitchen.auth';

export const supabase = createClient(
  url ?? 'https://placeholder.supabase.co',
  anonKey ?? 'placeholder-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Kitchen screens stay signed in through a whole service.
      storageKey: AUTH_STORAGE_KEY,
    },
  },
);

/// A session saved on this device. Offline, Supabase cannot refresh an expired
/// token and reports no session at all, but the person is still signed in.
export function hasStoredSession(): boolean {
  try {
    return localStorage.getItem(AUTH_STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  if (data.session) return data.session.access_token;

  // Expired and unable to refresh. Send the stored token anyway: if we are
  // actually online the server answers 401 and the caller refreshes and retries.
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    return raw
      ? ((JSON.parse(raw) as { access_token?: string }).access_token ?? null)
      : null;
  } catch {
    return null;
  }
}
