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
}

export function intervalCopy(p: PackageDetailViewModel): string {
  if (p.billingInterval === 'one_time') return 'one-time payment';
  const unit =
    p.billingInterval === 'monthly'
      ? 'month'
      : p.billingInterval === 'quarterly'
      ? 'quarter'
      : 'year';
  const count = p.intervalCount ?? 1;
  const every = count > 1 ? `every ${count} ${unit}s` : `per ${unit}`;
  return `billed ${every}`;
}

export default function PackageDetailSurface({ package: pkg, mode, onPay, paying = false }: Props) {
  const { semanticColors, tokens } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors, tokens), [semanticColors, tokens]);

  const isPreview = mode === 'coachPreview';
  const payLabel = pkg.trialDays
    ? 'Start free trial'
    : `Pay ${formatCurrencyCents(pkg.priceCents, pkg.currency)}`;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      {isPreview ? (
        <View style={styles.previewBanner} accessibilityRole="text">
          <Ionicons name="eye-outline" size={16} color={semanticColors.textPrimary} />
          <Text style={styles.previewBannerText}>
            Buyer preview — checkout is disabled for coaches.
          </Text>
        </View>
      ) : null}

      <View style={styles.coachCard}>
        <View style={styles.avatarPlaceholder}>
          <Ionicons name="person" size={22} color={semanticColors.textOnAccent} />
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
      {pkg.description ? <Text style={styles.description}>{pkg.description}</Text> : null}

      <View style={styles.priceCard}>
        <Text style={styles.priceValue}>{formatCurrencyCents(pkg.priceCents, pkg.currency)}</Text>
        <Text style={styles.priceMeta}>{intervalCopy(pkg)}</Text>
        {pkg.trialDays ? (
          <Text style={styles.trialMeta}>Includes a {pkg.trialDays}-day free trial.</Text>
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
                color={semanticColors.accent}
                style={{ marginTop: 2 }}
              />
              <Text style={styles.featureText}>{f}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.payBtn, (paying || isPreview) && styles.payBtnDisabled]}
        // Coach preview MUST NOT trigger checkout: no onPress wired at all.
        onPress={isPreview ? undefined : onPay}
        disabled={isPreview || paying}
        accessibilityRole="button"
        accessibilityState={{ disabled: isPreview || paying }}
        accessibilityLabel={isPreview ? 'Checkout disabled in preview' : 'Continue to payment'}
      >
        {paying ? (
          <ActivityIndicator color={semanticColors.textOnAccent} />
        ) : (
          <>
            <Ionicons name="lock-closed" size={16} color={semanticColors.textOnAccent} />
            <Text style={styles.payBtnText}>{payLabel}</Text>
          </>
        )}
      </TouchableOpacity>

      {isPreview ? (
        <Text style={styles.fineprint}>
          This is how buyers see your package. Share the link from the package
          screen to let clients purchase.
        </Text>
      ) : (
        <Text style={styles.fineprint}>
          Payment is processed securely by Stripe. Card details never touch this
          app or The Growth Project's servers.
        </Text>
      )}
    </ScrollView>
  );
}

const makeStyles = (semanticColors: SemanticTokens, tokens: Tokens) =>
  StyleSheet.create({
    content: { paddingHorizontal: 24, paddingBottom: 40 },
    previewBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: tokens.semantic.warning.bg,
      borderColor: tokens.semantic.warning.border,
      borderWidth: 1,
      borderRadius: tokens.radius.lg,
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
    coachCard: {
      flexDirection: 'row',
      gap: 12,
      backgroundColor: semanticColors.bgSurface,
      borderRadius: tokens.radius.lg,
      padding: 14,
      marginBottom: 18,
      alignItems: 'flex-start',
    },
    avatarPlaceholder: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: semanticColors.accent,
      justifyContent: 'center',
      alignItems: 'center',
    },
    coachLabel: {
      fontFamily: tokens.typography.eyebrow.fontFamily,
      fontSize: 11,
      color: semanticColors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    coachName: {
      fontFamily: tokens.typography.bodyMd.fontFamily,
      fontSize: 16,
      fontWeight: '500',
      color: semanticColors.textPrimary,
    },
    coachBio: { fontSize: 13, color: semanticColors.textMuted, marginTop: 4, lineHeight: 18 },
    title: {
      fontFamily: tokens.typography.h1.fontFamily,
      fontSize: 28,
      color: semanticColors.textPrimary,
      marginBottom: 8,
    },
    description: {
      fontFamily: tokens.typography.body.fontFamily,
      fontSize: 15,
      color: semanticColors.textMuted,
      lineHeight: 22,
      marginBottom: 18,
    },
    priceCard: {
      backgroundColor: semanticColors.bgSurface,
      borderRadius: tokens.radius.lg,
      padding: 18,
      marginBottom: 18,
    },
    priceValue: {
      fontFamily: tokens.typography.h2.fontFamily,
      fontSize: 32,
      color: semanticColors.textPrimary,
    },
    priceMeta: { fontSize: 13, color: semanticColors.textMuted, marginTop: 2 },
    trialMeta: { fontSize: 13, color: semanticColors.accent, marginTop: 6 },
    featuresList: { marginBottom: 24 },
    featuresTitle: {
      fontFamily: tokens.typography.eyebrow.fontFamily,
      fontSize: 12,
      color: semanticColors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 10,
    },
    featureRow: { flexDirection: 'row', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
    featureText: { flex: 1, fontSize: 14, color: semanticColors.textPrimary, lineHeight: 20 },
    payBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: semanticColors.accent,
      paddingVertical: 16,
      borderRadius: tokens.radius.md,
    },
    payBtnDisabled: { opacity: 0.6 },
    payBtnText: {
      fontFamily: tokens.typography.bodyMd.fontFamily,
      color: semanticColors.textOnAccent,
      fontSize: 16,
      fontWeight: '500',
    },
    fineprint: {
      marginTop: 12,
      fontSize: 12,
      color: semanticColors.textMuted,
      textAlign: 'center',
      lineHeight: 18,
    },
  });
