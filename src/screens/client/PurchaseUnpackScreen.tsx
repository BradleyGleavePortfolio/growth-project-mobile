/**
 * PurchaseUnpackScreen — the "here's what you just got + what's coming"
 * emotional payoff moment shown right after a successful in-app purchase
 * confirm. Decacorn/Apple-grade onboarding flourish for the drip engine:
 * the buyer sees the immediate-delivered items light up and the upcoming
 * schedule laid out, with a Done CTA into the persistent Deliverables
 * timeline.
 *
 * Wiring:
 *   CheckoutReturnScreen → (on successful confirm with a purchase_id) →
 *   navigate('PurchaseUnpack', { purchaseId, packageName? }).
 *
 * Data: `clientPaymentsApi.getPurchaseDrops(purchaseId)` — same typed
 *       contract Deliverables uses (PR-13 froze it; PR-15A ships the real
 *       backend route). Receipt header (package name, amount paid,
 *       recurring next-charge) is reconciled from
 *       `clientPaymentsApi.getPurchases()` + `getPackages()` because the
 *       drops endpoint intentionally does not carry receipt fields.
 *
 * Sections:
 *   • Receipt header — package name, amount paid, "Next charge {date}"
 *     line for recurring purchases (one_time: omitted).
 *   • Unlocked now — status='fired' (delivered immediate) drops. Tappable
 *     per the PR-13 routing table (workout → WorkoutAssignmentDetail,
 *     meal_plan → ClientDailyMealPlan, auto_message → Messages,
 *     pdf/video → non-tappable "Saved to your library").
 *   • Coming up — pending|due drops, with `upcomingCaption` for unlock
 *     timing (immediate / on_completion / on_milestone / fire_at date).
 *
 * States: loading skeleton, calm empty ("Your coach is setting things up"),
 * error retry banner, pull-to-refresh, graceful "purchase complete /
 * deliverables coming" when the endpoint is `not_configured` (501/404 —
 * never strands the buyer if PR-15A hasn't deployed yet).
 *
 * Flag-gating: this screen is only navigable when
 * `featureFlags.deliverables` is on; the CheckoutReturnScreen guards the
 * nav. If the flag is off, the legacy "Go to home" CTA on the confirm
 * screen still ships — the unpack screen is additive.
 *
 * Reuses the shared `DropRow` + `routeForDrop` from
 * `./deliverables/dropRow.tsx` so the routing table cannot drift from
 * the persistent Deliverables screen.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useNavigation,
  useRoute,
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
} from '@react-navigation/native';

import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { useTheme, type ThemeColors } from '../../theme/ThemeProvider';
import {
  clientPaymentsApi,
  type ClientCoachPackage,
  type ClientPurchase,
  type PaymentsResult,
  type ScheduledDropView,
} from '../../api/clientPaymentsApi';
import {
  DropRow,
  buyerStatusOf,
  routeForDrop,
} from './deliverables/dropRow';
import { formatCurrencyCents } from '../../utils/currency';

type PurchaseUnpackRouteParams = {
  purchaseId: string;
  /** Optional pre-fetched package name; the screen reconciles it from
   *  `getPurchases()` + `getPackages()` if the caller doesn't pass one. */
  packageName?: string;
};

interface Receipt {
  packageName: string | null;
  amountDisplay: string | null;
  recurring: boolean;
  /** Plain ISO timestamp — the renderer formats locally. */
  nextChargeAt: string | null;
}

function buildReceipt(
  purchaseId: string,
  purchases: ClientPurchase[],
  packages: ClientCoachPackage[],
  packageNameOverride: string | null,
): Receipt {
  const purchase = purchases.find((p) => p.id === purchaseId) ?? null;
  const pkg = purchase
    ? packages.find((p) => p.id === purchase.package_id) ?? null
    : null;
  const packageName = packageNameOverride ?? pkg?.name ?? null;
  const amountDisplay = pkg
    ? formatCurrencyCents(Math.round(pkg.price * 100), pkg.currency)
    : null;
  // `interval` on the CoachPackage is the source of truth for recurring vs
  // one_time (the purchase row carries the period_end but not the type).
  const recurring = !!pkg && pkg.type === 'recurring';
  const nextChargeAt =
    recurring && purchase && !purchase.cancel_at_period_end
      ? purchase.current_period_end
      : null;
  return { packageName, amountDisplay, recurring, nextChargeAt };
}

function formatChargeDate(iso: string | null): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year:
      d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  });
}

interface PurchaseUnpackContentProps {
  dropsResult: PaymentsResult<ScheduledDropView[]>;
  receipt: Receipt;
  refreshing: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  onOpenDrop: (drop: ScheduledDropView) => void;
  onDone: () => void;
  onGoToDeliverables: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}

function PurchaseUnpackContent({
  dropsResult,
  receipt,
  refreshing,
  onRefresh,
  onRetry,
  onOpenDrop,
  onDone,
  onGoToDeliverables,
  styles,
  colors,
}: PurchaseUnpackContentProps) {
  const visible = useMemo(() => {
    if (!dropsResult.ok)
      return { unlocked: [] as ScheduledDropView[], coming: [] as ScheduledDropView[] };
    const unlocked: ScheduledDropView[] = [];
    const coming: ScheduledDropView[] = [];
    for (const drop of dropsResult.data) {
      const status = buyerStatusOf(drop);
      if (status === 'delivered') unlocked.push(drop);
      else if (status === 'upcoming') coming.push(drop);
    }
    unlocked.sort((a, b) => {
      const ta = a.fired_at ? Date.parse(a.fired_at) : 0;
      const tb = b.fired_at ? Date.parse(b.fired_at) : 0;
      return tb - ta;
    });
    coming.sort((a, b) => {
      const ta = a.fire_at ? Date.parse(a.fire_at) : Number.POSITIVE_INFINITY;
      const tb = b.fire_at ? Date.parse(b.fire_at) : Number.POSITIVE_INFINITY;
      return ta - tb;
    });
    return { unlocked, coming };
  }, [dropsResult]);

  // ─── Receipt header ──────────────────────────────────────────────────
  const ReceiptHeader = (
    <View style={styles.receiptCard} testID="purchase-unpack-receipt">
      <View style={styles.celebrateRow}>
        <Ionicons name="checkmark-circle" size={28} color={colors.success} />
        <Text style={styles.celebrateText}>You&apos;re in</Text>
      </View>
      {receipt.packageName ? (
        <Text style={styles.packageName}>{receipt.packageName}</Text>
      ) : null}
      {receipt.amountDisplay ? (
        <Text style={styles.amount}>{receipt.amountDisplay} paid</Text>
      ) : null}
      {receipt.recurring && receipt.nextChargeAt ? (
        <Text
          style={styles.nextCharge}
          testID="purchase-unpack-next-charge"
          accessibilityLabel={`Next charge ${formatChargeDate(receipt.nextChargeAt) ?? ''}`}
        >
          Next charge {formatChargeDate(receipt.nextChargeAt)}
        </Text>
      ) : null}
    </View>
  );

  // ─── States: graceful + error ────────────────────────────────────────
  if (!dropsResult.ok && dropsResult.reason === 'not_configured') {
    // 404/501 — PR-15A hasn't deployed yet OR coach hasn't enabled
    // deliverables. NEVER strand the buyer with an error banner; the
    // purchase was successful, surface that calmly.
    return (
      <ScrollView
        testID="purchase-unpack-not-configured"
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {ReceiptHeader}
        <View style={styles.empty}>
          <Ionicons name="cube-outline" size={36} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Purchase complete</Text>
          <Text style={styles.emptyBody}>
            Your coach is finalising what&apos;s included. You&apos;ll see
            everything appear in Deliverables as it&apos;s unlocked.
          </Text>
        </View>
        <View style={styles.footerCtas}>
          <TouchableOpacity
            style={styles.ctaPrimary}
            onPress={onDone}
            accessibilityRole="button"
            testID="purchase-unpack-done"
          >
            <Text style={styles.ctaPrimaryText}>Done</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  if (!dropsResult.ok) {
    return (
      <ScrollView
        testID="purchase-unpack-error"
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {ReceiptHeader}
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.error} />
          <Text style={styles.emptyTitle}>We couldn&apos;t load what&apos;s included</Text>
          <Text style={styles.emptyBody}>
            Your purchase went through. Check your connection and try again,
            or open Deliverables from your packages screen later.
          </Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry loading what's included"
            testID="purchase-unpack-retry"
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.footerCtas}>
          <TouchableOpacity
            style={styles.ctaSecondary}
            onPress={onDone}
            accessibilityRole="button"
            testID="purchase-unpack-done"
          >
            <Text style={styles.ctaSecondaryText}>Done</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // ─── Empty (no buyer-visible drops yet) ──────────────────────────────
  if (visible.unlocked.length === 0 && visible.coming.length === 0) {
    return (
      <ScrollView
        testID="purchase-unpack-empty"
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {ReceiptHeader}
        <View style={styles.empty}>
          <Ionicons name="hourglass-outline" size={36} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Your coach is setting things up</Text>
          <Text style={styles.emptyBody}>
            Items in this package will appear here as your coach releases
            them. You&apos;ll get a notification each time.
          </Text>
        </View>
        <View style={styles.footerCtas}>
          <TouchableOpacity
            style={styles.ctaPrimary}
            onPress={onDone}
            accessibilityRole="button"
            testID="purchase-unpack-done"
          >
            <Text style={styles.ctaPrimaryText}>Done</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  // ─── Healthy: unlocked + coming sections ─────────────────────────────
  return (
    <ScrollView
      testID="purchase-unpack-list"
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.primary}
        />
      }
    >
      {ReceiptHeader}

      {visible.unlocked.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Unlocked now</Text>
          <Text style={styles.sectionSub}>
            Ready to use — tap to open.
          </Text>
          {visible.unlocked.map((drop) => (
            <DropRow
              key={drop.id}
              drop={drop}
              variant="delivered"
              onPress={onOpenDrop}
            />
          ))}
        </>
      ) : null}

      {visible.coming.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Coming up</Text>
          <Text style={styles.sectionSub}>
            Released on a schedule your coach set.
          </Text>
          {visible.coming.map((drop) => (
            <DropRow
              key={drop.id}
              drop={drop}
              variant="upcoming"
              onPress={onOpenDrop}
            />
          ))}
        </>
      ) : null}

      <View style={styles.footerCtas}>
        <TouchableOpacity
          style={styles.ctaSecondary}
          onPress={onGoToDeliverables}
          accessibilityRole="button"
          testID="purchase-unpack-go-to-deliverables"
        >
          <Text style={styles.ctaSecondaryText}>View deliverables</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.ctaPrimary}
          onPress={onDone}
          accessibilityRole="button"
          testID="purchase-unpack-done"
        >
          <Text style={styles.ctaPrimaryText}>Done</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

export default function PurchaseUnpackScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute<
    RouteProp<Record<string, PurchaseUnpackRouteParams>, string>
  >();
  const { purchaseId, packageName: packageNameParam } = route.params ?? {
    purchaseId: '',
  };

  const [dropsResult, setDropsResult] = useState<
    PaymentsResult<ScheduledDropView[]> | null
  >(null);
  const [receipt, setReceipt] = useState<Receipt>({
    packageName: packageNameParam ?? null,
    amountDisplay: null,
    recurring: false,
    nextChargeAt: null,
  });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!purchaseId) {
      setDropsResult({ ok: true, data: [] });
      return;
    }
    // Drops + receipt fetched in parallel — the receipt header should
    // render even if the drops request lags, but they're typically both
    // fast. Receipt failures degrade silently (the header just hides
    // the optional rows); drops failures show the error banner.
    const [drops, purchases, packages] = await Promise.all([
      clientPaymentsApi.getPurchaseDrops(purchaseId),
      clientPaymentsApi.getPurchases(),
      clientPaymentsApi.getPackages(),
    ]);
    setDropsResult(drops);
    setReceipt(
      buildReceipt(
        purchaseId,
        purchases.ok ? purchases.data : [],
        packages.ok ? packages.data : [],
        packageNameParam ?? null,
      ),
    );
  }, [purchaseId, packageNameParam]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onOpenDrop = useCallback(
    (drop: ScheduledDropView) => routeForDrop(drop, navigation),
    [navigation],
  );

  const onDone = useCallback(() => {
    // Done returns the buyer to the app home — they can re-open the
    // unpack moment via the Deliverables timeline if needed (it persists).
    const parent = navigation.getParent?.();
    if (parent?.navigate) {
      (parent as unknown as { navigate: (n: string) => void }).navigate('Home');
    } else {
      (navigation as unknown as { navigate: (n: string) => void }).navigate(
        'Home',
      );
    }
  }, [navigation]);

  const onGoToDeliverables = useCallback(() => {
    (
      navigation as unknown as {
        navigate: (n: string, p: { purchaseId: string; packageName?: string }) => void;
      }
    ).navigate('Deliverables', {
      purchaseId,
      packageName: receipt.packageName ?? undefined,
    });
  }, [navigation, purchaseId, receipt.packageName]);

  if (!dropsResult) {
    return <SkeletonScreen count={6} testID="purchase-unpack-skeleton" />;
  }

  return (
    <PurchaseUnpackContent
      dropsResult={dropsResult}
      receipt={receipt}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onRetry={() => void load()}
      onOpenDrop={onOpenDrop}
      onDone={onDone}
      onGoToDeliverables={onGoToDeliverables}
      styles={styles}
      colors={colors}
    />
  );
}

// Pure-helper test surface.
export const __test = {
  buildReceipt,
  formatChargeDate,
};

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40 },
    receiptCard: {
      backgroundColor: colors.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 20,
    },
    celebrateRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginBottom: 8,
    },
    celebrateText: {
      fontSize: 22,
      fontWeight: '600',
      color: colors.textPrimary,
    },
    packageName: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textPrimary,
      marginTop: 2,
    },
    amount: {
      fontSize: 14,
      color: colors.textSecondary,
      marginTop: 4,
    },
    nextCharge: {
      fontSize: 13,
      color: colors.textMuted,
      marginTop: 4,
    },
    sectionTitle: {
      fontSize: 12,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 18,
      marginBottom: 4,
    },
    sectionSub: {
      fontSize: 12,
      color: colors.textSecondary,
      marginBottom: 8,
    },
    empty: { alignItems: 'center', paddingVertical: 36, paddingHorizontal: 12 },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.textPrimary,
      marginTop: 12,
      textAlign: 'center',
    },
    emptyBody: {
      fontSize: 14,
      color: colors.textSecondary,
      textAlign: 'center',
      marginTop: 8,
      lineHeight: 20,
    },
    retryBtn: {
      marginTop: 18,
      backgroundColor: colors.primary,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderRadius: 10,
    },
    retryBtnText: { color: colors.textOnPrimary, fontWeight: '600', fontSize: 14 },
    footerCtas: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 28,
    },
    ctaPrimary: {
      flex: 1,
      backgroundColor: colors.primary,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
    },
    ctaPrimaryText: {
      color: colors.textOnPrimary,
      fontWeight: '600',
      fontSize: 15,
    },
    ctaSecondary: {
      flex: 1,
      borderWidth: 1,
      borderColor: colors.border,
      paddingVertical: 14,
      borderRadius: 12,
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    ctaSecondaryText: {
      color: colors.textPrimary,
      fontWeight: '600',
      fontSize: 15,
    },
  });
