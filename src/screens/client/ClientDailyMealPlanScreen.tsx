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
 *
 * GOAL-927-M (203-D20 op 1): a round toward C2 Style C C_day. The masthead says the day as the Food day
 * does, the coach's note in its quote marks and, with a target, what is left of it beside one gold mark per
 * meal; each meal shows its coach's time in the drawn time column, and today a gold now line once every meal
 * has a time. While the plan checklist switch is on (the only time a log is linked to its plan meal), an
 * eaten meal's mark fills with the Food day's done line under it, and today's next meal offers "Ate it as
 * planned" on the drawn cream card. The two reads (the target and the day's log) are the ones Macro targets
 * already makes; the eaten rule is the Food day's own (buildPlanDay).
 */

import React, { useCallback, useMemo, type ReactNode } from 'react';
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
import { useCurrentMacrosForSelf } from '../../hooks/useMacros';
import { useTodayLog } from '../../hooks/useApi';
import { getTodayString } from '../../utils/date';
import { featureFlags } from '../../config/featureFlags';
import { buildPlanDay, type DaySlot } from '../../utils/log/foodDay';
import { clockOf, dayLeft, minutesOf } from '../../utils/log/foodTimeline';
import { foodLogFromDailyEntry, type DailyLogEntry } from '../../utils/log/dailyEntry';
import { Skeleton } from '../../ui/skeletons/Skeleton';
import HapticPressable from '../../components/HapticPressable';
import LogPlannedMealButton, { plannedMealFromSlot } from '../../components/mealplan/LogPlannedMealButton';
import { colors, radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import {
  MastLine, mast, MastProgress, MealArt, NowRow, PaperPage, PlanMasthead, planStyleC, TimeCell, TimelineRow, useCoachItalic, useTimeColumn,
} from './mealplan/planStyleC';

// The Food day's words and formats, copied screen-locally (FoodDayView.tsx:41, :52, :232-236).
const n = (v: number) => Math.round(v).toLocaleString('en-US');
const longDay = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
// C_day's quote marks round the coach's note, unless the note already opens or closes with one (RULING 8).
const QUOTED = /^["'\u201C\u2018]|["'\u201D\u2019]$/;
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

/** One meal in the screen's order (main's: each plan, then SLOT_LABELS, then slot.order). */
interface Stop { slot: DailyMealPlanSlot; plan: string; first: boolean; last: boolean }

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
  const timeW = useTimeColumn();

  // The shown day: the route's date, else today (today's read stays the no-date read above).
  const today = getTodayString();
  const shownDay = dateParam ?? today;
  const isToday = shownDay === today;
  // RULING 3: the target and the shown day's log, read as Macro targets reads them.
  const target = useCurrentMacrosForSelf();
  const daily = useTodayLog(shownDay);
  const log = !daily.isError && daily.data && typeof daily.data === 'object'
    ? daily.data as { entries?: DailyLogEntry[]; total_calories?: unknown; total_protein_g?: unknown } : null;
  const goal = target.data ? { calories: num(target.data.calories_kcal), protein: num(target.data.protein_g) } : null;
  const left = log ? dayLeft(goal, { calories: num(log.total_calories), protein: num(log.total_protein_g) }) : null;
  // FoodDayView.tsx:233-235, word for word.
  const leftLine = !left ? null : left.over
    ? `${n(left.kcal)} kcal above today's target. Protein ${n(left.eatenProtein)} of ${n(left.targetProtein)} g.`
    : `${n(left.kcal)} kcal and ${n(left.protein)} g protein left.`;

  // RULING 4: the Food day's eaten rule. Only while the checklist switch is on is a log linked to its plan meal.
  const checklist = featureFlags.foodPlanChecklist;
  const stops = useMemo(() => orderStops(shown), [shown]);
  const eaten = useMemo(() => {
    const logs = checklist && log ? (log.entries ?? []).map((e) => foodLogFromDailyEntry(e, shownDay)) : [];
    const day = buildPlanDay(shown.map((a) => a.daily_meal_plan), logs);
    return new Map<string, DaySlot>(day.slots.map((x) => [x.key, x]));
  }, [checklist, log, shown, shownDay]);
  const isDone = (id: string) => checklist && (eaten.get(id)?.logs.length ?? 0) > 0;
  // The Food day's nextSlot over the shown plans in shown order; today only (the button logs to today).
  const next = checklist && isToday ? stops.find((x) => !isDone(x.slot.id))?.slot.id ?? null : null;
  // RULING 5: the now line today, once every shown meal has a time, after the last meal at or before the clock.
  const mins = stops.map((x) => minutesOf(x.slot.time_of_day));
  const nowMin = isToday && stops.length > 0 && mins.every((m) => m != null) ? nowMinutes() : null;
  const nowAfter = nowMin == null ? null
    : stops.reduce<string | null>((at, x, i) => ((mins[i] as number) <= nowMin ? x.slot.id : at), 'start');
  const ctx: DayCtx = { sc, styles, timeW, isDone, eaten, next, nowAfter, nowMin, firstId: stops[0]?.slot.id ?? null };
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
          // The pull-down above the masthead is forest (PlanMasthead), so the
          // iOS spinner takes the light ink, as the other forest pull-downs do (LO-927R2 B1).
          tintColor={mast.ink}
        />
      }
    >
      <PlanMasthead eyebrow={(isToday ? `Today, ${longDay(shownDay)}` : longDay(shownDay)).toUpperCase()}
        title={dateParam || assignmentId ? 'Meal plan' : "Today's meals"}
        testID="daily-meal-plan-masthead" bones={isLoading}>
        {single ? (
          <>
            <Text style={styles.mastPlan}>{single.daily_meal_plan.name}</Text>
            {single.daily_meal_plan.notes ? (
              <Quoted style={[styles.mastNote, italic]} testID="daily-meal-plan-note">{single.daily_meal_plan.notes}</Quoted>
            ) : null}
            {singleTotal ? <MastLine testID="daily-meal-plan-total" style={styles.tabular}>{singleTotal}</MastLine> : null}
          </>
        ) : null}
        {loaded && leftLine && stops.length > 0 ? (
          <MastProgress done={stops.map((x) => isDone(x.slot.id))} line={leftLine} segTestID="daily-meal-plan-seg" />
        ) : null}
      </PlanMasthead>

      <PaperPage bg={sc.bgSurface}>
        {isLoading ? (
          <LoadingTimeline sc={sc} styles={styles} timeW={timeW} />
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
          shown.map((a) => (
            <PlanSection key={a.id} assignment={a} stops={stops.filter((x) => x.plan === a.id)} italic={italic}
              onMasthead={a === single} ctx={ctx} />
          ))
        )}
      </PaperPage>
    </ScrollView>
  );
}

/** The coach's note as C_day writes it: in its quote marks (the words themselves stay one Text of their own). */
function Quoted({ children, style, testID }: { children: string; style: StyleProp<TextStyle>; testID?: string }) {
  const t = children.trim();
  return QUOTED.test(t)
    ? <Text style={style} testID={testID}>{children}</Text>
    : <Text style={style} testID={testID}>{'\u201C'}<Text>{children}</Text>{'\u201D'}</Text>;
}

/** Every shown meal in main's order and grouping: each plan, its labels in SLOT_LABELS order, then slot.order. */
function orderStops(shown: DailyMealPlanAssignmentWithPlan[]): Stop[] {
  return shown.flatMap((a) => {
    const byLabel = new Map<SlotLabel, DailyMealPlanSlot[]>();
    for (const slot of a.daily_meal_plan.slots) {
      const label = slot.slot_label as SlotLabel;
      byLabel.set(label, [...(byLabel.get(label) ?? []), slot]);
    }
    const labels = SLOT_LABELS.filter((l) => byLabel.has(l));
    const list = labels.flatMap((l) => [...(byLabel.get(l) ?? [])].sort((x, y) => x.order - y.order)
      .map((slot, i) => ({ slot, plan: a.id, first: i === 0, last: false })));
    if (list.length) list[list.length - 1].last = true;
    return list;
  });
}

interface DayCtx {
  sc: SemanticTokens;
  styles: Styles;
  timeW: number;
  isDone: (id: string) => boolean;
  eaten: Map<string, DaySlot>;
  next: string | null;
  nowAfter: string | null;
  nowMin: number | null;
  /** The first shown meal: a now line before every meal goes above it. */
  firstId: string | null;
}

function PlanSection({ assignment, stops, italic, onMasthead, ctx }: {
  assignment: DailyMealPlanAssignmentWithPlan;
  stops: Stop[];
  italic: StyleProp<TextStyle>;
  /** The name, note and day total already show on the masthead. */
  onMasthead: boolean;
  ctx: DayCtx;
}) {
  const { sc, styles } = ctx;
  const plan = assignment.daily_meal_plan;
  const dayTotal = onMasthead ? null : formatDayTotal(plan.slots);
  const nowRow = (key: string): ReactNode => (ctx.nowMin != null
    ? <NowRow key={key} clock={clockOf(ctx.nowMin)} width={ctx.timeW} line={colors.stone} ink={sc.accentText} testID="daily-meal-plan-now" />
    : null);
  const firstPlan = ctx.nowAfter === 'start' && stops.length > 0 && stops[0].slot.id === ctx.firstId;
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
        <Quoted style={[planStyleC.name, italic, styles.notes, { color: sc.textPrimary }]}>{plan.notes}</Quoted>
      ) : null}
      <View style={styles.timeline}>
        {firstPlan ? nowRow('now-start') : null}
        {stops.map((x) => (
          <React.Fragment key={x.slot.id}>
            <MealStop stop={x} ctx={ctx} />
            {ctx.nowAfter === x.slot.id ? nowRow('now') : null}
          </React.Fragment>
        ))}
      </View>
    </View>
  );
}

/** One meal: its time, its mark on the gutter, its words beside the cream tile, and its log action. */
function MealStop({ stop, ctx }: { stop: Stop; ctx: DayCtx }) {
  const { sc, styles } = ctx;
  const s = stop.slot;
  const min = minutesOf(s.time_of_day);
  const done = ctx.isDone(s.id);
  const status = done ? ctx.eaten.get(s.id)?.status ?? null : null;
  const isNext = ctx.next === s.id;
  return (
    <View style={styles.timed}>
      <TimeCell text={min != null ? clockOf(min) : ''} width={ctx.timeW} ink={sc.textMuted} />
      <View style={styles.grow}>
        <TimelineRow line={colors.stone} dot={done ? sc.accent : sc.textMuted} bg={sc.bgSurface} filled={done}
          last={stop.last && ctx.nowAfter !== s.id} style={styles.stop} markTestID={`daily-meal-plan-mark-${s.id}`}>
          {/* The meal's words beside its cream tile (C2 C_day); the words wrap, the tile keeps its size. */}
          <View style={styles.mealHead}>
            <View style={styles.mealWords}>
              {stop.first ? (
                <Text style={[planStyleC.stopEyebrow, { color: sc.textMuted }]} accessibilityRole="header">
                  {formatSlotLabel(s.slot_label as SlotLabel)}
                </Text>
              ) : null}
              <Text style={[planStyleC.name, { color: sc.textPrimary }]}>
                {s.meal_template.name}
              </Text>
              {status ? <Text style={[planStyleC.status, { color: sc.textMuted }]}>{status}</Text> : null}
              <Text style={[planStyleC.meta, styles.tabular, { color: sc.textMuted }]}>
                {s.meal_template.calories_kcal} kcal • P {s.meal_template.protein_g}g • C{' '}
                {s.meal_template.carbs_g}g • F {s.meal_template.fats_g}g
              </Text>
              {s.meal_template.description && !isNext ? (
                <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
                  {s.meal_template.description}
                </Text>
              ) : null}
            </View>
            <MealArt slot={s.slot_label} testID={`daily-meal-plan-art-${s.id}`} />
          </View>
          {isNext ? (
            // C_day .c-next: today's next meal on the cream card with what is in it and "Ate it as planned".
            <View style={planStyleC.nextCard} testID="daily-meal-plan-next-card">
              {s.meal_template.description ? <Text style={planStyleC.nextText}>{s.meal_template.description}</Text> : null}
              <LogPlannedMealButton meal={plannedMealFromSlot(s)} slot={s.slot_label} planSlotId={s.id} planned />
            </View>
          ) : (
            <LogPlannedMealButton meal={plannedMealFromSlot(s)} slot={s.slot_label} planSlotId={s.id} />
          )}
        </TimelineRow>
      </View>
    </View>
  );
}

/**
 * C2 C_loading (LS-927R2 B1): four stops on the meal timeline, each a short
 * eyebrow bar over a longer name bar, on the meal list's own gutter and ring.
 * The bones are the shared Skeleton primitive (its pulse holds still under
 * Reduce Motion) and are hidden from readers; the block says main's "Loading".
 * Local to this screen: the shared SkeletonScreen is unchanged.
 */
function LoadingTimeline({ sc, styles, timeW }: { sc: SemanticTokens; styles: Styles; timeW: number }) {
  return (
    <View testID="daily-meal-plan-loading" accessible accessibilityLabel="Loading">
      <View style={styles.timeline} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {[0, 1, 2, 3].map((i) => (
          <View key={i} style={styles.timed}>
            <TimeCell text="" width={timeW} ink={sc.textMuted} />
            <View style={styles.grow}>
              <TimelineRow line={colors.stone} dot={sc.textMuted} bg={sc.bgSurface} last={i === 3} style={styles.stop}>
                <View style={styles.loadingStop}>
                  <Skeleton width="44%" height={10} borderRadius={radius.pill} />
                  <Skeleton width="100%" height={18} borderRadius={radius.pill} />
                </View>
              </TimelineRow>
            </View>
          </View>
        ))}
      </View>
    </View>
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
    mastPlan: { ...typography.h2, color: mast.ink, marginTop: spacing.sm },
    // The coach's note in C2's italic on the masthead, in the light ink (C_day .q: 1.1875rem/1.35, 6 pt under the title).
    mastNote: { ...typography.h2, fontSize: 19, lineHeight: 26, letterSpacing: 0, color: mast.ink, marginTop: 6 },
    tabular: { fontVariant: ['tabular-nums'] },
    cardFill: { backgroundColor: sc.bgPrimary, borderColor: sc.border },
    state: { gap: spacing.md },
    plan: { gap: spacing.sm, marginBottom: spacing.xl },
    notes: { marginBottom: spacing.sm },
    // C_day's first row 22 pt under the paper's top (the paper's 20 plus 2).
    timeline: { marginTop: 2 },
    timed: { flexDirection: 'row' },
    grow: { flex: 1, minWidth: 0 },
    // C_day .c-e: 12 pt under each meal before the next.
    stop: { paddingBottom: spacing.md },
    slotRow: { gap: spacing.xs, marginTop: spacing.xs },
    mealHead: { flexDirection: 'row', alignItems: 'flex-start' },
    // Meal names at the frame's 21 pt Cormorant (planStyleC.name; LS-927 B2), then the meta and the description.
    mealWords: { flex: 1, minWidth: 0, gap: 2 },
    loadingStop: { gap: spacing.sm, paddingRight: spacing.xl },
  });
}
