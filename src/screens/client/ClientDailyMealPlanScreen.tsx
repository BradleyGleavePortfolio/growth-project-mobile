/**
 * ClientDailyMealPlanScreen — assigned meal plan as a slot-grouped list.
 *
 * Reads `/me/meal-plan/today` via `useMealPlanToday(dateIso?)`. The
 * endpoint returns one or more active assignments for the requested
 * date; we list every one, newest first (the API's starts_on DESC
 * order), each with its slots grouped by slot_label. More > Meal plan
 * opens this screen with no params, so a client with two active plans
 * reaches and logs both here.
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
 * screen shows exactly that assignment instead of every active one. If it is
 * absent, an honest unavailable state replaces another plan.
 *
 * When no assignment is active for the chosen day we render an honest
 * empty state — no fabricated suggestions, no "ask your coach" CTA
 * that cannot do anything from here. The plan is read-only for the
 * client (the coach assigns plans from `CoachDailyMealPlanScreen`); each
 * slot offers "Log this meal" (components/mealplan/LogPlannedMealButton),
 * which adds it to today's food log.
 */

import React, { useCallback, useMemo } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
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
import LogPlannedMealButton, { plannedMealFromSlot } from '../../components/mealplan/LogPlannedMealButton';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import { MastLine, mast, MealArt, PaperPage, PlanMasthead, planStyleC, TimelineRow, useCoachItalic } from './mealplan/planStyleC';

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

  const shown: DailyMealPlanAssignmentWithPlan[] = useMemo(() => {
    const all = data?.assignments ?? [];
    return assignmentId ? all.filter((a) => a.id === assignmentId) : all;
  }, [data, assignmentId]);

  const italic = useCoachItalic();
  const loaded = !isLoading && !isError;
  // One plan (the usual day): its name, the coach's note and the day total sit
  // on the masthead, as C2 C_day draws the coach's italic note there (FIX-927,
  // LS-927 B1: the note shows once, on the masthead). Several plans keep each
  // name, note and total with their own meals on the paper.
  const single = loaded && shown.length === 1 ? shown[0] : null;
  const singleTotal = single ? formatDayTotal(single.daily_meal_plan.slots) : null;

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
      <PlanMasthead eyebrow={dateParam ?? 'MEAL PLAN'} title={dateParam || assignmentId ? 'Meal plan' : "Today's meals"}
        testID="daily-meal-plan-masthead">
        {single ? (
          <>
            <Text style={styles.mastPlan}>{single.daily_meal_plan.name}</Text>
            {single.daily_meal_plan.notes ? (
              <Text style={[styles.mastNote, italic]} testID="daily-meal-plan-note">{single.daily_meal_plan.notes}</Text>
            ) : null}
            {singleTotal ? <MastLine testID="daily-meal-plan-total" style={styles.tabular}>{singleTotal}</MastLine> : null}
          </>
        ) : null}
      </PlanMasthead>

      <PaperPage bg={sc.bgSurface}>
        {isLoading ? (
          <SkeletonScreen count={3} />
        ) : isError ? (
          <View style={[planStyleC.card, styles.cardFill, styles.state]} accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Text style={[typography.body, { color: sc.textPrimary }]}>
              Could not load this meal plan. Pull to retry.
            </Text>
            <HapticPressable onPress={onRefresh} disabled={isRefetching} accessibilityRole="button"
              accessibilityLabel="Try again" style={[planStyleC.primary, { backgroundColor: sc.accent }]}>
              <Text style={[planStyleC.primaryLabel, { color: sc.textOnAccent }]}>Try again</Text>
            </HapticPressable>
          </View>
        ) : shown.length === 0 && assignmentId ? (
          <UnavailableState styles={styles} sc={sc} />
        ) : shown.length === 0 ? (
          <EmptyState styles={styles} sc={sc} dateOverride={dateParam} />
        ) : (
          shown.map((a) => <PlanSection key={a.id} assignment={a} sc={sc} styles={styles} italic={italic} onMasthead={a === single} />)
        )}
      </PaperPage>
    </ScrollView>
  );
}

function PlanSection({ assignment, sc, styles, italic, onMasthead }: {
  assignment: DailyMealPlanAssignmentWithPlan;
  sc: SemanticTokens;
  styles: Styles;
  italic: StyleProp<TextStyle>;
  /** The name, note and day total already show on the masthead. */
  onMasthead: boolean;
}) {
  const plan = assignment.daily_meal_plan;
  const byLabel = new Map<SlotLabel, DailyMealPlanSlot[]>();
  for (const slot of plan.slots) {
    const label = slot.slot_label as SlotLabel;
    byLabel.set(label, [...(byLabel.get(label) ?? []), slot]);
  }
  const dayTotal = onMasthead ? null : formatDayTotal(plan.slots);
  const labels = SLOT_LABELS.filter((l) => byLabel.has(l));
  return (
    <View style={styles.plan}>
      {!onMasthead ? <Text style={[typography.h2, { color: sc.textPrimary }]}>{plan.name}</Text> : null}
      {dayTotal ? (
        <Text testID="daily-meal-plan-total"
          style={[typography.bodySmall, styles.tabular, { color: sc.textMuted }]}>
          {dayTotal}
        </Text>
      ) : null}
      {plan.notes && !onMasthead ? (
        <Text style={[planStyleC.name, italic, styles.notes, { color: sc.textPrimary }]}>{plan.notes}</Text>
      ) : null}
      <View style={styles.timeline}>
        {labels.map((label, i) => (
          <SlotGroup key={label} label={label} sc={sc} styles={styles} last={i === labels.length - 1}
            slots={(byLabel.get(label) ?? []).sort((a, b) => a.order - b.order)} />
        ))}
      </View>
    </View>
  );
}

function SlotGroup({
  label,
  slots,
  sc,
  styles,
  last,
}: {
  label: SlotLabel;
  slots: DailyMealPlanSlot[];
  sc: SemanticTokens;
  styles: Styles;
  last: boolean;
}) {
  return (
    <TimelineRow line={sc.border} dot={sc.textMuted} bg={sc.bgSurface} last={last} style={styles.stop}>
      <Text style={[planStyleC.eyebrow, { color: sc.textMuted }]} accessibilityRole="header">
        {formatSlotLabel(label)}
      </Text>
      {slots.map((s) => (
        <View key={s.id} style={styles.slotRow}>
          {/* The meal's words beside its cream tile (C2 C_day); the words wrap, the tile keeps its size. */}
          <View style={styles.mealHead}>
            <View style={styles.mealWords}>
              <Text style={[planStyleC.name, { color: sc.textPrimary }]}>
                {s.meal_template.name}
              </Text>
              <Text style={[planStyleC.meta, styles.tabular, { color: sc.textMuted }]}>
                {s.meal_template.calories_kcal} kcal • P {s.meal_template.protein_g}g • C{' '}
                {s.meal_template.carbs_g}g • F {s.meal_template.fats_g}g
              </Text>
              {s.meal_template.description ? (
                <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
                  {s.meal_template.description}
                </Text>
              ) : null}
            </View>
            <MealArt slot={s.slot_label} testID={`daily-meal-plan-art-${s.id}`} />
          </View>
          <LogPlannedMealButton meal={plannedMealFromSlot(s)} slot={s.slot_label} planSlotId={s.id} />
        </View>
      ))}
    </TimelineRow>
  );
}

function UnavailableState({ styles, sc }: { styles: Styles; sc: SemanticTokens }) {
  return (
    <View style={[planStyleC.card, styles.cardFill, styles.state]} testID="meal-plan-ended">
      <Text style={[typography.h3, { color: sc.textPrimary }]}>This plan is not available for this day</Text>
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
    <View style={[planStyleC.card, styles.cardFill, styles.state]}>
      <Text style={[typography.h3, { color: sc.textPrimary }]}>
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
    content: { flexGrow: 1 },
    mastPlan: { ...typography.h2, color: mast.ink, marginTop: spacing.md },
    // The coach's note in C2's italic, on the masthead in its muted ink (C_day).
    mastNote: { ...typography.h2, fontSize: 19, lineHeight: 25, letterSpacing: 0, color: mast.muted, marginTop: spacing.sm },
    tabular: { fontVariant: ['tabular-nums'] },
    cardFill: { backgroundColor: sc.bgPrimary, borderColor: sc.border },
    state: { gap: spacing.md },
    plan: { gap: spacing.sm, marginBottom: spacing.xl },
    notes: { marginBottom: spacing.sm },
    timeline: { marginTop: spacing.sm },
    stop: { paddingBottom: spacing.xl },
    slotRow: { gap: spacing.xs, marginTop: spacing.xs },
    mealHead: { flexDirection: 'row', alignItems: 'flex-start' },
    // Meal names at the frame's 21 pt Cormorant (planStyleC.name; LS-927 B2), then the meta and the description.
    mealWords: { flex: 1, minWidth: 0, gap: spacing.xs },
  });
}
