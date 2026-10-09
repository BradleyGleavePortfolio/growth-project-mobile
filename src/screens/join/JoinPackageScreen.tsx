/**
 * JoinPackageScreen (B-PACKAGE-135) — the one package a coach code carries,
 * shown once the code is accepted (JoinPackageHost). Free / prepaid say so and
 * Start; paid shows package, coach and price, and "Continue to payment" runs
 * the shared purchase flow with `join_code` (the purchase attaches the client).
 * A client package is 1:1 coaching with an individual coach
 * (config/purchaseSurfaces.ts, Guideline 3.1.3(d)): same PaymentSheet, no new path.
 */
import React, { useCallback, useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { oneToOneCoachingLabel } from '../../config/purchaseSurfaces';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { usePackagePurchase } from '../../hooks/usePackagePurchase';
import { usePaymentSheetAppearance } from '../../components/purchase/usePaymentSheetAppearance';
import PlanTermsBlock from '../../components/purchase/PlanTermsBlock';
import PurchaseFeedback from '../../components/purchase/PurchaseFeedback';
import { priceLabel, purchasableFromCoachPackage } from '../../lib/planTerms';
import { clearPendingJoin, coachNameOf, type JoinOutcome } from '../../lib/joinPackage';
import { patchUserCache } from '../../lib/userCache';
import { authApi } from '../../services/api';
import { queryClient } from '../../services/queryClient';
import { logger } from '../../utils/logger';
import { spacing } from '../../theme/tokens';
import { Headline, Lede, PrimaryButton, QuietOverline, Screen, TextLink, type ScreenEdge } from '../../ui';

// Presented as a page sheet: on iOS it already starts below the status bar.
const MODAL_EDGES: readonly ScreenEdge[] = Platform.OS === 'ios' ? ['bottom'] : ['top', 'bottom'];

/**
 * After the paid join's purchase the webhook attached the client: re-read the
 * user (coach_id) and the coachless Home. The pending join is cleared only
 * once the server shows the coach.
 */
export async function refreshAfterJoinPaid(): Promise<void> {
  try {
    const me = await authApi.me();
    const coachId = (me?.data as { coach_id?: unknown } | undefined)?.coach_id;
    if (typeof coachId === 'string' && coachId) {
      await patchUserCache({ coach_id: coachId });
      await clearPendingJoin();
    }
  } catch (err) {
    logger.warn('JoinPackage', 'user refresh after payment failed', err);
  }
  await queryClient
    .invalidateQueries({ queryKey: ['coachless', 'home'] })
    .catch((err: unknown) => logger.warn('JoinPackage', 'Home refresh after payment failed', err));
}

export interface JoinPackageScreenProps {
  join: JoinOutcome;
  onClose: () => void;
}

export default function JoinPackageScreen({ join, onClose }: JoinPackageScreenProps) {
  const { refreshEntitlement } = useEntitlement();
  const { appearance, colorScheme } = usePaymentSheetAppearance();
  const coach = coachNameOf(join);
  const packageName = join.package.name.trim() || 'This package';
  const paid = join.status === 'checkout_required';
  const sellable = useMemo(() => purchasableFromCoachPackage(join.package), [join.package]);
  const refresh = useCallback(() => {
    void refreshEntitlement().catch((err: unknown) =>
      logger.warn('JoinPackage', 'entitlement refresh failed', err),
    );
  }, [refreshEntitlement]);
  const purchase = usePackagePurchase({
    surface: 'sheet',
    joinCode: join.code,
    appearance,
    colorScheme,
    onEntitled: refresh,
  });

  const leave = useCallback(() => {
    purchase.reset();
    refresh();
    void refreshAfterJoinPaid();
    onClose();
  }, [onClose, purchase, refresh]);
  const start = useCallback(() => {
    refresh();
    onClose();
  }, [onClose, refresh]);

  const phase = purchase.state.phase;
  const hidePay =
    !sellable ||
    phase === 'success' ||
    phase === 'confirm_slow' ||
    phase === 'confirmed_pending' ||
    purchase.state.priceChange !== null;

  const footer = paid ? (
    <View>
      {hidePay ? null : (
        <PrimaryButton
          label="Continue to payment"
          onPress={() => sellable && void purchase.start(sellable)}
          loading={purchase.busy}
          testID="join-package-pay"
        />
      )}
      {phase === 'success' ? null : (
        <TextLink label="Not now" onPress={onClose} disabled={purchase.busy} testID="join-package-not-now" />
      )}
    </View>
  ) : (
    <PrimaryButton label="Start" onPress={start} testID="join-package-start" />
  );

  return (
    <Screen edges={MODAL_EDGES} footer={footer} testID="join-package">
      <QuietOverline>{oneToOneCoachingLabel(join.coach.first_name)}</QuietOverline>
      {paid ? (
        <>
          <Headline level="h1" testID="join-package-title">{packageName}</Headline>
          {sellable ? (
            <Lede testID="join-package-price">{priceLabel(sellable)}</Lede>
          ) : (
            <Lede>{`This package cannot be paid for in the app right now. Ask ${coach} for a new code.`}</Lede>
          )}
          <Lede size="small" style={styles.gap}>
            {`Joining ${coach} finishes when the payment goes through.`}
          </Lede>
          {sellable && !hidePay ? <PlanTermsBlock pkg={sellable} /> : null}
          <PurchaseFeedback purchase={purchase} onContinue={leave} onOpenPlan={leave} />
        </>
      ) : (
        <>
          <Headline level="h1" testID="join-package-title">
            {join.grant_mode === 'prepaid' ? 'This package is paid for' : 'This package is free'}
          </Headline>
          <Lede testID="join-package-body">
            {join.grant_mode === 'prepaid'
              ? `${packageName} with ${coach}. There is nothing to pay in the app.`
              : `${packageName} with ${coach}. There is nothing to pay.`}
          </Lede>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({ gap: { marginTop: spacing.md } });
