/**
 * PackageCheckoutScreen — client-facing landing page for a coach's package
 * share link (`tgp://p/:token`). Renders the offering and its terms, then
 * sells it through the shared purchase flow (src/hooks/usePackagePurchase.ts)
 * in the native, TGP-themed Stripe PaymentSheet (OR-113-1: no hosted
 * Checkout, no in-app browser):
 *   renewing -> POST /v1/checkout/subscription-intent -> PaymentSheet
 *               (payment, or setup for a trial) -> "Confirming your plan"
 *   one-time -> POST /v1/checkout/payment-intent -> PaymentSheet
 *   $0       -> POST /v1/packages/:id/claim-free
 *
 * The checkout routes sell only the signed-in client's own coach's packages;
 * a share link from another coach answers PACKAGE_NOT_FOUND, shown with its
 * own copy (see the B-RECUR-MOB report, CONTRACT GAP).
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { oneToOneCoachingLabel } from '../../config/purchaseSurfaces';
import { Ionicons } from '@expo/vector-icons';
// Filing basis: Guideline 3.1.3(d). A client package is real-time 1:1
// coaching with an individual coach, so it may be paid outside IAP. The
// transport (here the native PaymentSheet) confers NO exemption by itself.
import type { NavigationProp, ParamListBase, RouteProp } from '@react-navigation/native';

import { publicPackagesApi, PublicPackageView } from '../../api/packagesApi';
import { errorCode, errorStatus } from '../../types/common';
import { isValidPackageShareToken } from '../../utils/packageShare';
import { mediumTap } from '../../utils/haptics';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { usePackagePurchase } from '../../hooks/usePackagePurchase';
import { usePaymentSheetAppearance } from '../../components/purchase/usePaymentSheetAppearance';
import PlanTermsBlock from '../../components/purchase/PlanTermsBlock';
import PurchaseFeedback from '../../components/purchase/PurchaseFeedback';
import { planTerms, purchasableFromPublicPackage } from '../../lib/planTerms';
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
  const { refreshEntitlement } = useEntitlement();
  const { appearance, colorScheme } = usePaymentSheetAppearance();

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
        body: 'This coach package link is not active yet. Ask your coach for an updated link.',
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
          body: 'Coach plans are not switched on for this app yet. Message the coach who shared the link.',
        });
      } else if (httpCode === undefined) {
        setError({
          title: 'You are offline',
          body: 'This plan could not load because the phone is offline. Check your connection, then choose Try again.',
        });
      } else {
        setError({
          title: 'Could not load this plan',
          body: 'This plan did not load. Choose Try again in a minute, or message the coach who shared the link.',
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

  const purchase = usePackagePurchase({
    surface: 'share_link',
    shareToken,
    appearance,
    colorScheme,
    onEntitled: () => {
      void refreshEntitlement().catch(() => false);
    },
    onReloadNeeded: () => {
      void load();
    },
  });
  const sellable = useMemo(() => (pkg ? purchasableFromPublicPackage(pkg) : null), [pkg]);

  const handlePay = useCallback(() => {
    if (!sellable) return;
    mediumTap();
    track('package_checkout_started', {
      share_token: shareToken,
      sale: sellable.renewing ? 'subscription' : 'one_time',
    });
    void purchase.start(sellable);
  }, [purchase, sellable, shareToken]);

  const leave = useCallback(() => {
    purchase.reset();
    // Membership plans (same More stack): the new plan shows there.
    navigation.navigate('ClientPackages');
  }, [navigation, purchase]);

  const phase = purchase.state.phase;
  const hidePay =
    phase === 'success' ||
    phase === 'confirm_slow' ||
    phase === 'confirmed_pending' ||
    purchase.state.priceChange !== null;

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
        <Text style={styles.topTitle} testID="package-checkout-title">
          {oneToOneCoachingLabel(pkg?.coach?.displayName)}
        </Text>
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
          paying={purchase.busy}
          payLabel={sellable ? planTerms(sellable).cta : undefined}
          hidePay={hidePay || !sellable}
          purchaseSlot={
            <>
              {sellable && !hidePay ? <PlanTermsBlock pkg={sellable} /> : null}
              <PurchaseFeedback purchase={purchase} onContinue={leave} onOpenPlan={leave} />
            </>
          }
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
    backBtn: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
    topTitle: {
      fontFamily: tokens.typography.eyebrow.fontFamily,
      fontSize: 13,
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
      ...tokens.typography.bodySmall,
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
      minHeight: 44, justifyContent: 'center', backgroundColor: semanticColors.accent,
    },
    retryText: { ...tokens.typography.bodyMd, color: semanticColors.textOnAccent, fontSize: 14 },
  });
