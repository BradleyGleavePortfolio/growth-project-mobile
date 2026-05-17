/**
 * PackageSelectionSheet — bottom sheet for coach package selection and
 * in-app Stripe payment.
 *
 * Rendered as a Modal (animationType='slide', presentationStyle='pageSheet')
 * so it feels like a native bottom sheet without a third-party dependency.
 *
 * Payment flow:
 *   1. On visible: GET /v1/clients/me/coach/packages
 *   2. User selects a package
 *   3. POST /v1/checkout/payment-intent → { client_secret, ephemeral_key,
 *      customer_id, publishable_key }
 *   4. stripe.initPaymentSheet() + stripe.presentPaymentSheet()
 *   5. Completed → onPaymentSuccess(); Cancel → stay on sheet; Error → inline
 *
 * 24-hour re-surface logic:
 *   MMKV key 'onboarding.package_prompt_dismissed_at' (ISO string).
 *   If set and < 24h ago → call onDismiss() immediately.
 *   If set and > 24h ago (or not set) → show sheet.
 *   Written on "Skip for now" tap.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useTheme, ThemeColors } from '../theme/ThemeProvider';
import { prefsStorage } from '../storage/mmkv';
import api from '../services/api';

// TODO: install @stripe/stripe-react-native when native build is configured.
// If the package is available, import { useStripe } from '@stripe/stripe-react-native';
let useStripe: (() => {
  initPaymentSheet: (params: Record<string, unknown>) => Promise<{ error?: { message: string } }>;
  presentPaymentSheet: () => Promise<{ error?: { message: string } }>;
}) | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const stripeModule = require('@stripe/stripe-react-native');
  useStripe = stripeModule.useStripe;
} catch {
  // @stripe/stripe-react-native not yet installed — payment sheet stubbed.
}

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

interface PaymentIntentResponse {
  client_secret: string;
  ephemeral_key: string;
  customer_id: string;
  publishable_key: string;
}

export interface PackageSelectionSheetProps {
  visible: boolean;
  onDismiss: () => void;
  onPaymentSuccess: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DISMISSED_KEY = 'onboarding.package_prompt_dismissed_at';
const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(priceCents: number, currency: string): string {
  const major = priceCents / 100;
  const code = currency.toUpperCase();
  // Common major-currency symbols
  const sym = code === 'USD' ? '$' : code === 'GBP' ? '£' : code === 'EUR' ? '€' : `${code} `;
  return `${sym}${major.toFixed(2)}`;
}

function formatPriceLabel(pkg: CoachPackage): string {
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
}: PackageSelectionSheetProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const stripe = useStripe ? useStripe() : null;

  const [packages, setPackages] = useState<CoachPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false); // passed 24h suppression check

  // ── 24h suppression gate ──────────────────────────────────────────────────
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      try {
        const dismissedAt = await prefsStorage.getStringAsync(DISMISSED_KEY);
        if (dismissedAt) {
          const elapsed = Date.now() - new Date(dismissedAt).getTime();
          if (elapsed < TWENTY_FOUR_HOURS) {
            // Suppressed — dismiss immediately
            if (!cancelled) onDismiss();
            return;
          }
        }
      } catch {
        // best-effort; show if check fails
      }
      if (!cancelled) setReady(true);
    })();
    return () => { cancelled = true; };
  }, [visible]);

  // ── Fetch packages when ready ─────────────────────────────────────────────
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedId(null);
    (async () => {
      try {
        const res = await api.get<{ packages: CoachPackage[] } | CoachPackage[]>(
          '/v1/clients/me/coach/packages',
        );
        // Backend may return { packages: [...] } or a bare array
        const data = res.data;
        const list: CoachPackage[] = Array.isArray(data)
          ? data
          : (data as { packages: CoachPackage[] }).packages ?? [];
        if (!cancelled) {
          if (list.length === 0) {
            onDismiss();
            return;
          }
          setPackages(list);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          // API error — dismiss quietly
          onDismiss();
        }
      }
    })();
    return () => { cancelled = true; };
  }, [ready]);

  // ── Payment ───────────────────────────────────────────────────────────────
  const handleSelectPlan = useCallback(async () => {
    if (!selectedId || paying) return;
    setError(null);
    setPaying(true);

    // Refuse to proceed when the native Stripe SDK is not available in this
    // build — previously this path stubbed out the payment by calling
    // onPaymentSuccess() without charging the card, which would silently
    // grant access in any environment that hadn't compiled in
    // @stripe/stripe-react-native.
    if (!stripe) {
      setError('Payment is not available in this build. Please contact support.');
      setPaying(false);
      return;
    }

    try {
      const intentRes = await api.post<PaymentIntentResponse>(
        '/v1/checkout/payment-intent',
        { package_id: selectedId },
      );
      const { client_secret, ephemeral_key, customer_id, publishable_key } =
        intentRes.data;

      const { error: initError } = await stripe.initPaymentSheet({
        merchantDisplayName: 'The Growth Project',
        customerId: customer_id,
        customerEphemeralKeySecret: ephemeral_key,
        paymentIntentClientSecret: client_secret,
        publishableKey: publishable_key,
        allowsDelayedPaymentMethods: false,
      });

      if (initError) {
        setError(initError.message ?? 'Could not initialise payment sheet.');
        setPaying(false);
        return;
      }

      const { error: presentError } = await stripe.presentPaymentSheet();

      if (presentError) {
        // User cancelled — no error shown; stay on sheet
        const isCancelled =
          presentError.message?.toLowerCase().includes('cancel') ||
          presentError.message?.toLowerCase().includes('dismiss');
        if (!isCancelled) {
          setError(presentError.message ?? 'Payment failed. Please try again.');
        }
        setPaying(false);
        return;
      }

      onPaymentSuccess();
    } catch (err) {
      const msg = (err as { message?: string })?.message ?? 'Payment failed. Please try again.';
      setError(msg);
      setPaying(false);
    }
  }, [selectedId, paying, stripe, onPaymentSuccess]);

  // ── Skip ──────────────────────────────────────────────────────────────────
  const handleSkip = useCallback(() => {
    prefsStorage
      .set(DISMISSED_KEY, new Date().toISOString())
      .catch(() => {});
    onDismiss();
  }, [onDismiss]);

  if (!visible || !ready) return null;

  return (
    <Modal
      visible={visible && ready}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleSkip}
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
                  onPress={() => setSelectedId(pkg.id)}
                  accessibilityRole="radio"
                  accessibilityLabel={`${pkg.name}, ${formatPriceLabel(pkg)}`}
                  accessibilityState={{ selected: isSelected }}
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

          {/* Inline error */}
          {error ? (
            <Text style={styles.errorText} testID="payment-error">{error}</Text>
          ) : null}

          {/* CTA */}
          <TouchableOpacity
            style={[
              styles.ctaBtn,
              (!selectedId || paying) && styles.ctaBtnDisabled,
            ]}
            onPress={handleSelectPlan}
            disabled={!selectedId || paying}
            accessibilityRole="button"
            accessibilityLabel="Select this plan"
            accessibilityState={{ disabled: !selectedId || paying }}
            testID="select-plan-btn"
          >
            <Text style={styles.ctaBtnText}>Select this plan</Text>
          </TouchableOpacity>

          {/* Skip */}
          <TouchableOpacity
            style={styles.skipBtn}
            onPress={handleSkip}
            accessibilityRole="button"
            accessibilityLabel="Skip for now"
            testID="skip-package-btn"
          >
            <Text style={styles.skipText}>Skip for now</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    sheet: {
      flex: 1,
      backgroundColor: colors.background,
      borderTopWidth: 1,
      borderTopColor: colors.border,
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
      backgroundColor: colors.border,
      marginBottom: 24,
    },
    heading: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 28,
      lineHeight: 32,
      color: colors.textPrimary,
      marginBottom: 8,
    },
    subtext: {
      fontFamily: 'Inter_400Regular',
      fontSize: 15,
      color: colors.textMuted,
      lineHeight: 22,
      marginBottom: 24,
    },
    // Package cards
    packageCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 2,
      padding: 16,
      marginBottom: 12,
      backgroundColor: colors.surface,
    },
    packageCardSelected: {
      borderColor: colors.primary,
      backgroundColor: colors.primaryPale,
    },
    packageName: {
      fontFamily: 'Inter_500Medium',
      fontSize: 15,
      color: colors.textPrimary,
      marginBottom: 4,
    },
    packagePrice: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textSecondary,
      marginBottom: 6,
    },
    packageDesc: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 19,
    },
    // Skeleton
    skeletonCard: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 2,
      padding: 16,
      marginBottom: 12,
      backgroundColor: colors.surface,
    },
    skeletonLine: {
      borderRadius: 2,
      backgroundColor: colors.border,
    },
    // Error
    errorText: {
      fontFamily: 'Inter_400Regular',
      fontSize: 13,
      color: colors.error,
      marginBottom: 12,
      lineHeight: 19,
    },
    // CTA
    ctaBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 8,
    },
    ctaBtnDisabled: { opacity: 0.5 },
    ctaBtnText: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
      color: colors.textOnPrimary,
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
      color: colors.textMuted,
    },
  });
