/**
 * Apple Sign-In via expo-apple-authentication.
 *
 * App Store policy: any iOS app that offers third-party sign-in (Google in
 * our case) MUST also offer Sign in with Apple. This module mirrors the shape
 * of utils/googleAuth.ts so the call sites in LoginScreen / CreateAccount
 * stay symmetrical.
 *
 * Flow:
 *   1. AppleAuthentication.signInAsync() — native iOS sheet, returns an
 *      identity token signed by Apple.
 *   2. POST the identity token to the backend at /auth/apple, which verifies
 *      the JWT against Apple's JWKS and returns our session JWTs (same shape
 *      as /auth/google).
 *   3. Persist the session tokens through secureStorage (Keychain/Keystore),
 *      same as the Google flow.
 *
 * Backend endpoint required: POST /auth/apple
 *   Request:  { identity_token: string, authorization_code?: string,
 *               full_name?: { given_name?: string; family_name?: string },
 *               email?: string, invite_code?: string }
 *   Response: { access_token, refresh_token, user, is_new_user }
 *
 * If the backend endpoint is not yet deployed, the call below fails through
 * to the existing toFriendlyAuthError pipeline; the user sees a clean
 * "Apple sign-in is temporarily unavailable" message and the operator gets
 * the raw 404 in Sentry. See the PR description for the backend punch-list.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as AppleAuthentication from 'expo-apple-authentication';
import api from '../services/api';
import { secureStorage } from '../services/secureStorage';

export interface AppleAuthResult {
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
  // True when the user dismissed the native sheet — call sites should stay
  // silent (no error banner) on this case to match the Google flow.
  cancelled?: boolean;
  error?: string;
}

export interface AppleAuthOptions {
  // Forwarded to /auth/apple so a new (or existing) user can be attached to
  // the right coach during the upsert — matches the Google flow.
  inviteCode?: string;
}

// Apple-specific cancel error code surfaced by expo-apple-authentication.
// See https://docs.expo.dev/versions/latest/sdk/apple-authentication/
const APPLE_CANCEL_CODE = 'ERR_REQUEST_CANCELED';

export async function isAppleAuthAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

export async function signInWithApple(
  options: AppleAuthOptions = {},
): Promise<AppleAuthResult> {
  if (Platform.OS !== 'ios') {
    return { success: false, error: 'Apple sign-in is only available on iOS' };
  }

  let credential: AppleAuthentication.AppleAuthenticationCredential | undefined;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
  } catch (err) {
    const authErr = err as { code?: string; message?: string };
    if (authErr?.code === APPLE_CANCEL_CODE) {
      return { success: false, cancelled: true };
    }
    return { success: false, error: authErr?.message || 'Apple sign-in failed' };
  }

  if (!credential?.identityToken) {
    return { success: false, error: 'No identity token returned from Apple' };
  }

  // Forward the identity token to the backend for verification + session mint.
  // The fullName fields are ONLY populated on the very first sign-in; the
  // backend must persist them on first contact and never expect them again.
  try {
    const body: Record<string, string | undefined | { given_name?: string; family_name?: string }> = {
      identity_token: credential.identityToken,
      authorization_code: credential.authorizationCode ?? undefined,
    };
    if (credential.email) body.email = credential.email;
    if (credential.fullName) {
      body.full_name = {
        given_name: credential.fullName.givenName ?? undefined,
        family_name: credential.fullName.familyName ?? undefined,
      };
    }
    if (options.inviteCode) body.invite_code = options.inviteCode;

    // POST the identity token to /auth/apple. The backend verifies the JWT
    // against Apple's JWKS, upserts the user, and returns a Supabase session.
    const response = await api.post('/auth/apple', body);
    const { access_token, refresh_token, user, is_new_user } = response.data;

    if (access_token) {
      await secureStorage.setItem('supabase_token', access_token);
    }
    if (refresh_token) {
      await secureStorage.setItem('supabase_refresh_token', refresh_token);
    }
    if (user) {
      await AsyncStorage.setItem('user_data', JSON.stringify(user));
    }

    return {
      success: true,
      access_token,
      user,
      is_new_user,
    };
  } catch (err) {
    const apiErr = err as { response?: { data?: { message?: string } }; message?: string };
    const msg =
      apiErr?.response?.data?.message ||
      apiErr?.message ||
      'Apple sign-in failed';
    return { success: false, error: msg };
  }
}
