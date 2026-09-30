/**
 * withPurchaseSurfaceGate — HOC for client purchase screens (package list,
 * package checkout, branded checkout web view). When client purchase
 * surfaces are hidden (iOS v1, App Review 3.1) the screen body is replaced
 * by the neutral "Ask your coach for an invite code" state, so a stale deep
 * link (`/p/<token>`) or an old navigate() call can never reach checkout.
 */
import React from 'react';
import { clientPurchasesHidden } from '../config/purchaseSurfaces';
import { useEntitlement } from './EntitlementProvider';
import NeutralAccessState from './NeutralAccessState';

function NeutralGate() {
  const { refreshEntitlement } = useEntitlement();
  return <NeutralAccessState onAttached={refreshEntitlement} testID="purchase-surface-hidden" />;
}

export function withPurchaseSurfaceGate<P extends object>(
  Component: React.ComponentType<P>,
): React.ComponentType<P> {
  const Wrapped: React.FC<P> = (props) =>
    clientPurchasesHidden() ? <NeutralGate /> : <Component {...props} />;
  Wrapped.displayName = `withPurchaseSurfaceGate(${Component.displayName || Component.name || 'Component'})`;
  return Wrapped;
}

export default withPurchaseSurfaceGate;
