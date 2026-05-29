/**
 * DeliverablesScreen — buyer-facing "what you got + what's coming next"
 * timeline for one ClientPurchase. The consumer surface for the drip
 * engine (master plan PR-9/PR-10 → ScheduledDrop rows).
 *
 * Data: `clientPaymentsApi.getPurchaseDrops(purchaseId)` (real backend
 *       route shipped by PR-15A; see clientPaymentsApi.ts header).
 *
 * Rows (master plan §3 `ScheduledDrop.status`):
 *   • fired                       → "Delivered" (tappable, routes to the
 *                                   existing per-asset_type viewer)
 *   • pending | due               → "Upcoming" (locked, "Unlocks {when}")
 *   • failed | canceled | skipped → HIDDEN from buyer (master plan §1 #10
 *                                   → COACH_ALERT, not buyer-facing).
 *                                   PR-13 BUILD REPORT (f) documents this.
 *
 * The row component + per-asset_type routing helpers live in
 * `./deliverables/dropRow.tsx` and are shared with `PurchaseUnpackScreen`
 * (PR-15B) — keeping a single source of truth for buyer-visibility,
 * tappability, and destination routing. PR-13 had these inlined; PR-15B
 * lifted them so the two screens cannot drift.
 *
 * Empty / loading / error / pull-to-refresh all handled here; no headless
 * states.
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
  useFocusEffect,
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
  type PaymentsResult,
  type ScheduledDropAssetType,
  type ScheduledDropCadenceKind,
  type ScheduledDropView,
} from '../../api/clientPaymentsApi';
import {
  DropRow,
  buyerStatusOf,
  isTappableDelivered,
  formatUnlockAt,
  formatDeliveredAt,
  upcomingCaption,
  routeForDrop,
} from './deliverables/dropRow';

// Route params: the purchase id we're listing drops for + optional human-
// readable package name to render in the header (avoids a second fetch
// for a label the caller already has).
type DeliverablesRouteParams = {
  purchaseId: string;
  packageName?: string;
};

interface DeliverablesScreenContentProps {
  result: PaymentsResult<ScheduledDropView[]>;
  refreshing: boolean;
  onRefresh: () => void;
  onRetry: () => void;
  onOpenDrop: (drop: ScheduledDropView) => void;
  headerTitle: string;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}

function DeliverablesContent({
  result,
  refreshing,
  onRefresh,
  onRetry,
  onOpenDrop,
  headerTitle,
  styles,
  colors,
}: DeliverablesScreenContentProps) {
  const visible = useMemo(() => {
    if (!result.ok) return { delivered: [] as ScheduledDropView[], upcoming: [] as ScheduledDropView[] };
    const delivered: ScheduledDropView[] = [];
    const upcoming: ScheduledDropView[] = [];
    for (const drop of result.data) {
      const status = buyerStatusOf(drop);
      if (status === 'delivered') delivered.push(drop);
      else if (status === 'upcoming') upcoming.push(drop);
      // failed | canceled | skipped → filtered out (buyer-visibility decision).
    }
    delivered.sort((a, b) => {
      const ta = a.fired_at ? Date.parse(a.fired_at) : 0;
      const tb = b.fired_at ? Date.parse(b.fired_at) : 0;
      return tb - ta;
    });
    upcoming.sort((a, b) => {
      const ta = a.fire_at ? Date.parse(a.fire_at) : Number.POSITIVE_INFINITY;
      const tb = b.fire_at ? Date.parse(b.fire_at) : Number.POSITIVE_INFINITY;
      return ta - tb;
    });
    return { delivered, upcoming };
  }, [result]);

  if (!result.ok) {
    if (result.reason === 'not_configured') {
      return (
        <ScrollView
          testID="deliverables-empty"
          style={styles.container}
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
        >
          <Text style={styles.header}>{headerTitle}</Text>
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No deliverables yet</Text>
            <Text style={styles.emptyBody}>
              Your coach hasn&apos;t added anything to this package yet. Check
              back soon.
            </Text>
          </View>
        </ScrollView>
      );
    }
    return (
      <ScrollView
        testID="deliverables-error"
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <Text style={styles.header}>{headerTitle}</Text>
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.error} />
          <Text style={styles.emptyTitle}>We couldn&apos;t load deliverables</Text>
          <Text style={styles.emptyBody}>
            Check your connection and try again. If this keeps happening,
            message your coach.
          </Text>
          <TouchableOpacity
            style={styles.retryBtn}
            onPress={onRetry}
            accessibilityRole="button"
            accessibilityLabel="Retry loading deliverables"
            testID="deliverables-retry"
          >
            <Text style={styles.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    );
  }

  if (visible.delivered.length === 0 && visible.upcoming.length === 0) {
    return (
      <ScrollView
        testID="deliverables-empty"
        style={styles.container}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <Text style={styles.header}>{headerTitle}</Text>
        <View style={styles.empty}>
          <Ionicons name="cube-outline" size={36} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No deliverables yet</Text>
          <Text style={styles.emptyBody}>
            Your coach hasn&apos;t added anything to this package yet. Check
            back soon.
          </Text>
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView
      testID="deliverables-list"
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
      }
    >
      <Text style={styles.header}>{headerTitle}</Text>
      <Text style={styles.subheader}>
        What&apos;s included and when it unlocks. Tap a delivered item to open
        it.
      </Text>

      {visible.delivered.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Delivered</Text>
          {visible.delivered.map((drop) => (
            <DropRow
              key={drop.id}
              drop={drop}
              variant="delivered"
              onPress={onOpenDrop}
            />
          ))}
        </>
      ) : null}

      {visible.upcoming.length > 0 ? (
        <>
          <Text style={styles.sectionTitle}>Upcoming</Text>
          {visible.upcoming.map((drop) => (
            <DropRow
              key={drop.id}
              drop={drop}
              variant="upcoming"
              onPress={onOpenDrop}
            />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

export default function DeliverablesScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const route = useRoute<RouteProp<Record<string, DeliverablesRouteParams>, string>>();
  const { purchaseId, packageName } = route.params ?? { purchaseId: '' };
  const headerTitle = packageName ? `${packageName} • Deliverables` : 'Deliverables';

  const [result, setResult] = useState<PaymentsResult<ScheduledDropView[]> | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!purchaseId) {
      setResult({ ok: true, data: [] });
      return;
    }
    const r = await clientPaymentsApi.getPurchaseDrops(purchaseId);
    setResult(r);
  }, [purchaseId]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const onOpenDrop = useCallback(
    (drop: ScheduledDropView) => routeForDrop(drop, navigation),
    [navigation],
  );

  if (!result) {
    return <SkeletonScreen count={6} testID="deliverables-skeleton" />;
  }

  return (
    <DeliverablesContent
      result={result}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onRetry={() => void load()}
      onOpenDrop={onOpenDrop}
      headerTitle={headerTitle}
      styles={styles}
      colors={colors}
    />
  );
}

// Export the cadence + asset-type unions and pure helpers for unit tests.
// Re-exported from `./deliverables/dropRow.tsx` so the existing PR-13
// test surface keeps working while the implementations live in the
// shared module.
export const __test = {
  buyerStatusOf,
  isTappableDelivered,
  formatUnlockAt,
  formatDeliveredAt,
  upcomingCaption,
};
export type { ScheduledDropCadenceKind, ScheduledDropAssetType };

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 20, paddingTop: 56, paddingBottom: 40 },
    header: {
      fontSize: 28,
      fontWeight: '600',
      color: colors.textPrimary,
      marginBottom: 4,
    },
    subheader: {
      fontSize: 13,
      color: colors.textSecondary,
      lineHeight: 18,
      marginBottom: 16,
    },
    sectionTitle: {
      fontSize: 12,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 18,
      marginBottom: 8,
    },
    empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 16 },
    emptyTitle: {
      fontSize: 18,
      fontWeight: '600',
      color: colors.textPrimary,
      marginTop: 12,
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
  });
