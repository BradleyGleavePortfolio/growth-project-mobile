/**
 * CheckoutReturnScreen — handles the deep-link return from Stripe Checkout.
 *
 * Routes:
 *   tgp://checkout/success?session_id=<sid>  → outcome === 'success'
 *   tgp://checkout/cancel                    → outcome === 'cancel'
 *
 * On success we call `GET /v1/checkout/sessions/:id/confirm` (the real
 * CheckoutController confirm route) to verify the session actually
 * completed before showing a celebratory state — Stripe webhooks may not
 * have landed by the time the user is back in the app, so we re-fetch
 * payment status from the backend. On cancel we route back to the
 * packages screen without a celebration.
 *
 * History: this previously did `POST /clients/me/coach/checkout/confirm`,
 * which is both the wrong verb AND a non-existent path on the backend.
 * The 404 used to be swallowed as `reason: 'not_configured'`, which
 * silently kept the buyer in "confirmation pending" forever even though
 * the charge had succeeded. Both bugs are fixed here.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase, RouteProp, useRoute } from '@react-navigation/native';

import {
  clientPaymentsApi,
  type ClientPaymentStatus,
} from '../../api/clientPaymentsApi';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { featureFlags } from '../../config/featureFlags';

type CheckoutReturnRoute = RouteProp<
  Record<string, { outcome?: 'success' | 'cancel'; session_id?: string } | undefined>,
  string
>;

export default function CheckoutReturnScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute<CheckoutReturnRoute>();
  const outcome = route.params?.outcome ?? 'success';
  const sessionId = route.params?.session_id;

  const [status, setStatus] = useState<ClientPaymentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(outcome === 'success');
  // PR-15B — once the confirm lands and we have a real ClientPurchase id,
  // we forward the buyer to the PurchaseUnpack screen for the
  // "here's what you just got" moment. The unpack screen is gated behind
  // `featureFlags.deliverables` (same flag the persistent Deliverables
  // surface uses) so this is a no-op in production until ops flips it.
  const [didUnpackNav, setDidUnpackNav] = useState(false);

  useEffect(() => {
    if (outcome !== 'success') return;
    let cancelled = false;
    (async () => {
      // The confirm endpoint reports `paid` but does NOT carry the
      // ClientPurchase row id (see clientPaymentsApi.confirmCheckoutSession
      // — `purchase_id: null` by design). For the PR-15B unpack
      // navigation we need a real purchase id, so on a successful confirm
      // we ALSO call getPaymentStatus() which reads from
      // GET /v1/checkout/purchases and returns the active purchase id.
      // This is one extra call only on the success path; on cancel /
      // missing session id we already did getPaymentStatus directly.
      const confirmRes = sessionId
        ? await clientPaymentsApi.confirmCheckoutSession(sessionId)
        : await clientPaymentsApi.getPaymentStatus();
      if (cancelled) return;
      if (!confirmRes.ok) {
        if (confirmRes.reason === 'not_configured') {
          setError(
            'Backend not configured — your coach will need to confirm payment manually.',
          );
        } else {
          setError(confirmRes.message);
        }
        setLoading(false);
        return;
      }
      let confirmedStatus = confirmRes.data;
      // If we don't already have a purchase_id (confirm response doesn't
      // include it), reconcile with getPaymentStatus() to find the active
      // ClientPurchase row id.
      if (!confirmedStatus.purchase_id) {
        const statusRes = await clientPaymentsApi.getPaymentStatus();
        if (cancelled) return;
        if (statusRes.ok && statusRes.data.purchase_id) {
          confirmedStatus = {
            ...confirmedStatus,
            purchase_id: statusRes.data.purchase_id,
            package_id: confirmedStatus.package_id ?? statusRes.data.package_id,
            package_name:
              confirmedStatus.package_name ?? statusRes.data.package_name,
            current_period_end:
              confirmedStatus.current_period_end ??
              statusRes.data.current_period_end,
          };
        }
      }
      setStatus(confirmedStatus);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [outcome, sessionId]);

  // PR-15B nav handoff: once we have a confirmed `paid` status + a real
  // ClientPurchase id and the deliverables flag is enabled, swap the
  // unpack screen IN PLACE of the confirmation screen. We use
  // `navigation.replace` (when available on the native stack) instead
  // of `navigate` so a back-swipe from PurchaseUnpack lands on the
  // caller (More tab / packages screen / deep-link origin), not on
  // the bare "You are subscribed" confirm screen — the buyer just
  // completed the purchase, so re-presenting the confirm state on
  // back-swipe would be a weird dead-end. Falls back to `navigate` on
  // navigator types that don't expose `replace` (bottom-tab parents).
  useEffect(() => {
    if (didUnpackNav) return;
    if (!featureFlags.deliverables) return;
    if (outcome !== 'success') return;
    if (!status) return;
    const isPaying = status.state === 'active' || status.state === 'trialing';
    if (!isPaying) return;
    if (!status.purchase_id) return;
    setDidUnpackNav(true);
    const params = {
      purchaseId: status.purchase_id,
      packageName: status.package_name ?? undefined,
    };
    const navAny = navigation as unknown as {
      replace?: (n: string, p: typeof params) => void;
      navigate: (n: string, p: typeof params) => void;
    };
    if (typeof navAny.replace === 'function') {
      navAny.replace('PurchaseUnpack', params);
    } else {
      navAny.navigate('PurchaseUnpack', params);
    }
  }, [didUnpackNav, outcome, status, navigation]);

  const goPackages = () => {
    // The packages screen lives on the MoreStack; navigate via parent to hop tabs.
    const parent = navigation.getParent?.();
    if (parent?.navigate) {
      parent.navigate('MoreTab', { screen: 'ClientPackages' });
    } else {
      navigation.navigate('ClientPackages' as never);
    }
  };
  const goHome = () => {
    const parent = navigation.getParent?.();
    if (parent?.navigate) {
      parent.navigate('Home');
    } else {
      navigation.navigate('Home' as never);
    }
  };

  if (outcome === 'cancel') {
    return (
      <View style={styles.container}>
        <Ionicons name="close-circle-outline" size={64} color={colors.textMuted} />
        <Text style={styles.title}>Checkout canceled</Text>
        <Text style={styles.body}>
          No charge was made. You can try again whenever you're ready.
        </Text>
        <TouchableOpacity style={styles.cta} onPress={goPackages} accessibilityRole="button">
          <Text style={styles.ctaText}>Back to plans</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color={colors.primary} size="large" />
        <Text style={styles.title}>Confirming payment…</Text>
        <Text style={styles.body}>
          We're verifying your subscription with Stripe. This usually takes a
          few seconds.
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <Ionicons name="alert-circle-outline" size={64} color={colors.warning} />
        <Text style={styles.title}>Payment received — confirmation pending</Text>
        <Text style={styles.body}>
          Stripe accepted the charge, but the app couldn't confirm with the
          backend yet: {error}
        </Text>
        <Text style={styles.body}>
          You'll see access activate within a few minutes. If not, message
          your coach.
        </Text>
        <TouchableOpacity style={styles.cta} onPress={goHome} accessibilityRole="button">
          <Text style={styles.ctaText}>Go to home</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isPaying = status?.state === 'active' || status?.state === 'trialing';

  return (
    <View style={styles.container}>
      <Ionicons
        name={isPaying ? 'checkmark-circle' : 'time-outline'}
        size={64}
        color={isPaying ? colors.success : colors.warning}
      />
      <Text style={styles.title}>
        {isPaying ? 'You are subscribed' : 'Payment received'}
      </Text>
      <Text style={styles.body}>
        {isPaying && status?.package_name
          ? `Welcome to ${status.package_name}. Your coach has been notified.`
          : 'Your coach has been notified — access activates within a few minutes.'}
      </Text>
      <TouchableOpacity style={styles.cta} onPress={goHome} accessibilityRole="button">
        <Text style={styles.ctaText}>Go to home</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      backgroundColor: colors.background,
    },
    title: {
      fontSize: 22,
      fontWeight: '600',
      color: colors.textPrimary,
      marginTop: 16,
      textAlign: 'center',
    },
    body: {
      fontSize: 14,
      color: colors.textSecondary,
      lineHeight: 20,
      textAlign: 'center',
      marginTop: 12,
    },
    cta: {
      marginTop: 28,
      backgroundColor: colors.primary,
      paddingHorizontal: 28,
      paddingVertical: 12,
      borderRadius: 10,
    },
    ctaText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 15 },
  });
