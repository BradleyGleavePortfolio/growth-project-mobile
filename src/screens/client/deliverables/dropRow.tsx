/**
 * Shared DropRow + per-asset_type routing helpers used by both
 * `DeliverablesScreen` (PR-13) and `PurchaseUnpackScreen` (PR-15B).
 *
 * Lifted out of DeliverablesScreen to keep the two surfaces honestly
 * identical — the audit guard that "the unpack screen routes to the
 * SAME destinations as the deliverables screen" is enforced by both
 * importing from this single module instead of re-implementing.
 *
 * What lives here:
 *   • pure helpers (`buyerStatusOf`, `isTappableDelivered`,
 *     `upcomingCaption`, `formatUnlockAt`, `formatDeliveredAt`,
 *     `deliveredFallbackCaption`)
 *   • `routeForDrop` — the per-asset_type navigate() callback (PR-13
 *     routing table; rule 18: never fabricate success when there's no
 *     `materialised_ref`)
 *   • `DropRow` — the row component (delivered vs upcoming variants,
 *     non-tappable graceful degrade, theme-aware styling)
 *
 * What does NOT live here:
 *   • Screen-level chrome (header, sections, refresh control) — each
 *     screen renders its own.
 *   • Data loading — each screen calls
 *     `clientPaymentsApi.getPurchaseDrops` itself.
 */

import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type {
  NavigationProp,
  ParamListBase,
} from '@react-navigation/native';

import { useTheme } from '../../../theme/ThemeProvider';
import type { SemanticTokens, Tokens } from '../../../theme/tokens';
import type {
  ScheduledDropAssetType,
  ScheduledDropView,
} from '../../../api/clientPaymentsApi';

// ─── Asset-type display tables ──────────────────────────────────────────────

export const ASSET_ICON: Record<ScheduledDropAssetType, keyof typeof Ionicons.glyphMap> = {
  workout_program: 'barbell-outline',
  workout_plan: 'barbell-outline',
  meal_plan: 'restaurant-outline',
  pdf: 'document-text-outline',
  video: 'play-circle-outline',
  auto_message: 'chatbubble-ellipses-outline',
};

export const ASSET_LABEL: Record<ScheduledDropAssetType, string> = {
  workout_program: 'Workout program',
  workout_plan: 'Workout plan',
  meal_plan: 'Meal plan',
  pdf: 'Document',
  video: 'Video',
  auto_message: 'Message',
};

// ─── Buyer-visibility helpers ───────────────────────────────────────────────

/**
 * Buyer-visible status. Drops with status in
 * (failed | canceled | skipped) are filtered out of the list entirely
 * (coach gets the COACH_ALERT — master plan §1 #10). Within the visible
 * set we collapse (pending | due) into "upcoming" and (fired) into
 * "delivered".
 */
export type BuyerStatus = 'delivered' | 'upcoming';

export function buyerStatusOf(drop: ScheduledDropView): BuyerStatus | null {
  if (drop.status === 'fired') return 'delivered';
  if (drop.status === 'pending' || drop.status === 'due') return 'upcoming';
  return null;
}

/**
 * "Unlocks in 3 days" / "Unlocks May 31" / "Unlocks today" formatting.
 * Built on `Intl.RelativeTimeFormat` so the wording matches the device
 * locale; absolute fallback uses the user's local calendar.
 */
export function formatUnlockAt(iso: string | null): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  const now = Date.now();
  const diffMs = ts - now;
  const absMs = Math.abs(diffMs);
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

export function formatDeliveredAt(iso: string | null): string {
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
export function upcomingCaption(drop: ScheduledDropView): string {
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
 * - meal_plan needs a `materialised_ref` we treat as the start date string.
 * - auto_message routes to Messages (no params needed beyond opening
 *   the thread surface).
 * - pdf / video have no viewer registered today (PR-12 is out of scope).
 *
 * If a delivered drop cannot route, the row renders non-tappable with a
 * neutral "Saved to your library" caption. Master plan rule 18 — we never
 * fabricate success when the operation can't complete.
 */
export function isTappableDelivered(drop: ScheduledDropView): boolean {
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

export function deliveredFallbackCaption(asset_type: ScheduledDropAssetType): string {
  if (asset_type === 'pdf' || asset_type === 'video') {
    return 'Saved to your library';
  }
  return 'Tap to open';
}

// ─── Per-asset_type viewer routing ──────────────────────────────────────────

/**
 * The single source of truth for "where does tapping a delivered drop
 * take you?". Both DeliverablesScreen and PurchaseUnpackScreen call
 * this — extracting it keeps the two screens honestly identical and
 * removes the risk of drift.
 *
 * Caller is responsible for first checking `isTappableDelivered(drop)`;
 * this function is a no-op for non-tappable drops (defense-in-depth
 * against rule 18 — fabricated success).
 */
export function routeForDrop(
  drop: ScheduledDropView,
  navigation: NavigationProp<ParamListBase>,
): void {
  if (!isTappableDelivered(drop)) return;
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
      // we should never reach here. Guard anyway.
      return;
    default:
      return;
  }
}

// ─── DropRow component ──────────────────────────────────────────────────────

export interface DropRowProps {
  drop: ScheduledDropView;
  variant: BuyerStatus;
  onPress: (drop: ScheduledDropView) => void;
}

export function DropRow({ drop, variant, onPress }: DropRowProps) {
  const { semanticColors, tokens } = useTheme();
  const styles = React.useMemo(() => makeStyles(semanticColors, tokens), [semanticColors, tokens]);
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
          color={variant === 'upcoming' ? semanticColors.textMuted : semanticColors.accent}
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
        <Ionicons name="chevron-forward" size={18} color={semanticColors.textMuted} />
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

const makeStyles = (semanticColors: SemanticTokens, tokens: Tokens) =>
  StyleSheet.create({
    rowTouchable: {
      borderRadius: 12,
      marginBottom: 10,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: semanticColors.bgSurface,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: semanticColors.border,
      padding: 12,
    },
    rowLocked: {
      backgroundColor: semanticColors.bgPrimary,
      borderStyle: 'dashed',
    },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: tokens.brand[50],
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconWrapLocked: {
      backgroundColor: semanticColors.bgSurface,
    },
    rowBody: { flex: 1 },
    rowTypeLabel: {
      fontSize: 10,
      color: semanticColors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: 2,
    },
    rowTitle: { fontSize: 15, fontWeight: '600', color: semanticColors.textPrimary },
    rowTitleLocked: { color: semanticColors.textMuted },
    rowDesc: {
      fontSize: 12,
      color: semanticColors.textMuted,
      marginTop: 2,
      lineHeight: 16,
    },
    rowMeta: { fontSize: 12, color: semanticColors.textMuted, marginTop: 4 },
  });

// Test surface — pure helpers exposed for unit tests.
export const __test = {
  buyerStatusOf,
  isTappableDelivered,
  formatUnlockAt,
  formatDeliveredAt,
  upcomingCaption,
  deliveredFallbackCaption,
};
