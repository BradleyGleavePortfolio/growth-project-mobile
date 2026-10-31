/**
 * PackageDetailSurface — the SHARED presentational surface for a coach
 * package's buyer-facing detail page (PR-18 M1 item 2).
 *
 * Both the real buyer flow (PackageCheckoutScreen, `mode="buyer"`) and the
 * coach's "Preview as buyer" sheet (CoachPackageEditScreen, `mode="coachPreview"`)
 * render this same component, so the two views can NEVER fork visually. The
 * only behavioral difference lives here, gated on `mode`:
 *
 *   • buyer        → functional pay CTA that calls `onPay`.
 *   • coachPreview → NO functional CTA. The pay button is disabled and a
 *                    banner reads "Buyer preview — checkout is disabled for
 *                    coaches." The component never calls `onPay` in this mode.
 *
 * The surface is purely presentational: it owns no network calls, no
 * share-token validation, and no checkout-session creation. The hosting
 * screen owns all of that and passes a normalized `package` down.
 */

import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useTheme } from '../../../theme/ThemeProvider';
import type { SemanticTokens, Tokens } from '../../../theme/tokens';
import { formatCurrencyCents } from '../../../utils/currency';
import type { PackageBillingInterval } from '../../../api/packagesApi';
import { QuietOverline } from '../../../ui';
import { CLIENT_PLAN_COPY, CoachNote, PlanIncluded, PlanMasthead } from './ClientPlanPresentation';

export type PackageDetailMode = 'buyer' | 'coachPreview';

/**
 * The minimal normalized shape this surface renders. Deliberately a subset of
 * both `PublicPackageView` (buyer) and the coach editor's draft/`original`
 * (preview) so callers can adapt either source without a network round-trip.
 */
export interface PackageDetailViewModel {
  id: string;
  title: string;
  description: string | null;
  priceCents: number;
  currency: string;
  billingInterval: PackageBillingInterval;
  /** Optional — defaults to 1 when omitted (callers that lack a count). */
  intervalCount?: number;
  trialDays: number | null;
  features: string[];
  coach: {
    displayName: string;
    bio: string | null;
  };
}

interface Props {
  package: PackageDetailViewModel;
  mode: PackageDetailMode;
  /** Buyer-only: invoked when the pay CTA is pressed. Ignored in coachPreview. */
  onPay?: () => void;
  /** Buyer-only: disables/spins the CTA while a checkout session is in flight. */
  paying?: boolean;
  /** Buyer-only: plan terms and purchase feedback, rendered above the pay CTA. */
  purchaseSlot?: React.ReactNode;
  /** Buyer-only: the pay CTA label from the plan terms (e.g. "Subscribe for $49.00 a month"). */
  payLabel?: string;
  /** Buyer-only: hide the pay CTA (success, slow confirmation, price confirmation). */
  hidePay?: boolean;
}

export function intervalCopy(p: PackageDetailViewModel): string {
  if (p.billingInterval === 'one_time') return 'one-time payment';
  const unit =
    p.billingInterval === 'weekly'
      ? 'week'
      : p.billingInterval === 'monthly'
      ? 'month'
      : p.billingInterval === 'quarterly'
      ? 'quarter'
      : 'year';
  const count = p.intervalCount ?? 1;
  const every = count > 1 ? `every ${count} ${unit}s` : `per ${unit}`;
  return `billed ${every}`;
}

export default function PackageDetailSurface({
  package: pkg,
  mode,
  onPay,
  paying = false,
  purchaseSlot,
  payLabel: payLabelOverride,
  hidePay = false,
}: Props) {
  const { semanticColors, tokens } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors, tokens), [semanticColors, tokens]);

  const isPreview = mode === 'coachPreview';
  // Disabled = coach preview (no checkout) or a buyer mid-request. We swap to
  // explicit disabled semantic tokens (disabledBg + textOnDisabled) instead of
  // dimming the enabled accent button with parent opacity, which dragged the
  // 16px label below AA (audited ~3.60:1 in dark mode). The token pair clears
  // AA on both modes (see tokens.ts / scopedTokenGate).
  const isDisabled = paying || isPreview;
  const onAccentColor = isDisabled ? semanticColors.textOnDisabled : semanticColors.textOnAccent;
  const payLabel =
    (!isPreview && payLabelOverride) ||
    (pkg.trialDays ? 'Start free trial' : `Pay ${formatCurrencyCents(pkg.priceCents, pkg.currency)}`);

  // FR-1TO1 (LS B2): C5 Style C, the same masthead, coach note and included list as the in-app plan
  // page (ClientPlanPresentation), so the buyer page and the coach's preview match the GOAL.
  const price = formatCurrencyCents(pkg.priceCents, pkg.currency);
  return (
    <ScrollView style={{ backgroundColor: semanticColors.bgPrimary }} contentContainerStyle={styles.content}>
      <View style={[styles.mast, { backgroundColor: semanticColors.surface.masthead }]}>
        <PlanMasthead title={pkg.title} price={price} coach={pkg.coach.displayName} />
      </View>
      <View style={styles.body}>
      {isPreview ? (
        <View style={styles.previewBanner} accessibilityRole="text">
          <Ionicons name="eye-outline" size={16} color={semanticColors.textPrimary} />
          <Text style={styles.previewBannerText}>
            Buyer preview — checkout is disabled for coaches.
          </Text>
        </View>
      ) : null}

      <CoachNote description={pkg.description} coach={pkg.coach.displayName} />
      {pkg.coach.bio ? <Text style={styles.coachBio} numberOfLines={3}>{pkg.coach.bio}</Text> : null}

      <PlanIncluded coach={pkg.coach.displayName} features={pkg.features} testID="package-detail-one-to-one" />

      <View style={styles.priceCard}>
        <QuietOverline style={styles.featuresTitle} accessibilityRole="header">{CLIENT_PLAN_COPY.billing}</QuietOverline>
        <Text style={styles.priceValue} testID="package-detail-price">{price}</Text>
        <Text style={styles.priceMeta}>{intervalCopy(pkg)}</Text>
        {pkg.trialDays ? (
          <Text style={styles.trialMeta}>Includes a {pkg.trialDays}-day free trial.</Text>
        ) : null}
      </View>

      {!isPreview ? purchaseSlot : null}

      {!isPreview && hidePay ? null : (
      <TouchableOpacity
        style={[styles.payBtn, isDisabled && styles.payBtnDisabled]}
        // Coach preview MUST NOT trigger checkout: no onPress wired at all.
        onPress={isPreview ? undefined : onPay}
        disabled={isDisabled}
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled }}
        accessibilityLabel={isPreview ? 'Checkout disabled in preview' : 'Continue to payment'}
      >
        {paying ? (
          <ActivityIndicator color={onAccentColor} />
        ) : (
          <>
            <Ionicons name="lock-closed-outline" size={16} color={onAccentColor} />
            <Text style={[styles.payBtnText, isDisabled && styles.payBtnTextDisabled]}>{payLabel}</Text>
          </>
        )}
      </TouchableOpacity>
      )}

      {isPreview ? (
        <Text style={styles.fineprint}>
          This is how buyers see your package. Share the link from the package
          screen to let clients purchase.
        </Text>
      ) : (
        <Text style={styles.fineprint}>
          Payment is processed securely by Stripe. Card details never touch this
          app or TGP Fitness servers.
        </Text>
      )}
      </View>
    </ScrollView>
  );
}

const makeStyles = (semanticColors: SemanticTokens, tokens: Tokens) =>
  StyleSheet.create({
    content: { paddingBottom: 40 },
    mast: { paddingHorizontal: 24, paddingTop: 12 },
    body: { paddingHorizontal: 24, paddingTop: 12 },
    previewBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderBottomColor: semanticColors.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingVertical: 10,
      paddingHorizontal: 12,
      marginBottom: 16,
    },
    previewBannerText: {
      flex: 1,
      fontFamily: tokens.typography.bodySmall.fontFamily,
      fontSize: 13,
      color: semanticColors.textPrimary,
      lineHeight: 18,
    },
    coachBio: { ...tokens.typography.bodySmall, fontSize: 13, color: semanticColors.textMuted, marginTop: 4, lineHeight: 18 },
    priceCard: { paddingBottom: 16, marginBottom: 8 },
    priceValue: {
      fontFamily: tokens.typography.h2.fontFamily,
      fontSize: 32,
      fontVariant: ['tabular-nums'],
      color: semanticColors.textPrimary,
    },
    priceMeta: { ...tokens.typography.bodySmall, fontSize: 13, color: semanticColors.textMuted, marginTop: 2 },
    trialMeta: { ...tokens.typography.bodySmall, fontSize: 13, color: semanticColors.textMuted, marginTop: 6 },
    featuresTitle: { ...tokens.typography.eyebrow, marginBottom: 12 },
    payBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: semanticColors.accent,
      paddingVertical: 16,
      borderRadius: tokens.radius.lg, minHeight: 44,
    },
    // Explicit disabled fill (no parent opacity) so the label keeps AA contrast.
    payBtnDisabled: { backgroundColor: semanticColors.disabledBg },
    payBtnText: {
      fontFamily: tokens.typography.bodyMd.fontFamily,
      color: semanticColors.textOnAccent,
      fontSize: 16,
      fontWeight: '500',
    },
    payBtnTextDisabled: { color: semanticColors.textOnDisabled },
    fineprint: {
      marginTop: 12,
      ...tokens.typography.bodySmall, fontSize: 13,
      color: semanticColors.textMuted,
      textAlign: 'center',
      lineHeight: 18,
    },
  });
