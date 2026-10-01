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
 *   Request:  { token: string, full_name?: string, invite_code?: string }
 *             (see buildAppleAuthBody — only fields the live DTO whitelists)
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
import {
  COACH_SIGNUP_UNAVAILABLE,
  COACH_SIGNUP_UNCONFIRMED,
  classifyCoachSignupFailure,
  isCoachSignupUnavailable,
  postWithIntendedRole,
  type IntendedRole,
} from '../lib/intendedRole';

/**
 * Request body for POST /auth/apple.
 *
 * The live backend's AppleAuthDto is `{ token, full_name?: string,
 * invite_code?, raw_nonce? }` under a `forbidNonWhitelisted` ValidationPipe,
 * so ANY extra key (identity_token, authorization_code, email, an object
 * full_name) is rejected with 400 "property identity_token should not exist".
 * The backend fix (clinic/c02-apple-contract) accepts `token` OR
 * `identity_token` plus a string full_name, so this body — only whitelisted
 * fields, the JWT under `token`, and the name joined into one string — works
 * against both the current and the fixed server. Email is read from the
 * verified identity token server-side, so it is not sent.
 */
export function buildAppleAuthBody(input: {
  identityToken: string;
  givenName?: string | null;
  familyName?: string | null;
  inviteCode?: string;
}): { token: string; full_name?: string; invite_code?: string } {
  const body: { token: string; full_name?: string; invite_code?: string } = {
    token: input.identityToken,
  };
  const fullName = [input.givenName, input.familyName]
    .map((part) => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .slice(0, 200);
  if (fullName) body.full_name = fullName;
  if (input.inviteCode) body.invite_code = input.inviteCode;
  return body;
}

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
  /**
   * 'coach_signup_unavailable' (C13): the backend refused `intended_role`
   * before any handler ran, so no account was created. CreateAccount shows
   * plain copy and never falls back to a client account.
   * 'coach_signup_unconfirmed' (#306 r3): a coach request got no server
   * answer (network, timeout, 5xx); it may or may not have committed.
   */
  error_code?: typeof COACH_SIGNUP_UNAVAILABLE | typeof COACH_SIGNUP_UNCONFIRMED;
  // Invite-attach outcome (C03 contract). `invite_attached:false` means the
  // account exists but is not connected to the coach; callers route to the
  // enter-code retry step instead of continuing silently.
  invite_attached?: boolean;
  invite_attach_error?: string;
  /**
   * #306 r4: the email Apple shared on this sign-in (first authorisation
   * only), returned with `coach_signup_unconfirmed` so the unconfirmed-attempt
   * marker is scoped to this identity when Apple gives one.
   */
  provider_email?: string;
}

export interface AppleAuthOptions {
  // Forwarded to /auth/apple so a new (or existing) user can be attached to
  // the right coach during the upsert — matches the Google flow.
  inviteCode?: string;
  /**
   * Signup role choice (C13). Pass only when the live signup policy
   * advertises `role_choice`. Omitted from the request when an invite code
   * is present (always client).
   */
  intendedRole?: IntendedRole;
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
    const body = buildAppleAuthBody({
      identityToken: credential.identityToken,
      givenName: credential.fullName?.givenName,
      familyName: credential.fullName?.familyName,
      inviteCode: options.inviteCode,
    });

    // POST the identity token to /auth/apple. The backend verifies the JWT
    // against Apple's JWKS, upserts the user, and returns a Supabase session.
    // With an invite code the user is always a client, so `intended_role`
    // is omitted (server default). A coach request is never retried without
    // the field; that failure is returned as `error_code`.
    const response = await postWithIntendedRole(
      (b) => api.post('/auth/apple', b),
      body,
      options.inviteCode ? undefined : options.intendedRole,
    );
    const { access_token, refresh_token, user, is_new_user, invite_attached, invite_attach_error } =
      response.data ?? {};

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
      ...(typeof invite_attached === 'boolean' ? { invite_attached } : {}),
      ...(typeof invite_attach_error === 'string' ? { invite_attach_error } : {}),
    };
  } catch (err) {
    if (isCoachSignupUnavailable(err)) {
      return { success: false, error: 'Coach sign-up is not available right now', error_code: COACH_SIGNUP_UNAVAILABLE };
    }
    if (options.intendedRole === 'coach' && !options.inviteCode && classifyCoachSignupFailure(err) === 'unconfirmed') {
      // #306 r3: same rule as Google. A coach request with no server answer
      // (network, timeout, 5xx) may have committed; the outcome is unknown,
      // never reported as a refusal or a generic failure.
      return {
        success: false,
        error: 'Could not confirm the coach account',
        error_code: COACH_SIGNUP_UNCONFIRMED,
        ...(typeof credential.email === 'string' && credential.email ? { provider_email: credential.email } : {}),
      };
    }
    const apiErr = err as { response?: { data?: { message?: string } }; message?: string };
    const msg =
      apiErr?.response?.data?.message ||
      apiErr?.message ||
      'Apple sign-in failed';
    return { success: false, error: msg };
  }
}
