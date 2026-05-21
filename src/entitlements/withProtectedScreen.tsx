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

export function withProtectedScreen<P extends object>(
  Component: React.ComponentType<P>,
): React.ComponentType<P> {
  const Wrapped: React.FC<P> = (props) => (
    <ProtectedScreen>
      <Component {...props} />
    </ProtectedScreen>
  );
  const displayName = Component.displayName || Component.name || 'Component';
  Wrapped.displayName = `withProtectedScreen(${displayName})`;
  return Wrapped;
}

export default withProtectedScreen;
