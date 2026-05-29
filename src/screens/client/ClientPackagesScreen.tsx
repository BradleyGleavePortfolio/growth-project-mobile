/**
 * ClientPackagesScreen — packages the client's coach offers + checkout.
 *
 * Wired via `clientPaymentsApi`:
 *   - GET  /v1/clients/me/coach/packages    (packages list)
 *   - POST /v1/checkout/sessions            (CheckoutController — buy)
 *   - GET  /v1/checkout/entitlement         (CheckoutController — paid-access flag)
 *   - POST /v1/checkout/billing-portal      (CheckoutController — Stripe Billing Portal URL)
 *
 * `getPaymentStatus()` is a DERIVED call: there is no backend `/status`
 * route, so subscription state is composed from the entitlement flag and
 * the package list's `is_current` marker. Fields the backend does not
 * expose (period_end, trial_ends_at, dunning) arrive as null and the UI
 * omits the corresponding rows rather than fabricating values.
 *
 * Behaviour contract:
 *  - 501 from packages OR entitlement => "Your coach has not enabled
 *    self-serve checkout yet" empty state with a "Message your coach"
 *    CTA. A real 404 / transport error is surfaced as a retryable error
 *    banner — it is no longer silently shown as "not configured" (PR-1
 *    in-app checkout fix). The true "not configured" state is derived
 *    from the explicit `not_configured` envelope plus an empty package
 *    list / inactive entitlement, never from a 404 alone.
 *  - The dunning banner is reachable only when the backend ships a real
 *    past-due signal; until then `status.dunning` is always null and the
 *    banner does not render. The standalone
 *    `clientPaymentsApi.createBillingPortalSession()` is still available
 *    for any future surface that needs to mint a portal URL on demand.
 *  - Tapping a package opens Stripe Checkout in the branded in-app
 *    webview (Apple Rule 3.1.3(b)/(e) B2B exemption). The success /
 *    cancel deep links are intercepted by the webview screen and routed
 *    via `CheckoutReturn`; this screen refreshes payment-status on focus.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';

import {
  clientPaymentsApi,
  type ClientCoachPackage,
  type ClientPaymentStatus,
  type PaymentsResult,
} from '../../api/clientPaymentsApi';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function DunningBanner({
  dunning,
  onUpdateCard,
  styles,
}: {
  dunning: NonNullable<ClientPaymentStatus['dunning']>;
  onUpdateCard: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.dunningBanner}>
      <Ionicons name="warning" size={18} color="#fff" />
      <View style={{ flex: 1 }}>
        <Text style={styles.dunningText}>{dunning.summary}</Text>
        {dunning.grace_until ? (
          <Text style={styles.dunningSub}>
            Access continues until {formatDate(dunning.grace_until)}.
          </Text>
        ) : null}
      </View>
      {dunning.update_card_url ? (
        <TouchableOpacity
          onPress={onUpdateCard}
          accessibilityRole="button"
          accessibilityLabel="Update card"
          style={styles.dunningBtn}
        >
          <Text style={styles.dunningBtnText}>Update</Text>
        </TouchableOpacity>
      ) : dunning.portal_unavailable ? (
        // Round-3 fix: surface mint failure so the past-due banner is not
        // a dead-end. Mirrors the AI-gateway fail-closed posture — show a
        // clear notice rather than a missing CTA.
        <Text
          style={styles.dunningSub}
          accessibilityLabel="Update card unavailable, contact support"
          testID="dunning-portal-unavailable"
        >
          Update card unavailable — contact support
        </Text>
      ) : null}
    </View>
  );
}

export default function ClientPackagesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();

  const [packages, setPackages] = useState<PaymentsResult<ClientCoachPackage[]> | null>(null);
  const [status, setStatus] = useState<PaymentsResult<ClientPaymentStatus> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [checkoutBusyId, setCheckoutBusyId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [pkgs, st] = await Promise.all([
      clientPaymentsApi.getPackages(),
      clientPaymentsApi.getPaymentStatus(),
    ]);
    setPackages(pkgs);
    setStatus(st);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Refresh on focus — covers the case where the user returns from the
  // Stripe Checkout sheet via the success / cancel deep link.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Typed-nav helper: route into the BrandedCheckoutWebView screen
  // registered on ClientNavigator. The branded webview screen handles
  // its own success / cancel deep-link short-circuit and routes through
  // CheckoutReturn, which refreshes payment-status on mount. Navigation
  // is fire-and-forget; post-checkout refresh happens on the destination
  // screen and via `useFocusEffect` when the user returns here.
  const navigateToBrandedCheckout = useCallback(
    (params: {
      checkoutUrl: string;
      packageName: string;
      returnScheme: string;
    }) => {
      (
        navigation as unknown as {
          navigate: (
            name: string,
            params: {
              checkoutUrl: string;
              packageName: string;
              returnScheme: string;
            },
          ) => void;
        }
      ).navigate('BrandedCheckoutWebView', params);
    },
    [navigation],
  );

  const handleBuy = useCallback(
    async (pkg: ClientCoachPackage) => {
      setCheckoutError(null);
      setCheckoutBusyId(pkg.id);
      try {
        const res = await clientPaymentsApi.createCheckoutSession(pkg.id);
        if (!res.ok) {
          setCheckoutError(
            res.reason === 'not_configured'
              ? 'Self-serve checkout is not enabled yet. Message your coach.'
              : res.message,
          );
          return;
        }
        // Apple Rule 3.1.3(b)/(e) B2B exemption: open Stripe Checkout in
        // a branded in-app webview so the user never leaves the app.
        navigateToBrandedCheckout({
          checkoutUrl: res.data.url,
          packageName: pkg.name,
          returnScheme: 'com.growthproject.app',
        });
      } catch (err) {
        setCheckoutError(
          (err as { message?: string })?.message || 'Could not open checkout.',
        );
      } finally {
        setCheckoutBusyId(null);
      }
    },
    [navigateToBrandedCheckout],
  );

  const handleUpdateCard = useCallback(() => {
    if (!status?.ok || !status.data.dunning?.update_card_url) return;
    // Stripe Billing Portal is a payment surface (Rule 8 / Apple B2B
    // exemption): keep it inside the branded in-app webview so the user
    // never leaves the app. The portal redirects back to
    // `com.growthproject.app://` on save, which the webview's deep-link
    // gate intercepts and routes to CheckoutReturn — payment-status is
    // refreshed there and again when this screen regains focus.
    navigateToBrandedCheckout({
      checkoutUrl: status.data.dunning.update_card_url,
      packageName: 'Update payment method',
      returnScheme: 'com.growthproject.app',
    });
  }, [status, navigateToBrandedCheckout]);

  const handleMessageCoach = useCallback(() => {
    const parent = navigation.getParent?.();
    if (parent?.navigate) {
      parent.navigate('Home', { screen: 'Messages' });
    } else {
      navigation.navigate('Messages' as never);
    }
  }, [navigation]);

  if (!packages || !status) {
    return <SkeletonScreen count={5} />;
  }

  // PR-1: derive "your coach has not enabled self-serve checkout" from
  // real backend signal, not from a 404. The explicit 501 → not_configured
  // envelope on EITHER packages or payment-status is one signal; an empty
  // published package list + `state: 'none'` from a healthy payment-status
  // call is the other. A 404 / transport error on either now arrives as
  // `reason: 'error'` and lands in the retryable error branches below
  // instead of being silently mapped to the calm "not enabled yet" gate.
  const packagesNotConfigured = !packages.ok && packages.reason === 'not_configured';
  const packagesEmptyOk = packages.ok && packages.data.length === 0;
  const statusUnavailable = !status.ok && status.reason === 'not_configured';
  const statusNone = status.ok && status.data.state === 'none';
  const notConfigured =
    (packagesNotConfigured || packagesEmptyOk) && (statusUnavailable || statusNone);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      <Text style={styles.header}>Coaching plans</Text>
      <Text style={styles.subheader}>
        Your coach's plans are listed below. Payment is handled inside The
        Growth Project by Stripe's secure checkout — your card never touches
        our servers.
      </Text>

      {/* Past-due / dunning banner */}
      {status.ok && status.data.dunning ? (
        <DunningBanner
          dunning={status.data.dunning}
          onUpdateCard={handleUpdateCard}
          styles={styles}
        />
      ) : null}

      {/* Current plan summary */}
      {status.ok && status.data.state !== 'none' && status.data.package_name ? (
        <View style={styles.currentPlanCard}>
          <Text style={styles.currentPlanLabel}>Current plan</Text>
          <Text style={styles.currentPlanName}>{status.data.package_name}</Text>
          <Text style={styles.currentPlanSub}>
            {status.data.state === 'trialing' && status.data.trial_ends_at
              ? `Trial ends ${formatDate(status.data.trial_ends_at)}`
              : status.data.state === 'past_due'
              ? 'Past due — see banner above'
              : status.data.current_period_end
              ? `Renews ${formatDate(status.data.current_period_end)}`
              : ''}
          </Text>
        </View>
      ) : null}

      {checkoutError ? (
        <>
          <View style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={18} color="#fff" />
            <Text style={styles.errorBannerText}>{checkoutError}</Text>
          </View>
          <TouchableOpacity
            onPress={() => void load()}
            accessibilityRole="button"
            accessibilityLabel="Refresh access"
            style={styles.refreshLink}
          >
            <Text style={styles.refreshLinkText}>Already completed payment? Tap to refresh your access.</Text>
          </TouchableOpacity>
        </>
      ) : null}

      {/* Packages list */}
      {notConfigured ? (
        <View style={styles.gate}>
          <Ionicons name="cube-outline" size={36} color={colors.textMuted} />
          <Text style={styles.gateTitle}>No self-serve plans yet</Text>
          <Text style={styles.gateBody}>
            Your coach handles access directly. Message them to start or
            change a plan — no payment is taken inside the app until they
            enable it.
          </Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={handleMessageCoach}
            accessibilityRole="button"
            accessibilityLabel="Message your coach"
          >
            <Text style={styles.ctaText}>Message your coach</Text>
          </TouchableOpacity>
        </View>
      ) : packages.ok ? (
        packages.data.length === 0 ? (
          <View style={styles.gate}>
            <Text style={styles.gateTitle}>No plans available right now</Text>
            <Text style={styles.gateBody}>
              Your coach hasn't published a plan yet. Message them to ask
              what's available.
            </Text>
            <TouchableOpacity
              style={styles.cta}
              onPress={handleMessageCoach}
              accessibilityRole="button"
              accessibilityLabel="Message your coach"
            >
              <Text style={styles.ctaText}>Message your coach</Text>
            </TouchableOpacity>
          </View>
        ) : (
          packages.data.map((pkg) => {
            const busy = checkoutBusyId === pkg.id;
            const current = pkg.is_current;
            return (
              <View key={pkg.id} style={styles.pkgCard}>
                <View style={styles.pkgHeader}>
                  <Text style={styles.pkgName}>{pkg.name}</Text>
                  {current ? (
                    <View style={styles.currentPill}>
                      <Text style={styles.currentPillText}>Current</Text>
                    </View>
                  ) : null}
                </View>
                <Text style={styles.pkgPrice}>
                  {formatMoney(pkg.price ?? 0, pkg.currency)}
                  {pkg.type === 'recurring' && pkg.interval ? (
                    <Text style={styles.pkgInterval}> / {pkg.interval}</Text>
                  ) : null}
                </Text>
                {pkg.trial_days && pkg.type === 'recurring' ? (
                  <Text style={styles.pkgTrial}>{pkg.trial_days}-day free trial</Text>
                ) : null}
                {pkg.description ? (
                  <Text style={styles.pkgDesc}>{pkg.description}</Text>
                ) : null}
                {(pkg.features?.length ?? 0) > 0 ? (
                  <View style={styles.pkgFeatures}>
                    {(pkg.features ?? []).map((feat, i) => (
                      <View key={i} style={styles.pkgFeatureRow}>
                        <Ionicons name="checkmark" size={14} color={colors.primary} />
                        <Text style={styles.pkgFeatureText}>{feat}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.buyBtn,
                    (current || busy) && styles.buyBtnDisabled,
                  ]}
                  onPress={() => handleBuy(pkg)}
                  disabled={current || busy}
                  accessibilityRole="button"
                  accessibilityLabel={
                    current ? 'Current plan' : `Buy ${pkg.name}`
                  }
                >
                  {busy ? (
                    <ActivityIndicator color={colors.textOnPrimary} />
                  ) : (
                    <Text style={styles.buyBtnText}>
                      {current
                        ? 'Current plan'
                        : pkg.type === 'recurring'
                        ? pkg.trial_days
                          ? 'Start free trial'
                          : 'Subscribe'
                        : 'Buy'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            );
          })
        )
      ) : packages.reason === 'error' ? (
        <TouchableOpacity onPress={load} style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={18} color="#fff" />
          <Text style={styles.errorBannerText}>{packages.message} Tap to retry.</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={styles.fineprint}>
        Payments are processed by Stripe. The Growth Project is a
        coach-managed platform; cancellations and refunds are handled by
        your coach.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40 },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    header: { fontSize: 28, fontWeight: '600', color: colors.textPrimary, marginBottom: 4 },
    subheader: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
      marginBottom: 16,
    },
    dunningBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.error,
      padding: 12,
      borderRadius: 8,
      marginBottom: 16,
    },
    dunningText: { color: '#fff', fontSize: 13, fontWeight: '500' },
    dunningSub: { color: '#fff', fontSize: 11, opacity: 0.85, marginTop: 2 },
    dunningBtn: {
      backgroundColor: '#fff',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
    },
    dunningBtnText: { color: colors.error, fontWeight: '600', fontSize: 12 },
    currentPlanCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 16,
    },
    currentPlanLabel: {
      fontSize: 11,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 4,
    },
    currentPlanName: { fontSize: 18, fontWeight: '600', color: colors.textPrimary },
    currentPlanSub: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.error,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
      marginBottom: 12,
    },
    errorBannerText: { color: '#fff', fontSize: 13, flex: 1 },
    gate: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 16 },
    gateTitle: { fontSize: 18, fontWeight: '600', color: colors.textPrimary, marginTop: 12 },
    gateBody: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 20,
    },
    cta: {
      marginTop: 20,
      backgroundColor: colors.primary,
      borderRadius: 10,
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    ctaText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
    pkgCard: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.border,
      marginBottom: 12,
    },
    pkgHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pkgName: { fontSize: 17, fontWeight: '600', color: colors.textPrimary, flex: 1 },
    currentPill: {
      backgroundColor: colors.primaryPale,
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 999,
    },
    currentPillText: { color: colors.primary, fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
    pkgPrice: { fontSize: 22, fontWeight: '600', color: colors.textPrimary, marginTop: 6 },
    pkgInterval: { fontSize: 13, fontWeight: '400', color: colors.textSecondary },
    pkgTrial: { fontSize: 12, color: colors.success, marginTop: 2 },
    pkgDesc: { fontSize: 13, color: colors.textSecondary, marginTop: 8, lineHeight: 18 },
    pkgFeatures: { marginTop: 10, gap: 6 },
    pkgFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    pkgFeatureText: { fontSize: 13, color: colors.textPrimary, flex: 1 },
    buyBtn: {
      marginTop: 14,
      backgroundColor: colors.primary,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
    },
    buyBtnDisabled: { backgroundColor: colors.textMuted, opacity: 0.55 },
    buyBtnText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
    fineprint: {
      fontSize: 11,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: 20,
      lineHeight: 16,
    },
    refreshLink: {
      alignSelf: 'center',
      marginBottom: 12,
      paddingVertical: 4,
    },
    refreshLinkText: {
      fontSize: 13,
      color: colors.primary,
      textAlign: 'center',
    },
  });
