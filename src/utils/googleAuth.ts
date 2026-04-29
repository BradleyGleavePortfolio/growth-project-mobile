/**
 * Google OAuth via Supabase + expo-auth-session.
 *
 * Flow:
 * 1. Open Google's consent screen in a web browser
 * 2. User picks their Google account
 * 3. Google redirects back to Supabase with an auth code
 * 4. Supabase exchanges the code for a session
 * 5. We get the access_token and user data
 */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { secureStorage } from '../services/secureStorage';
import { env } from '../config/env';
import { errorMessage } from '../types/common';

// Ensure the browser session is completed when returning to the app
WebBrowser.maybeCompleteAuthSession();

// Security: Supabase URL + anon key are now read from env (see config/env.ts)
// instead of being duplicated here and in services/api.ts.
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;

export interface GoogleAuthResult {
  success: boolean;
  access_token?: string;
  user?: {
    id: string;
    email: string;
    name: string;
    role?: string;
    coach_id?: string;
  };
  is_new_user?: boolean;
  error?: string;
}

export interface GoogleAuthOptions {
  // When set, the invite code is forwarded to /auth/google so the backend can
  // attach the new (or existing) user to the right coach during the upsert.
  inviteCode?: string;
}

export async function signInWithGoogle(
  options: GoogleAuthOptions = {},
): Promise<GoogleAuthResult> {
  try {
    // Build the redirect URI that Expo will use to return to our app
    const redirectUri = AuthSession.makeRedirectUri({
      scheme: 'tgp',
      path: 'auth/callback',
    });

    // Construct Supabase OAuth URL
    const supabaseAuthUrl =
      `${SUPABASE_URL}/auth/v1/authorize?provider=google` +
      `&redirect_to=${encodeURIComponent(redirectUri)}`;

    // Open the browser for Google sign-in
    const result = await WebBrowser.openAuthSessionAsync(
      supabaseAuthUrl,
      redirectUri,
    );

    if (result.type !== 'success' || !result.url) {
      return { success: false, error: 'Sign-in was cancelled' };
    }

    // Parse the tokens from the redirect URL.
    // Supabase redirects with: #access_token=xxx&refresh_token=xxx&...
    // On error Supabase redirects with: #error=access_denied&error_description=...
    // — we must surface those instead of silently showing "No access token received".
    const url = result.url;
    const hashFragment = url.split('#')[1];
    const queryFragment = url.split('?')[1]?.split('#')[0];

    // Check BOTH the hash fragment and the query string for error params — some
    // OAuth return paths put errors in the query, not the hash.
    const tryParseError = (frag: string | undefined) => {
      if (!frag) return null;
      const params = new URLSearchParams(frag);
      const err = params.get('error');
      if (!err) return null;
      const desc = params.get('error_description');
      return desc ? `${err}: ${decodeURIComponent(desc.replace(/\+/g, ' '))}` : err;
    };
    const errMsg = tryParseError(hashFragment) || tryParseError(queryFragment);
    if (errMsg) {
      return { success: false, error: errMsg };
    }

    if (!hashFragment) {
      return { success: false, error: 'No auth data received' };
    }

    const params = new URLSearchParams(hashFragment);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');

    if (!accessToken) {
      return { success: false, error: 'No access token received' };
    }

    // Use the tokens to get the user from Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const { data: sessionData, error: sessionError } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken || '',
    });

    if (sessionError || !sessionData.user) {
      return { success: false, error: sessionError?.message || 'Failed to set session' };
    }

    const supaUser = sessionData.user;

    // Now call our backend to upsert the user in our DB
    const { authApi } = await import('../services/api');

    // Store the token in SecureStore (not AsyncStorage) so the API client can
    // attach it to the backend request. Security: SecureStore uses Keychain /
    // Keystore, not the plain SQLite/plist that AsyncStorage uses.
    await secureStorage.setItem('supabase_token', accessToken);
    if (refreshToken) {
      await secureStorage.setItem('supabase_refresh_token', refreshToken);
    }

    try {
      const response = await authApi.googleAuth(accessToken, options.inviteCode);
      const { user } = response.data;

      // Defensive second pass: if the backend doesn't yet support the
      // invite_code arg on /auth/google but exposes the dedicated attach
      // endpoint, forward the code there. Failure is non-fatal — sign-in
      // already succeeded; the user can re-enter the code on RoleSelection.
      if (options.inviteCode && !user?.coach_id) {
        try {
          await authApi.attachInviteCode(options.inviteCode);
        } catch {
          // ignore — non-fatal
        }
      }

      await AsyncStorage.setItem('user_data', JSON.stringify(user));

      return {
        success: true,
        access_token: accessToken,
        user,
        is_new_user: response.data.is_new_user,
      };
    } catch {
      // Backend call failed — but we still have Supabase auth
      // Store basic user data from Supabase directly
      const basicUser = {
        id: supaUser.id,
        email: supaUser.email || '',
        name: supaUser.user_metadata?.full_name || supaUser.email || '',
      };
      await AsyncStorage.setItem('user_data', JSON.stringify(basicUser));

      return {
        success: true,
        access_token: accessToken,
        user: basicUser,
        is_new_user: true,
      };
    }
  } catch (err) {
    return { success: false, error: errorMessage(err) || 'Google sign-in failed' };
  }
}
