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
} from 'crisp-sdk-react-native';
import { prefsStorage } from '../../storage/mmkv';

export interface CrispUser {
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

// Which identity the native Crisp session currently belongs to:
//  - a fingerprint of the signed-in email (never the email itself),
//  - SIGNED_OUT for a session started on the pre-sign-in support screen,
//  - null when unknown (cold start, or sessions created before this fix).
// Kept in memory and mirrored to prefs so the same user is not reset on every
// launch. sign-out wipes prefs and resets the session.
const BOUND_KEY = 'support.crisp_session_owner';
const SIGNED_OUT = 'signed-out';
let boundOwner: string | null = null;

function fingerprint(email: string): string {
  // djb2; only used to tell "same person" from "someone else" on this device.
  const e = email.trim().toLowerCase();
  let h = 5381;
  for (let i = 0; i < e.length; i++) h = ((h << 5) + h + e.charCodeAt(i)) | 0;
  return `u${(h >>> 0).toString(36)}`;
}

function readOwner(): string | null {
  if (boundOwner) return boundOwner;
  try {
    return prefsStorage.getString(BOUND_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeOwner(owner: string | null): void {
  boundOwner = owner;
  try {
    if (owner) void prefsStorage.set(BOUND_KEY, owner);
    else void prefsStorage.delete(BOUND_KEY);
  } catch {
    // Best effort: an unknown owner only causes an extra reset next time.
  }
}

function resetNativeSession(): void {
  try {
    resetSession();
  } catch (err) {
    if (__DEV__) console.warn('[crisp.service] resetSession failed:', err);
  }
}

export function syncCrispIdentity(user: CrispUser): void {
  if (!getWebsiteId()) return;
  // Before binding, drop a session that belongs to anyone else, including
  // an anonymous pre-sign-in session and one whose owner is unknown.
  const owner = user.email ? fingerprint(user.email) : null;
  if (!owner || readOwner() !== owner) resetNativeSession();
  writeOwner(owner);
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
}

/** Sign-out: end the chat session so the next person cannot open it. */
export function resetCrispIdentity(): void {
  writeOwner(null);
  if (!getWebsiteId()) return;
  resetNativeSession();
}

/**
 * Before the support chat opens with nobody signed in: keep an anonymous
 * session this device already started signed out, reset anything else (a
 * previous user's session, or one of unknown owner).
 */
export function prepareSignedOutCrispSession(): void {
  if (!getWebsiteId()) return;
  if (readOwner() === SIGNED_OUT) return;
  resetNativeSession();
  writeOwner(SIGNED_OUT);
}

/** Test seam: forget the in-memory session owner. */
export function __resetCrispOwnerForTests(): void {
  boundOwner = null;
}
