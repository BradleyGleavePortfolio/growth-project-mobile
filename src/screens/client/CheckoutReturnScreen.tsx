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

  useEffect(() => {
    if (outcome !== 'success') return;
    let cancelled = false;
    (async () => {
      const res = sessionId
        ? await clientPaymentsApi.confirmCheckoutSession(sessionId)
        : await clientPaymentsApi.getPaymentStatus();
      if (cancelled) return;
      if (res.ok) {
        setStatus(res.data);
      } else if (res.reason === 'not_configured') {
        setError(
          'Backend not configured — your coach will need to confirm payment manually.',
        );
      } else {
        setError(res.message);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [outcome, sessionId]);

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
