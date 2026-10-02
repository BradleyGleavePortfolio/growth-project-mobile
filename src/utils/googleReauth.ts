/**
 * Google re-authentication for sensitive actions (account deletion).
 *
 * The app signs Google accounts in through Supabase's Google OAuth flow and
 * ships no Google client id, so it cannot get a Google-issued ID token.
 * Instead it runs the same Supabase Google OAuth flow again and returns the
 * access token of that brand-new session as the proof
 * `{ provider: 'google_session', provider_token }`. The backend accepts it
 * only if the token belongs to the signed-in account and its `amr` records a
 * Google sign-in within the re-auth window, so the app's existing session
 * cannot be replayed.
 *
 * Nothing is stored: the current app session is left unchanged.
 * Works for existing Google accounts even while Google sign-up is off.
 */
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { env } from '../config/env';
import { errorMessage } from '../types/common';

export interface GoogleReauthResult {
  success: boolean;
  /** Access token of the fresh Supabase session (provider=google_session). */
  accessToken?: string;
  cancelled?: boolean;
  error?: string;
}

/** Parse a Supabase OAuth redirect: tokens in the hash, errors in hash or query. */
export function parseOAuthRedirect(url: string): { accessToken?: string; error?: string } {
  const hash = url.split('#')[1];
  const query = url.split('?')[1]?.split('#')[0];
  for (const fragment of [hash, query]) {
    if (!fragment) continue;
    const params = new URLSearchParams(fragment);
    const err = params.get('error');
    if (err) {
      const desc = params.get('error_description');
      return { error: desc ? `${err}: ${desc.replace(/\+/g, ' ')}` : err };
    }
  }
  const accessToken = hash ? new URLSearchParams(hash).get('access_token') : null;
  return accessToken ? { accessToken } : { error: 'No access token received' };
}

export async function reauthenticateWithGoogle(): Promise<GoogleReauthResult> {
  try {
    const redirectUri = AuthSession.makeRedirectUri({ scheme: 'tgp', path: 'auth/callback' });
    // prompt=select_account makes Google show the account chooser instead of
    // silently reusing a browser session, so the person actively confirms.
    const authorizeUrl =
      `${env.SUPABASE_URL}/auth/v1/authorize?provider=google` +
      `&redirect_to=${encodeURIComponent(redirectUri)}` +
      `&prompt=select_account`;
    const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, redirectUri);
    if (result.type === 'cancel' || result.type === 'dismiss') {
      return { success: false, cancelled: true };
    }
    if (result.type !== 'success' || !result.url) {
      return { success: false, error: 'Google sign-in did not finish' };
    }
    const parsed = parseOAuthRedirect(result.url);
    if (!parsed.accessToken) return { success: false, error: parsed.error };
    return { success: true, accessToken: parsed.accessToken };
  } catch (err) {
    return { success: false, error: errorMessage(err) || 'Google sign-in failed' };
  }
}
