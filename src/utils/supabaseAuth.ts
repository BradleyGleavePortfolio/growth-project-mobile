// Small helper around Supabase auth operations.
// Keeps the supabase-js bundle out of the cold-start path — we only pull it in
// when a user actually triggers a password change (rare).
//
// Token read goes through the same secureStorage path api.ts uses, so we're
// not inventing a new auth scheme — we're calling supabase-js with the
// already-signed-in session.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureStorage } from '../services/secureStorage';

const SUPABASE_URL = 'https://rpyfdsgxxltzutgqeouk.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJweWZkc2d4eGx0enV0Z3Flb3VrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MjE2OTAsImV4cCI6MjA4OTA5NzY5MH0.cH-yapSxmjdHgMlJiYEt6-uGzMTArgIs9tPVs29lUF0';

export async function updateSupabasePassword(newPassword: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const [accessToken, refreshToken] = await Promise.all([
      secureStorage.getItem('supabase_token'),
      AsyncStorage.getItem('supabase_refresh_token'),
    ]);
    if (!accessToken) {
      return { ok: false, message: 'You are not signed in. Please sign in again and retry.' };
    }

    const { createClient } = await import('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    if (refreshToken) {
      // Hydrate session so updateUser can authorize; supabase-js uses
      // the current session's access_token internally.
      await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    }

    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) {
      return { ok: false, message: error.message || 'Password update failed' };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Password update failed' };
  }
}
