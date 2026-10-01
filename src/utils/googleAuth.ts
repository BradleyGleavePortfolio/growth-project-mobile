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
// Static import (appleAuth does the same; services/api does not import this
// module, so there is no cycle). A dynamic import() cannot run in Jest, which
// left the backend-failure branches below untested (#306 fix round 2).
import { authApi } from '../services/api';
import { env } from '../config/env';
import { errorMessage } from '../types/common';
import {
  COACH_SIGNUP_UNAVAILABLE,
  COACH_SIGNUP_UNCONFIRMED,
  isCoachSignupUnavailable,
  type IntendedRole,
} from '../lib/intendedRole';

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
  /**
   * 'coach_signup_unavailable' (C13): the backend refused `intended_role`
   * before any handler ran, so no account row was created. Not a success;
   * the Supabase session is dropped so the next attempt starts clean.
   */
  error_code?: typeof COACH_SIGNUP_UNAVAILABLE | typeof COACH_SIGNUP_UNCONFIRMED;
  /**
   * True only when the backend answered /auth/google and `user` /
   * `is_new_user` come from that answer. False on the legacy fallback where
   * the backend call failed and `user` is a basic Supabase identity: in that
   * case nothing is known about whether an account row exists or its role,
   * so callers must not tell the user an account was created.
   */
  server_confirmed?: boolean;
  /**
   * Set when the caller passed an invite code and the backend did not
   * attach it (no `coach_id` on the returned user, dedicated attach call
   * failed too). The code is returned so the caller can carry it to the
   * RoleSelection retry step instead of dropping it.
   */
  invite_attached?: boolean;
  invite_code?: string;
}

export interface GoogleAuthOptions {
  // When set, the invite code is forwarded to /auth/google so the backend can
  // attach the new (or existing) user to the right coach during the upsert.
  inviteCode?: string;
  /**
   * Signup role choice (C13). Pass only when the live signup policy
   * advertises `role_choice`. Omitted from the request when an invite code
   * is present (always client).
   */
  intendedRole?: IntendedRole;
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

    // Store the token in SecureStore (not AsyncStorage) so the API client can
    // attach it to the backend request. Security: SecureStore uses Keychain /
    // Keystore, not the plain SQLite/plist that AsyncStorage uses.
    await secureStorage.setItem('supabase_token', accessToken);
    if (refreshToken) {
      await secureStorage.setItem('supabase_refresh_token', refreshToken);
    }

    try {
      const response = await authApi.googleAuth(accessToken, options.inviteCode, options.intendedRole);
      const { user } = response.data;

      // Defensive second pass: if the backend doesn't yet support the
      // invite_code arg on /auth/google but exposes the dedicated attach
      // endpoint, forward the code there. Failure is non-fatal — sign-in
      // already succeeded; the user can re-enter the code on RoleSelection.
      let inviteAttached: boolean | undefined;
      if (options.inviteCode) {
        inviteAttached = !!user?.coach_id;
        if (!inviteAttached) {
          try {
            const attach = await authApi.attachInviteCode(options.inviteCode);
            const coachId = (attach?.data as { coach_id?: unknown } | undefined)?.coach_id;
            if (typeof coachId === 'string' && user) user.coach_id = coachId;
            inviteAttached = typeof coachId === 'string';
          } catch {
            inviteAttached = false;
          }
        }
      }

      await AsyncStorage.setItem('user_data', JSON.stringify(user));

      return {
        success: true,
        access_token: accessToken,
        user,
        is_new_user: response.data.is_new_user,
        server_confirmed: true,
        ...(typeof inviteAttached === 'boolean'
          ? { invite_attached: inviteAttached, invite_code: options.inviteCode }
          : {}),
      };
    } catch (backendErr) {
      if (isCoachSignupUnavailable(backendErr)) {
        // C13: the coach request was refused before any handler ran. Do not
        // present this as a signed-in client; drop the provider session.
        await secureStorage.removeItem('supabase_token').catch(() => undefined);
        await secureStorage.removeItem('supabase_refresh_token').catch(() => undefined);
        return {
          success: false,
          error: 'Coach sign-up is not available right now',
          error_code: COACH_SIGNUP_UNAVAILABLE,
        };
      }
      if (options.intendedRole === 'coach') {
        // #306 r2 (B1): a coach request whose backend call failed (5xx,
        // network, timeout, or any other error) has no server answer, so
        // neither the account nor its role is known. The server may even
        // have committed before the response was lost. Never fall through to
        // the legacy "signed-in basic user" result below: that was reported
        // as a client account being created. Drop the provisional provider
        // session and local user cache, and return a truthful failure. A
        // retry with the same Google account is safe: if the server did
        // create the account, /auth/google answers with it and its role.
        await secureStorage.removeItem('supabase_token').catch(() => undefined);
        await secureStorage.removeItem('supabase_refresh_token').catch(() => undefined);
        await AsyncStorage.removeItem('user_data').catch(() => undefined);
        return {
          success: false,
          error: 'Could not confirm the coach account',
          error_code: COACH_SIGNUP_UNCONFIRMED,
        };
      }
      // Backend call failed — but we still have Supabase auth
      // Store basic user data from Supabase directly. Pre-existing fallback
      // for sign-in and client signup; `server_confirmed: false` tells the
      // caller this is not a server answer.
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
        server_confirmed: false,
        ...(options.inviteCode ? { invite_attached: false, invite_code: options.inviteCode } : {}),
      };
    }
  } catch (err) {
    return { success: false, error: errorMessage(err) || 'Google sign-in failed' };
  }
}
