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
 * Server state stays canonical (rule 22); this only hides UI (see the A1
 * note below for the native anchor and server header).
 */
import { Platform } from 'react-native';
import * as Application from 'expo-application';
import { featureFlags } from './featureFlags';

/**
 * Audit #305 A1: an OTA update must not be able to turn non-P2P purchase
 * surfaces on for an installed iOS binary just by shipping a different
 * EXPO_PUBLIC_* value. That flag is inlined into the replaceable JS bundle.
 *
 * The rule is fail closed, and the "show" decision needs BOTH:
 *   1. the bundle flag explicitly false (unset, malformed or true → hidden), AND
 *   2. a native value that agrees: CFBundleVersion is read from the
 *      installed binary through expo-application, and an update cannot change
 *      it. Every iOS binary at or above IOS_P2P_ONLY_MIN_NATIVE_BUILD (the
 *      first OTA-capable build) stays hidden whatever the bundle flag says.
 *      An unreadable build number counts as hidden.
 * Local dev bundles (__DEV__, never an OTA/release bundle) honour flag=false
 * so engineers can exercise the flows in the simulator.
 *
 * This is defence in depth, not a proof. An authorised publisher can still
 * ship JS that edits this function. That path is covered by governance:
 * scripts/eas-update-guard.js (#305) refuses a preview/production publish
 * unless the flag is "true" in that EAS environment and this file matches
 * the pinned hash. The API client also sends X-Client-Purchase-Policy so the
 * backend can reject non-P2P checkout/portal sessions for iOS clients (a
 * backend follow-up).
 */
export const IOS_P2P_ONLY_MIN_NATIVE_BUILD = 6;

export function nativeBuildNumber(): number | null {
  const raw = Application.nativeBuildVersion;
  if (typeof raw !== 'string' || !/^\d+$/.test(raw.trim())) return null;
  return parseInt(raw.trim(), 10);
}

export function nonP2PPurchasesHidden(
  platform: string = Platform.OS,
  flag: boolean = featureFlags.iosHideNonP2PPurchases,
  nativeBuild: number | null = nativeBuildNumber(),
  dev: boolean = __DEV__,
): boolean {
  if (platform !== 'ios') return false;
  if (flag !== false) return true;
  if (dev) return false;
  if (nativeBuild === null) return true;
  return nativeBuild >= IOS_P2P_ONLY_MIN_NATIVE_BUILD;
}

/** Value for the X-Client-Purchase-Policy request header. */
export function purchasePolicyHeader(): 'p2p-only' | 'all' {
  return nonP2PPurchasesHidden() ? 'p2p-only' : 'all';
}

export const NON_P2P_HIDDEN_TITLE = 'Not available in this app';
export const NON_P2P_HIDDEN_BODY =
  'This purchase is not offered in the iOS app. Your account and anything you already have are unchanged.';

/** Copy for 1:1 package checkout: names the individual coach and the 1:1 nature. */
export function oneToOneCoachingLabel(coachName?: string | null): string {
  const name = typeof coachName === 'string' ? coachName.trim() : '';
  return name ? `1:1 coaching with ${name}` : '1:1 coaching with your coach';
}

// ---------------------------------------------------------------------------
// External links (audit #304 B2). A dynamic, server-provided URL must not
// become a way around the gate on hidden iOS builds.
// ---------------------------------------------------------------------------

/**
 * Payment and checkout hosts. This mirrors the backend's
 * landing-pages/banned-payment-hosts.ts and adds common checkout and ticketing
 * hosts. Suffix match, case-insensitive.
 */
export const PAYMENT_HOST_SUFFIXES: readonly string[] = [
  'stripe.com',
  'paypal.com',
  'paypal.me',
  'venmo.com',
  'cash.app',
  'cashapp.com',
  'ko-fi.com',
  'buymeacoffee.com',
  'patreon.com',
  'gumroad.com',
  'lemonsqueezy.com',
  'whop.com',
  'square.link',
  'squareup.com',
  'square.site',
  'paddle.com',
  'shopify.com',
  'myshopify.com',
  'eventbrite.com',
  'ticketmaster.com',
  'kajabi.com',
  'teachable.com',
  'thinkific.com',
  'podia.com',
  'stan.store',
];

/**
 * Attendance/replay hosts, mirroring the backend's built-in community event
 * allowlist (community/events/community-event-link.ts). The backend accepts
 * `external_url` only for these hosts, plus operator-added hosts from
 * COMMUNITY_EVENT_LINK_HOSTS. On hidden iOS builds the app fails closed to
 * this built-in list, so an operator-added host does not open on iOS.
 */
export const ATTENDANCE_HOST_SUFFIXES: readonly string[] = [
  'zoom.us',
  'zoom.com',
  'meet.google.com',
  'teams.microsoft.com',
  'teams.live.com',
  'youtube.com',
  'youtu.be',
  'vimeo.com',
  'loom.com',
  'whereby.com',
  'riverside.fm',
  'streamyard.com',
  'restream.io',
  'twitch.tv',
  'daily.co',
];

const PAYMENT_PATH = /\/(checkout|checkouts|pay|payment|payments|purchase|buy|cart|subscribe|billing|invoice)(\/|$|\?)/i;

function hostMatches(host: string, suffixes: readonly string[]): boolean {
  return suffixes.some((s) => host === s || host.endsWith(`.${s}`));
}

/** True when a URL points at a payment host or a checkout-like path. Unparseable counts as payment (fail closed). */
export function isPaymentUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return true;
  }
  const host = u.hostname.toLowerCase();
  return hostMatches(host, PAYMENT_HOST_SUFFIXES) || PAYMENT_PATH.test(u.pathname);
}

/**
 * May this external link open? When non-P2P purchases are visible, always
 * yes (callers keep their own scheme checks). When hidden (iOS), only an https
 * attendance/replay host with no payment signal is allowed.
 */
export function externalLinkAllowed(
  raw: string | null | undefined,
  hidden: boolean = nonP2PPurchasesHidden(),
): boolean {
  if (!hidden) return true;
  if (!raw) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (isPaymentUrl(raw)) return false;
  return hostMatches(u.hostname.toLowerCase(), ATTENDANCE_HOST_SUFFIXES);
}
