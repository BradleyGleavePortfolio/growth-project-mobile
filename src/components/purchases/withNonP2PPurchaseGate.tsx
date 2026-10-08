/**
 * HOC for routes that sell something other than a 1:1 person-to-person
 * service (coach AI credit packs). When the store build hides those purchases
 * the route renders NonP2PPurchaseHidden, so a push tap (ai-budget push
 * targets CreditPackCheckout) or a stale navigate() can never reach checkout.
 * `isHidden` defaults to digitalPurchasesHidden; the credit-pack route passes
 * creditPacksHidden so a US-link build reaches its system-browser checkout.
 */
import React from 'react';
import { digitalPurchasesHidden } from '../../config/purchaseSurfaces';
import NonP2PPurchaseHidden from './NonP2PPurchaseHidden';

export function withNonP2PPurchaseGate<P extends object>(
  Component: React.ComponentType<P>,
  isHidden: () => boolean = digitalPurchasesHidden,
): React.ComponentType<P> {
  const Wrapped: React.FC<P> = (props) =>
    isHidden() ? <NonP2PPurchaseHidden /> : <Component {...props} />;
  Wrapped.displayName = `withNonP2PPurchaseGate(${Component.displayName || Component.name || 'Component'})`;
  return Wrapped;
}

export default withNonP2PPurchaseGate;
