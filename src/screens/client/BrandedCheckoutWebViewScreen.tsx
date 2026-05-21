/**
 * BrandedCheckoutWebViewScreen — branded in-app Stripe checkout (B2B exemption).
 *
 * Why this exists:
 *   - Apple App Review Rule 3.1.3(b)/(e) ("Multiplatform / Enterprise B2B")
 *     allows coaching SaaS sold to businesses to bill outside of Apple IAP
 *     when the purchase happens in a webview pointing at the seller's own
 *     branded checkout. Salesforce, Notion, Linear, and Slack all ship this
 *     same pattern. No Apple 30%.
 *   - Rule 8 (decacorn doctrine): checkout MUST feel in-app and branded —
 *     the user never sees the Safari URL bar or a "leave the app" sheet.
 *
 * What this is:
 *   - A native React Navigation screen whose body is a `react-native-webview`
 *     pointing at the TGP-branded Stripe Checkout hosted under
 *     `app.bradleytgpcoaching.com/checkout` (configured in Stripe Dashboard
 *     custom-domain). Header is rendered by us, not by Safari — TGP logo
 *     left, "Secure Checkout" centered, X button right.
 *   - The checkout URL is minted by the backend
 *     (`clientPaymentsApi.createCheckoutSession`) so the app never embeds
 *     a publishable key or hard-codes a Price ID.
 *
 * Lifecycle:
 *   - We listen for `onNavigationStateChange` and short-circuit when the
 *     webview attempts to navigate to our deep-link return URLs
 *     (`com.growthproject.app://checkout/success` and `…/checkout/cancel`).
 *     On match we fire the screen's `onSuccess` / `onCancel` callback (when
 *     provided), then pop the screen so the caller can take over.
 *   - A strict origin allow-list (`isOriginAllowed`) rejects any attempt to
 *     navigate outside of the TGP checkout domain or Stripe's own payment
 *     iframes. This blocks phishing redirects and any third-party JS that
 *     tries to bounce the user off to an external site.
 *   - Error states cover (a) failure to mint the checkout URL, (b) webview
 *     load failure (network / 4xx / 5xx), and (c) blocked-origin attempts.
 *     All error copy is structured per Rule 9 — never a raw error code.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StatusBar,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import WebView, {
  type WebViewMessageEvent,
  type WebViewNavigation,
} from 'react-native-webview';
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
} from '@react-navigation/native';

import { useTheme, type ThemeColors } from '../../theme/ThemeProvider';

// ─── Route params ─────────────────────────────────────────────────────────────

export interface BrandedCheckoutWebViewParams {
  /** Backend-minted Stripe Checkout URL. Must already be branded (TGP custom domain). */
  checkoutUrl: string;
  /** Optional human-readable plan name shown in the header subtitle. */
  packageName?: string;
  /**
   * App scheme used for the deep-link return URLs Stripe is configured to
   * redirect to on completion / cancel. The webview short-circuits on
   * `${returnScheme}://checkout/success` and `${returnScheme}://checkout/cancel`.
   * Defaults to `com.growthproject.app` to match `app.json`.
   */
  returnScheme?: string;
}

type BrandedCheckoutRoute = RouteProp<
  Record<string, BrandedCheckoutWebViewParams | undefined>,
  string
>;

// ─── Origin allow-list ────────────────────────────────────────────────────────

/**
 * Domains the webview is permitted to navigate to. Anything outside of this
 * list is blocked (Rule 8 / Rule 9 — no off-app surprises, structured error
 * if a malicious or misconfigured redirect tries to bounce the user out).
 *
 * Exported for tests.
 */
export const CHECKOUT_ALLOWED_HOSTS: readonly string[] = [
  // TGP-branded Stripe Checkout (Stripe Dashboard custom-domain).
  'app.bradleytgpcoaching.com',
  'bradleytgpcoaching.com',
  'app.trygrowthproject.com',
  'trygrowthproject.com',
  // Stripe's own domains — required because Stripe Checkout embeds
  // payment iframes (3DS / Apple Pay / Link) served from these.
  'checkout.stripe.com',
  'js.stripe.com',
  'm.stripe.com',
  'm.stripe.network',
  'q.stripe.com',
  'r.stripe.com',
  'b.stripecdn.com',
  'hooks.stripe.com',
  // Stripe Customer Billing Portal — past-due clients tap "Update card"
  // in the dunning banner and the backend mints a billing.stripe.com
  // session URL. Keeping this in the branded webview avoids punting to
  // Safari and preserves the Apple B2B exemption posture.
  'billing.stripe.com',
];

export function isOriginAllowed(url: string): boolean {
  try {
    const parsed = new URL(url);
    // HTTPS-only — checkout must never run over plaintext (Rule 8 / Rule 9).
    // Anything else (about:, data:, javascript:, file:, http:) is rejected.
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return CHECKOUT_ALLOWED_HOSTS.some(
      (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
  } catch {
    return false;
  }
}

// ─── Deep-link detection ──────────────────────────────────────────────────────

export type CheckoutDeepLinkOutcome =
  | { outcome: 'success'; sessionId: string | null }
  | { outcome: 'cancel' };

/**
 * Exact, normalized match for our return deep links. We parse the URL and
 * require the scheme, host, AND path to match one of the two known entries
 * in the allow-list — `<scheme>://checkout/success` or `<scheme>://checkout/cancel`.
 *
 * Prefix matching (the previous implementation) was unsafe: a malicious or
 * misconfigured page could redirect to `<scheme>://checkout/success.evil.com`
 * or `<scheme>://checkout/successful` and we would treat it as a real
 * outcome. With exact matching:
 *   - scheme is case-insensitive (URL standard)
 *   - host MUST be exactly `checkout`
 *   - path MUST be exactly `/success` or `/cancel` (trailing slash stripped)
 *   - query string (e.g. `?session_id=...`) is allowed, fragment ignored
 *
 * Tests: see `src/__tests__/BrandedCheckoutWebViewScreen.test.tsx`.
 */
export function parseReturnDeepLink(
  url: string,
  returnScheme: string,
): CheckoutDeepLinkOutcome | null {
  const expectedScheme = `${returnScheme.toLowerCase()}:`;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol.toLowerCase() !== expectedScheme) return null;
  if (parsed.hostname.toLowerCase() !== 'checkout') return null;
  // Strip a single trailing slash so `/success/` matches `/success`.
  const path = parsed.pathname.replace(/\/+$/, '');
  if (path === '/success') {
    const sessionId = parsed.searchParams.get('session_id');
    return { outcome: 'success', sessionId: sessionId || null };
  }
  if (path === '/cancel') {
    return { outcome: 'cancel' };
  }
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Structured error shape rendered when the webview cannot complete checkout.
 * Per Rule 9, the user is never shown a raw HTTP code — they get a friendly
 * sentence + a TGPError tag for support.
 */
interface CheckoutErrorState {
  title: string;
  body: string;
  code: string;
}

export default function BrandedCheckoutWebViewScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute<BrandedCheckoutRoute>();
  const params = route.params;

  const checkoutUrl = params?.checkoutUrl ?? '';
  const packageName = params?.packageName ?? null;
  const returnScheme = params?.returnScheme ?? 'com.growthproject.app';

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<CheckoutErrorState | null>(
    checkoutUrl
      ? null
      : {
          title: 'Checkout temporarily unavailable',
          body:
            'We could not start a secure checkout session. Please go back and try again — if it keeps happening, message your coach.',
          code: 'TGPError: checkout_url_missing',
        },
  );
  const webviewRef = useRef<WebView | null>(null);
  const settledRef = useRef<boolean>(false);

  // ── deep-link short-circuit ───────────────────────────────────────────────

  const settleAndPop = useCallback(
    (outcome: CheckoutDeepLinkOutcome) => {
      if (settledRef.current) return;
      settledRef.current = true;
      // Hand control back to CheckoutReturn so the existing post-checkout
      // confirmation flow (call /v1/checkout/confirm + render the success
      // card) runs identically to the deep-link path.
      if (outcome.outcome === 'success') {
        navigation.navigate('CheckoutReturn', {
          outcome: 'success',
          session_id: outcome.sessionId ?? undefined,
        });
      } else {
        navigation.navigate('CheckoutReturn', { outcome: 'cancel' });
      }
    },
    [navigation],
  );

  const handleNavigationStateChange = useCallback(
    (nav: WebViewNavigation) => {
      // Defence-in-depth: `onShouldStartLoadWithRequest` is the primary
      // gate (returns `false` so the WebView never attempts to load the
      // app-scheme URL), but on some Android versions navigation-state
      // changes can race ahead of the should-start gate. Re-checking
      // here means a deep-link that slipped through is still routed
      // exactly once via `settleAndPop`.
      const deepLink = parseReturnDeepLink(nav.url, returnScheme);
      if (deepLink) {
        webviewRef.current?.stopLoading?.();
        settleAndPop(deepLink);
      }
    },
    [returnScheme, settleAndPop],
  );

  const handleShouldStartLoadWithRequest = useCallback(
    (request: { url: string }) => {
      // Deep-link return URLs are the success/cancel outcomes. We route
      // the screen ourselves and MUST return `false` so the WebView does
      // not also attempt to load the custom-scheme URL (which would
      // surface as a navigation error and a brief broken-page flash).
      const deepLink = parseReturnDeepLink(request.url, returnScheme);
      if (deepLink) {
        webviewRef.current?.stopLoading?.();
        settleAndPop(deepLink);
        return false;
      }
      if (!isOriginAllowed(request.url)) {
        setError({
          title: 'Checkout link not allowed',
          body:
            'For your security, this checkout tried to send you to a site we do not recognise. We blocked it. Please go back and try again.',
          code: `TGPError: blocked_origin (${safeHostFor(request.url)})`,
        });
        return false;
      }
      return true;
    },
    [returnScheme, settleAndPop],
  );

  // ── error handlers ────────────────────────────────────────────────────────

  const handleHttpError = useCallback(
    (nativeEvent: { statusCode?: number; description?: string }) => {
      const code = nativeEvent.statusCode ?? 0;
      // 4xx vs 5xx get distinct copy per Rule 9 (recovery action matched
      // to the failure mode). 4xx is most often a stale / expired
      // Checkout session — re-creating the session is the right fix; the
      // user can also try again or message their coach. 5xx is a Stripe
      // outage — retry is the right recovery.
      const is4xx = code >= 400 && code < 500;
      setError({
        title: is4xx
          ? 'Checkout session expired'
          : 'Stripe is temporarily unreachable',
        body: is4xx
          ? 'This checkout link is no longer valid. Tap “Try again” to start a fresh checkout — if it keeps happening, message your coach.'
          : 'Stripe could not load the secure checkout page. Tap “Try again” in a moment, or come back later.',
        code: `TGPError: http_${code || 'unknown'}`,
      });
    },
    [],
  );

  const handleLoadError = useCallback(
    (nativeEvent: { code?: number; description?: string }) => {
      setError({
        title: 'Checkout could not connect',
        body:
          'We could not reach the secure checkout server. Check your internet connection and tap “Try again”.',
        code: `TGPError: net_${nativeEvent.code ?? 'unknown'}`,
      });
    },
    [],
  );

  const handleRetry = useCallback(() => {
    // Clearing the error re-mounts the WebView, which fires its own
    // load against `source.uri`. We don't call `reload()` on the
    // current ref because the error branch has already unmounted it.
    setError(null);
    setLoading(true);
  }, []);

  const handleMessage = useCallback(
    (_event: WebViewMessageEvent) => {
      // Analytics hook reserved for the Stripe page to postMessage
      // events (e.g. "form_focused", "payment_attempted"). Intentionally
      // a no-op for now — wiring this up requires a coordinated change on
      // the Stripe Checkout template, which is out of scope for the
      // launch PR. Future work: forward to `analytics.track(...)`.
    },
    [],
  );

  // ── header actions ────────────────────────────────────────────────────────

  const handleClose = useCallback(() => {
    if (settledRef.current) return;
    settledRef.current = true;
    // User aborted mid-flow. Treat as cancel — Stripe will mark the
    // session expired automatically. We route through CheckoutReturn so
    // payment-status is re-fetched and any partial state is reconciled.
    navigation.navigate('CheckoutReturn', { outcome: 'cancel' });
  }, [navigation]);

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.root} edges={['top', 'left', 'right']}>
      <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />
      <View style={styles.header} testID="branded-checkout-header">
        <View style={styles.headerLogoSlot}>
          <View
            style={styles.logoBadge}
            accessibilityLabel="The Growth Project logo"
            testID="branded-checkout-logo"
          >
            <Text style={styles.logoBadgeText}>TGP</Text>
          </View>
        </View>
        <View style={styles.headerTitleSlot}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            Secure Checkout
          </Text>
          {packageName ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {packageName}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity
          onPress={handleClose}
          accessibilityRole="button"
          accessibilityLabel="Close checkout"
          accessibilityHint="Cancels this checkout and returns to the plans screen."
          hitSlop={{ top: 12, right: 12, bottom: 12, left: 12 }}
          style={styles.closeBtn}
          testID="branded-checkout-close"
        >
          <Ionicons name="close" size={24} color={colors.textOnPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {error ? (
          <View
            style={styles.errorWrap}
            accessibilityRole="alert"
            testID="branded-checkout-error"
          >
            <Ionicons
              name="alert-circle"
              size={36}
              color={colors.error}
              style={styles.errorIcon}
            />
            <Text style={styles.errorTitle}>{error.title}</Text>
            <Text style={styles.errorBody}>{error.body}</Text>
            <Text style={styles.errorCode} testID="branded-checkout-error-code">
              {error.code}
            </Text>
            {checkoutUrl ? (
              <TouchableOpacity
                onPress={handleRetry}
                accessibilityRole="button"
                accessibilityLabel="Try again"
                accessibilityHint="Reloads secure checkout."
                style={styles.errorBtn}
                testID="branded-checkout-error-retry"
              >
                <Text style={styles.errorBtnText}>Try again</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={handleClose}
              accessibilityRole="button"
              accessibilityLabel="Cancel checkout"
              style={styles.errorBtnSecondary}
              testID="branded-checkout-error-cancel"
            >
              <Text style={styles.errorBtnSecondaryText}>Cancel checkout</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <WebView
              ref={webviewRef}
              testID="branded-checkout-webview"
              source={{ uri: checkoutUrl }}
              // HTTPS-only — deep-link returns are intercepted in
              // `onShouldStartLoadWithRequest` and never loaded.
              originWhitelist={['https://*']}
              onNavigationStateChange={handleNavigationStateChange}
              onShouldStartLoadWithRequest={handleShouldStartLoadWithRequest}
              onLoadStart={() => setLoading(true)}
              onLoadEnd={() => setLoading(false)}
              onHttpError={(e) => handleHttpError(e.nativeEvent)}
              onError={(e) => handleLoadError(e.nativeEvent)}
              onMessage={handleMessage}
              javaScriptEnabled
              domStorageEnabled
              // Stripe Elements (3DS / SCA / Apple Pay / Link) maintains
              // session state in an iframe — without shared cookies and
              // (on Android) third-party cookies, 3DS authentication
              // breaks silently mid-flow. These props are mandatory.
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              startInLoadingState={false}
              // Stripe sets `Strict-Transport-Security` and may block
              // mixed content; defaults are fine, but be explicit so
              // future RN upgrades don't quietly flip them.
              mixedContentMode="never"
              // iOS only — keeps the Apple Pay / Link payment sheet
              // inline rather than punting to mobile Safari.
              {...(Platform.OS === 'ios'
                ? { allowsInlineMediaPlayback: true, decelerationRate: 'normal' as const }
                : {})}
              style={styles.webview}
            />
            {loading ? (
              <View
                style={styles.skeleton}
                pointerEvents="none"
                testID="branded-checkout-skeleton"
              >
                <ActivityIndicator size="large" color={colors.primary} />
                <Text style={styles.skeletonText}>Loading secure checkout…</Text>
              </View>
            ) : null}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function safeHostFor(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return 'unknown';
  }
}

// ─── styles ───────────────────────────────────────────────────────────────────

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.primaryDark,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      backgroundColor: colors.primaryDark,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: 'rgba(255,255,255,0.08)',
    },
    headerLogoSlot: {
      width: 44,
      alignItems: 'flex-start',
    },
    logoBadge: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: colors.gold,
      alignItems: 'center',
      justifyContent: 'center',
    },
    logoBadgeText: {
      color: colors.primaryDark,
      fontWeight: '800',
      fontSize: 12,
      letterSpacing: 0.5,
    },
    headerTitleSlot: {
      flex: 1,
      alignItems: 'center',
      paddingHorizontal: 8,
    },
    headerTitle: {
      color: colors.textOnPrimary,
      fontSize: 17,
      fontWeight: '700',
    },
    headerSubtitle: {
      color: colors.textOnPrimary,
      opacity: 0.75,
      fontSize: 12,
      marginTop: 2,
    },
    closeBtn: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: {
      flex: 1,
      backgroundColor: colors.background,
    },
    webview: {
      flex: 1,
      backgroundColor: colors.background,
    },
    skeleton: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
      gap: 12,
    },
    skeletonText: {
      color: colors.textSecondary,
      fontSize: 14,
    },
    errorWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 8,
      backgroundColor: colors.background,
    },
    errorIcon: {
      marginBottom: 4,
    },
    errorTitle: {
      color: colors.textPrimary,
      fontSize: 18,
      fontWeight: '700',
      textAlign: 'center',
    },
    errorBody: {
      color: colors.textSecondary,
      fontSize: 14,
      textAlign: 'center',
      lineHeight: 20,
    },
    errorCode: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 4,
      fontVariant: ['tabular-nums'],
    },
    errorBtn: {
      marginTop: 16,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.primary,
      minHeight: 44,
      minWidth: 160,
      alignItems: 'center',
      justifyContent: 'center',
    },
    errorBtnText: {
      color: colors.textOnPrimary,
      fontWeight: '700',
      fontSize: 15,
    },
    errorBtnSecondary: {
      marginTop: 10,
      paddingHorizontal: 20,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: 'transparent',
      minHeight: 44,
      minWidth: 160,
      alignItems: 'center',
      justifyContent: 'center',
    },
    errorBtnSecondaryText: {
      color: colors.textPrimary,
      fontWeight: '600',
      fontSize: 15,
    },
  });
}
