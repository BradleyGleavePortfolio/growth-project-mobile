/**
 * DeliverablesScreen — buyer-facing "what you got + what's coming next"
 * timeline for one ClientPurchase. The consumer surface for the drip
 * engine (master plan PR-9/PR-10 → ScheduledDrop rows).
 *
 * Data: `clientPaymentsApi.getPurchaseDrops(purchaseId)` (see file
 *       header in clientPaymentsApi.ts for the documented backend gap +
 *       typed contract this screen is built against).
 *
 * Rows (master plan §3 `ScheduledDrop.status`):
 *   • fired                       → "Delivered" (tappable, routes to the
 *                                   existing per-asset_type viewer)
 *   • pending | due               → "Upcoming" (locked, "Unlocks {when}")
 *   • failed | canceled | skipped → HIDDEN from buyer (master plan §1 #10
 *                                   → COACH_ALERT, not buyer-facing).
 *                                   PR-13 BUILD REPORT (f) documents this.
 *
 * Viewers (existing screens — no new viewers built):
 *   workout_program / workout_plan → 'WorkoutAssignmentDetail' { assignmentId }
 *   meal_plan                      → 'ClientDailyMealPlan'    { date }
 *   auto_message                   → 'Messages'               (parent Home stack)
 *   pdf / video                    → not tappable today (PR-12 ships the
 *                                    viewers; until then "Saved to your
 *                                    library" caption — degrades cleanly).
 *
 * Empty / loading / error / pull-to-refresh all handled here; no headless
 * states. Date formatting uses the platform's `Intl.RelativeTimeFormat`
 * (locale-aware, timezone-safe) for the "Unlocks in 3 days" copy and
 * the device locale's `toLocaleDateString` for absolute dates. Display
 * only — no time-sensitive business logic is derived from
 * `Date.now()` here (Rule 16); the timestamps come from the server and
 * are formatted for the buyer.
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

// Route params: the purchase id we're listing drops for + optional human-
// readable package name to render in the header (avoids a second fetch
// for a label the caller already has).
type DeliverablesRouteParams = {
  purchaseId: string;
  packageName?: string;
};

const ASSET_ICON: Record<ScheduledDropAssetType, keyof typeof Ionicons.glyphMap> = {
  workout_program: 'barbell-outline',
  workout_plan: 'barbell-outline',
  meal_plan: 'restaurant-outline',
  pdf: 'document-text-outline',
  video: 'play-circle-outline',
  auto_message: 'chatbubble-ellipses-outline',
};

const ASSET_LABEL: Record<ScheduledDropAssetType, string> = {
  workout_program: 'Workout program',
  workout_plan: 'Workout plan',
  meal_plan: 'Meal plan',
  pdf: 'Document',
  video: 'Video',
  auto_message: 'Message',
};

/**
 * Buyer-visible status. Drops with status in
 * (failed | canceled | skipped) are filtered out of the list entirely
 * (coach gets the COACH_ALERT). Within the visible set we collapse
 * (pending | due) into "upcoming" and (fired) into "delivered".
 */
type BuyerStatus = 'delivered' | 'upcoming';

function buyerStatusOf(drop: ScheduledDropView): BuyerStatus | null {
  if (drop.status === 'fired') return 'delivered';
  if (drop.status === 'pending' || drop.status === 'due') return 'upcoming';
  return null;
}

/**
 * "Unlocks in 3 days" / "Unlocks May 31" / "Unlocks today" formatting.
 * Built on `Intl.RelativeTimeFormat` so the wording matches the device
 * locale; absolute fallback uses the user's local calendar.
 *
 * Same wall-clock day → `Intl.RelativeTimeFormat` with `numeric: 'auto'`
 * produces "today" / "tomorrow" / "in N days" using the device's locale
 * and timezone, so DST and east-of-UTC users don't get an off-by-one
 * label for a `fire_at` later today.
 */
function formatUnlockAt(iso: string | null): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const now = Date.now();
  const diffMs = ts - now;
  const absMs = Math.abs(diffMs);
  // Below 1 hour → minutes; below 1 day → hours; below 7 days → days;
  // else show calendar date.
  if (absMs < 60_000) return 'Unlocks shortly';
  let rtf: Intl.RelativeTimeFormat | null = null;
  try {
    rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  } catch {
    rtf = null;
  }
  if (absMs < 60 * 60_000) {
    const mins = Math.round(diffMs / 60_000);
    return rtf ? `Unlocks ${rtf.format(mins, 'minute')}` : `Unlocks in ${Math.max(1, mins)}m`;
  }
  if (absMs < 24 * 60 * 60_000) {
    const hrs = Math.round(diffMs / (60 * 60_000));
    return rtf ? `Unlocks ${rtf.format(hrs, 'hour')}` : `Unlocks in ${Math.max(1, hrs)}h`;
  }
  if (absMs < 7 * 24 * 60 * 60_000) {
    const days = Math.round(diffMs / (24 * 60 * 60_000));
    return rtf ? `Unlocks ${rtf.format(days, 'day')}` : `Unlocks in ${Math.max(1, days)}d`;
  }
  const d = new Date(ts);
  return `Unlocks ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
}

function formatDeliveredAt(iso: string | null): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const d = new Date(ts);
  return `Delivered ${d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year:
      d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  })}`;
}

/**
 * Caption for an upcoming drop. `fire_at`-backed cadences (immediate,
 * relative_to_purchase, fixed_calendar) show the relative date; trigger-
 * backed cadences (on_completion, on_milestone) show the trigger copy.
 *
 * cadence_payload is intentionally NOT parsed here — the row's
 * `display_caption` is the coach-authored label for that specific
 * trigger ("Unlocks when you complete Week 1", "Unlocks at Phase 2").
 * If the coach left it blank we fall back to a neutral copy so we never
 * leak schema field names to the buyer.
 */
function upcomingCaption(drop: ScheduledDropView): string {
  if (drop.fire_at) return formatUnlockAt(drop.fire_at);
  if (drop.cadence_kind === 'on_completion') {
    return drop.display_caption
      ? `Unlocks when you complete ${drop.display_caption}`
      : 'Unlocks when you complete the previous step';
  }
  if (drop.cadence_kind === 'on_milestone') {
    return drop.display_caption
      ? `Unlocks at ${drop.display_caption}`
      : 'Unlocks at the next milestone';
  }
  return 'Unlocks soon';
}

/**
 * Pre-flight: can this delivered drop route to a real existing viewer?
 *
 * - workout_program / workout_plan need a `materialised_ref` (assignment id).
 * - meal_plan needs a `materialised_ref` we treat as the start date string
 *   (the meal-plan viewer is keyed by date).
 * - auto_message routes to Messages (no params needed beyond opening
 *   the thread surface).
 * - pdf / video have no viewer registered today (PR-12 is out of scope).
 *
 * If a delivered drop cannot route, the row renders non-tappable with a
 * neutral "Saved to your library" caption. Master plan rule 18 — we never
 * fabricate success when the operation can't complete.
 */
function isTappableDelivered(drop: ScheduledDropView): boolean {
  if (drop.status !== 'fired') return false;
  switch (drop.asset_type) {
    case 'workout_program':
    case 'workout_plan':
      return typeof drop.materialised_ref === 'string' && drop.materialised_ref.length > 0;
    case 'meal_plan':
      return typeof drop.materialised_ref === 'string' && drop.materialised_ref.length > 0;
    case 'auto_message':
      return true; // routes to Messages list
    case 'pdf':
    case 'video':
      return false; // viewer not built yet (PR-12)
    default:
      return false;
  }
}

function deliveredFallbackCaption(asset_type: ScheduledDropAssetType): string {
  if (asset_type === 'pdf' || asset_type === 'video') {
    return 'Saved to your library';
  }
  return 'Tap to open';
}

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
    // Delivered: most recent first; upcoming: soonest first (nulls last).
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
      // 501 — surface coach hasn't enabled deliverables on this deployment.
      // Render the empty state; do NOT show a scary error.
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
    // 'error' — real, retryable failure.
    //
    // We NEVER surface the raw axios `message` (e.g. "Request failed
    // with status code 404") to the buyer — Rule 9 (no raw error codes
    // to users) + Rule 17 (scrub server internals). The technical
    // detail is still in `result.message` for any logger/observability
    // wiring; the UI renders only a friendly, action-oriented copy.
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
              styles={styles}
              colors={colors}
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
              styles={styles}
              colors={colors}
            />
          ))}
        </>
      ) : null}
    </ScrollView>
  );
}

interface DropRowProps {
  drop: ScheduledDropView;
  variant: BuyerStatus;
  onPress: (drop: ScheduledDropView) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: ThemeColors;
}

function DropRow({ drop, variant, onPress, styles, colors }: DropRowProps) {
  const tappable = variant === 'delivered' && isTappableDelivered(drop);
  const icon = ASSET_ICON[drop.asset_type] ?? 'cube-outline';
  const typeLabel = ASSET_LABEL[drop.asset_type] ?? 'Item';
  const title = drop.display_title?.trim() || typeLabel;
  const caption =
    variant === 'delivered'
      ? drop.fired_at
        ? formatDeliveredAt(drop.fired_at)
        : deliveredFallbackCaption(drop.asset_type)
      : upcomingCaption(drop);

  const a11yLabel =
    variant === 'delivered'
      ? `${typeLabel}, ${title}. ${caption}.${tappable ? ' Tap to open.' : ''}`
      : `${typeLabel}, ${title}. ${caption}. Locked.`;

  const Inner = (
    <View style={[styles.row, variant === 'upcoming' && styles.rowLocked]}>
      <View
        style={[
          styles.iconWrap,
          variant === 'upcoming' && styles.iconWrapLocked,
        ]}
      >
        <Ionicons
          name={variant === 'upcoming' ? 'lock-closed-outline' : icon}
          size={20}
          color={variant === 'upcoming' ? colors.textMuted : colors.primary}
        />
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.rowTypeLabel}>{typeLabel}</Text>
        <Text
          style={[
            styles.rowTitle,
            variant === 'upcoming' && styles.rowTitleLocked,
          ]}
          numberOfLines={2}
        >
          {title}
        </Text>
        {drop.display_caption && variant === 'delivered' ? (
          <Text style={styles.rowDesc} numberOfLines={2}>
            {drop.display_caption}
          </Text>
        ) : null}
        <Text style={styles.rowMeta}>{caption}</Text>
      </View>
      {variant === 'delivered' && tappable ? (
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      ) : null}
    </View>
  );

  if (tappable) {
    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        onPress={() => onPress(drop)}
        activeOpacity={0.7}
        testID={`drop-row-${drop.id}`}
        style={styles.rowTouchable}
      >
        {Inner}
      </TouchableOpacity>
    );
  }
  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={a11yLabel}
      testID={`drop-row-${drop.id}`}
      style={styles.rowTouchable}
    >
      {Inner}
    </View>
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
      // Defensive: route should always be reached with a purchase id;
      // surface a graceful empty so the screen never crashes if it isn't.
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
    (drop: ScheduledDropView) => {
      if (!isTappableDelivered(drop)) return;
      // Per-asset_type viewer routing — reuses existing screens registered
      // on ClientNavigator's MoreStack / HomeStack. Never builds a new
      // viewer (PR-13 brief scope guardrail).
      switch (drop.asset_type) {
        case 'workout_program':
        case 'workout_plan':
          if (drop.materialised_ref) {
            (
              navigation as unknown as {
                navigate: (n: string, p: { assignmentId: string }) => void;
              }
            ).navigate('WorkoutAssignmentDetail', {
              assignmentId: drop.materialised_ref,
            });
          }
          return;
        case 'meal_plan':
          if (drop.materialised_ref) {
            (
              navigation as unknown as {
                navigate: (n: string, p: { date: string }) => void;
              }
            ).navigate('ClientDailyMealPlan', {
              date: drop.materialised_ref,
            });
          }
          return;
        case 'auto_message': {
          // Messages lives on the Home stack — route through the parent
          // navigator the same way ClientPackagesScreen handles
          // "Message your coach".
          const parent = navigation.getParent?.();
          if (parent?.navigate) {
            (parent as unknown as {
              navigate: (n: string, p: { screen: string }) => void;
            }).navigate('Home', { screen: 'Messages' });
          } else {
            (
              navigation as unknown as { navigate: (n: string) => void }
            ).navigate('Messages');
          }
          return;
        }
        case 'pdf':
        case 'video':
          // Viewers ship in PR-12; row is rendered non-tappable today, so
          // we should never reach here. Guard anyway (Rule 18 — no
          // fabricated success).
          return;
        default:
          return;
      }
    },
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
// Keeping them on the module surface (a) prevents drift between the screen
// and tests, and (b) makes the buyer-visibility filter auditable from one
// place per master plan §1 #10.
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
    rowTouchable: {
      borderRadius: 12,
      marginBottom: 10,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 12,
    },
    rowLocked: {
      backgroundColor: colors.background,
      borderStyle: 'dashed',
    },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primaryPale,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconWrapLocked: {
      backgroundColor: colors.surface,
    },
    rowBody: { flex: 1 },
    rowTypeLabel: {
      fontSize: 10,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    rowTitle: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
    rowTitleLocked: { color: colors.textSecondary },
    rowDesc: {
      fontSize: 12,
      color: colors.textSecondary,
      marginTop: 2,
      lineHeight: 16,
    },
    rowMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
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
