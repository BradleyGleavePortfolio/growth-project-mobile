// Small helper around Supabase auth operations.
// Keeps the supabase-js bundle out of the cold-start path — we only pull it in
// when a user actually triggers a password change (rare).
//
// Token read goes through the same secureStorage path api.ts uses, so we're
// not inventing a new auth scheme — we're calling supabase-js with the
// already-signed-in session.

import { secureStorage } from '../services/secureStorage';
import { env } from '../config/env';
import { errorMessage } from '../types/common';

const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;

export async function updateSupabasePassword(newPassword: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const [accessToken, refreshToken] = await Promise.all([
      secureStorage.getItem('supabase_token'),
      secureStorage.getItem('supabase_refresh_token'),
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
  } catch (err) {
    return { ok: false, message: errorMessage(err, 'Password update failed') };
  }
}
