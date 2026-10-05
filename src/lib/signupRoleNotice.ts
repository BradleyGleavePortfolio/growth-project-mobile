/**
 * Plain notices about what happened to a signup role request (C13).
 *
 * These are facts the user must see once, on the next screen, even if the
 * route params that first carried them are gone (RootNavigator remounts the
 * auth stack after `authEvents.emit()`, and a cold start lands on Welcome).
 * So the kind is persisted in AsyncStorage as well as passed as a param;
 * RoleSelection reads both and clears the stored one once the role step is
 * complete.
 *
 * Copy follows docs/QUIET_LUXURY_DOCTRINE.md: plain statements, no
 * exclamation marks, no celebration.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

export const SIGNUP_ROLE_NOTICE_KEY = 'signup_role_notice';

export type SignupRoleNoticeKind =
  /** The user chose coach, the server created the account, but as a client. */
  | 'coach_request_not_applied'
  /** The user chose a role, but the Apple ID / Google account already had an account, so they were signed in. */
  | 'existing_account'
  /**
   * A retry after an unconfirmed coach attempt found an existing non-coach
   * account. It may be the account the lost attempt created, so "already had
   * an account" is not claimed (#306 fix round 3, Opus C4).
   */
  | 'coach_retry_not_applied'
  /** Sign in with Apple / Google on the Login screen had no matching account and created a new client account. */
  | 'new_account_from_sign_in';

const KINDS: readonly SignupRoleNoticeKind[] = [
  'coach_request_not_applied',
  'existing_account',
  'coach_retry_not_applied',
  'new_account_from_sign_in',
];

export function isSignupRoleNoticeKind(v: unknown): v is SignupRoleNoticeKind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v);
}

/** Notices that ask the user to contact support; the screen must offer a way there. */
export function signupRoleNoticeNeedsSupport(kind: SignupRoleNoticeKind): boolean {
  return kind === 'coach_request_not_applied' || kind === 'coach_retry_not_applied';
}

export function signupRoleNoticeMessage(kind: SignupRoleNoticeKind): string {
  switch (kind) {
    case 'coach_request_not_applied':
      return 'Coach sign-up was not applied to this account, so it was created as a client account. You can continue as a client. To run your practice here, contact support and we will set up coach access. Use Contact support below, or Support in Settings at any time.';
    case 'existing_account':
      return 'This Apple Account or Google account already had an account, so you were signed in to it. The role choice applies only to new accounts.';
    case 'coach_retry_not_applied':
      return 'Coach sign-up was not applied to this account, so you are signed in to a client account. Your earlier attempt may have created it. To run your practice here, contact support and we will set up coach access. Use Contact support below, or Support in Settings at any time.';
    case 'new_account_from_sign_in':
      return 'There was no account for this sign-in, so a new client account was created. If you meant to sign in to an existing account, sign out and use the email you registered with.';
  }
}

export async function setSignupRoleNotice(kind: SignupRoleNoticeKind): Promise<void> {
  try {
    await AsyncStorage.setItem(SIGNUP_ROLE_NOTICE_KEY, kind);
  } catch {
    // Best effort; the route param still carries it for this session.
  }
}

export async function readSignupRoleNotice(): Promise<SignupRoleNoticeKind | null> {
  try {
    const v = await AsyncStorage.getItem(SIGNUP_ROLE_NOTICE_KEY);
    return isSignupRoleNoticeKind(v) ? v : null;
  } catch {
    return null;
  }
}

export async function clearSignupRoleNotice(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SIGNUP_ROLE_NOTICE_KEY);
  } catch {
    // ignore
  }
}
