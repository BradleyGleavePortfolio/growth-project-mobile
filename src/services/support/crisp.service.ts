/**
 * crisp.service.ts — Crisp Chat SDK initialisation and identity sync.
 *
 * Wraps `crisp-sdk-react-native` to:
 *   1. Configure the SDK with the Crisp website ID from the environment.
 *   2. Bind the authenticated user's identity (email, display name, session data)
 *      so operators see each conversation attributed to the right account.
 *
 * Call `initCrisp()` once at app start (regardless of auth state) to configure
 * the SDK.  Call `syncCrispIdentity(user)` after authentication completes —
 * RootNavigator's bootstrapAuth() is the canonical call-site.
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

/** Shape of the user passed into identity sync. */
export interface CrispUser {
  email: string;
  displayName?: string;
  planTier?: string;
  role?: string;
  tenantId?: string;
}

const CRISP_WEBSITE_ID = process.env.EXPO_PUBLIC_CRISP_WEBSITE_ID ?? '';

let configured = false;

/**
 * Configure the Crisp SDK once at app start.
 *
 * Guards against double-init because `configure()` resets the session each
 * time it is called — safe to call idempotently via the guard below.
 */
export function initCrisp(): void {
  if (configured) return;
  if (!CRISP_WEBSITE_ID) {
    // Fail loudly in development; silently skip in test/CI where the var is absent.
    if (__DEV__) {
      console.warn(
        '[crisp.service] EXPO_PUBLIC_CRISP_WEBSITE_ID is not set. ' +
          'Add it to your .env file to enable the support inbox.',
      );
    }
    return;
  }
  configure(CRISP_WEBSITE_ID);
  configured = true;
}

/**
 * Sync the authenticated user's identity into the active Crisp session.
 *
 * Call once on login so the operator sees the user's email, name, plan tier,
 * role, and tenant ID in the Crisp dashboard.
 *
 * @param user - The current authenticated user.
 */
export function syncCrispIdentity(user: CrispUser): void {
  if (!CRISP_WEBSITE_ID) return;

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

/**
 * Reset Crisp identity on sign-out.
 *
 * Currently a no-op because the SDK handles session reset when `configure()`
 * is called again; exposed here so callers have a clean contract.
 */
export function resetCrispIdentity(): void {
  // Session is scoped to the SDK configuration. When the app restarts after
  // sign-out and a new user logs in, `syncCrispIdentity` overwrites all keys.
}
