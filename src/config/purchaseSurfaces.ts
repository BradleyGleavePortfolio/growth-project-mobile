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
 *     CTA, meter chip tap, PackOptionsRow in the tutorial / hard-pause modals.
 *     Exception (owner decision 10 fallback): a build with
 *     EXPO_PUBLIC_FF_IOS_US_CREDIT_PACK_LINK on shows them again and opens
 *     Stripe Checkout in the system browser (creditPackCheckoutMode below).
 *     Android release builds do the same with
 *     EXPO_PUBLIC_FF_ANDROID_CREDIT_PACK_LINK (preview profile only)
 *   - coach subscription / seat CTAs: "Start subscription" / "Manage billing"
 *     and invoice links in CoachBillingScreen (there are no seat fees now)
 *   - one-to-many paid products (group, cohort, community). None is sold in
 *     the app today; any future one must check this gate.
 *
 * Server state stays canonical (rule 22); this only hides UI (see the A1
 * note below for the native anchor and what is still only planned).
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
 * ship JS that edits this function. What exists at this head:
 *   - this native anchor (app.json ios.buildNumber is 8, and
 *     scripts/validate-app-config.js fails a build number below
 *     IOS_P2P_ONLY_MIN_NATIVE_BUILD);
 *   - expo-updates is NOT configured in this repo yet, so there is no OTA
 *     channel that could replace this bundle on an installed binary.
 * What does NOT exist yet (audit #304 C1; do not rely on it):
 *   - PLANNED (#305): an EAS publish guard that refuses a preview/production
 *     update unless the flag is "true" and this file matches a pinned hash.
 *     It must land with, or before, the first OTA-enabled release.
 *   - PLANNED (backend follow-up): server-side enforcement of the
 *     X-Client-Purchase-Policy header. The API client sends the header today
 *     (services/api.ts). Once the CREDIT-PAY-130 backend change is deployed,
 *     the server reads it only to word the AI pool-empty message; no handler
 *     enforces it, so it is advisory until that follow-up ships.
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

/**
 * Digital AI packs and coach software subscriptions need store billing (or
 * an enrolled, correctly integrated alternative-billing program). Neither
 * purchase route is integrated here, so Android release builds expose usage
 * and existing account status, not Stripe checkout or upgrade instructions.
 * Development builds retain the checkout path for engineering.
 *
 * Keep this separate from nonP2PPurchasesHidden: that existing iOS posture
 * also governs feature paywalls and attendance links. Client purchases of
 * real-time 1:1 human coaching, including recurring packages, are unchanged.
 * Coach AI credit packs have their own per-platform link switch on top of
 * this (creditPackCheckoutMode below).
 */
export function digitalPurchasesHidden(
  platform: string = Platform.OS,
  flag: boolean = featureFlags.iosHideNonP2PPurchases,
  nativeBuild: number | null = nativeBuildNumber(),
  dev: boolean = __DEV__,
): boolean {
  if (platform === 'android') return !dev;
  return nonP2PPurchasesHidden(platform, flag, nativeBuild, dev);
}

/**
 * How this build sells coach AI credit packs (owner decision 10 fallback,
 * 09-30: "an external link to web checkout on the US storefront
 * (3.1.1(a))"):
 *   'in-app'   digital purchases are shown (development builds): the
 *              existing in-app WebView checkout.
 *   'external' iOS store build with EXPO_PUBLIC_FF_IOS_US_CREDIT_PACK_LINK
 *              on: packs show, and checkout opens in the system browser.
 *              The app cannot read the storefront, so the switch stands in
 *              for it: it is on only for builds offered solely on the US
 *              App Store (an owner action in App Store Connect).
 *              Also an Android release build with
 *              EXPO_PUBLIC_FF_ANDROID_CREDIT_PACK_LINK on (PACKS-BOTH-131:
 *              set only in the eas.json preview profile, the Android test
 *              app; a Google Play build with it on is an owner decision).
 *   'hidden'   everything else, including Android release builds without
 *              that switch (production and clinic).
 * Only credit packs use this. Seat upgrades, subscriptions and one-to-many
 * products keep digitalPurchasesHidden / nonP2PPurchasesHidden.
 */
export type CreditPackCheckoutMode = 'hidden' | 'in-app' | 'external';

export function creditPackCheckoutMode(
  platform: string = Platform.OS,
  digitalHidden: boolean = digitalPurchasesHidden(),
  usLink: boolean = featureFlags.iosUsCreditPackLink,
  androidLink: boolean = featureFlags.androidCreditPackLink,
): CreditPackCheckoutMode {
  if (!digitalHidden) return 'in-app';
  if (platform === 'ios' && usLink === true) return 'external';
  if (platform === 'android' && androidLink === true) return 'external';
  return 'hidden';
}

/** True when no credit-pack entry point may show. */
export function creditPacksHidden(): boolean {
  return creditPackCheckoutMode() === 'hidden';
}

/**
 * Value for the X-Client-Purchase-Policy request header. 'p2p-and-ai-credits'
 * means 1:1 coaching plus AI credit packs through the system-browser link
 * (an iOS US-link build or an Android build with the Android link on); the
 * backend may then tell a coach to add a credit pack. Other Android release
 * builds still send 'all' (that value describes the iOS posture), so the
 * backend trusts 'all' only from iOS (backend ai-credits/client-purchase-policy.ts).
 */
export function purchasePolicyHeader(): 'p2p-only' | 'p2p-and-ai-credits' | 'all' {
  if (creditPackCheckoutMode() === 'external') return 'p2p-and-ai-credits';
  return nonP2PPurchasesHidden() ? 'p2p-only' : 'all';
}

// Operator 2026-09-30 (store package P0): the hidden state has no link, URL or
// instruction to buy elsewhere (3.1.1 / 3.1.3). Operator 2026-10-07: there is
// no web checkout, so it no longer says "Managed on the web"; it says plainly
// that packs are not sold in this build. Only the CreditPackCheckout route
// shows it, and a US-link build never does (creditPackCheckoutMode 'external').
export const NON_P2P_HIDDEN_TITLE = 'Not available in this app';
export const NON_P2P_HIDDEN_BODY =
  'AI credit packs are not sold in this version of the app. Your AI credits renew each month, and your account and anything you already have are unchanged.';

/**
 * Owner 10-07 20:54: AI credit packs are non-refundable. Shown beside the pack
 * prices wherever they show (PackOptionsRow, the browser-checkout wait state).
 */
export const CREDIT_PACK_NON_REFUNDABLE = 'Credit packs are non-refundable.';

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
 * Re-audit #304 B2: a host is not an attendance contract. YouTube `/join`
 * (paid channel membership), Vimeo `/ondemand`, `/redirect?q=<pay url>` and
 * `/pricing` all live on "attendance" domains. On hidden iOS builds we
 * therefore POSITIVELY match known meeting / live / replay URL shapes for the
 * hosts the backend accepts (community/events/community-event-link.ts). Any
 * other path, host or shape fails closed.
 */
type AttendanceShape = {
  provider: string;
  host: (h: string) => boolean;
  path: RegExp;
  /** Optional query requirement (e.g. YouTube /watch needs a video id). */
  query?: (q: URLSearchParams) => boolean;
};

const exact = (...hosts: string[]) => (h: string) => hosts.includes(h);
const suffix = (root: string) => (h: string) => h === root || h.endsWith(`.${root}`);
const subdomainOnly = (root: string, excluded: string[] = []) => (h: string) =>
  h.endsWith(`.${root}`) && !excluded.includes(h.slice(0, -root.length - 1));
const YT_ID = '[A-Za-z0-9_-]{11}';
const TWITCH_RESERVED = new Set([
  'subs', 'subscriptions', 'prime', 'turbo', 'settings', 'directory', 'downloads', 'jobs', 'p',
  'store', 'bits', 'products', 'wallet', 'payments', 'checkout', 'search', 'friends', 'inventory',
]);

export const ATTENDANCE_URL_SHAPES: readonly AttendanceShape[] = [
  { provider: 'zoom', host: suffix('zoom.us'), path: /^\/(j|s|w)\/\d{9,11}\/?$/ },
  { provider: 'zoom', host: suffix('zoom.us'), path: /^\/wc\/(join\/)?\d{9,11}(\/join)?\/?$/ },
  { provider: 'zoom', host: suffix('zoom.us'), path: /^\/rec\/(play|share)\/[A-Za-z0-9._-]+\/?$/ },
  { provider: 'zoom', host: suffix('zoom.com'), path: /^\/(j|s|w)\/\d{9,11}\/?$/ },
  { provider: 'meet', host: exact('meet.google.com'), path: /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/ },
  { provider: 'teams', host: exact('teams.microsoft.com'), path: /^\/l\/meetup-join\/[^/]+(\/[^/]+)*\/?$/ },
  { provider: 'teams', host: exact('teams.live.com'), path: /^\/meet\/\d{6,20}\/?$/ },
  {
    provider: 'youtube',
    host: exact('youtube.com', 'www.youtube.com', 'm.youtube.com'),
    path: /^\/watch\/?$/,
    query: (q) => new RegExp(`^${YT_ID}$`).test(q.get('v') ?? ''),
  },
  { provider: 'youtube', host: exact('youtube.com', 'www.youtube.com', 'm.youtube.com'), path: new RegExp(`^/(live|embed)/${YT_ID}/?$`) },
  { provider: 'youtube', host: exact('youtu.be'), path: new RegExp(`^/${YT_ID}/?$`) },
  { provider: 'vimeo', host: exact('vimeo.com', 'www.vimeo.com'), path: /^\/(event\/)?\d+(\/[0-9a-f]{6,})?\/?$/ },
  { provider: 'vimeo', host: exact('player.vimeo.com'), path: /^\/video\/\d+\/?$/ },
  { provider: 'loom', host: exact('loom.com', 'www.loom.com'), path: /^\/(share|embed)\/[0-9a-f]{32}\/?$/ },
  { provider: 'riverside', host: exact('riverside.fm', 'www.riverside.fm'), path: /^\/studio\/[A-Za-z0-9-]+\/?$/ },
  { provider: 'streamyard', host: exact('streamyard.com', 'www.streamyard.com'), path: /^\/watch\/[A-Za-z0-9]+\/?$/ },
  { provider: 'twitch', host: exact('twitch.tv', 'www.twitch.tv', 'm.twitch.tv'), path: /^\/videos\/\d+\/?$/ },
  { provider: 'daily', host: subdomainOnly('daily.co', ['www', 'dashboard', 'docs', 'api']), path: /^\/[A-Za-z0-9_-]+\/?$/ },
];

function matchesAttendanceShape(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  // Twitch channel live page: /<channel>, never a reserved commerce path.
  if (exact('twitch.tv', 'www.twitch.tv', 'm.twitch.tv')(host)) {
    const m = u.pathname.match(/^\/([A-Za-z0-9_]{4,25})\/?$/);
    if (m && !TWITCH_RESERVED.has(m[1].toLowerCase())) return true;
  }
  return ATTENDANCE_URL_SHAPES.some(
    (s) => s.host(host) && s.path.test(u.pathname) && (!s.query || s.query(u.searchParams)),
  );
}

/** A query value that is itself a URL (open redirect / wrapped payment link). */
function hasEmbeddedUrl(u: URL): boolean {
  for (const [, v] of u.searchParams) {
    if (/^(https?:|\/\/)|%2f%2f|:\/\//i.test(v)) return true;
  }
  return /(^|\/)(redirect|out|away|l\.php)(\/|$)/i.test(u.pathname);
}

const PAYMENT_PATH = /\/(checkout|checkouts|pay|payment|payments|purchase|buy|cart|subscribe|billing|invoice|pricing|plans|membership|memberships|ondemand|store|shop|donate|tip|tickets)(\/|$|\?)/i;

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
  if (u.username || u.password || (u.port && u.port !== '443')) return false;
  if (isPaymentUrl(raw) || hasEmbeddedUrl(u)) return false;
  return matchesAttendanceShape(u);
}
