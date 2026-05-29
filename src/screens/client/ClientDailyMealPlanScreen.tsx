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
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';

// Route params: optional ISO date string (YYYY-MM-DD). Falls back to
// today (useMealPlanToday's default) when omitted, matching the legacy
// call site behaviour.
type MealPlanRouteParams = { date?: string } | undefined;

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

  const { data, isLoading, isError, refetch, isRefetching } =
    useMealPlanToday(dateParam);

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const active: DailyMealPlanAssignmentWithPlan | null = useMemo(() => {
    if (!data || data.assignments.length === 0) return null;
    return data.assignments[0] ?? null;
  }, [data]);

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

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={onRefresh}
          tintColor={sc.accent}
        />
      }
    >
      <Text style={[typography.h2, { color: sc.textPrimary }]}>
        {dateParam ? 'Meal plan' : "Today's meals"}
      </Text>

      {isLoading ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Loading...
        </Text>
      ) : isError ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Could not load today's plan. Pull to retry.
        </Text>
      ) : !active ? (
        <EmptyState styles={styles} sc={sc} dateOverride={dateParam} />
      ) : (
        <>
          <Text style={[typography.bodySmall, { color: sc.accent }]}>
            {active.daily_meal_plan.name}
          </Text>
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
          <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
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
      <Text style={[typography.h3, { color: sc.textPrimary }]}>
        {dateOverride ? 'No plan for this day' : 'No plan for today'}
      </Text>
      <Text style={[typography.body, { color: sc.textMuted }]}>
        {dateOverride
          ? 'Your coach has not assigned a meal plan that covers this day. Once they do, the slot list will appear here.'
          : 'Your coach has not assigned a meal plan that covers today. Once they do, the slot list will appear here.'}
      </Text>
    </View>
  );
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
    content: { padding: spacing.lg, gap: spacing.md },
    card: {
      backgroundColor: sc.bgSurface,
      borderRadius: 12,
      padding: spacing.lg,
      gap: spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
    },
    slotRow: { gap: spacing.xs, paddingVertical: spacing.xs },
  });
}
