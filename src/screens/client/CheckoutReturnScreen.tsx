/**
 * CheckoutReturnScreen — handles the deep-link return from Stripe Checkout.
 *
 * Routes (the Stripe return scheme minted by packagesApi):
 *   com.growthproject.app://checkout/success?session_id=<sid> → 'success'
 *   com.growthproject.app://checkout/cancel                   → 'cancel'
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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useNavigation, NavigationProp, ParamListBase, RouteProp, useRoute } from '@react-navigation/native';

import {
  clientPaymentsApi,
  type ClientPaymentStatus,
} from '../../api/clientPaymentsApi';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens, Tokens } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';

type CheckoutReturnRoute = RouteProp<
  Record<string, { outcome?: 'success' | 'cancel'; session_id?: string } | undefined>,
  string
>;

export default function CheckoutReturnScreen() {
  const { semanticColors, tokens } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors, tokens), [semanticColors, tokens]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute<CheckoutReturnRoute>();
  const outcome = route.params?.outcome ?? 'success';
  const sessionId = route.params?.session_id;

  const [status, setStatus] = useState<ClientPaymentStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(outcome === 'success');

  // ─── Success peak-moment (PR-18 M1 R2 P0) ────────────────────────────────
  // The paid confirmation is the peak of the buyer journey. Rather than a
  // static icon + line + button (an "Empty Confirmation" anti-pattern), we
  // fire a single calibrated success haptic and animate a brief, premium
  // closure moment: the check badge springs in, then the copy + CTA reveal.
  // Everything degrades to its final state on the first frame when the user
  // has Reduce Motion enabled (or in the test harness), so the screen is
  // never gated on animation completing.
  const badgeScale = useRef(new Animated.Value(0.6)).current;
  const badgeOpacity = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(0)).current;
  const contentTranslate = useRef(new Animated.Value(12)).current;
  const didCelebrate = useRef(false);
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

  const isPaying = status?.state === 'active' || status?.state === 'trialing';

  // Fire the success haptic + reveal animation exactly once, the moment a
  // confirmed paying state lands. Guarded by `didCelebrate` so a re-render
  // (or a status reconcile) cannot double-fire the haptic.
  useEffect(() => {
    if (outcome !== 'success') return;
    if (loading || error) return;
    if (!isPaying) return;
    if (didCelebrate.current) return;
    didCelebrate.current = true;

    // Success haptic — fire-and-forget; never block the UI on it and never
    // let a missing haptic engine (simulator) throw.
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => {},
    );

    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduceMotion) => {
        if (cancelled) return;
        if (reduceMotion) {
          badgeScale.setValue(1);
          badgeOpacity.setValue(1);
          contentOpacity.setValue(1);
          contentTranslate.setValue(0);
          return;
        }
        Animated.sequence([
          Animated.parallel([
            Animated.spring(badgeScale, {
              toValue: 1,
              friction: 5,
              tension: 120,
              useNativeDriver: true,
            }),
            Animated.timing(badgeOpacity, {
              toValue: 1,
              duration: 220,
              useNativeDriver: true,
            }),
          ]),
          Animated.parallel([
            Animated.timing(contentOpacity, {
              toValue: 1,
              duration: 280,
              useNativeDriver: true,
            }),
            Animated.timing(contentTranslate, {
              toValue: 0,
              duration: 280,
              useNativeDriver: true,
            }),
          ]),
        ]).start();
      })
      .catch(() => {
        // If the reduce-motion probe fails, fall back to the final state so
        // the confirmation is never stuck invisible.
        badgeScale.setValue(1);
        badgeOpacity.setValue(1);
        contentOpacity.setValue(1);
        contentTranslate.setValue(0);
      });
    return () => {
      cancelled = true;
    };
  }, [
    outcome,
    loading,
    error,
    isPaying,
    badgeScale,
    badgeOpacity,
    contentOpacity,
    contentTranslate,
  ]);

  const goUnpack = () => {
    // Primary next-step: take the buyer straight into "here's what you got"
    // when we have a real purchase to unpack and the deliverables surface is
    // live. Otherwise fall back to home. Only ONE primary decision is shown.
    if (featureFlags.deliverables && status?.purchase_id) {
      const params = {
        purchaseId: status.purchase_id,
        packageName: status.package_name ?? undefined,
      };
      const navAny = navigation as unknown as {
        replace?: (n: string, p: typeof params) => void;
        navigate: (n: string, p: typeof params) => void;
      };
      if (typeof navAny.replace === 'function') navAny.replace('PurchaseUnpack', params);
      else navAny.navigate('PurchaseUnpack', params);
      return;
    }
    goHome();
  };

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
        <Ionicons name="close-circle-outline" size={64} color={semanticColors.textMuted} />
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
        <ActivityIndicator color={semanticColors.accent} size="large" />
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
        <Ionicons name="alert-circle-outline" size={64} color={tokens.semantic.warning.icon} />
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

  // Confirmed-paid peak moment. The check badge springs in, then the
  // package-specific copy + single primary next-step reveal. One primary
  // decision only ("See what's included" when there's something to unpack,
  // else "Go to home"); a quiet secondary link is non-competing.
  if (isPaying) {
    const packageName = status?.package_name?.trim();
    const hasUnpack = featureFlags.deliverables && !!status?.purchase_id;
    const primaryLabel = hasUnpack ? "See what's included" : 'Go to home';
    return (
      <View style={styles.container}>
        <Animated.View
          style={[
            styles.successBadge,
            { opacity: badgeOpacity, transform: [{ scale: badgeScale }] },
          ]}
        >
          <Ionicons name="checkmark-circle" size={88} color={tokens.colors.forest} />
        </Animated.View>
        <Animated.View
          style={{ opacity: contentOpacity, transform: [{ translateY: contentTranslate }], alignItems: 'center' }}
        >
          <Text style={styles.successEyebrow}>You're in</Text>
          <Text style={styles.title}>
            {packageName ? `Welcome to ${packageName}` : "You're subscribed"}
          </Text>
          <Text style={styles.body}>
            {packageName
              ? `Your spot in ${packageName} is confirmed and your coach has been notified. Here's what happens next.`
              : 'Your subscription is confirmed and your coach has been notified. Here\'s what happens next.'}
          </Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={hasUnpack ? goUnpack : goHome}
            accessibilityRole="button"
            accessibilityLabel={primaryLabel}
          >
            <Text style={styles.ctaText}>{primaryLabel}</Text>
          </TouchableOpacity>
          {hasUnpack ? (
            <TouchableOpacity
              style={styles.secondaryLink}
              onPress={goHome}
              accessibilityRole="button"
              accessibilityLabel="Go to home"
            >
              <Text style={styles.secondaryLinkText}>Go to home</Text>
            </TouchableOpacity>
          ) : null}
        </Animated.View>
      </View>
    );
  }

  // Paid but not yet entitled (webhook lag) — calm "almost there" state.
  return (
    <View style={styles.container}>
      <Ionicons name="time-outline" size={64} color={tokens.semantic.warning.icon} />
      <Text style={styles.title}>Payment received</Text>
      <Text style={styles.body}>
        {status?.package_name
          ? `We're activating ${status.package_name} now — your coach has been notified and access opens within a few minutes.`
          : 'Your coach has been notified — access activates within a few minutes.'}
      </Text>
      <TouchableOpacity style={styles.cta} onPress={goHome} accessibilityRole="button">
        <Text style={styles.ctaText}>Go to home</Text>
      </TouchableOpacity>
    </View>
  );
}

const makeStyles = (semanticColors: SemanticTokens, tokens: Tokens) =>
  StyleSheet.create({
    container: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 32,
      backgroundColor: semanticColors.bgPrimary,
    },
    successBadge: {
      marginBottom: 4,
    },
    successEyebrow: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: tokens.colors.forest,
      marginTop: 16,
      textAlign: 'center',
    },
    title: {
      fontSize: 22,
      fontWeight: '600',
      color: semanticColors.textPrimary,
      marginTop: 8,
      textAlign: 'center',
    },
    body: {
      fontSize: 14,
      color: semanticColors.textMuted,
      lineHeight: 20,
      textAlign: 'center',
      marginTop: 12,
    },
    cta: {
      marginTop: 28,
      backgroundColor: semanticColors.accent,
      paddingHorizontal: 28,
      paddingVertical: 12,
      borderRadius: 10,
    },
    ctaText: { color: semanticColors.textOnAccent, fontWeight: '600', fontSize: 15 },
    secondaryLink: { marginTop: 14, paddingVertical: 6 },
    secondaryLinkText: {
      color: semanticColors.textMuted,
      fontWeight: '500',
      fontSize: 14,
    },
  });
