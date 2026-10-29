/**
 * STORE-1TO1 (owner #183-S1): every package includes 1:1 coaching with the coach who sells it, and
 * the server refuses to publish or sell one whose coach cannot give it. The buyer pages list
 * oneToOneCoachingLabel() (config/purchaseSurfaces) first under "What's included"; the coach's
 * package forms say this line. Kept out of config/purchaseSurfaces.ts, whose bytes are pinned by
 * the purchase-policy lock (scripts/purchase-policy.sha256).
 */
export const EVERY_PACKAGE_INCLUDES_COACHING = 'Every package includes 1:1 coaching with you.';
