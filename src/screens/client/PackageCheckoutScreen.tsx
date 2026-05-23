/**
 * PackageCheckoutScreen — client-facing landing page for a coach's package
 * share link. Renders the offering, then mints a Stripe Checkout Session
 * and opens the hosted page in a browser sheet.
 *
 * Why Stripe Checkout (web sheet) and not PaymentSheet in-app:
 *   • The mobile build is in Expo's managed workflow. PaymentSheet from
 *     @stripe/stripe-react-native requires a native module + Expo config
 *     plugin and a dev-client. Adding that ships a new native binary,
 *     which is outside the pre-TestFlight scope.
 *   • Stripe Checkout has the same compliance + UX guarantees (Apple Pay,
 *     Link, 3DS, SCA) and works in the existing managed binary.
 *   • The backend response leaves the door open for PaymentSheet: if it
 *     returns `paymentIntentClientSecret` + `ephemeralKey` + `customerId`
 *     + `publishableKey`, a future build can swap the open-browser call
 *     for `presentPaymentSheet()` without touching the contract.
 *
 * Real-or-flagged: a `CHECKOUT_NOT_CONFIGURED` / 404 / 503 response is
 * surfaced as an actionable error — never a synthesized success.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import type { NavigationProp, ParamListBase, RouteProp } from '@react-navigation/native';

import { publicPackagesApi, PublicPackageView, CheckoutSessionResponse } from '../../api/packagesApi';
import { errorCode, errorMessage, errorStatus } from '../../types/common';
import { assertStripeUrl } from '../../utils/stripeUrlValidator';
import { isValidPackageShareToken } from '../../utils/packageShare';
import { mediumTap, successTap, warningTap } from '../../utils/haptics';
import { track } from '../../lib/analytics';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { formatCurrencyCents } from '../../utils/currency';

type ParamList = {
  PackageCheckout: { shareToken: string };
};

interface Props {
  navigation: NavigationProp<ParamListBase>;
  route: RouteProp<ParamList, 'PackageCheckout'>;
}

function intervalCopy(p: PublicPackageView): string {
  if (p.billingInterval === 'one_time') return 'one-time payment';
  const unit =
    p.billingInterval === 'monthly'
      ? 'month'
      : p.billingInterval === 'quarterly'
      ? 'quarter'
      : 'year';
  const every = p.intervalCount > 1 ? `every ${p.intervalCount} ${unit}s` : `per ${unit}`;
  return `billed ${every}`;
}

export default function PackageCheckoutScreen({ navigation, route }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { shareToken } = route.params;
  const [pkg, setPkg] = useState<PublicPackageView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ title: string; body: string } | null>(null);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    if (!isValidPackageShareToken(shareToken)) {
      setError({
        title: 'Link not valid',
        body: 'This link is not valid. Ask your coach for an updated link.',
      });
      setLoading(false);
      return;
    }
    try {
      const res = await publicPackagesApi.getByShareToken(shareToken);
      setPkg(res.data);
    } catch (err) {
      const httpCode = errorStatus(err);
      const code = errorCode(err);
      if (httpCode === 404) {
        setError({
          title: 'Link not found',
          body: 'This package link has expired or been removed. Ask your coach for an updated link.',
        });
      } else if (code === 'PACKAGES_NOT_CONFIGURED') {
        setError({
          title: 'Not available yet',
          body: errorMessage(
            err,
            'Coach packages are not available in this environment yet.',
          ),
        });
      } else {
        setError({
          title: 'Could not load this package',
          body: errorMessage(err, 'Please check your connection and try again.'),
        });
      }
    } finally {
      setLoading(false);
    }
  }, [shareToken]);

  useEffect(() => {
    track('package_checkout_opened', { share_token: shareToken });
    load();
  }, [load, shareToken]);

  const handlePay = useCallback(async () => {
    if (!pkg) return;
    mediumTap();
    setPaying(true);
    try {
      // Backend `POST /v1/checkout/sessions` requires the resolved package
      // UUID (not the share token). We use the id returned from the public
      // share lookup. Default redirect URLs use the growthproject:// scheme
      // which the backend allow-list accepts.
      const res = await publicPackagesApi.createCheckoutSession(pkg.id);
      const data: CheckoutSessionResponse = res.data;
      if (!data.url) {
        // Real-or-flagged: backend can return a paymentIntent payload for a
        // future PaymentSheet path; for now we only know how to open URLs.
        warningTap();
        Alert.alert(
          'Checkout unavailable',
          'The server returned a payment intent without a hosted Checkout URL. Update the app or contact your coach to enable in-app payments on this environment.',
        );
        return;
      }
      track('package_checkout_session_created', { share_token: shareToken });
      try {
        assertStripeUrl(data.url, 'PackageCheckoutScreen');
      } catch {
        warningTap();
        Alert.alert(
          'Checkout unavailable',
          'Payment link is invalid. Please contact your coach.',
        );
        return;
      }
      const result = await WebBrowser.openBrowserAsync(data.url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      });
      // The webhook is the source of truth for subscription state. We
      // don't claim success based on the sheet closing — we just refresh
      // and trust the next /me load to reflect the new subscription.
      if (
        result.type === 'cancel' ||
        result.type === 'dismiss' ||
        result.type === 'opened'
      ) {
        successTap();
        track('package_checkout_returned', { share_token: shareToken });
      }
    } catch (err) {
      const code = errorCode(err);
      if (code === 'PACKAGES_NOT_CONFIGURED' || code === 'STRIPE_NOT_CONFIGURED') {
        Alert.alert(
          'Payments not enabled',
          errorMessage(err, 'Payments are not enabled in this environment.'),
        );
      } else if (code === 'CONNECT_ONBOARDING_INCOMPLETE') {
        Alert.alert(
          'Your coach is finishing setup',
          'This coach hasn\'t finished setting up payouts. Please check back shortly or message them directly.',
        );
      } else {
        Alert.alert(
          'Could not start checkout',
          errorMessage(err, 'Please try again in a moment.'),
        );
      }
    } finally {
      setPaying(false);
    }
  }, [pkg, shareToken]);

  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="close" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Coaching package</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.errorWrap}>
          <Ionicons name="alert-circle-outline" size={32} color={colors.textMuted} />
          <Text style={styles.errorTitle}>{error.title}</Text>
          <Text style={styles.errorBody}>{error.body}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : pkg ? (
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.coachCard}>
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="person" size={22} color={colors.textOnPrimary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.coachLabel}>Coached by</Text>
              <Text style={styles.coachName}>{pkg.coach.displayName}</Text>
              {pkg.coach.bio ? (
                <Text style={styles.coachBio} numberOfLines={3}>
                  {pkg.coach.bio}
                </Text>
              ) : null}
            </View>
          </View>

          <Text style={styles.title}>{pkg.title}</Text>
          {pkg.description ? (
            <Text style={styles.description}>{pkg.description}</Text>
          ) : null}

          <View style={styles.priceCard}>
            <Text style={styles.priceValue}>
              {formatCurrencyCents(pkg.priceCents, pkg.currency)}
            </Text>
            <Text style={styles.priceMeta}>{intervalCopy(pkg)}</Text>
            {pkg.trialDays ? (
              <Text style={styles.trialMeta}>
                Includes a {pkg.trialDays}-day free trial.
              </Text>
            ) : null}
          </View>

          {pkg.features.length > 0 ? (
            <View style={styles.featuresList}>
              <Text style={styles.featuresTitle}>What's included</Text>
              {pkg.features.map((f, i) => (
                <View key={i} style={styles.featureRow}>
                  <Ionicons
                    name="checkmark"
                    size={18}
                    color={colors.primary}
                    style={{ marginTop: 2 }}
                  />
                  <Text style={styles.featureText}>{f}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.payBtn, paying && styles.payBtnDisabled]}
            onPress={handlePay}
            disabled={paying}
            accessibilityRole="button"
            accessibilityLabel="Continue to payment"
          >
            {paying ? (
              <ActivityIndicator color={colors.textOnPrimary} />
            ) : (
              <>
                <Ionicons name="lock-closed" size={16} color={colors.textOnPrimary} />
                <Text style={styles.payBtnText}>
                  {pkg.trialDays
                    ? 'Start free trial'
                    : `Pay ${formatCurrencyCents(pkg.priceCents, pkg.currency)}`}
                </Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.fineprint}>
            Payment is processed securely by Stripe. Card details never touch
            this app or The Growth Project's servers.
          </Text>
        </ScrollView>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
    },
    backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    topTitle: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },
    loadingWrap: { paddingVertical: 60, alignItems: 'center' },
    errorWrap: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
      gap: 12,
    },
    errorTitle: {
      fontSize: 18,
      fontWeight: '500',
      color: colors.textPrimary,
      textAlign: 'center',
    },
    errorBody: {
      fontSize: 13,
      color: colors.textSecondary,
      textAlign: 'center',
      lineHeight: 18,
    },
    retryBtn: {
      marginTop: 8,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: 4,
      borderWidth: 1,
      borderColor: colors.primary,
    },
    retryText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
    content: { paddingHorizontal: 24, paddingBottom: 40 },
    coachCard: {
      flexDirection: 'row',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 14,
      marginBottom: 18,
      alignItems: 'flex-start',
    },
    avatarPlaceholder: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    coachLabel: {
      fontSize: 11,
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    coachName: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },
    coachBio: { fontSize: 13, color: colors.textSecondary, marginTop: 4, lineHeight: 18 },
    title: {
      fontFamily: 'CormorantGaramond_400Regular',
      fontSize: 28,
      color: colors.textPrimary,
      marginBottom: 8,
    },
    description: {
      fontSize: 15,
      color: colors.textSecondary,
      lineHeight: 22,
      marginBottom: 18,
    },
    priceCard: {
      backgroundColor: colors.surface,
      borderRadius: 4,
      padding: 18,
      marginBottom: 18,
    },
    priceValue: { fontSize: 32, fontWeight: '500', color: colors.textPrimary },
    priceMeta: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
    trialMeta: { fontSize: 13, color: colors.primary, marginTop: 6 },
    featuresList: {
      marginBottom: 24,
    },
    featuresTitle: {
      fontSize: 12,
      fontWeight: '500',
      color: colors.textSecondary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 10,
    },
    featureRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 8,
      alignItems: 'flex-start',
    },
    featureText: { flex: 1, fontSize: 14, color: colors.textPrimary, lineHeight: 20 },
    payBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.primary,
      paddingVertical: 16,
      borderRadius: 2,
    },
    payBtnDisabled: { opacity: 0.6 },
    payBtnText: { color: colors.textOnPrimary, fontSize: 16, fontWeight: '500' },
    fineprint: {
      marginTop: 12,
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
      lineHeight: 18,
    },
  });
