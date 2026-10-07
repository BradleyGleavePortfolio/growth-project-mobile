/**
 * ClientDailyMealPlanScreen — assigned meal plan as a slot-grouped list.
 *
 * Reads `/me/meal-plan/today` via `useMealPlanToday(dateIso?)`. The
 * endpoint returns one or more active assignments for the requested
 * date; we pick the most-recent (first in the API's starts_on DESC
 * order) and render its slots grouped by slot_label.
 *
 * Route param `date` (optional, ISO `YYYY-MM-DD`): when present, the
 * screen loads the plan that covers that day instead of today. Added
 * for PR-13 audit fix (P2-2): the Deliverables timeline routes a
 * delivered `meal_plan` drop into this screen with the drop's
 * `materialised_ref` (start-date string) as `date`, so tapping a
 * delivered plan opens THAT plan rather than silently showing today.
 * The route entry in `MoreStackParamList` already typed this param as
 * `{ date?: string } | undefined` — the screen was the one that needed
 * to honor it. Defaults to today when omitted (the legacy call site).
 *
 * Route param `assignmentId` (B-DELIV-125, B4): the backend materialises a
 * delivered meal_plan drop as a DailyMealPlanAssignment and stores its id in
 * `materialised_ref`, not a date. Delivered assignments start on delivery
 * day with no end, so the plan is among today's active assignments; the
 * screen shows exactly that assignment instead of the newest one. If it is
 * absent, an honest unavailable state replaces another plan.
 *
 * When no assignment is active for the chosen day we render an honest
 * empty state — no fabricated suggestions, no "ask your coach" CTA
 * that cannot do anything from here. The client-side surface is
 * read-only; the coach assigns plans from `CoachDailyMealPlanScreen`.
 */

import React, { useCallback, useMemo } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRoute, type RouteProp } from '@react-navigation/native';
import {
  SLOT_LABELS,
  type DailyMealPlanAssignmentWithPlan,
  type DailyMealPlanSlot,
  type SlotLabel,
} from '../../api/mealTemplatesApi';
import { useMealPlanToday } from '../../hooks/useMealTemplates';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import HapticPressable from '../../components/HapticPressable';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';

// Route params: optional ISO date string (YYYY-MM-DD). Falls back to
// today (useMealPlanToday's default) when omitted, matching the legacy
// call site behaviour.
type MealPlanRouteParams = { date?: string; assignmentId?: string } | undefined;

// Accept either YYYY-MM-DD or a full ISO timestamp; the hook + backend
// query parameter expect YYYY-MM-DD so we trim accordingly.
function normaliseDateParam(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  // Reject anything that isn't a plausible date string so a malformed
  // route param can't propagate into the query string. Defense in depth
  // — the typed param is `string` but routes can be deep-linked.
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? match[1] : undefined;
}

export default function ClientDailyMealPlanScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);

  const route = useRoute<RouteProp<Record<string, MealPlanRouteParams>, string>>();
  const dateParam = normaliseDateParam(route.params?.date);
  const assignmentId = route.params?.assignmentId || undefined;

  const { data, isLoading, isError, refetch, isRefetching } =
    useMealPlanToday(dateParam);

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const active: DailyMealPlanAssignmentWithPlan | null = useMemo(() => {
    if (!data || data.assignments.length === 0) return null;
    if (assignmentId) {
      return data.assignments.find((a) => a.id === assignmentId) ?? null;
    }
    return data.assignments[0] ?? null;
  }, [data, assignmentId]);

  const groups = useMemo<Array<{ label: SlotLabel; slots: DailyMealPlanSlot[] }>>(() => {
    if (!active) return [];
    const byLabel = new Map<SlotLabel, DailyMealPlanSlot[]>();
    for (const slot of active.daily_meal_plan.slots) {
      const label = slot.slot_label as SlotLabel;
      const list = byLabel.get(label) ?? [];
      list.push(slot);
      byLabel.set(label, list);
    }
    return SLOT_LABELS.filter((l) => byLabel.has(l)).map((label) => ({
      label,
      slots: (byLabel.get(label) ?? []).sort((a, b) => a.order - b.order),
    }));
  }, [active]);

  const dayTotal = useMemo(() => formatDayTotal(active?.daily_meal_plan.slots ?? []), [active]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          testID="daily-meal-plan-refresh"
          refreshing={isRefetching}
          onRefresh={onRefresh}
          tintColor={sc.accent}
        />
      }
    >
      <Text style={[typography.eyebrow, { color: sc.textMuted }]}>{dateParam ?? 'MEAL PLAN'}</Text>
      <Text style={[typography.h1, { color: sc.textPrimary }]}>
        {dateParam || assignmentId ? 'Meal plan' : "Today's meals"}
      </Text>

      {isLoading ? (
        <SkeletonScreen count={3} />
      ) : isError ? (
        <View style={styles.card} accessibilityLiveRegion="polite">
          <Text style={[typography.body, { color: sc.textMuted }]}>
            Could not load this meal plan. Pull to retry.
          </Text>
          <HapticPressable onPress={onRefresh} disabled={isRefetching} accessibilityRole="button"
            accessibilityLabel="Try again" style={styles.retry}>
            <Text style={[typography.bodySmall, { color: sc.textOnAccent }]}>Try again</Text>
          </HapticPressable>
        </View>
      ) : !active && assignmentId ? (
        <UnavailableState styles={styles} sc={sc} />
      ) : !active ? (
        <EmptyState styles={styles} sc={sc} dateOverride={dateParam} />
      ) : (
        <>
          <Text style={[typography.h2, { color: sc.textPrimary }]}>
            {active.daily_meal_plan.name}
          </Text>
          {dayTotal ? (
            <Text testID="daily-meal-plan-total"
              style={[typography.bodySmall, { color: sc.textMuted, fontVariant: ['tabular-nums'] }]}>
              {dayTotal}
            </Text>
          ) : null}
          {active.daily_meal_plan.notes ? (
            <Text style={[typography.bodySmall, { color: sc.textMuted }]}>{active.daily_meal_plan.notes}</Text>
          ) : null}
          {groups.map((g) => (
            <SlotGroup key={g.label} label={g.label} slots={g.slots} sc={sc} styles={styles} />
          ))}
        </>
      )}
    </ScrollView>
  );
}

function SlotGroup({
  label,
  slots,
  sc,
  styles,
}: {
  label: SlotLabel;
  slots: DailyMealPlanSlot[];
  sc: SemanticTokens;
  styles: Styles;
}) {
  return (
    <View style={styles.card}>
      <Text style={[typography.eyebrow, { color: sc.textMuted }]}>
        {formatSlotLabel(label)}
      </Text>
      {slots.map((s) => (
        <View key={s.id} style={styles.slotRow}>
          <Text style={[typography.bodyMd, { color: sc.textPrimary }]}>
            {s.meal_template.name}
          </Text>
          <Text style={[typography.bodySmall, { color: sc.textMuted, fontVariant: ['tabular-nums'] }]}>
            {s.meal_template.calories_kcal} kcal • P {s.meal_template.protein_g}g • C{' '}
            {s.meal_template.carbs_g}g • F {s.meal_template.fats_g}g
          </Text>
          {s.meal_template.description ? (
            <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
              {s.meal_template.description}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function UnavailableState({ styles, sc }: { styles: Styles; sc: SemanticTokens }) {
  return (
    <View style={styles.card} testID="meal-plan-ended">
      <Text style={[typography.h4, { color: sc.textPrimary }]}>This plan is not available for this day</Text>
      <Text style={[typography.body, { color: sc.textMuted }]}>
        {'This assignment is not in the active meal plans for the selected day.'}
      </Text>
    </View>
  );
}

function EmptyState({
  styles,
  sc,
  dateOverride,
}: {
  styles: Styles;
  sc: SemanticTokens;
  dateOverride?: string;
}) {
  return (
    <View style={styles.card}>
      <Text style={[typography.h4, { color: sc.textPrimary }]}>
        {dateOverride ? 'No plan for this day' : 'No plan for today'}
      </Text>
      <Text style={[typography.body, { color: sc.textMuted }]}>
        {dateOverride
          ? 'No meal plan is assigned for this day.'
          : 'No meal plan is assigned for today.'}
      </Text>
    </View>
  );
}

// One day-total line from the slots' own macros. A nutrient is totalled only
// when every slot supplies it, so a missing value is never counted as zero.
function formatDayTotal(slots: DailyMealPlanSlot[]): string | null {
  if (slots.length === 0) return null;
  const sum = (pick: (s: DailyMealPlanSlot) => number | null | undefined): number | null => {
    let total = 0;
    for (const s of slots) {
      const v = pick(s);
      if (typeof v !== 'number' || !Number.isFinite(v)) return null;
      total += v;
    }
    return Math.round(total);
  };
  const parts = [
    [sum((s) => s.meal_template.calories_kcal), '', ' kcal'],
    [sum((s) => s.meal_template.protein_g), 'P ', 'g'],
    [sum((s) => s.meal_template.carbs_g), 'C ', 'g'],
    [sum((s) => s.meal_template.fats_g), 'F ', 'g'],
  ] as const;
  const shown = parts.filter(([v]) => v !== null).map(([v, pre, unit]) => `${pre}${v}${unit}`);
  return shown.length > 0 ? `Day total ${shown.join(' • ')}` : null;
}

function formatSlotLabel(label: SlotLabel): string {
  switch (label) {
    case 'preworkout':
      return 'Pre-workout';
    case 'postworkout':
      return 'Post-workout';
    default:
      return label.charAt(0).toUpperCase() + label.slice(1);
  }
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    content: { padding: spacing.lg, paddingBottom: spacing['3xl'], gap: spacing.lg },
    card: {
      paddingVertical: spacing.lg,
      gap: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
    },
    slotRow: { gap: spacing.xs, paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.border },
    retry: { minHeight: 44, paddingHorizontal: spacing.lg, alignSelf: 'flex-start',
      justifyContent: 'center', borderRadius: 4, backgroundColor: sc.accent },
  });
}
