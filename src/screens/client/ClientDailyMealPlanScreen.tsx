/**
 * ClientDailyMealPlanScreen — today's assigned meal plan as a slot-
 * grouped list.
 *
 * Reads /me/meal-plan/today via useMealPlanToday(). The endpoint
 * returns one or more active assignments for the requested date; we
 * pick the most-recent (first in the API's starts_on DESC order) and
 * render its slots grouped by slot_label.
 *
 * When no assignment is active for today we render an honest empty
 * state — no fabricated suggestions, no "ask your coach" CTA that
 * cannot do anything from here. The client-side surface is read-only;
 * the coach assigns plans from CoachDailyMealPlanScreen.
 */

import React, { useCallback, useMemo } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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

export default function ClientDailyMealPlanScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);

  const { data, isLoading, isError, refetch, isRefetching } =
    useMealPlanToday();

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
        Today's meals
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
        <EmptyState styles={styles} sc={sc} />
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

function EmptyState({ styles, sc }: { styles: Styles; sc: SemanticTokens }) {
  return (
    <View style={styles.card}>
      <Text style={[typography.h3, { color: sc.textPrimary }]}>
        No plan for today
      </Text>
      <Text style={[typography.body, { color: sc.textMuted }]}>
        Your coach has not assigned a meal plan that covers today. Once
        they do, the slot list will appear here.
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
