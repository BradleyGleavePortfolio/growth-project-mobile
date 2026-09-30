/**
 * Single decision point for "may this build show a client purchase surface?"
 *
 * Clinic launch default (PLAN §4 default 2): iOS v1 ships with NO in-app
 * purchase surfaces for clients, removing the App Review 3.1 payments risk.
 * Clinic clients get a comp entitlement from their invite code (C01), so
 * they never need to buy. An inactive client on iOS sees a neutral
 * "Ask your coach for an invite code" state instead of checkout.
 *
 * Every client purchase entry point calls `clientPurchasesHidden()`:
 *   - ProtectedScreen (locked-tab state)            src/entitlements/ProtectedScreen.tsx
 *   - PaywallSheet (402-triggered sheet)            src/entitlements/EntitlementProvider.tsx
 *   - onOpenPlans → ClientPackages navigation       src/navigation/RootNavigator.tsx
 *   - Day1Win PackageSelectionSheet                 src/screens/client/Day1WinScreen.tsx
 *   - 24h package_prompt re-surface                 src/navigation/RootNavigator.tsx
 *   - Membership "View packages" button             src/screens/client/MembershipScreen.tsx
 *   - ClientPackages / PackageCheckout screens      (render the neutral state)
 *
 * Server entitlement stays canonical (rule 22); this only hides UI.
 */
import { Platform } from 'react-native';
import { featureFlags } from './featureFlags';

export function clientPurchasesHidden(
  platform: string = Platform.OS,
  flag: boolean = featureFlags.iosHidePurchases,
): boolean {
  return platform === 'ios' && flag === true;
}

export const NEUTRAL_ACCESS_TITLE = 'Ask your coach for an invite code';
export const NEUTRAL_ACCESS_BODY =
  'Your coach gives you access to this part of the app. Ask them for your invite code, then enter it to unlock everything.';
