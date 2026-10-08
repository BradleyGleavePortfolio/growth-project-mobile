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

const SIGN_IN_AGAIN = 'Your sign-in has expired. Sign out, sign in again, then change your password.';

/**
 * Plain words for a refused password change, read from the Supabase error
 * code and status (never the provider's raw text). Used by client and coach
 * Settings.
 */
export function passwordChangeFailureCopy(error: { code?: string; status?: number; message?: string }): string {
  const code = error.code ?? '';
  const text = `${code} ${error.message ?? ''}`.toLowerCase();
  if (code === 'same_password' || text.includes('different from the old')) {
    return 'Choose a password different from your current one.';
  }
  if (code === 'weak_password' || text.includes('weak')) {
    return 'Choose a stronger password: at least 8 characters, with an uppercase letter, a number and a special character.';
  }
  if (code === 'reauthentication_needed' || text.includes('reauthenticat')) {
    return 'For your security, sign out, sign in again, then change your password.';
  }
  if (error.status === 429 || code === 'over_request_rate_limit' || text.includes('rate limit')) {
    return 'Too many attempts. Wait a few minutes, then try again.';
  }
  if (error.status === 401 || error.status === 403 || /session|jwt|token|not authenticated/.test(text)) {
    return SIGN_IN_AGAIN;
  }
  if (/network|fetch|timeout|offline/.test(text)) {
    return 'The app could not reach the server, so your password was not changed. Check your connection, then try again.';
  }
  return 'Your password was not changed. Try again in a moment.';
}

export async function updateSupabasePassword(newPassword: string): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const [accessToken, refreshToken] = await Promise.all([
      secureStorage.getItem('supabase_token'),
      secureStorage.getItem('supabase_refresh_token'),
    ]);
    if (!accessToken) {
      return { ok: false, message: SIGN_IN_AGAIN };
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
      return { ok: false, message: passwordChangeFailureCopy(error) };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, message: passwordChangeFailureCopy({ message: errorMessage(err, '') }) };
  }
}
