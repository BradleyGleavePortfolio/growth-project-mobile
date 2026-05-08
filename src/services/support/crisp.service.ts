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
 * NOTE: `crisp-sdk-react-native` requires a development build (Expo Go is not
 * supported) because the SDK bundles native modules for iOS and Android.
 */

import {
  configure,
  setUserEmail,
  setUserNickname,
  setSessionString,
} from 'crisp-sdk-react-native';

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

export function syncCrispIdentity(user: CrispUser): void {
  if (!getWebsiteId()) return;
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

export function resetCrispIdentity(): void {
  // No-op: identity is overwritten on next syncCrispIdentity call.
}
