/**
 * ClientPackagesScreen — packages the client's coach offers + checkout.
 *
 * Wired via `clientPaymentsApi`:
 *   - GET  /v1/clients/me/coach/packages    (packages list)
 *   - Buy: the shared purchase flow (src/hooks/usePackagePurchase.ts):
 *     renewing plans -> POST /v1/checkout/subscription-intent, one-time ->
 *     POST /v1/checkout/payment-intent, $0 -> claim-free, all through the
 *     native TGP-themed PaymentSheet (OR-113-1; no hosted Checkout).
 *   - GET  /v1/checkout/purchases           (CheckoutController — purchase history)
 *   - GET  /v1/checkout/entitlement         (CheckoutController — paid-access flag)
 *   Update card opens the native `UpdateCard` screen (OR-110-2: Stripe
 *   PaymentSheet themed with TGP tokens; no Stripe-hosted portal).
 *
 * `getPaymentStatus()` is a DERIVED call: there is no backend `/status`
 * route, so subscription state is composed from the REAL purchases list
 * (the `ClientPurchase` Prisma row carries `entitlement_active`, `status`,
 * `current_period_end`, `package_id`) joined against the packages list
 * by `package_id` for the human-readable name. Fields the backend does
 * not expose (trial_ends_at, dunning) arrive as null and the UI omits
 * the corresponding rows rather than fabricating values. The "Current"
 * pill on each card now reads `status.data.package_id === pkg.id`
 * instead of a fabricated `pkg.is_current` field (round-3 audit fix —
 * the backend `CoachPackage` schema has no `is_current` column, so the
 * pill never rendered before).
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
 *    banner does not render. Its Update button opens the native
 *    `UpdateCard` screen, which in dunning also pays the open invoice
 *    (owner ruling 1A).
 *  - Each plan shows its terms before paying (PlanTermsBlock). Tapping
 *    its button runs the shared purchase flow in the native PaymentSheet
 *    (basis: Guideline 3.1.3(d), real-time 1:1 coaching). Success and the
 *    calm "still confirming" state render inline; payment-status reloads
 *    when the client continues and on focus.
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
import api from '../../services/api';
import { oneToOneCoachingLabel } from '../../config/purchaseSurfaces';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';

import {
  clientPaymentsApi,
  type ClientCoachPackage,
  type ClientPaymentStatus,
  type PaymentsResult,
} from '../../api/clientPaymentsApi';
import { useTheme } from '../../theme/ThemeProvider';
import { DunningBanner as SmartDunningBanner } from '../../entitlements/dunning/DunningBanner';
import type { SemanticTokens, Tokens } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { usePackagePurchase } from '../../hooks/usePackagePurchase';
import { usePaymentSheetAppearance } from '../../components/purchase/usePaymentSheetAppearance';
import PlanTermsBlock from '../../components/purchase/PlanTermsBlock';
import PurchaseFeedback from '../../components/purchase/PurchaseFeedback';
import YourPlansPanel from '../../components/purchase/YourPlansPanel';
import { planTerms, priceLabel } from '../../lib/planTerms';
import { useCoachlessClient } from '../../hooks/useCoachlessClient';
import { COACHLESS_TITLE, COACHLESS_BODY, COACHLESS_CTA } from '../../entitlements/PaywallSheet';

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

/**
 * MONEY-CLIENT-124: the one line under "Current plan". B-MC-2: a plan the
 * client ended (cancel at period end) or a canceled plan that still has
 * access says when it ends, never "Renews"; a one-time plan says when its
 * access runs out; a past-due plan says the payment did not go through.
 */
export function currentPlanLine(d: ClientPaymentStatus): string {
  if (d.state === 'past_due') return 'The last payment did not go through.';
  if (d.state === 'canceled' || d.cancel_at_period_end) {
    // B-402-2: access ends with the billing period (Your plans shows that
    // date); access_expires_at carries a 24 h renewal pad on paid rows.
    const ends = formatDate(d.current_period_end) ?? formatDate(d.access_expires_at ?? null);
    return ends
      ? `Ends ${ends}. Nothing more is charged.`
      : 'Ends at the close of this period. Nothing more is charged.';
  }
  if (d.state === 'trialing' && d.trial_ends_at) {
    return `Trial ends ${formatDate(d.trial_ends_at)}`;
  }
  if (d.current_period_end) {
    const renews = formatDate(d.current_period_end);
    if (renews) return `Renews ${renews}`;
  }
  const until = formatDate(d.access_expires_at ?? null);
  return until ? `Access until ${until}` : '';
}

function isRenewing(pkg: ClientCoachPackage | undefined): boolean {
  if (!pkg) return false;
  return pkg.purchasable ? pkg.purchasable.renewing : pkg.type === 'recurring';
}

/** U-MC-3: buying another plan never replaces a renewing one. */
export function secondPlanNotice(currentName: string): string {
  return `${currentName} keeps renewing alongside this plan. To switch, end ${currentName} in Your plans first.`;
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
  const { semanticColors } = useTheme();
  return (
    <View style={styles.dunningBanner}>
      <Ionicons name="warning-outline" size={18} color={semanticColors.textPrimary} />
      <View style={{ flex: 1 }}>
        <Text style={styles.dunningText}>{dunning.summary}</Text>
        {dunning.grace_until ? (
          <Text style={styles.dunningSub}>
            Access continues until {formatDate(dunning.grace_until)}.
          </Text>
        ) : null}
      </View>
      {/* OR-110-2: always the native card screen; no portal link needed. */}
      <TouchableOpacity
        onPress={onUpdateCard}
        accessibilityRole="button"
        accessibilityLabel="Update card"
        style={styles.dunningBtn}
      >
        <Text style={styles.dunningBtnText}>Update</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function ClientPackagesScreen() {
  const { semanticColors, tokens } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors, tokens), [semanticColors, tokens]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const noCoach = useCoachlessClient();

  // Clinic launch: plans are 1:1 person-to-person coaching (Guideline
  // 3.1.3(d)), so the screen names the individual coach.
  const [coachName, setCoachName] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    api
      .get<{ name?: string }>('/v1/clients/me/coach')
      .then((res) => {
        if (mounted && typeof res?.data?.name === 'string') setCoachName(res.data.name);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const [packages, setPackages] = useState<PaymentsResult<ClientCoachPackage[]> | null>(null);
  const [status, setStatus] = useState<PaymentsResult<ClientPaymentStatus> | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [plansTick, setPlansTick] = useState(0);

  const load = useCallback(async () => {
    const [pkgs, st] = await Promise.all([
      clientPaymentsApi.getPackages(),
      clientPaymentsApi.getPaymentStatus(),
    ]);
    setPackages(pkgs);
    setStatus(st);
    setPlansTick((t) => t + 1);
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

  const { refreshEntitlement } = useEntitlement();

  // B-402-1: after End my plan / Keep my plan succeeds, Current plan, the
  // buy buttons and the second-plan notice re-read payment status. Only the
  // status is re-read: bumping plansTick would clear the panel's receipt.
  const onPlanChanged = useCallback(() => {
    void clientPaymentsApi.getPaymentStatus().then(setStatus);
    void refreshEntitlement().catch(() => false);
  }, [refreshEntitlement]);
  const { appearance, colorScheme } = usePaymentSheetAppearance();
  const purchase = usePackagePurchase({
    surface: 'plans',
    appearance,
    colorScheme,
    onEntitled: () => {
      void refreshEntitlement().catch(() => false);
    },
    onReloadNeeded: () => {
      void load();
    },
  });

  const handleBuy = useCallback(
    (pkg: ClientCoachPackage) => {
      if (!pkg.purchasable) return;
      void purchase.start(pkg.purchasable);
    },
    [purchase],
  );

  // After success, the slow state, or "Open your plan": back to the list,
  // reloaded so the Current plan card shows the new plan.
  const finishPurchase = useCallback(() => {
    purchase.reset();
    void load();
  }, [purchase, load]);

  const handleUpdateCard = useCallback(() => {
    // OR-110-2: the native card screen (Stripe PaymentSheet, TGP theme)
    // replaces the Stripe-hosted portal webview. In dunning it also pays the
    // open invoice right away (1A).
    navigation.navigate('UpdateCard', { autostart: true });
  }, [navigation]);

  const handleMessageCoach = useCallback(() => {
    const parent = navigation.getParent?.();
    if (parent?.navigate) {
      parent.navigate('Home', { screen: 'Messages' });
    } else {
      navigation.navigate('Messages' as never);
    }
  }, [navigation]);

  if (noCoach) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {navigation.canGoBack?.() ? (
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="client-packages-back"
          >
            <Ionicons name="arrow-back" size={24} color={semanticColors.textPrimary} />
          </TouchableOpacity>
        ) : null}
        <View style={styles.gate} testID="client-packages-coachless">
          <Text style={styles.gateTitle}>{COACHLESS_TITLE}</Text>
          <Text style={styles.gateBody}>{COACHLESS_BODY}</Text>
          <TouchableOpacity
            style={styles.cta}
            onPress={() => navigation.getParent()?.navigate('Home', {
              screen: 'Messages', params: { openCoachCode: true },
            })}
            accessibilityRole="button"
            accessibilityLabel={COACHLESS_CTA}
          >
            <Text style={styles.ctaText}>{COACHLESS_CTA}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

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
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={semanticColors.accent} />
      }
    >
      {/* U-MC-5: the More stack hides headers, so the screen brings its own
          back control (cross-tab opens have nothing to go back to). */}
      {navigation.canGoBack?.() ? (
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="client-packages-back"
        >
          <Ionicons name="arrow-back" size={24} color={semanticColors.textPrimary} />
        </TouchableOpacity>
      ) : null}
      <Text style={styles.header} testID="client-packages-header">
        {oneToOneCoachingLabel(coachName)}
      </Text>
      <Text style={styles.subheader}>
        Each plan is personal coaching delivered one to one by your coach.
        Payment is handled by Stripe's secure checkout. Your card never
        touches The Growth Project servers.
      </Text>

      {/* Past-due / dunning banner */}
      {status.ok && status.data.dunning ? (
        <DunningBanner
          dunning={status.data.dunning}
          onUpdateCard={handleUpdateCard}
          styles={styles}
        />
      ) : null}

      {/* Smart Dunning v2 Days 0-9 notice (GET /v1/checkout/dunning). The
          legacy banner above only renders from payment-status, whose dunning
          field is always null today. */}
      <SmartDunningBanner surface="ClientPackagesScreen" />

      {/* Renewing plans: next charge, End my plan / Keep my plan */}
      <YourPlansPanel
        reloadKey={plansTick}
        onUpdateCard={handleUpdateCard}
        onPlanChanged={onPlanChanged}
      />

      {/* Current plan summary */}
      {status.ok && status.data.state !== 'none' && status.data.package_name ? (
        <View style={styles.currentPlanCard}>
          <Text style={styles.currentPlanLabel}>Current plan</Text>
          <Text style={styles.currentPlanName}>{status.data.package_name}</Text>
          <Text style={styles.currentPlanSub} testID="current-plan-line">
            {currentPlanLine(status.data)}
          </Text>
          {/* PR-13 — buyer-facing Deliverables entry. Two gates:
              (1) feature flag `deliverables` — OFF in production until
                  the backend ships `GET /v1/checkout/purchases/:id/drops`
                  (the screen exists but the data source does not). This
                  prevents every paying user from landing on a 404 error
                  state today. Flip via EXPO_PUBLIC_FF_DELIVERABLES=true.
              (2) real `purchase_id` — when state === 'none' there is no
                  purchase to list drops for, so the row is hidden
                  rather than showing a dead-end. */}
          {featureFlags.deliverables && status.data.purchase_id ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="View what's included in your plan"
              testID="view-deliverables-cta"
              onPress={() =>
                (
                  navigation as unknown as {
                    navigate: (
                      n: string,
                      p: { purchaseId: string; packageName?: string },
                    ) => void;
                  }
                ).navigate('Deliverables', {
                  purchaseId: status.data.purchase_id as string,
                  packageName: status.data.package_name ?? undefined,
                })
              }
              style={styles.currentPlanCta}
            >
              <Text style={styles.currentPlanCtaText}>
                View what&apos;s included
              </Text>
              <Ionicons name="chevron-forward" size={16} color={semanticColors.accent} />
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}

      {/* Packages list */}
      {notConfigured ? (
        <View style={styles.gate}>
          <Ionicons name="cube-outline" size={36} color={semanticColors.textMuted} />
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
            const active = purchase.state.packageId === pkg.id;
            const busy = active && purchase.busy;
            const anyBusy = purchase.busy;
            const sellable = pkg.purchasable ?? null;
            // PR-1 round 3: "current package" comes from the real backend
            // ClientPurchase row surfaced via getPaymentStatus().package_id,
            // not from a fabricated `is_current` field on the package row
            // (the backend CoachPackage schema has no such column —
            // backend prisma/schema.prisma:2942-3000).
            const current = status.ok && status.data.package_id === pkg.id;
            // U-MC-3: a live renewing plan keeps charging when another plan
            // is bought (each plan is its own subscription), so say so.
            const st = status.ok ? status.data : null;
            const renewingName =
              st &&
              !current &&
              st.package_name &&
              (st.state === 'active' || st.state === 'trialing' || st.state === 'past_due') &&
              !st.cancel_at_period_end &&
              isRenewing(packages.data.find((p) => p.id === st.package_id))
                ? st.package_name
                : null;
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
                  {sellable ? priceLabel(sellable) : formatMoney(pkg.price ?? 0, pkg.currency)}
                </Text>
                {pkg.description ? (
                  <Text style={styles.pkgDesc}>{pkg.description}</Text>
                ) : null}
                {(pkg.features?.length ?? 0) > 0 ? (
                  <View style={styles.pkgFeatures}>
                    {(pkg.features ?? []).map((feat, i) => (
                      <View key={i} style={styles.pkgFeatureRow}>
                        <Ionicons name="checkmark" size={14} color={semanticColors.accent} />
                        <Text style={styles.pkgFeatureText}>{feat}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
                {sellable && !current ? <PlanTermsBlock pkg={sellable} testID={`plan-terms-${pkg.id}`} /> : null}
                {sellable && renewingName ? (
                  <Text style={styles.pkgDesc} testID={`plan-second-${pkg.id}`}>
                    {secondPlanNotice(renewingName)}
                  </Text>
                ) : null}
                {active ? (
                  <PurchaseFeedback
                    purchase={purchase}
                    onContinue={finishPurchase}
                    onOpenPlan={finishPurchase}
                  />
                ) : null}
                {!sellable && !current ? (
                  <Text style={styles.pkgDesc} testID={`plan-unsellable-${pkg.id}`}>
                    Your coach sets this plan up directly. Message your coach to join it.
                  </Text>
                ) : null}
                {!sellable && !current ? null : active && (purchase.state.phase === 'success' ||
                  purchase.state.phase === 'confirm_slow' ||
                  purchase.state.phase === 'confirmed_pending' ||
                  purchase.state.priceChange) ? null : (
                  <TouchableOpacity
                    style={[
                      styles.buyBtn,
                      (current || anyBusy || !sellable) && styles.buyBtnDisabled,
                    ]}
                    onPress={() => handleBuy(pkg)}
                    disabled={current || anyBusy || !sellable}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: current || anyBusy || !sellable, busy }}
                    accessibilityLabel={
                      current
                        ? 'Current plan'
                        : sellable
                          ? `${planTerms(sellable).cta}, ${pkg.name}`
                          : `${pkg.name} is not available to buy in the app`
                    }
                    testID={`buy-plan-${pkg.id}`}
                  >
                    {busy ? (
                      <ActivityIndicator color={semanticColors.textOnDisabled} />
                    ) : (
                      <Text
                        style={[
                          styles.buyBtnText,
                          (current || anyBusy || !sellable) && styles.buyBtnTextDisabled,
                        ]}
                      >
                        {current
                          ? 'Current plan'
                          : sellable
                            ? planTerms(sellable).cta
                            : ''}
                      </Text>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )
      ) : packages.reason === 'error' ? (
        <TouchableOpacity onPress={load} style={styles.errorBanner}>
          <Ionicons name="alert-circle-outline" size={18} color={semanticColors.textPrimary} />
          <Text style={styles.errorBannerText}>{packages.message} Tap to retry.</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={styles.fineprint}>
        Payments are processed securely by Stripe inside the app. A renewing
        plan can be ended at any time in Your plans when it shows End my
        plan, or through your coach. Refunds are issued by The Growth Project team; to ask, go to You &gt; Settings &gt; Support.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (semanticColors: SemanticTokens, tokens: Tokens) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: semanticColors.bgPrimary },
    content: { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 40 },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: semanticColors.bgPrimary,
    },
    backBtn: { width: 44, height: 44, justifyContent: 'center', marginLeft: -10, marginTop: -12 },
    header: { ...tokens.typography.h1, color: semanticColors.textPrimary, marginBottom: 12 },
    subheader: {
      ...tokens.typography.bodySmall,
      fontSize: 13,
      color: semanticColors.textMuted,
      lineHeight: 18,
      marginBottom: 24,
    },
    dunningBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: semanticColors.bgPrimary,
      padding: 12,
      borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: semanticColors.border,
      marginBottom: 16,
    },
    dunningText: { ...tokens.typography.bodySmall, color: semanticColors.textPrimary, fontSize: 13 },
    dunningSub: { ...tokens.typography.bodySmall, color: semanticColors.textMuted, fontSize: 13, marginTop: 4 },
    dunningBtn: {
      minHeight: 44, justifyContent: 'center',
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: tokens.radius.lg,
    },
    dunningBtnText: { ...tokens.typography.bodyMd, color: semanticColors.accentText, fontSize: 13 },
    currentPlanCard: {
      paddingVertical: 24,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: semanticColors.border,
      marginBottom: 16,
    },
    currentPlanLabel: {
      ...tokens.typography.eyebrow,
      fontSize: 11,
      color: semanticColors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 4,
    },
    currentPlanName: { ...tokens.typography.h2, color: semanticColors.textPrimary },
    currentPlanSub: { ...tokens.typography.bodySmall, fontSize: 13, color: semanticColors.textMuted, marginTop: 8 },
    currentPlanCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 12,
      minHeight: 44,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: semanticColors.border,
    },
    currentPlanCtaText: {
      ...tokens.typography.bodyMd,
      fontSize: 14,
      color: semanticColors.accent,
      fontWeight: '600',
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: semanticColors.bgPrimary,
      paddingVertical: 10,
      paddingHorizontal: 12,
      minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: semanticColors.border,
      marginBottom: 12,
    },
    errorBannerText: { ...tokens.typography.bodySmall, color: semanticColors.textPrimary, fontSize: 13, flex: 1 },
    gate: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 16 },
    gateTitle: { ...tokens.typography.h2, color: semanticColors.textPrimary, marginTop: 12 },
    gateBody: {
      ...tokens.typography.bodySmall,
      fontSize: 14,
      color: semanticColors.textMuted,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 20,
    },
    cta: {
      marginTop: 20,
      backgroundColor: semanticColors.accent,
      borderRadius: tokens.radius.lg, minHeight: 44, justifyContent: 'center',
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    ctaText: { ...tokens.typography.bodyMd, color: semanticColors.textOnAccent, fontSize: 14 },
    pkgCard: {
      paddingVertical: 24,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: semanticColors.border,
      marginBottom: 12,
    },
    pkgHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pkgName: { ...tokens.typography.h2, color: semanticColors.textPrimary, flex: 1 },
    currentPill: {
      paddingHorizontal: 10,
      paddingVertical: 3,
    },
    currentPillText: { ...tokens.typography.eyebrow, color: semanticColors.textMuted },
    pkgPrice: { ...tokens.typography.h2, fontVariant: ['tabular-nums'], color: semanticColors.textPrimary, marginTop: 6 },
    pkgDesc: { ...tokens.typography.bodySmall, fontSize: 13, color: semanticColors.textMuted, marginTop: 8, lineHeight: 18 },
    pkgFeatures: { marginTop: 10, gap: 6 },
    pkgFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    pkgFeatureText: { ...tokens.typography.bodySmall, fontSize: 13, color: semanticColors.textPrimary, flex: 1 },
    buyBtn: {
      marginTop: 14,
      backgroundColor: semanticColors.accent,
      paddingVertical: 12,
      borderRadius: tokens.radius.lg, minHeight: 44, justifyContent: 'center',
      alignItems: 'center',
    },
    // Explicit disabled fill + label tokens (no parent opacity). The previous
    // opacity-on-textMuted treatment composited to ~2.05–2.24:1 for the 14px
    // semibold label; disabledBg + textOnDisabled clear AA in both modes.
    buyBtnDisabled: { backgroundColor: semanticColors.disabledBg },
    buyBtnText: { ...tokens.typography.bodyMd, color: semanticColors.textOnAccent, fontSize: 14 },
    buyBtnTextDisabled: { color: semanticColors.textOnDisabled },
    fineprint: {
      ...tokens.typography.bodySmall, fontSize: 13,
      color: semanticColors.textMuted,
      textAlign: 'center',
      marginTop: 20,
      lineHeight: 20,
    },
  });
