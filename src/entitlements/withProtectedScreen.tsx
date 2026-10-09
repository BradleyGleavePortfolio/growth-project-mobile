/**
 * withProtectedScreen — HOC that wraps a screen component so the underlying
 * screen renders only when the signed-in student has an active entitlement.
 *
 * Use this on screen registrations for paid surfaces in `ClientNavigator`
 * and `CoachNavigator`. Do NOT wrap auth, onboarding, billing, paywall,
 * profile/settings, or any screen the user must reach to *acquire* an
 * entitlement — wrapping those would create a lock-out loop where the
 * paywall sends the user to a destination that itself shows the paywall.
 *
 * Rule 22 (entitlement RBAC) + Rule 24 (no dead code): pairs with the
 * server-side `ClientEntitlementGuard`. The client gate adds defense in
 * depth and shaves the network round-trip for known-unentitled users; the
 * server remains canonical.
 */
import React from 'react';
import { ProtectedScreen } from './ProtectedScreen';
import { DunningOwnScreen } from './dunning/DunningOwnScreen';

export interface ProtectedScreenOptions {
  /**
   * B22/B24: the screen only calls server routes marked
   * @OpenToCoachlessClient(), so a client with no coach is never gated.
   * These are also the client's own logging, which stays open under the
   * payment lockout (DunningOwnScreen, owner ruling 2026-10-08 23:5x).
   */
  openToCoachless?: boolean;
}

export function withProtectedScreen<P extends object>(
  Component: React.ComponentType<P>,
  options: ProtectedScreenOptions = {},
): React.ComponentType<P> {
  const displayName = Component.displayName || Component.name || 'Component';
  const Wrapped: React.FC<P> = (props) => (
    <ProtectedScreen openToCoachless={options.openToCoachless}>
      {options.openToCoachless ? (
        <DunningOwnScreen surface={displayName}>
          <Component {...props} />
        </DunningOwnScreen>
      ) : (
        <Component {...props} />
      )}
    </ProtectedScreen>
  );
  Wrapped.displayName = `withProtectedScreen(${displayName})`;
  return Wrapped;
}

export default withProtectedScreen;
