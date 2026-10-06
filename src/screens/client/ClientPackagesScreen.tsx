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
import tokens, { type SemanticTokens, type Tokens } from '../../theme/tokens';
import { featureFlags } from '../../config/featureFlags';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { usePackagePurchase } from '../../hooks/usePackagePurchase';
import { usePaymentSheetAppearance } from '../../components/purchase/usePaymentSheetAppearance';
import PlanTermsBlock from '../../components/purchase/PlanTermsBlock';
import PurchaseFeedback from '../../components/purchase/PurchaseFeedback';
import YourPlansPanel from '../../components/purchase/YourPlansPanel';
import { planTerms, priceLabel } from '../../lib/planTerms';

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
      <Ionicons name="warning" size={18} color={tokens.neutral[0]} />
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
  const { semanticColors } = useTheme();
  // `tokens` is the static design-token module (mode-agnostic) imported at the
  // top of this file, so it does not need to come from the theme context and
  // is referenceable from module-scope sub-components (e.g. DunningBanner).
  const styles = useMemo(() => makeStyles(semanticColors, tokens), [semanticColors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();

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
      <YourPlansPanel reloadKey={plansTick} />

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
          <Ionicons name="alert-circle-outline" size={18} color={tokens.neutral[0]} />
          <Text style={styles.errorBannerText}>{packages.message} Tap to retry.</Text>
        </TouchableOpacity>
      ) : null}

      <Text style={styles.fineprint}>
        Payments are processed securely by Stripe inside the app. A renewing
        plan can be ended at any time in Your plans when it shows End my
        plan, or through your coach; refunds are handled by your coach.
      </Text>
    </ScrollView>
  );
}

const makeStyles = (semanticColors: SemanticTokens, tokens: Tokens) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: semanticColors.bgPrimary },
    content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40 },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: semanticColors.bgPrimary,
    },
    header: { fontSize: 28, fontWeight: '600', color: semanticColors.textPrimary, marginBottom: 4 },
    subheader: {
      fontSize: 13,
      color: semanticColors.textMuted,
      lineHeight: 18,
      marginBottom: 16,
    },
    dunningBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: tokens.colors.error,
      padding: 12,
      borderRadius: 8,
      marginBottom: 16,
    },
    dunningText: { color: tokens.neutral[0], fontSize: 13, fontWeight: '500' },
    dunningSub: { color: tokens.neutral[0], fontSize: 11, opacity: 0.85, marginTop: 2 },
    dunningBtn: {
      backgroundColor: tokens.neutral[0],
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: 6,
    },
    dunningBtnText: { color: tokens.colors.error, fontWeight: '600', fontSize: 12 },
    currentPlanCard: {
      backgroundColor: semanticColors.bgSurface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: semanticColors.border,
      marginBottom: 16,
    },
    currentPlanLabel: {
      fontSize: 11,
      color: semanticColors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginBottom: 4,
    },
    currentPlanName: { fontSize: 18, fontWeight: '600', color: semanticColors.textPrimary },
    currentPlanSub: { fontSize: 12, color: semanticColors.textMuted, marginTop: 2 },
    currentPlanCta: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: 12,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: semanticColors.border,
    },
    currentPlanCtaText: {
      fontSize: 14,
      color: semanticColors.accent,
      fontWeight: '600',
    },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: tokens.colors.error,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 8,
      marginBottom: 12,
    },
    errorBannerText: { color: tokens.neutral[0], fontSize: 13, flex: 1 },
    gate: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 16 },
    gateTitle: { fontSize: 18, fontWeight: '600', color: semanticColors.textPrimary, marginTop: 12 },
    gateBody: {
      fontSize: 14,
      color: semanticColors.textMuted,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 20,
    },
    cta: {
      marginTop: 20,
      backgroundColor: semanticColors.accent,
      borderRadius: 10,
      paddingHorizontal: 20,
      paddingVertical: 12,
    },
    ctaText: { color: semanticColors.textOnAccent, fontWeight: '600', fontSize: 14 },
    pkgCard: {
      backgroundColor: semanticColors.bgSurface,
      borderRadius: 12,
      padding: 16,
      borderWidth: 1,
      borderColor: semanticColors.border,
      marginBottom: 12,
    },
    pkgHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    pkgName: { fontSize: 17, fontWeight: '600', color: semanticColors.textPrimary, flex: 1 },
    currentPill: {
      backgroundColor: tokens.brand[50],
      paddingHorizontal: 10,
      paddingVertical: 3,
      borderRadius: 999,
    },
    currentPillText: { color: semanticColors.accent, fontSize: 10, fontWeight: '600', textTransform: 'uppercase' },
    pkgPrice: { fontSize: 22, fontWeight: '600', color: semanticColors.textPrimary, marginTop: 6 },
    pkgDesc: { fontSize: 13, color: semanticColors.textMuted, marginTop: 8, lineHeight: 18 },
    pkgFeatures: { marginTop: 10, gap: 6 },
    pkgFeatureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    pkgFeatureText: { fontSize: 13, color: semanticColors.textPrimary, flex: 1 },
    buyBtn: {
      marginTop: 14,
      backgroundColor: semanticColors.accent,
      paddingVertical: 12,
      borderRadius: 8,
      alignItems: 'center',
    },
    // Explicit disabled fill + label tokens (no parent opacity). The previous
    // opacity-on-textMuted treatment composited to ~2.05–2.24:1 for the 14px
    // semibold label; disabledBg + textOnDisabled clear AA in both modes.
    buyBtnDisabled: { backgroundColor: semanticColors.disabledBg },
    buyBtnText: { color: semanticColors.textOnAccent, fontWeight: '600', fontSize: 14 },
    buyBtnTextDisabled: { color: semanticColors.textOnDisabled },
    fineprint: {
      fontSize: 11,
      color: semanticColors.textMuted,
      textAlign: 'center',
      marginTop: 20,
      lineHeight: 16,
    },
  });
