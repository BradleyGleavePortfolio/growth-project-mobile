/**
 * PackageSelectionSheet — bottom sheet for coach package selection and
 * in-app Stripe payment.
 *
 * Rendered as a Modal (animationType='slide', presentationStyle='pageSheet')
 * so it feels like a native bottom sheet without a third-party dependency.
 *
 * Payment flow (OR-112-22, contract cited in src/lib/packagePayment.ts):
 *   1. On visible: GET /v1/clients/me/coach/packages (price = amount_cents)
 *   2. User selects a package
 *   3. One-time package: POST /v1/checkout/payment-intent
 *        { package_id, idempotency_key } ->
 *        { client_secret, ephemeral_key, customer_id, publishable_key }
 *      The key is stable for the attempt: retries, a cancel or a decline on
 *      the same package reuse it, so the backend returns the same
 *      PaymentIntent and the client can never be charged twice.
 *      $0 package: POST /v1/packages/:id/claim-free (never reaches Stripe).
 *      Renewing package: the payment-intent route makes a one-off charge with
 *      no subscription, so the sheet points to the plans screen instead.
 *   4. initStripe() + initPaymentSheet({ customerId, ephemeral key, client
 *      secret }) themed with TGP tokens, then presentPaymentSheet()
 *   5. Completed -> entitlement check -> onPaymentSuccess(); Canceled -> stay
 *      on the sheet, no message; failure -> specific copy per cause, unknown
 *      causes add a short reference and the support email.
 *
 * R18: payment success is only fired after Stripe confirms the PaymentSheet.
 * R19: every payment-intent POST carries a client-generated idempotency key.
 * R17: raw Stripe/backend error strings are never shown or reported; secrets
 *      are never logged or sent to Sentry.
 *
 * 24-hour re-surface logic:
 *   MMKV key 'onboarding.package_prompt_dismissed_at:<userId>' (ISO string).
 *   If set and < 24h ago → call onDismiss() immediately.
 *   If set and > 24h ago (or not set) → show sheet.
 *   Written on "Skip for now" tap.
 */

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import type { SemanticTokens, Tokens } from '../theme/tokens';
import { prefsStorage } from '../storage/mmkv';
import api from '../services/api';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { generateIdempotencyKey } from '../utils/idempotency';
import { shortReference } from '../utils/correlation';
import { resolveStripePublishableKey } from '../config/stripe';
import { clientPaymentsApi } from '../api/clientPaymentsApi';
import { useEntitlement } from '../entitlements/EntitlementProvider';
import { SupportEmailFallback, useSupportEmail } from './support/SupportEmailFallback';
import {
  PACKAGE_PAYMENT_COPY,
  STRIPE_RETURN_URL,
  STRIPE_URL_SCHEME,
  backendCodeOf,
  claimFreePackage,
  createPackagePaymentIntent,
  describeBackendFailure,
  describeMissingPublishableKey,
  describeSheetCrash,
  describeSdkMissing,
  describeSheetFailure,
  isSheetCanceled,
  loadPackageStripeSdk,
  reportPackagePaymentFailure,
  type PackagePaymentNotice,
  type StripeSdkError,
} from '../lib/packagePayment';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoachPackage {
  id: string;
  name: string;
  price_cents: number;
  currency: string;
  description: string | null;
  billing_type: 'one_time' | 'recurring';
  interval?: 'month' | 'year';
}

export interface PackageSelectionSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onPaymentSuccess: () => void;
  /**
   * Waits between entitlement checks after Stripe confirms the payment (the
   * webhook flips the entitlement). Tests pass zeros.
   */
  entitlementPollDelaysMs?: number[];
}

type Phase = 'idle' | 'paying' | 'confirming' | 'confirmed_pending';

type Outcome =
  | { kind: 'paid'; free?: boolean }
  | { kind: 'canceled' }
  | { kind: 'notice'; notice: PackagePaymentNotice };

// ─── Constants ────────────────────────────────────────────────────────────────

const DISMISSED_KEY_BASE = 'onboarding.package_prompt_dismissed_at';
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
/** About 10 s for the payment_intent.succeeded webhook to flip the entitlement. */
const ENTITLEMENT_POLL_DELAYS_MS = [0, 1500, 2500, 3000, 3000];
const MERCHANT_DISPLAY_NAME = 'The Growth Project';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The backend sends the raw CoachPackage row (amount_cents, billing_type,
 * interval). Rows without an id or a whole-cent price are dropped rather
 * than shown with a made-up price.
 */
function normalizePackage(raw: unknown): CoachPackage | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const cents =
    typeof r.amount_cents === 'number'
      ? r.amount_cents
      : typeof r.price_cents === 'number'
        ? r.price_cents
        : NaN;
  if (typeof r.id !== 'string' || !r.id || !Number.isInteger(cents) || cents < 0) return null;
  return {
    id: r.id,
    name: typeof r.name === 'string' ? r.name : '',
    price_cents: cents,
    currency: typeof r.currency === 'string' && r.currency ? r.currency : 'usd',
    description: typeof r.description === 'string' ? r.description : null,
    billing_type: r.billing_type === 'recurring' ? 'recurring' : 'one_time',
    interval: r.interval === 'year' ? 'year' : r.interval === 'month' ? 'month' : undefined,
  };
}

function infoNotice(cause: string, message: string): PackagePaymentNotice {
  return { cause, message, support: false, reference: null, tone: 'info' };
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

function formatPrice(priceCents: number, currency: string): string {
  const major = priceCents / 100;
  const code = currency.toUpperCase();
  // Common major-currency symbols
  const sym = code === 'USD' ? '$' : code === 'GBP' ? '£' : code === 'EUR' ? '€' : `${code} `;
  return `${sym}${major.toFixed(2)}`;
}

function formatPriceLabel(pkg: CoachPackage): string {
  if (pkg.price_cents === 0) return 'Free';
  const price = formatPrice(pkg.price_cents, pkg.currency);
  if (pkg.billing_type === 'recurring') {
    const interval = pkg.interval ?? 'month';
    return `${price} / ${interval}`;
  }
  return `${price} one-time`;
}

// ─── Skeleton shimmer ─────────────────────────────────────────────────────────

function SkeletonCard({ styles }: { styles: ReturnType<typeof makeStyles> }) {
  return (
    <View style={styles.skeletonCard}>
      <View style={[styles.skeletonLine, { width: '50%', height: 14 }]} />
      <View style={[styles.skeletonLine, { width: '30%', height: 12, marginTop: 6 }]} />
      <View style={[styles.skeletonLine, { width: '90%', height: 12, marginTop: 8 }]} />
    </View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function PackageSelectionSheet({
  visible,
  onDismiss,
  onPaymentSuccess,
  entitlementPollDelaysMs = ENTITLEMENT_POLL_DELAYS_MS,
}: PackageSelectionSheetProps) {
  const { semanticColors, tokens, colorScheme } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors, tokens), [semanticColors, tokens]);
  const currentUser = useCurrentUser();
  const { refreshEntitlement } = useEntitlement();
  const dismissedKey = useMemo(
    () => (currentUser?.id ? `${DISMISSED_KEY_BASE}:${currentUser.id}` : null),
    [currentUser?.id],
  );

  const [packages, setPackages] = useState<CoachPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [notice, setNotice] = useState<PackagePaymentNotice | null>(null);
  const [ready, setReady] = useState(false); // passed 24h suppression check
  const [freePlan, setFreePlan] = useState(false); // the confirmed plan was a $0 claim
  const supportEmail = useSupportEmail(PACKAGE_PAYMENT_COPY.supportSubject(notice?.reference ?? null));

  // One idempotency key per attempt (package). Reused on retry, cancel or
  // decline so the backend hands back the same PaymentIntent; replaced when
  // the client picks another package or the sheet reloads.
  const attemptRef = useRef<{ packageId: string; key: string } | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Latest-ref pattern: callers may pass an inline onDismiss that re-creates
  // every render. Subscribing the effects below to `onDismiss` directly would
  // cause them to re-run (and re-fetch packages) on every parent re-render.
  // Storing it in a ref lets the effects always invoke the freshest callback
  // while depending only on the actual triggers (`visible`, `ready`). This
  // satisfies react-hooks/exhaustive-deps without changing runtime semantics.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  // ── 24h suppression gate ──────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    if (!dismissedKey) return; // wait for user id to resolve
    let cancelled = false;
    (async () => {
      try {
        const dismissedAt = await prefsStorage.getStringAsync(dismissedKey);
        if (dismissedAt) {
          const elapsed = Date.now() - new Date(dismissedAt).getTime();
          if (elapsed < TWENTY_FOUR_HOURS) {
            // Suppressed — dismiss immediately
            if (!cancelled) onDismissRef.current();
            return;
          }
        }
      } catch {
        // best-effort; show if check fails
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [visible, dismissedKey]);

  // ── Fetch packages when ready ─────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    setNotice(null);
    setPhase('idle');
    setSelectedId(null);
    attemptRef.current = null;
    (async () => {
      try {
        const res = await api.get<{ packages: unknown[] } | unknown[]>(
          '/v1/clients/me/coach/packages',
        );
        // Backend may return { packages: [...] } or a bare array
        const data = res.data;
        const raw: unknown[] = Array.isArray(data)
          ? data
          : (data as { packages?: unknown[] })?.packages ?? [];
        const list = raw
          .map(normalizePackage)
          .filter((p): p is CoachPackage => p !== null);
        if (!cancelled) {
          if (list.length === 0) {
            onDismissRef.current();
            return;
          }
          setPackages(list);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          // API error — dismiss quietly
          onDismissRef.current();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [ready]);

  // ── Payment ───────────────────────────────────────────────────────────────
  const appearance = useMemo(
    () => ({
      colors: {
        primary: semanticColors.accent,
        background: semanticColors.bgPrimary,
        componentBackground: semanticColors.bgSurface,
        componentBorder: semanticColors.border,
        componentDivider: semanticColors.border,
        primaryText: semanticColors.textPrimary,
        secondaryText: semanticColors.textMuted,
        componentText: semanticColors.textPrimary,
        placeholderText: semanticColors.textMuted,
        icon: semanticColors.textMuted,
        error: tokens.colors.error,
      },
      shapes: { borderRadius: 2, borderWidth: 1 },
      primaryButton: {
        colors: {
          background: semanticColors.accent,
          text: semanticColors.textOnAccent,
          border: semanticColors.accent,
        },
        shapes: { borderRadius: 0, borderWidth: 0 },
      },
    }),
    [semanticColors, tokens],
  );

  const attemptKeyFor = useCallback((packageId: string): string => {
    if (attemptRef.current?.packageId !== packageId) {
      attemptRef.current = { packageId, key: generateIdempotencyKey() };
    }
    return attemptRef.current.key;
  }, []);

  const claimFree = useCallback(async (packageId: string): Promise<Outcome> => {
    try {
      const active = await claimFreePackage(packageId);
      return active
        ? { kind: 'paid', free: true }
        : { kind: 'notice', notice: infoNotice('free_pending', PACKAGE_PAYMENT_COPY.freePending) };
    } catch (err) {
      return { kind: 'notice', notice: describeBackendFailure(err, 'claim_free', null) };
    }
  }, []);

  const payWithSheet = useCallback(
    async (packageId: string): Promise<Outcome> => {
      const sdk = loadPackageStripeSdk();
      if (!sdk) {
        return { kind: 'notice', notice: describeSdkMissing() };
      }
      const key = attemptKeyFor(packageId);
      const ref = shortReference(key);

      let secrets;
      try {
        secrets = await createPackagePaymentIntent(packageId, key);
      } catch (err) {
        // The coach made the plan free since the list loaded.
        if (backendCodeOf(err) === 'PACKAGE_IS_FREE') return claimFree(packageId);
        return { kind: 'notice', notice: describeBackendFailure(err, 'payment_intent', ref) };
      }

      // The backend key always matches the secret key that minted the
      // PaymentIntent (same mode, same account); the build key is the fallback.
      const publishableKey = secrets.publishableKey || resolveStripePublishableKey();
      if (!publishableKey) {
        return { kind: 'notice', notice: describeMissingPublishableKey(ref) };
      }

      let init: { error?: StripeSdkError } | undefined;
      try {
        await sdk.initStripe({
          publishableKey,
          urlScheme: STRIPE_URL_SCHEME,
          setReturnUrlSchemeOnAndroid: true,
        });
        init = await sdk.initPaymentSheet({
          merchantDisplayName: MERCHANT_DISPLAY_NAME,
          customerId: secrets.customerId,
          customerEphemeralKeySecret: secrets.ephemeralKey,
          paymentIntentClientSecret: secrets.clientSecret,
          returnURL: STRIPE_RETURN_URL,
          allowsDelayedPaymentMethods: false,
          style: colorScheme === 'dark' ? 'alwaysDark' : 'alwaysLight',
          appearance,
        });
      } catch {
        return { kind: 'notice', notice: describeSheetCrash('sheet_init', ref) };
      }
      if (init?.error) {
        return { kind: 'notice', notice: describeSheetFailure(init.error, 'sheet_init', ref) };
      }

      let presented: { error?: StripeSdkError } | undefined;
      try {
        presented = await sdk.presentPaymentSheet();
      } catch {
        return { kind: 'notice', notice: describeSheetCrash('sheet_present', ref) };
      }
      if (presented?.error) {
        if (isSheetCanceled(presented.error)) return { kind: 'canceled' };
        return { kind: 'notice', notice: describeSheetFailure(presented.error, 'sheet_present', ref) };
      }
      // Stripe confirmed the payment; this attempt's key is spent.
      attemptRef.current = null;
      return { kind: 'paid' };
    },
    [appearance, attemptKeyFor, claimFree, colorScheme],
  );

  /** Wait (bounded) for the webhook to activate the plan. */
  const waitForEntitlement = useCallback(async (): Promise<boolean> => {
    for (const delay of entitlementPollDelaysMs) {
      if (delay > 0) await wait(delay);
      if (!mountedRef.current) return false;
      try {
        const res = await clientPaymentsApi.getEntitlement();
        if (res.ok && res.data?.active === true) return true;
      } catch {
        // keep polling; the payment itself is already confirmed
      }
    }
    return false;
  }, [entitlementPollDelaysMs]);

  const handleSelectPlan = useCallback(async () => {
    const pkg = packages.find((p) => p.id === selectedId);
    if (!pkg || inFlightRef.current) return;
    inFlightRef.current = true;
    setNotice(null);
    setPhase('paying');

    let outcome: Outcome;
    try {
      if (pkg.billing_type === 'recurring') {
        outcome = {
          kind: 'notice',
          notice: infoNotice('recurring_elsewhere', PACKAGE_PAYMENT_COPY.recurringElsewhere),
        };
      } else if (pkg.price_cents === 0) {
        outcome = await claimFree(pkg.id);
      } else {
        outcome = await payWithSheet(pkg.id);
      }
    } catch {
      // Anything not mapped above (e.g. no secure random source for the key).
      const ref = attemptRef.current ? shortReference(attemptRef.current.key) : null;
      const n: PackagePaymentNotice = {
        cause: 'unexpected',
        message: PACKAGE_PAYMENT_COPY.unknown(ref),
        support: true,
        reference: ref,
      };
      reportPackagePaymentFailure('config', n);
      outcome = { kind: 'notice', notice: n };
    }

    if (!mountedRef.current) {
      inFlightRef.current = false;
      return;
    }
    if (outcome.kind === 'paid') {
      setFreePlan(outcome.free === true);
      setPhase('confirming');
      const active = await waitForEntitlement();
      void refreshEntitlement().catch(() => false);
      inFlightRef.current = false;
      if (!mountedRef.current) return;
      if (active) {
        onPaymentSuccess();
      } else {
        setPhase('confirmed_pending');
      }
      return;
    }
    inFlightRef.current = false;
    // Canceled: the client closed the card form; stay on the sheet, no message.
    if (outcome.kind === 'notice') setNotice(outcome.notice);
    setPhase('idle');
  }, [packages, selectedId, claimFree, payWithSheet, waitForEntitlement, refreshEntitlement, onPaymentSuccess]);

  // ── Skip ──────────────────────────────────────────────────────────────────
  const busy = phase === 'paying' || phase === 'confirming';
  const handleSkip = useCallback(() => {
    if (busy) return; // never close the sheet in the middle of a payment
    if (dismissedKey) {
      prefsStorage
        .set(dismissedKey, new Date().toISOString())
        .catch(() => {});
    }
    onDismiss();
  }, [busy, onDismiss, dismissedKey]);

  if (!visible || !ready) return null;

  const paid = phase === 'confirmed_pending';
  const ctaDisabled = paid ? false : !selectedId || busy;

  return (
    <Modal
      visible={visible && ready}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={paid ? onPaymentSuccess : handleSkip}
    >
      <View style={styles.sheet}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.handleBar} />

          <Text style={styles.heading}>Choose your plan</Text>
          <Text style={styles.subtext}>Start with a plan that fits your goals.</Text>

          {/* Package cards */}
          {loading ? (
            <>
              <SkeletonCard styles={styles} />
              <SkeletonCard styles={styles} />
            </>
          ) : (
            packages.map((pkg) => {
              const isSelected = pkg.id === selectedId;
              return (
                <Pressable
                  key={pkg.id}
                  style={[
                    styles.packageCard,
                    isSelected && styles.packageCardSelected,
                  ]}
                  onPress={() => {
                    if (busy || paid) return;
                    setSelectedId(pkg.id);
                    setNotice(null);
                  }}
                  accessibilityRole="radio"
                  accessibilityLabel={`${pkg.name}, ${formatPriceLabel(pkg)}`}
                  accessibilityState={{ selected: isSelected, disabled: busy || paid }}
                  testID={`package-card-${pkg.id}`}
                >
                  <Text style={styles.packageName}>{pkg.name}</Text>
                  <Text style={styles.packagePrice}>{formatPriceLabel(pkg)}</Text>
                  {pkg.description ? (
                    <Text style={styles.packageDesc} numberOfLines={2}>
                      {pkg.description}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })
          )}

          {/* Payment progress */}
          {phase === 'confirming' || paid ? (
            <Text
              style={styles.statusText}
              accessibilityLiveRegion="polite"
              testID={paid ? 'payment-confirmed-pending' : 'payment-confirming'}
            >
              {freePlan
                ? paid
                  ? PACKAGE_PAYMENT_COPY.confirmedPendingFree
                  : PACKAGE_PAYMENT_COPY.confirmingFree
                : paid
                  ? PACKAGE_PAYMENT_COPY.confirmedPending
                  : PACKAGE_PAYMENT_COPY.confirming}
            </Text>
          ) : null}

          {/* Inline notice */}
          {notice ? (
            <View style={styles.noticeWrap}>
              <Text
                style={notice.tone === 'info' ? styles.infoText : styles.errorText}
                accessibilityRole="alert"
                accessibilityLiveRegion="polite"
                testID="payment-error"
              >
                {notice.message}
              </Text>
              {notice.support ? (
                <>
                  {notice.reference ? (
                    <Text selectable style={styles.referenceText} testID="payment-error-reference">
                      {`Reference ${notice.reference}`}
                    </Text>
                  ) : null}
                  <Pressable
                    onPress={() => {
                      void supportEmail.open();
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={PACKAGE_PAYMENT_COPY.supportAction}
                    hitSlop={8}
                    style={styles.supportBtn}
                    testID="payment-support"
                  >
                    <Text style={styles.supportText}>{PACKAGE_PAYMENT_COPY.supportAction}</Text>
                  </Pressable>
                  <SupportEmailFallback
                    handle={supportEmail}
                    textStyle={styles.infoText}
                    linkColor={semanticColors.accentText}
                    testID="payment-support-fallback"
                  />
                </>
              ) : null}
            </View>
          ) : null}

          {/* CTA */}
          <TouchableOpacity
            style={[
              styles.ctaBtn,
              ctaDisabled && styles.ctaBtnDisabled,
            ]}
            onPress={paid ? onPaymentSuccess : handleSelectPlan}
            disabled={ctaDisabled}
            accessibilityRole="button"
            accessibilityLabel={paid ? 'Continue' : 'Select this plan'}
            accessibilityState={{ disabled: ctaDisabled, busy }}
            testID="select-plan-btn"
          >
            <Text style={styles.ctaBtnText}>{paid ? 'Continue' : 'Select this plan'}</Text>
          </TouchableOpacity>

          {/* Skip */}
          {paid ? null : (
            <TouchableOpacity
              style={styles.skipBtn}
              onPress={handleSkip}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Skip for now"
              accessibilityState={{ disabled: busy }}
              testID="skip-package-btn"
            >
              <Text style={styles.skipText}>Skip for now</Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (semanticColors: SemanticTokens, tokens: Tokens) =>
  StyleSheet.create({
    sheet: {
      flex: 1,
      backgroundColor: semanticColors.bgPrimary,
      borderTopWidth: 1,
      borderTopColor: semanticColors.border,
    },
    scrollContent: {
      paddingHorizontal: 24,
      paddingTop: 16,
      paddingBottom: 40,
    },
    handleBar: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: semanticColors.border,
      marginBottom: 24,
    },
    heading: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 28,
      lineHeight: 32,
      color: semanticColors.textPrimary,
      marginBottom: 8,
    },
    subtext: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: semanticColors.textMuted,
      lineHeight: 22,
      marginBottom: 24,
    },
    // Package cards
    packageCard: {
      borderWidth: 1,
      borderColor: semanticColors.border,
      borderRadius: 2,
      padding: 16,
      marginBottom: 12,
      backgroundColor: semanticColors.bgSurface,
    },
    packageCardSelected: {
      borderColor: semanticColors.accent,
      backgroundColor: tokens.brand[50],
    },
    packageName: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
      color: semanticColors.textPrimary,
      marginBottom: 4,
    },
    packagePrice: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: semanticColors.textMuted,
      marginBottom: 6,
    },
    packageDesc: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: semanticColors.textMuted,
      lineHeight: 19,
    },
    // Skeleton
    skeletonCard: {
      borderWidth: 1,
      borderColor: semanticColors.border,
      borderRadius: 2,
      padding: 16,
      marginBottom: 12,
      backgroundColor: semanticColors.bgSurface,
    },
    skeletonLine: {
      borderRadius: 2,
      backgroundColor: semanticColors.border,
    },
    // Notices
    noticeWrap: {
      marginBottom: 12,
    },
    errorText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: tokens.colors.error,
      lineHeight: 19,
    },
    infoText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: semanticColors.textPrimary,
      lineHeight: 19,
    },
    statusText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: semanticColors.textPrimary,
      lineHeight: 19,
      marginBottom: 12,
    },
    referenceText: {
      fontFamily: 'Inter_500Medium',
      fontSize: 13,
      color: semanticColors.textMuted,
      marginTop: 6,
    },
    supportBtn: {
      minHeight: 44,
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    supportText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 13,
      color: semanticColors.accentText,
      textDecorationLine: 'underline',
    },
    // CTA
    ctaBtn: {
      backgroundColor: semanticColors.accent,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 8,
    },
    ctaBtnDisabled: { opacity: 0.5 },
    ctaBtnText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
      color: semanticColors.textOnAccent,
      letterSpacing: 1.2,
    },
    // Skip
    skipBtn: {
      paddingVertical: 16,
      alignItems: 'center',
    },
    skipText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: semanticColors.textMuted,
    },
  });
