/**
 * STORE-1TO1 (owner #183-S1): every package includes 1:1 coaching with the coach who sells it, and
 * the server refuses to publish or sell one whose coach cannot give it. The buyer pages list
 * oneToOneCoachingLabel() (config/purchaseSurfaces) first under "What's included"; the coach's
 * package forms say this line. Kept out of config/purchaseSurfaces.ts, whose bytes are pinned by
 * the purchase-policy lock (scripts/purchase-policy.sha256).
 */
export const EVERY_PACKAGE_INCLUDES_COACHING = 'Every package includes 1:1 coaching with you.';

/** U-5 (approved): the buyer pages' retry line while the coach's name or plans could not load
 *  (ClientPackagesScreen plan cards). The plan sheet no longer shows it when only the name fails
 *  (1TO1-FU-M, #186-P4 op 1: "1:1 coaching with your coach", no error). */
export const PLANS_LOAD_ERROR = "Your coach's plans could not load. Check your connection, then tap to try again.";
