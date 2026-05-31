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
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// Apple Rule 3.1.3(b)/(e) B2B exemption — Stripe checkout opens inside the
// in-app branded webview, NOT expo-web-browser. The BrandedCheckoutWebView
// screen owns the URL allow-list, deep-link short-circuit, and the
// CheckoutReturn refresh that keeps webhook-derived state authoritative.
import type { NavigationProp, ParamListBase, RouteProp } from '@react-navigation/native';

import {
  publicPackagesApi,
  PublicPackageView,
  CheckoutSessionResponse,
  PACKAGE_CHECKOUT_RETURN_SCHEME,
} from '../../api/packagesApi';
import { errorCode, errorMessage, errorStatus } from '../../types/common';
import { assertStripeUrl } from '../../utils/stripeUrlValidator';
import { isValidPackageShareToken } from '../../utils/packageShare';
import { mediumTap, successTap, warningTap } from '../../utils/haptics';
import { track } from '../../lib/analytics';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens, Tokens } from '../../theme/tokens';
import PackageDetailSurface, {
  type PackageDetailViewModel,
} from './packageDetail/PackageDetailSurface';

type ParamList = {
  PackageCheckout: { shareToken: string };
};

interface Props {
  navigation: NavigationProp<ParamListBase>;
  route: RouteProp<ParamList, 'PackageCheckout'>;
}

// Adapt the public buyer model into the shared surface's normalized shape.
function toDetailViewModel(p: PublicPackageView): PackageDetailViewModel {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    priceCents: p.priceCents,
    currency: p.currency,
    billingInterval: p.billingInterval,
    intervalCount: p.intervalCount,
    trialDays: p.trialDays,
    features: p.features,
    coach: { displayName: p.coach.displayName, bio: p.coach.bio },
  };
}

export default function PackageCheckoutScreen({ navigation, route }: Props) {
  const { semanticColors, tokens } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors, tokens), [semanticColors, tokens]);
  const { shareToken } = route.params;
  const [pkg, setPkg] = useState<PublicPackageView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ title: string; body: string } | null>(null);
  const [paying, setPaying] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    // Defense-in-depth: a missing/null shareToken should never reach the API.
    // The backend share-token endpoint is a Wave 4 dependency (not yet
    // shipped), so the only valid path here today is a fully-formed token
    // that the validator accepts. Anything else gets a clear "not yet active"
    // message instead of a silent 404.
    if (shareToken == null || shareToken === '') {
      setError({
        title: 'This link is not yet active',
        body: 'Coach package share links are coming soon. Ask your coach for an updated link.',
      });
      setLoading(false);
      return;
    }
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
      // share lookup. The default redirect URLs minted in packagesApi use the
      // backend-accepted `com.growthproject.app://checkout/success` /
      // `.../checkout/cancel` deep links — the SAME scheme + path that the
      // BrandedCheckoutWebView parser (`returnScheme` below) and RootNavigator
      // intercept, so a completed Stripe payment is reliably routed to
      // CheckoutReturn for confirmation.
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
      // Apple Rule 3.1.3(b)/(e) B2B exemption — open Stripe Checkout in the
      // branded in-app webview rather than expo-web-browser. The webview owns
      // the URL allow-list, deep-link short-circuit, and refresh; webhooks
      // remain the source of truth for subscription state.
      successTap();
      track('package_checkout_returned', { share_token: shareToken });
      (
        navigation as unknown as {
          navigate: (
            name: string,
            params: { checkoutUrl: string; packageName: string; returnScheme: string },
          ) => void;
        }
      ).navigate('BrandedCheckoutWebView', {
        checkoutUrl: data.url,
        packageName: pkg?.title ?? 'Coaching package',
        // MUST match the scheme of the success_url/cancel_url minted by
        // createCheckoutSession (PACKAGE_CHECKOUT_SUCCESS_URL/_CANCEL_URL).
        // Mismatched schemes mean the webview never intercepts the Stripe
        // return redirect and the buyer is stranded after paying (P0).
        returnScheme: PACKAGE_CHECKOUT_RETURN_SCHEME,
      });
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
          <Ionicons name="close" size={24} color={semanticColors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>Coaching package</Text>
        <View style={styles.backBtn} />
      </View>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={semanticColors.accent} />
        </View>
      ) : error ? (
        <View style={styles.errorWrap}>
          <Ionicons name="alert-circle-outline" size={32} color={semanticColors.textMuted} />
          <Text style={styles.errorTitle}>{error.title}</Text>
          <Text style={styles.errorBody}>{error.body}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={load}>
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : pkg ? (
        <PackageDetailSurface
          package={toDetailViewModel(pkg)}
          mode="buyer"
          onPay={handlePay}
          paying={paying}
        />
      ) : null}
    </View>
  );
}

const makeStyles = (semanticColors: SemanticTokens, tokens: Tokens) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: semanticColors.bgPrimary },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingTop: 56,
      paddingBottom: 12,
    },
    backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    topTitle: {
      fontFamily: tokens.typography.bodyMd.fontFamily,
      fontSize: 16,
      fontWeight: '500',
      color: semanticColors.textPrimary,
    },
    loadingWrap: { paddingVertical: 60, alignItems: 'center' },
    errorWrap: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
      gap: 12,
    },
    errorTitle: {
      fontFamily: tokens.typography.h3.fontFamily,
      fontSize: 18,
      fontWeight: '500',
      color: semanticColors.textPrimary,
      textAlign: 'center',
    },
    errorBody: {
      fontSize: 13,
      color: semanticColors.textMuted,
      textAlign: 'center',
      lineHeight: 18,
    },
    retryBtn: {
      marginTop: 8,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: semanticColors.accent,
    },
    retryText: { color: semanticColors.accent, fontSize: 14, fontWeight: '600' },
  });
