/**
 * FoodDayView: the Food tab's day in the picked C2 Style C, "Coach's page" (owner #191-E3 on m#916: "make it
 * exactly as I wanted"; planning/MOCKUP3/C2/index.md sections 3, 5, 6 and 9, frames style-c/C_day, C_over,
 * C_offline, C_loading, C_usual, C_workout, C_first). Behind featureFlags.foodPlanChecklist, the parent flag of
 * every C2 style (section 9); with it off FoodDayGate renders the classic Food log, as on main.
 *
 * A deep-forest masthead carries the day, the coach's note and what is left of the target; a cream paper page
 * (radius 24) over it holds the day as a 24-hour timeline with a time gutter and the now line. Plan meals sit at
 * the coach's time (DailyMealPlanSlot.time_of_day) or, once eaten, at the log time; a meal with no time keeps plan
 * order and shows no time. The workout from Train sits on the same line. Every tap reuses a Food log path owned
 * by LogScreen (plan meal log, repeat a past meal, the search sheet, the edit sheet), so self logging stays open
 * in every state. UI-3c (owner 10-19): every plan for the day shows in the one day; with two or more, the
 * masthead lists each plan with its own dot and note, and each meal carries its plan's tag.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutAnimation, Pressable, StyleSheet, Text, View, useWindowDimensions, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import * as Navigation from '@react-navigation/native';
import { CormorantGaramond_400Regular_Italic, useFonts } from '@expo-google-fonts/cormorant-garamond';
import api, { logApi } from '../../services/api';
import { mealTemplatesApi } from '../../api/mealTemplatesApi';
import { useMyWorkoutAssignments } from '../../hooks/useWorkoutBuilder';
import { useReducedMotion } from '../../hooks/useReducedMotion';
import HapticPressable from '../HapticPressable';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { HapticService } from '../../ui/haptics/haptics.service';
import { PrimaryButton, useScreenInsets } from '../../ui';
import { QuietError, loadFailureMessage } from '../../ui/states/QuietStates';
import { useTheme } from '../../theme/ThemeProvider';
import { colors as palette, gold, layout, radius, typography, type SemanticTokens } from '../../theme/tokens';
import { useStatusBarBand } from '../StatusBarBand';
import type { FoodLog, MealType } from '../../types';
import { addDays, getTodayString } from '../../utils/date';
import { assignmentDay } from '../../utils/workout/workoutDay';
import { buildPlanDay, buildUsualDay, dayWord, joinNames, loggedOn, nextSlot, type DaySlot, type PastDay } from '../../utils/log/foodDay';
import { buildTimeline, clockOf, dayLeft, logMinutes, minutesOf, type TimelineItem } from '../../utils/log/foodTimeline';
import type { PlanLink } from '../../utils/log/planLink';
import { countsInDay } from '../../utils/log/queuedDay';

const n = (v: number) => Math.round(v).toLocaleString('en-US');
// UI-3c board: each plan's own dot, newest plan first (gold, then forest; a third plan takes the dark gold).
const DOTS = [gold[300], palette.cream, gold[700]].map((backgroundColor) => ({ backgroundColor }));
const dotOf = (i = 0) => DOTS[i % DOTS.length];
// OFFLINE-FOOD-M (LS-931 B2): a food saved offline reads as waiting in the plan day too, with the words
// the C2 Style C offline frame draws under its meal (C2-S-15 + C2-S-16; several foods: the plural
// approved #196-E11); a refused one with the app's error title (C2-S-18). Shown, never as synced.
const offlineLine = (waiting: FoodLog[]) => (waiting.length === 1
  ? `Saved offline. ${waiting[0].foodName} will sync when you reconnect.`
  : `Saved offline. ${waiting.length} foods will sync when you reconnect.`);
const REFUSED = "Couldn't log food";
const longDay = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
// C_first: the three meals of a first day, each one tap from the search sheet.
const FIRST_MEALS: Array<{ type: MealType; label: string }> = [
  { type: 'breakfast', label: 'Breakfast' }, { type: 'lunch', label: 'Lunch' }, { type: 'dinner', label: 'Dinner' },
];

export interface FoodDayViewProps {
  coached: boolean;
  selectedDate: string;
  foodLogs: FoodLog[];
  eaten: { calories: number; protein: number };
  targets: { calories: number; protein: number } | null;
  ready: boolean;
  /** The day's log is still loading (LogScreen's first read): the Style C skeleton shows. */
  dayLoading?: boolean;
  saving: boolean;
  fallback: React.ReactNode;
  notes: React.ReactNode;
  water: React.ReactNode;
  /** Minutes after midnight for the now line; the phone's clock by default (tests and renders pass one). */
  nowMin?: number;
  onDateChange: (date: string) => void;
  onLogPlanned: (slot: DaySlot) => void;
  /** Usual day: logs the slot's usual meal again with the same foods and portions. */
  onRepeat: (slot: DaySlot) => void;
  /** Opens the search sheet for this meal; `link` (FOODLINK) is what the sheet's foods are logged for. */
  onSomethingElse: (mealType: MealType, link?: PlanLink) => void;
  onEditFood: (log: FoodLog) => void;
}

export function FoodDayGate({ on, children, ...p }: Omit<FoodDayViewProps, 'fallback'> & { on: boolean; children: React.ReactNode }) {
  return on ? <FoodDayView {...p} fallback={children} /> : <>{children}</>;
}

/** The phone's clock in minutes, moved on each minute while the day shown is today. */
function useClock(enabled: boolean): number {
  const [now, setNow] = useState(nowMinutes);
  useEffect(() => {
    if (!enabled) return undefined;
    setNow(nowMinutes());
    const id = setInterval(() => setNow(nowMinutes()), 60 * 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

/** The forest status bar over the masthead (the coach's page runs to the top edge, as Train's masthead). */
function ForestBandOwner() {
  useStatusBarBand(palette.forest);
  return null;
}
// The band follows screen focus, so it needs a navigator; outside one (a test, a render harness) there is no band.
const NO_NAVIGATION = React.createContext<unknown>(undefined);
function ForestBand() {
  const navigation = React.useContext((Navigation.NavigationContext as React.Context<unknown> | undefined) ?? NO_NAVIGATION);
  return navigation ? <ForestBandOwner /> : null;
}

/**
 * The timeline mark: filled forest once eaten (fills in 200 ms; Reduce Motion: at once). While a food in it
 * waits to sync it is C_offline's dashed ring (main's OFFLINE-FOOD-M mark), never filled as synced.
 */
function Mark({ done, waiting = false, reduced, style, fill, testID }:
  { done: boolean; waiting?: boolean; reduced: boolean; style: object; fill: object; testID?: string }) {
  const v = useRef(new Animated.Value(done ? 1 : 0)).current;
  useEffect(() => {
    if (reduced) { v.setValue(done ? 1 : 0); return; }
    Animated.timing(v, { toValue: done ? 1 : 0, duration: 200, useNativeDriver: true }).start();
  }, [done, reduced, v]);
  return (
    <View style={[style, waiting && MARK_WAITING]} testID={testID}>
      <Animated.View style={[fill, { opacity: v, transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }] }]} />
    </View>
  );
}

export default function FoodDayView(p: FoodDayViewProps) {
  const { semanticColors: sc } = useTheme();
  const { fontScale, width } = useWindowDimensions();
  // The time gutter grows with the text size so "12:35 pm" never wraps at 130 percent.
  const scale = Math.min(Math.max(fontScale, 1), 1.6);
  const gutter = Math.round(56 * scale);
  // On a narrow phone or at large text the up-next card takes the page's width under the gutter, so its
  // button keeps two lines at most ("Repeat yesterday's breakfast" at 320 wide, 130 percent).
  const wideCard = width - 2 * layout.gutter - gutter - RAIL - 8 < 215 * scale;
  const s = useMemo(() => makeStyles(sc, gutter, wideCard), [sc, gutter, wideCard]);
  const { messageCoach } = useEntitlement();
  const insets = useScreenInsets();
  const reduced = useReducedMotion();
  const [italic] = useFonts({ CormorantGaramond_400Regular_Italic });
  const [open, setOpen] = useState<string | null>(null);
  const today = getTodayString();
  const isToday = p.selectedDate === today;
  const clock = useClock(isToday && p.nowMin == null);
  const nowMin = isToday ? p.nowMin ?? clock : null;
  const top = insets.top + layout.statusBarGap;

  const plan = useQuery({
    queryKey: ['meal-plan', 'today', p.selectedDate],
    queryFn: () => mealTemplatesApi.todayForClient(p.selectedDate).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: p.coached,
  });
  const coach = useQuery({
    queryKey: ['clients', 'me', 'coach'],
    queryFn: () => api.get<{ name?: string }>('/v1/clients/me/coach').then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: p.coached,
  });
  // C_workout: the day's workout from Train, the same read and cache as the Train tab (GET /assignments/me).
  const workouts = useMyWorkoutAssignments();
  // Every plan for the day, newest first as the server orders them; a plan assigned twice shows once.
  const plans = useMemo(() => [...new Map((plan.data?.assignments ?? [])
    .flatMap((a) => (a?.daily_meal_plan ? [[a.daily_meal_plan.id, a.daily_meal_plan] as const] : []))).values()]
    .filter((x) => x.slots.length > 0), [plan.data]);
  const usualDay = !p.coached || (plan.isSuccess && plans.length === 0);
  // The seven days before the shown day, read like the search sheet's Recent (useFoodBrowse). A day
  // that fails to read is left out; with none read there is no usual day.
  // UI-3b (owner 10-19): a coached client whose plan read comes back with no plan gets the same usual day.
  const past = useQuery({
    queryKey: ['food', 'usual-day', p.selectedDate],
    enabled: usualDay,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PastDay[]> => {
      const dates = Array.from({ length: 7 }, (_, i) => addDays(p.selectedDate, -(i + 1)));
      const read = await Promise.allSettled(dates.map((d) => logApi.getDaily(d)));
      return read.flatMap((r, i) => (r.status === 'fulfilled' ? [{ date: dates[i], entries: r.value.data?.entries ?? [] }] : []));
    },
  });
  // Each food carries the plan or usual meal it was logged for (FOODLINK), so the day is rebuilt from the server's log.
  // A food the server refused ticks off no meal and counts in nothing; it shows with the extras, marked.
  const counted = useMemo(() => p.foodLogs.filter(countsInDay), [p.foodLogs]);
  const refused = useMemo(() => p.foodLogs.filter((l) => !countsInDay(l)), [p.foodLogs]);
  const day = useMemo(() => {
    if (plans.length > 0) return buildPlanDay(plans, counted);
    if (!usualDay) return null;
    const usual = past.data ? buildUsualDay(past.data, counted) : null;
    return usual && usual.slots.length > 0 ? usual : null;
  }, [plans, usualDay, past.data, counted]);
  const workout = useMemo(() => {
    const row = (workouts.data ?? []).find((w) => assignmentDay(w) === p.selectedDate && !(w as { skipped_at?: string | null }).skipped_at);
    const name = row ? (row.snapshot?.plan_name ?? row.workout_plan?.name ?? '').trim() : '';
    return row && name ? { name, time: row.scheduled_time ?? null } : null;
  }, [workouts.data, p.selectedDate]);
  // A refused food sits with the extras at its time, marked (main's OFFLINE-FOOD-M rule).
  const items = useMemo(() => (day ? buildTimeline({ day: refused.length ? { ...day, extras: [...day.extras, ...refused] } : day, nowMin, workout }) : []),
    [day, refused, nowMin, workout]);

  // Section 5: after "Ate it as planned" the now line eases to its new place in 300 ms (Reduce Motion: at once).
  const doneCount = day ? day.slots.filter((x) => x.logs.length > 0).length + day.extras.length : 0;
  const lastDone = useRef(doneCount);
  if (lastDone.current !== doneCount) {
    if (!reduced && lastDone.current < doneCount) LayoutAnimation.configureNext(LayoutAnimation.create(300, 'easeInEaseOut', 'opacity'));
    lastDone.current = doneCount;
  }

  const withTop = (node: React.ReactNode) => <View style={{ paddingTop: top }}>{node}</View>;
  const loading = !!p.dayLoading || (p.ready && ((p.coached && plan.isLoading) || (usualDay && past.isPending)));
  if (loading) return <DaySkeleton s={s} top={top} />;
  // The day itself could not load: LogScreen's classic log says so and offers its retry.
  if (!p.ready) return withTop(p.fallback);
  if (p.coached && plan.isError) {
    // The plan did not load: say so, offer the retry, and keep the classic log open under it.
    return withTop(
      <>
        <QuietError message={loadFailureMessage(plan.error, 'Your meal plan')} onRetry={() => void plan.refetch()}
          retrying={plan.isFetching} layout="inline" testID="food-day-plan-error" />
        {p.fallback}
      </>,
    );
  }
  // C_first: nothing to build a day from yet. Another day with nothing keeps the classic log.
  if (!day && !isToday) return withTop(p.fallback);

  const left = dayLeft(p.targets, p.eaten);
  const leftLine = left && !left.over ? `${n(left.kcal)} kcal and ${n(left.protein)} g protein left.` : null;
  const dayLabel = isToday ? `Today, ${longDay(p.selectedDate)}` : longDay(p.selectedDate);
  const forest = sc.textOnAccent;

  const dateRow = (
    <View style={s.dateRow}>
      <HapticPressable intent="light" disableAnimation onPress={() => p.onDateChange(addDays(p.selectedDate, -1))}
        accessibilityRole="button" accessibilityLabel="Previous day" style={s.chevron}>
        <Ionicons name="chevron-back" size={24} color={forest} />
      </HapticPressable>
      <Pressable onPress={() => { void HapticService.softImpact(); p.onDateChange(today); }} accessibilityRole="button"
        accessibilityLabel={isToday ? 'Viewing today' : `Viewing ${dayLabel}, tap to go to today`} style={s.dateLabel}>
        <Text style={s.dateText}>{dayLabel.toUpperCase()}</Text>
      </Pressable>
      <HapticPressable intent="light" disableAnimation onPress={() => p.onDateChange(addDays(p.selectedDate, 1))}
        accessibilityRole="button" accessibilityLabel="Next day" style={s.chevron}>
        <Ionicons name="chevron-forward" size={24} color={forest} />
      </HapticPressable>
    </View>
  );

  if (!day) {
    // C_first (coachless, or coached with no plan, and no usual meal yet): no coach, no Roman.
    const logsOf = (t: MealType) => counted.filter((l) => l.mealType === t);
    const others = [...counted.filter((l) => !FIRST_MEALS.some((m) => m.type === l.mealType)), ...refused];
    return (
      <View testID="food-day">
        <View style={[s.mast, { paddingTop: top }]} testID="food-day-masthead">
          <ForestBand />
          {dateRow}
          <Text style={s.title} accessibilityRole="header">Log what you eat today</Text>
          <Text style={[s.mastLine, s.mastGap]}>{leftLine ?? 'No target'}</Text>
          <View style={s.rule} />
        </View>
        <View style={s.paper} testID="food-day-page">
          {p.notes}
          <Text style={s.lead}>After a few days, this page builds your usual day from the meals you repeat.</Text>
          <HapticPressable intent="light" onPress={() => p.onSomethingElse('breakfast')} style={s.tool}
            accessibilityRole="button" accessibilityLabel="Enter manually" testID="food-day-first-manual">
            <Ionicons name="create-outline" size={22} color={sc.accentText} />
            <Text style={s.toolText}>Enter manually</Text>
          </HapticPressable>
          <HapticPressable intent="light" disableAnimation onPress={() => p.onSomethingElse(nextFirst(counted))} style={s.search}
            accessibilityRole="search" accessibilityLabel="Search foods..." testID="food-day-first-search">
            <Ionicons name="search-outline" size={22} color={sc.textMuted} />
            <Text style={s.searchText}>Search foods...</Text>
          </HapticPressable>
          <View style={s.timeline}>
            {nowMin != null ? nowRow(s, nowMin, () => p.onSomethingElse(nextFirst(counted))) : null}
            {FIRST_MEALS.map((m) => {
              const mine = logsOf(m.type);
              const waiting = mine.filter((l) => l.offline === 'waiting');
              return (
                <HapticPressable key={m.type} intent="light" disableAnimation testID={`food-day-first-${m.type}`}
                  onPress={() => (mine.length === 1 ? p.onEditFood(mine[0]) : p.onSomethingElse(m.type))}
                  accessibilityRole="button" accessibilityLabel={mine.length ? `${m.label}. ${joinNames(mine.map((l) => l.foodName))}${waiting.length ? `. ${offlineLine(waiting)}` : ''}` : `${m.label}. Nothing yet`}
                  style={s.row}>
                  <Text style={s.time}>{mine.length && logMinutes(mine[0]) != null ? clockOf(logMinutes(mine[0]) as number) : ''}</Text>
                  <View style={s.rail}><View style={s.line} /><Mark done={mine.length > 0 && waiting.length === 0} waiting={waiting.length > 0} reduced={reduced}
                    style={s.mark} fill={s.markFill} testID={waiting.length ? `food-day-waiting-${m.type}` : undefined} /></View>
                  <View style={s.body}>
                    <Text style={s.eyebrow}>{m.label.toUpperCase()}</Text>
                    {mine.length ? <Text style={s.sansName}>{joinNames(mine.map((l) => l.foodName))}</Text>
                      : <Text style={s.nothing}>Nothing yet</Text>}
                    {waiting.length ? <Text style={s.meta}>{offlineLine(waiting)}</Text> : null}
                  </View>
                </HapticPressable>
              );
            })}
            {others.map((l) => extraRow(s, l, reduced, p.onEditFood))}
          </View>
          <View style={s.water}>{p.water}</View>
        </View>
      </View>
    );
  }

  // Up next: the first meal still to eat in clock order (with no times, plan order, as nextSlot).
  const next = items.reduce<DaySlot | null>((f, it) => f ?? (it.kind === 'slot' && it.slot.logs.length === 0 ? it.slot : null), null) ?? nextSlot(day);
  const isPlan = day.kind === 'plan';
  const assigned = plans[0];
  const many = plans.length > 1;
  const yesterday = isToday ? addDays(today, -1) : null;
  const coachFirst = (coach.data?.name ?? '').trim().split(/\s+/)[0];
  const note = assigned?.notes?.trim();
  const workoutLine = workout
    ? `Before ${workout.name}${minutesOf(workout.time) != null ? ` at ${clockOf(minutesOf(workout.time) as number)}` : ''}. Logs under Snacks.`
    : null;
  const quote = (t: string) => `\u201C${t}\u201D`;
  const tag = (x: DaySlot) => (x.plan ? (
    <View style={s.tag} testID={`food-day-tag-${x.key}`}>
      <View style={[s.dot, dotOf(x.planNo)]} />
      <Text style={s.tagText}>{x.plan}</Text>
    </View>
  ) : null);
  const head = (label: string, kcal: number | null) => (
    <Text style={s.eyebrowRow}>
      <Text style={s.eyebrow}>{label.toUpperCase()}</Text>
      {kcal != null ? <Text style={s.kcal}>{` ${n(kcal)} KCAL`}</Text> : null}
    </Text>
  );
  // A one-line list of a plan meal's foods: "Banana 1 medium, Whey protein 30 g".
  const foodsLine = (x: DaySlot) => x.foods.map((f) => (f.portion ? `${f.name} ${f.portion}` : f.name)).join(', ');

  const slotRow = (x: DaySlot, min: number | null) => {
    const isDone = x.logs.length > 0;
    const waiting = x.logs.filter((l) => l.offline === 'waiting');
    const sub = isDone ? (waiting.length > 0 ? offlineLine(waiting) : x.status) : x.usual ? loggedOn(x.usual.days, yesterday)
      : x.label === 'Pre-workout' && workoutLine ? workoutLine : null;
    const name = !isDone && x.usual ? `Your usual: ${x.name}` : x.name;
    const kcal = isDone ? x.logs.reduce((t, l) => t + l.calories, 0) : x.kcal;
    const expanded = open === x.key;
    return (
      <View key={x.key}>
        <HapticPressable intent="light" disableAnimation disabled={!isDone} onPress={() => setOpen(expanded ? null : x.key)}
          accessibilityRole={isDone ? 'button' : 'text'} accessibilityState={isDone ? { expanded } : undefined}
          accessibilityLabel={`${min != null ? `${clockOf(min)}. ` : ''}${x.label}. ${name}.${sub ? ` ${sub}.` : ''} ${n(kcal)} kcal${x.plan ? `. From ${x.plan}.` : ''}`}
          style={s.row} testID={`food-day-slot-${x.key}`}>
          <Text style={s.time}>{min != null ? clockOf(min) : ''}</Text>
          <View style={s.rail}><View style={s.line} /><Mark done={isDone && waiting.length === 0} waiting={waiting.length > 0} reduced={reduced} style={s.mark} fill={s.markFill}
              testID={waiting.length > 0 ? `food-day-waiting-${x.key}` : undefined} /></View>
          <View style={s.body}>
            {head(x.label, kcal)}
            <Text style={s.serifName}>{name}</Text>
            {sub ? <Text style={s.meta}>{sub}</Text> : null}
            {tag(x)}
          </View>
        </HapticPressable>
        {expanded ? x.logs.map((l) => (
          <HapticPressable key={l.id} intent="light" disableAnimation onPress={() => p.onEditFood(l)} style={s.food}
            accessibilityRole="button" accessibilityLabel={`${l.foodName}, ${n(l.calories)} kcal${l.offline ? '. Saved offline' : ''}`}>
            <View style={s.rail}><View style={s.line} /></View>
            <Text style={[s.small, s.grow]} numberOfLines={1}>{l.foodName}</Text>
            <Text style={s.smallMuted}>{n(l.calories)}</Text>
          </HapticPressable>
        )) : null}
      </View>
    );
  };

  const nextRow = (x: DaySlot, min: number | null) => (
    <View key={x.key} style={s.row} testID="food-day-next">
      <Text style={s.time}>{min != null ? clockOf(min) : ''}</Text>
      <View style={s.rail}><View style={s.line} /><View style={s.halo}><View style={s.ring} /></View></View>
      <View style={s.body}>
        {head(x.usual ? `Up next, your usual ${x.mealType}` : `Up next, ${x.label}`, x.kcal)}
        <Text style={s.serifName}>{x.name}</Text>
        {tag(x)}
        <View style={s.card}>
          {x.usual ? <Text style={s.cardText}>{loggedOn(x.usual.days, yesterday)}</Text>
            : x.foods.length > 0 ? <Text style={s.cardText}>{foodsLine(x)}</Text> : null}
          {!x.usual && x.label === 'Pre-workout' && workoutLine ? <Text style={s.cardMeta}>{workoutLine}</Text> : null}
          <PrimaryButton label={x.usual ? `Repeat ${dayWord(x.usual.meal.date, yesterday)}'s ${x.mealType}` : 'Ate it as planned'} loading={p.saving}
            haptic={false} wrap style={s.cardPrimary} testID="food-day-primary" onPress={() => (x.usual ? p.onRepeat(x) : p.onLogPlanned(x))} />
          <Pressable disabled={p.saving} onPress={() => p.onSomethingElse(x.mealType, x.usual ? { fillsUsualMeal: true } : { planSlotId: x.key })}
            accessibilityRole="button" accessibilityLabel="Something else" accessibilityState={{ disabled: p.saving }}
            testID="food-day-something-else" style={s.link}>
            <Text style={s.linkText}>Something else</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );

  const workoutRow = (name: string, min: number | null) => (
    <View key="workout" style={s.row} testID="food-day-workout" accessible
      accessibilityLabel={`${min != null ? `${clockOf(min)}. ` : ''}Workout. ${name}`}>
      <Text style={s.time}>{min != null ? clockOf(min) : ''}</Text>
      <View style={s.rail}><View style={s.line} /><View style={s.workoutMark} /></View>
      <View style={s.body}>
        <Text style={s.eyebrow}>WORKOUT</Text>
        <Text style={s.sansName}>{name}</Text>
      </View>
    </View>
  );

  const row = (it: TimelineItem) => {
    if (it.kind === 'now') return nowRow(s, it.min, () => p.onSomethingElse(next?.mealType ?? 'snack'));
    if (it.kind === 'extra') return extraRow(s, it.log, reduced, p.onEditFood, isPlan);
    if (it.kind === 'workout') return workoutRow(it.name, it.min);
    return it.slot === next ? nextRow(it.slot, it.min) : slotRow(it.slot, it.min);
  };

  return (
    <View testID="food-day">
      <View style={[s.mast, { paddingTop: top }]} testID="food-day-masthead">
        <ForestBand />
        {dateRow}
        {isPlan && assigned && many ? (
          <>
            <Text style={s.title} accessibilityRole="header">
              {coachFirst ? `${coachFirst}'s plans${isToday ? ' for today' : ''}` : joinNames(plans.map((x) => x.name))}
            </Text>
            {/* One line per plan, newest first, each with its own dot; a coach's note sits under its own plan. */}
            {plans.map((x, i) => (
              <View key={x.id} style={s.planRow} testID={`food-day-plan-${x.id}`}>
                <View style={[s.dot, s.planDot, dotOf(i)]} />
                <View style={s.grow}>
                  <Text style={s.mastMuted}>{x.name}</Text>
                  {x.notes?.trim() ? <Text style={[s.note, italic && s.italic]}>{quote(x.notes.trim())}</Text> : null}
                </View>
              </View>
            ))}
          </>
        ) : isPlan && assigned ? (
          <>
            <Text style={s.title} accessibilityRole="header">{coachFirst ? `${coachFirst}'s plan${isToday ? ' for today' : ''}` : assigned.name}</Text>
            {left?.over && isToday ? <Text style={[s.note, italic && s.italic]}>{`Tomorrow starts fresh at ${n(left.target)} kcal.`}</Text>
              : note ? <Text style={[s.note, italic && s.italic]}>{quote(note)}</Text> : null}
          </>
        ) : (
          <Text style={s.title} accessibilityRole="header">Your usual day</Text>
        )}
        <View style={[s.progress, (left?.over || !isPlan) && s.progressStack]}>
          <View style={s.segs} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {/* Done meals fill from the left, as C_day draws them. */}
            {[...day.slots].sort((a, b) => Number(b.logs.length > 0) - Number(a.logs.length > 0))
              .map((x) => <View key={x.key} style={[s.seg, (x.logs.length > 0 || left?.over) && s.segDone]} />)}
          </View>
          {isPlan ? (
            <Text style={s.mastLine}>
              {left?.over ? `${n(left.kcal)} kcal above today's target. Protein ${n(left.eatenProtein)} of ${n(left.targetProtein)} g.` : leftLine ?? ''}
            </Text>
          ) : (
            <Text style={s.mastLine}>{`Built from the meals you logged this week.${p.targets?.calories ? ` ${n(p.targets.calories)} kcal target.` : ''}`}</Text>
          )}
        </View>
        <View style={s.rule} />
      </View>

      <View style={s.paper} testID="food-day-page">
        {p.notes}
        <View style={s.timeline}>{items.map(row)}</View>
        {/* With no now line (another day) the extras still get their Add, under the day. */}
        {nowMin == null ? (
          <Pressable onPress={() => p.onSomethingElse(next?.mealType ?? 'snack')} accessibilityRole="button" accessibilityLabel="Add"
            testID="food-day-add" style={[s.link, s.addEnd]}>
            <Text style={s.linkText}>Add</Text>
          </Pressable>
        ) : null}
        <View style={s.water}>{p.water}</View>
        {isPlan || p.coached ? null : (
          <View style={s.quiet} testID="food-day-join">
            <Text style={s.eyebrow}>MEAL PLANS COME FROM A COACH</Text>
            <Text style={s.small}>A coach can build your day here, meal by meal. Your own logging stays open.</Text>
            <HapticPressable intent="light" onPress={messageCoach} style={s.outline} accessibilityRole="button"
              accessibilityLabel="Join a coach" testID="food-day-join-coach">
              {/* The app's "Join a coach" (JoinCoachState, JoinCoachBanner): the coach-code path. */}
              <Text style={s.outlineText}>Join a coach</Text>
            </HapticPressable>
          </View>
        )}
      </View>
    </View>
  );
}

/** C_first: the meal a search or a now-line Add goes to, the first of the three with nothing logged. */
const nextFirst = (logs: FoodLog[]): MealType => FIRST_MEALS.find((m) => !logs.some((l) => l.mealType === m.type))?.type ?? 'snack';

type Styles = ReturnType<typeof makeStyles>;

/** The now line: the clock in the gutter, a gold rule, and Add (an extra: it never ticks a plan meal). */
function nowRow(s: Styles, min: number, onAdd: () => void) {
  return (
    <View key="now" style={s.nowRow} testID="food-day-now">
      <Text style={[s.time, s.nowTime]}>{clockOf(min)}</Text>
      <View style={[s.rail, s.nowRail]}><View style={s.line} /><View style={s.nowDot} /></View>
      <View style={s.nowRule} />
      <Pressable onPress={onAdd} accessibilityRole="button" accessibilityLabel={`Add food at ${clockOf(min)}`} testID="food-day-add" style={s.nowAdd}>
        <Text style={s.linkText}>Add</Text>
      </Pressable>
    </View>
  );
}

function extraRow(s: Styles, l: FoodLog, reduced: boolean, onEdit: (l: FoodLog) => void, plan = true) {
  const min = logMinutes(l);
  // Main's OFFLINE-FOOD-M marks: a waiting food carries the offline line in place of its meal; a refused one
  // says so and shows no number (it counts in nothing).
  const mark = l.offline === 'refused' ? REFUSED : l.offline === 'waiting' ? offlineLine([l]) : null;
  return (
    <HapticPressable key={l.id} intent="light" disableAnimation onPress={() => onEdit(l)} style={s.row}
      testID={mark ? `food-day-offline-${l.id}` : `food-day-extra-${l.id}`} accessibilityRole="button"
      accessibilityLabel={l.offline === 'refused' ? `${l.foodName}. ${REFUSED}`
        : `${l.foodName}, logged to ${l.mealType}, ${n(l.calories)} kcal${mark ? '. Saved offline' : ''}`}>
      <Text style={s.time}>{min != null ? clockOf(min) : ''}</Text>
      <View style={s.rail}><View style={s.line} /><Mark done={false} waiting={!!mark} reduced={reduced} style={s.mark} fill={s.markFill} /></View>
      <View style={s.body}>
        <Text style={s.eyebrowRow}>
          <Text style={s.eyebrow}>{plan ? 'EXTRAS, NOT IN THE PLAN' : 'EXTRAS'}</Text>
          {l.offline === 'refused' ? null : <Text style={s.kcal}>{` ${n(l.calories)} KCAL`}</Text>}
        </Text>
        <Text style={s.sansName}>{l.foodName}</Text>
        <Text style={s.meta}>{mark ?? `Logged to ${l.mealType}`}</Text>
      </View>
    </HapticPressable>
  );
}

/** C_loading: the masthead and four timeline rows as still blocks (no shimmer), read once. */
function DaySkeleton({ s, top }: { s: Styles; top: number }) {
  return (
    <View testID="food-day-loading" accessible accessibilityRole="progressbar" accessibilityLabel="Loading today's meals">
      <View style={[s.mast, { paddingTop: top }]}>
        <ForestBand />
        <View style={[s.bone, s.boneTitle]} />
        <View style={[s.bone, s.boneLine]} />
        <View style={s.rule} />
      </View>
      <View style={s.paper}>
        <View style={s.timeline}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={s.row}>
              <Text style={s.time} />
              <View style={s.rail}><View style={s.line} /><View style={s.mark} /></View>
              <View style={s.body}>
                <View style={[s.paperBone, s.paperBoneShort]} />
                <View style={[s.paperBone, s.paperBoneLong]} />
              </View>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const MARK = 14;
const RAIL = 26;
const MARK_WAITING = { borderStyle: 'dashed' as const, borderColor: palette.charcoal };
const makeStyles = (sc: SemanticTokens, gutter: number, wideCard = false) => StyleSheet.create({
  grow: { flex: 1, minWidth: 0 },
  // Masthead (section 3: deep forest, Cormorant-led, gold rule); it runs edge to edge under the page gutters.
  mast: { marginHorizontal: -layout.gutter, paddingHorizontal: layout.gutter, paddingBottom: 18 + 4, backgroundColor: palette.forest },
  dateRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: -10, minHeight: layout.touchMin },
  chevron: { width: layout.touchMin, height: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  dateLabel: { flex: 1, minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  dateText: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontWeight: '600', lineHeight: 13, letterSpacing: 1.98, color: sc.textOnMastheadMuted, textAlign: 'center' },
  title: { ...typography.h1, fontFamily: 'CormorantGaramond_500Medium', fontWeight: '500', letterSpacing: -0.2, color: sc.textOnAccent, marginTop: 6 },
  note: { ...typography.h3, fontFamily: typography.h2.fontFamily, fontWeight: '400', fontSize: 19, lineHeight: 25, letterSpacing: 0, fontStyle: 'italic', color: sc.textOnMastheadMuted, marginTop: 6 },
  italic: { fontFamily: 'CormorantGaramond_400Regular_Italic', fontStyle: 'normal' },
  mastMuted: { ...typography.bodySmall, color: sc.textOnMastheadMuted },
  mastLine: { ...typography.bodyMd, fontSize: 15, lineHeight: 21, letterSpacing: 0, color: sc.textOnAccent, flexShrink: 1, minWidth: 0 },
  mastGap: { marginTop: 10 },
  progress: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginTop: 10 },
  progressStack: { flexDirection: 'column', alignItems: 'flex-start', gap: 10 },
  segs: { flexDirection: 'row', gap: 4, flexShrink: 0 },
  seg: { width: 18, height: 4, borderRadius: radius.chip, backgroundColor: sc.data.plannedOnDark },
  segDone: { backgroundColor: gold[300] },
  rule: { height: 1, backgroundColor: gold[300], opacity: 0.8, marginTop: 12 },
  planRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 10 },
  planDot: { marginTop: 7 },
  dot: { width: 8, height: 8, borderRadius: radius.chip },
  tag: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', gap: 8, marginTop: 6,
    paddingLeft: 8, paddingRight: 10, paddingVertical: 1, borderRadius: radius.chip, backgroundColor: palette.cream },
  tagText: { ...typography.caption, letterSpacing: 0, color: sc.textPrimary, flexShrink: 1 },
  // The paper page (radius 24) over the masthead's foot.
  paper: { marginHorizontal: -layout.gutter, marginTop: -18, paddingHorizontal: layout.gutter, paddingTop: 16, paddingBottom: 8,
    backgroundColor: sc.bgPrimary, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, minHeight: 360 },
  lead: { ...typography.bodySmall, fontSize: 15, color: sc.textMuted, marginBottom: 16 },
  timeline: { marginTop: 0 },
  row: { flexDirection: 'row', alignItems: 'stretch', paddingTop: 6, paddingBottom: 12, minHeight: 56 },
  time: { ...typography.bodyMd, fontSize: 12, lineHeight: 16, letterSpacing: 0, width: gutter, textAlign: 'right', color: sc.textMuted, paddingTop: 4 },
  rail: { width: RAIL, marginLeft: 8, alignItems: 'flex-start' },
  line: { position: 'absolute', left: 0, top: -6, bottom: -12, borderLeftWidth: 1.5, borderStyle: 'dotted', borderColor: palette.stone },
  mark: { width: MARK, height: MARK, borderRadius: MARK / 2, marginTop: 4, marginLeft: 1, borderWidth: 1.5, borderColor: sc.textMuted,
    backgroundColor: sc.bgPrimary, overflow: 'hidden' },
  markFill: { position: 'absolute', left: -2, top: -2, right: -2, bottom: -2, borderRadius: MARK, backgroundColor: palette.forest },
  halo: { width: MARK + 8, height: MARK + 8, borderRadius: (MARK + 8) / 2, marginTop: 0, marginLeft: -3, alignItems: 'center',
    justifyContent: 'center', backgroundColor: sc.surface.sage },
  ring: { width: MARK, height: MARK, borderRadius: MARK / 2, borderWidth: 2, borderColor: palette.forest, backgroundColor: sc.bgPrimary },
  workoutMark: { width: MARK, height: MARK, borderRadius: 3, marginTop: 4, marginLeft: 1, backgroundColor: gold[300] },
  body: { flex: 1, minWidth: 0 },
  eyebrowRow: { flexShrink: 1 },
  eyebrow: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontWeight: '600', lineHeight: 14, letterSpacing: 1.3, color: sc.textMuted },
  kcal: { ...typography.bodyMd, fontSize: 13, lineHeight: 18, letterSpacing: 0, color: palette.charcoal, fontVariant: ['tabular-nums'] },
  serifName: { ...typography.h3, fontSize: 21, lineHeight: 27, letterSpacing: 0, color: sc.textPrimary, marginTop: 1 },
  sansName: { ...typography.bodyMd, fontSize: 17, lineHeight: 22, letterSpacing: 0, color: sc.textPrimary, marginTop: 1 },
  nothing: { ...typography.body, fontSize: 17, lineHeight: 22, letterSpacing: 0, color: sc.textMuted, marginTop: 1 },
  meta: { ...typography.bodySmall, fontSize: 13, lineHeight: 18, color: sc.textMuted, marginTop: 2 },
  food: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: layout.touchMin, paddingLeft: gutter, marginTop: -6, marginBottom: 6 },
  small: { ...typography.bodySmall, color: sc.textPrimary },
  smallMuted: { ...typography.bodySmall, color: sc.textMuted, fontVariant: ['tabular-nums'] },
  card: { marginTop: 6, paddingTop: 12, paddingHorizontal: 14, paddingBottom: 6, borderRadius: 16, backgroundColor: palette.cream, gap: 4,
    marginLeft: wideCard ? -(gutter + RAIL + 8) : 0 },
  cardText: { ...typography.bodySmall, lineHeight: 22, color: palette.charcoal },
  cardMeta: { ...typography.bodySmall, fontSize: 13, lineHeight: 18, color: sc.textMuted },
  cardPrimary: { marginTop: 6, paddingHorizontal: 12 },
  link: { minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', paddingHorizontal: 8 },
  linkText: { ...typography.bodyMd, color: sc.accentText, textDecorationLine: 'underline' },
  addEnd: { alignSelf: 'flex-end' },
  nowRow: { flexDirection: 'row', alignItems: 'center', minHeight: layout.touchMin, marginTop: -4, marginBottom: 6 },
  nowTime: { ...typography.bodyMd, fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 12, lineHeight: 16, letterSpacing: 0, color: sc.accentText, paddingTop: 0 },
  nowRail: { alignSelf: 'stretch' },
  nowDot: { position: 'absolute', left: -2, top: '50%', marginTop: -3.25, width: 8, height: 8, borderRadius: 4, backgroundColor: gold[300] },
  nowRule: { flex: 1, height: 1.5, marginLeft: -RAIL, backgroundColor: gold[300] },
  nowAdd: { minHeight: layout.touchMin, minWidth: layout.touchMin, alignItems: 'flex-end', justifyContent: 'center', paddingLeft: 12 },
  // C_first's one tool and the search field (Photo of a meal and Scan a barcode are v1.1, owner #192-E2).
  tool: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 16, borderRadius: radius.card,
    borderWidth: 1, borderColor: palette.forest },
  toolText: { ...typography.bodyMd, fontSize: 17, color: sc.accentText },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, marginTop: 12, marginBottom: 20,
    borderBottomWidth: 1.5, borderColor: sc.textPrimary },
  searchText: { ...typography.body, fontSize: 17, color: sc.textMuted },
  water: { marginTop: 8 },
  quiet: { marginTop: 20, gap: 6 },
  outline: { minHeight: layout.touchMin + 4, marginTop: 6, borderRadius: radius.button, borderWidth: 1, borderColor: palette.forest,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  outlineText: { ...typography.bodyMd, color: sc.accentText },
  // C_loading blocks: still, no shimmer (section 5).
  bone: { borderRadius: radius.button, backgroundColor: sc.data.frameOnDark, opacity: 0.55 },
  boneTitle: { height: 30, width: '70%', marginTop: 56 },
  boneLine: { height: 16, width: '85%', marginTop: 14 },
  paperBone: { height: 12, borderRadius: radius.button, backgroundColor: sc.data.trackLight },
  paperBoneShort: { width: '55%' },
  paperBoneLong: { width: '90%', height: 22, marginTop: 10 },
});
