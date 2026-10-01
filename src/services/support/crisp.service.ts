/**
 * crisp.service.ts — Crisp Chat SDK initialisation and identity sync.
 *
 * Wraps `crisp-sdk-react-native` to:
 *   1. Configure the SDK with the Crisp website ID from the environment.
 *   2. Bind the authenticated user's identity (email, display name, session data)
 *      so operators see each conversation attributed to the right account.
 *
 * Call `initCrisp()` once at app start (regardless of auth state) to configure
 * the SDK.  Call `syncCrispIdentity(user)` after authentication completes.
 *
 * Shared devices (#306 fix round 3, Opus C2): the native SDK keeps its chat
 * session (and its history) across app launches and across accounts until
 * `resetSession()` is called. So:
 *   - `resetCrispIdentity()` resets the session; `signOut` calls it.
 *   - `syncCrispIdentity(user)` resets first when the session belongs to
 *     someone else (or to nobody known), before binding the new identity.
 *   - `prepareSignedOutCrispSession()` runs before the pre-sign-in support
 *     screen opens the chat, so it never shows a previous user's conversation.
 *   - #306 r4 (Sol A1-R3 / A2-R3): ownership is the server user id, and every
 *     open goes through `openSupportChat()`, which fails closed: when a reset
 *     fails the chat is not shown.
 *
 * NOTE: `crisp-sdk-react-native` requires a development build (Expo Go is not
 * supported) because the SDK bundles native modules for iOS and Android.
 */

import {
  configure,
  setUserEmail,
  setUserNickname,
  setSessionString,
  resetSession,
  show,
} from 'crisp-sdk-react-native';
import { prefsStorage } from '../../storage/mmkv';

export interface CrispUser {
  /**
   * The authenticated server user id. It decides whether the chat session
   * already belongs to this user; without it the session is always reset
   * before binding.
   */
  userId?: string;
  email: string;
  displayName?: string;
  planTier?: string;
  role?: string;
  tenantId?: string;
}

function getWebsiteId(): string {
  return process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID ?? '';
}

let configured = false;

export function initCrisp(): void {
  if (configured) return;
  const websiteId = getWebsiteId();
  if (!websiteId) {
    if (__DEV__) {
      console.warn('[crisp.service] EXPO_PUBLIC_CRISP_WEBSITE_ID is not set.');
    }
    return;
  }
  configure(websiteId);
  configured = true;
}

// Which identity the native Crisp session currently belongs to (#306 r4,
// Sol A1-R3 / A2-R3):
//  - `uid:<server user id>` for a signed-in user. The authenticated server
//    user id is the discriminator, compared exactly; an email fingerprint
//    could collide (32-bit djb2: `a0@example.com` / `_r@example.com`).
//  - SIGNED_OUT for an anonymous session this process reset itself,
//  - null when unknown or dirty (cold start before a check, a reset that
//    failed, a user without a server id). Unknown always means "reset first".
// Mirrored to prefs only so the same user is not reset on every launch. The
// pre-sign-in screen never trusts a persisted value: only a reset that
// succeeded in this process makes a session safe to open signed out.
const BOUND_KEY = 'support.crisp_session_owner';
const SIGNED_OUT = 'signed-out';
let memOwner: string | null | undefined; // undefined = not read from prefs yet
let verifiedThisProcess = false;
// A user whose binding could not be completed because the reset failed;
// retried before the chat opens.
let pendingUser: CrispUser | null = null;

function ownerFor(user: CrispUser): string | null {
  const id = typeof user.userId === 'string' ? user.userId.trim() : '';
  return id ? `uid:${id}` : null;
}

function readOwner(): string | null {
  if (memOwner !== undefined) return memOwner;
  try {
    const v = prefsStorage.getString(BOUND_KEY) ?? null;
    // Only the server-id form is trusted from storage (round-3 builds stored
    // an email fingerprint; those are treated as unknown).
    memOwner = v && v.startsWith('uid:') ? v : null;
  } catch {
    memOwner = null;
  }
  return memOwner;
}

function writeOwner(owner: string | null, verified: boolean): void {
  memOwner = owner;
  verifiedThisProcess = verified && owner !== null;
  try {
    if (owner && owner !== SIGNED_OUT) void prefsStorage.set(BOUND_KEY, owner);
    else void prefsStorage.delete(BOUND_KEY);
  } catch {
    // Best effort: an unknown owner only causes an extra reset next time.
  }
}

/** True only when the native reset ran without throwing. */
function resetNativeSession(): boolean {
  try {
    resetSession();
    return true;
  } catch (err) {
    if (__DEV__) console.warn('[crisp.service] resetSession failed:', err);
    return false;
  }
}

/**
 * Bind the signed-in user to the chat session. Resets first unless the
 * session already belongs to this exact server user. If the reset fails the
 * user is NOT bound (the previous session must not be relabelled as theirs),
 * ownership stays unknown, and the binding is retried before the chat opens.
 * Returns whether the session is now this user's.
 */
export function syncCrispIdentity(user: CrispUser): boolean {
  if (!getWebsiteId()) return false;
  const owner = ownerFor(user);
  if (!owner || readOwner() !== owner) {
    // Mark dirty before touching the native session, so a crash or a failed
    // reset can never leave a stale "same user" mark behind.
    writeOwner(null, false);
    if (!resetNativeSession()) {
      pendingUser = user;
      return false;
    }
  }
  pendingUser = null;
  // A user without a server id is bound for attribution but stays
  // "unknown", so the next bind or open resets again.
  writeOwner(owner, true);
  setUserEmail(user.email);
  const displayName = user.displayName ?? user.email.split('@')[0] ?? '';
  if (displayName) {
    setUserNickname(displayName);
  }
  if (user.planTier) {
    setSessionString('planTier', user.planTier);
  }
  if (user.role) {
    setSessionString('role', user.role);
  }
  if (user.tenantId) {
    setSessionString('tenantId', user.tenantId);
  }
  return owner !== null;
}

/** Sign-out: end the chat session so the next person cannot open it. */
export function resetCrispIdentity(): void {
  pendingUser = null;
  writeOwner(null, false);
  if (!getWebsiteId()) return;
  // On failure ownership stays unknown, so every later open resets first.
  resetNativeSession();
}

/**
 * Before the support chat opens with nobody signed in. Keeps an anonymous
 * session only if this process reset it itself; resets anything else (a
 * previous user's session, one of unknown owner, a persisted claim). Returns
 * whether the session is safe to show.
 */
export function prepareSignedOutCrispSession(): boolean {
  if (!getWebsiteId()) return false;
  if (readOwner() === SIGNED_OUT && verifiedThisProcess) return true;
  writeOwner(null, false);
  if (!resetNativeSession()) return false;
  writeOwner(SIGNED_OUT, true);
  return true;
}

export type SupportChatOpenResult = 'opened' | 'blocked' | 'unavailable';

/**
 * The only way the support screen opens the chat (mount and the manual
 * button). Fail closed: `show()` runs only when the session is known to be
 * safe for the viewer.
 *  - Signed out: `prepareSignedOutCrispSession()` must succeed.
 *  - Signed in: the session must have been bound to a user in this process;
 *    a binding that failed is retried; with no binding at all the session is
 *    reset to a fresh anonymous one first.
 * 'blocked' means a reset failed and the chat stayed closed; the caller
 * offers a retry. 'unavailable' means Crisp is not configured or `show()`
 * threw (native module missing).
 */
export function openSupportChat(opts: { preSignIn: boolean }): SupportChatOpenResult {
  if (!getWebsiteId()) return 'unavailable';
  let safe: boolean;
  if (opts.preSignIn) {
    safe = prepareSignedOutCrispSession();
  } else if (pendingUser) {
    safe = syncCrispIdentity(pendingUser);
  } else {
    const owner = readOwner();
    safe =
      verifiedThisProcess && owner !== null && (owner === SIGNED_OUT || owner.startsWith('uid:'))
        ? true
        : prepareSignedOutCrispSession();
  }
  if (!safe) return 'blocked';
  try {
    show();
    return 'opened';
  } catch (err) {
    if (__DEV__) console.warn('[crisp.service] show() failed:', err);
    return 'unavailable';
  }
}

/** Test seam: forget the in-memory session state (simulates a cold start). */
export function __resetCrispOwnerForTests(): void {
  memOwner = undefined;
  verifiedThisProcess = false;
  pendingUser = null;
}
