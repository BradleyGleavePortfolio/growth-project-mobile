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
import { SafeAreaView } from 'react-native-safe-area-context';
import HapticPressable from '../../components/HapticPressable';
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type NavigationProp,
  type ParamListBase,
  type RouteProp,
} from '@react-navigation/native';

import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens, Tokens } from '../../theme/tokens';
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
  semanticColors: SemanticTokens;
}

function DeliverablesContent({
  result,
  refreshing,
  onRefresh,
  onRetry,
  onOpenDrop,
  headerTitle,
  styles,
  semanticColors,
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
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={semanticColors.accent} />
          }
        >
          <Text style={styles.header}>{headerTitle}</Text>
          <View style={styles.empty}>
            <Ionicons name="cube-outline" size={36} color={semanticColors.textMuted} />
            <Text style={styles.emptyTitle}>Content list unavailable</Text>
            <Text style={styles.emptyBody}>
              This purchase&apos;s content list is not available here.
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={semanticColors.accent} />
        }
      >
        <Text style={styles.header}>{headerTitle}</Text>
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={36} color={semanticColors.textMuted} />
          <Text style={styles.emptyTitle}>Deliverables did not load</Text>
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
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={semanticColors.accent} />
        }
      >
        <Text style={styles.header}>{headerTitle}</Text>
        <View style={styles.empty}>
          <Ionicons name="cube-outline" size={36} color={semanticColors.textMuted} />
          <Text style={styles.emptyTitle}>No content listed</Text>
          <Text style={styles.emptyBody}>
            No content is listed for this purchase.
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
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={semanticColors.accent} />
      }
    >
      <Text style={styles.header}>{headerTitle}</Text>
      <Text style={styles.subheader}>
        What&apos;s included and when it unlocks.
        {visible.delivered.some(isTappableDelivered) ? ' Tap a delivered item to open it.' : ''}
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
  const { semanticColors, tokens } = useTheme();
  const styles = useMemo(() => makeStyles(semanticColors, tokens), [semanticColors, tokens]);
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

  const content = !result ? <SkeletonScreen count={6} testID="deliverables-skeleton" /> : (
    <DeliverablesContent
      result={result}
      refreshing={refreshing}
      onRefresh={onRefresh}
      onRetry={() => void load()}
      onOpenDrop={onOpenDrop}
      headerTitle={headerTitle}
      styles={styles}
      semanticColors={semanticColors}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <HapticPressable
        disableAnimation
        style={styles.back}
        accessibilityRole="button"
        accessibilityLabel="Back"
        testID="deliverables-back"
        onPress={() => navigation.goBack()}
      >
        <Ionicons name="arrow-back-outline" size={22} color={semanticColors.textPrimary} />
      </HapticPressable>
      {content}
    </SafeAreaView>
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

const makeStyles = (semanticColors: SemanticTokens, tokens: Tokens) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: semanticColors.bgPrimary },
    content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48 },
    back: { width: 44, height: 44, marginLeft: 16, alignItems: 'center', justifyContent: 'center' },
    header: {
      ...tokens.typography.h1,
      color: semanticColors.textPrimary,
      marginBottom: 12,
    },
    subheader: {
      ...tokens.typography.bodySmall,
      color: semanticColors.textMuted,
      marginBottom: 24,
    },
    sectionTitle: {
      ...tokens.typography.eyebrow,
      color: semanticColors.textMuted,
      marginTop: 24,
      marginBottom: 12,
    },
    empty: { alignItems: 'center', paddingVertical: 48, paddingHorizontal: 16 },
    emptyTitle: {
      ...tokens.typography.bodyMd,
      color: semanticColors.textPrimary,
      marginTop: 12,
    },
    emptyBody: {
      ...tokens.typography.bodySmall,
      color: semanticColors.textMuted,
      textAlign: 'center',
      marginTop: 8,
    },
    retryBtn: {
      marginTop: 18,
      backgroundColor: semanticColors.accent,
      paddingHorizontal: 20,
      paddingVertical: 10,
      minHeight: 44,
      justifyContent: 'center',
      borderRadius: tokens.radius.lg,
    },
    retryBtnText: { ...tokens.typography.bodyMd, color: semanticColors.textOnAccent },
  });
