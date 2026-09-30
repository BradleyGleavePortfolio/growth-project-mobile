/**
 * Single decision point for "may this iOS build show a purchase that is not
 * a 1:1 person-to-person service?"
 *
 * Owner decision (clinic launch): client payments for 1:1 coach packages are
 * real-time 1:1 coaching between a client and an individual coach, filed
 * under App Review Guideline 3.1.3(d) and paid through Stripe. They stay
 * available on iOS. Everything else that is sold in the app is hidden on iOS
 * while `EXPO_PUBLIC_FF_IOS_HIDE_NON_P2P_PURCHASES` is on:
 *   - coach AI credit packs: CreditPackCheckout route, "Buy credits" banner
 *     CTA, meter chip tap, PackOptionsRow in the tutorial / hard-pause modals
 *   - coach subscription / seat CTAs: "Start subscription" / "Manage billing"
 *     and invoice links in CoachBillingScreen (there are no seat fees now)
 *   - one-to-many paid products (group, cohort, community). None is sold in
 *     the app today; any future one must check this gate.
 *
 * Server state stays canonical (rule 22); this only hides UI.
 */
import { Platform } from 'react-native';
import { featureFlags } from './featureFlags';

export function nonP2PPurchasesHidden(
  platform: string = Platform.OS,
  flag: boolean = featureFlags.iosHideNonP2PPurchases,
): boolean {
  return platform === 'ios' && flag === true;
}

export const NON_P2P_HIDDEN_TITLE = 'Not available in this app';
export const NON_P2P_HIDDEN_BODY =
  'This purchase is not offered in the iOS app. Your account and anything you already have are unchanged.';

/** Copy for 1:1 package checkout: names the individual coach and the 1:1 nature. */
export function oneToOneCoachingLabel(coachName?: string | null): string {
  const name = typeof coachName === 'string' ? coachName.trim() : '';
  return name ? `1:1 coaching with ${name}` : '1:1 coaching with your coach';
}
