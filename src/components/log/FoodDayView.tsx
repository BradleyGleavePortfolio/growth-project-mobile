/**
 * FoodDayView: the Food tab as the day's meal checklist (V1_1_UI_SPEC UI-3, owner 2026-10-09: coached
 * plan checklist "render 2", coachless "concept 2"). Behind featureFlags.foodPlanChecklist. A coached
 * client with a plan for the day ticks off the coach's meals in order; a client with no coach gets "Your
 * usual day" from the meals they repeat. Every tap reuses a Food log path owned by LogScreen (plan meal
 * log, repeat a past meal, the search sheet, the edit sheet), so basic self logging stays open in every
 * state. With nothing to build the day from, or the flag off, FoodDayGate renders the classic Food log.
 * UI-3c (owner 10-19, board W-UI3C): every plan the server gives for the day shows in the one checklist;
 * with two or more, the card lists each plan with its own dot and note, and each meal carries its plan's tag.
 */
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation, type NavigationProp, type ParamListBase } from '@react-navigation/native';
import api, { logApi } from '../../services/api';
import { mealTemplatesApi, type DailyMealPlan } from '../../api/mealTemplatesApi';
import HapticPressable from '../HapticPressable';
import { useEntitlement } from '../../entitlements/EntitlementProvider';
import { HapticService } from '../../ui/haptics/haptics.service';
import { PrimaryButton, TextLink } from '../../ui';
import { QuietError, loadFailureMessage } from '../../ui/states/QuietStates';
import { useTheme } from '../../theme/ThemeProvider';
import { colors as palette, gold, layout, radius, typography, type SemanticTokens } from '../../theme/tokens';
import type { FoodLog, MealType } from '../../types';
import { addDays, getTodayString } from '../../utils/date';
import { buildPlanDay, buildUsualDay, dayWord, joinNames, loggedOn, nextSlot, weekday, type DaySlot, type PastDay } from '../../utils/log/foodDay';
import type { PlanLink } from '../../utils/log/planLink';

const n = (v: number) => Math.round(v).toLocaleString('en-US');
const sumOf = (plan: DailyMealPlan, key: 'calories_kcal' | 'protein_g') =>
  plan.slots.reduce((t, x) => t + (Number(x.meal_template[key]) || 0), 0);
// UI-3c board: each plan's own dot, newest plan first (gold, then forest; a third plan takes the dark gold).
const DOTS = [gold[300], palette.forest, gold[700]].map((backgroundColor) => ({ backgroundColor }));
const dotOf = (i = 0) => DOTS[i % DOTS.length];
const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const longDay = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');

export interface FoodDayViewProps {
  coached: boolean;
  selectedDate: string;
  foodLogs: FoodLog[];
  eaten: { calories: number; protein: number };
  targets: { calories: number; protein: number } | null;
  ready: boolean;
  saving: boolean;
  fallback: React.ReactNode;
  notes: React.ReactNode;
  water: React.ReactNode;
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

export default function FoodDayView(p: FoodDayViewProps) {
  const { semanticColors: sc } = useTheme();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { messageCoach } = useEntitlement();
  const [open, setOpen] = useState<string | null>(null);
  const today = getTodayString();
  const isToday = p.selectedDate === today;

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
  // The seven days before the shown day, read like the search sheet's Recent (useFoodBrowse). A day
  // that fails to read is left out; with none read there is no usual day and the classic log shows.
  const past = useQuery({
    queryKey: ['food', 'usual-day', p.selectedDate],
    enabled: !p.coached,
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<PastDay[]> => {
      const dates = Array.from({ length: 7 }, (_, i) => addDays(p.selectedDate, -(i + 1)));
      const read = await Promise.allSettled(dates.map((d) => logApi.getDaily(d)));
      return read.flatMap((r, i) => (r.status === 'fulfilled' ? [{ date: dates[i], entries: r.value.data?.entries ?? [] }] : []));
    },
  });
  // Every plan for the day, newest first as the server orders them; a plan assigned twice shows once.
  const plans = useMemo(() => [...new Map((plan.data?.assignments ?? [])
    .flatMap((a) => (a?.daily_meal_plan ? [[a.daily_meal_plan.id, a.daily_meal_plan] as const] : []))).values()]
    .filter((x) => x.slots.length > 0), [plan.data]);
  const assigned = plans[0];
  const many = plans.length > 1;
  // Each food carries the plan or usual meal it was logged for (FOODLINK), so the day is rebuilt from the server's log.
  const day = useMemo(() => {
    if (p.coached) return plans.length > 0 ? buildPlanDay(plans, p.foodLogs) : null;
    const usual = past.data ? buildUsualDay(past.data, p.foodLogs) : null;
    return usual && usual.slots.length > 0 ? usual : null;
  }, [p.coached, plans, past.data, p.foodLogs]);

  // Until the day and the plan (or the past week) are read, the classic log stays open for logging.
  if (!p.ready || (p.coached ? plan.isLoading : past.isLoading)) return <>{p.fallback}</>;
  if (p.coached && plan.isError) {
    // The plan did not load: say so, offer the retry, and keep the classic log open under it.
    return (
      <>
        <QuietError message={loadFailureMessage(plan.error, 'Your meal plan')} onRetry={() => void plan.refetch()}
          retrying={plan.isFetching} layout="inline" testID="food-day-plan-error" />
        {p.fallback}
      </>
    );
  }
  if (!day) return <>{p.fallback}</>;

  const next = nextSlot(day);
  const done = day.slots.filter((x) => x.logs.length > 0).length;
  const isPlan = day.kind === 'plan';
  // The plan's own total, or the client's target on a usual day (none without a target).
  const total = isPlan ? day.slots.reduce((t, x) => t + x.kcal, 0) : p.targets?.calories ?? null;
  const yesterday = isToday ? addDays(today, -1) : null;
  const coachFirst = (coach.data?.name ?? '').trim().split(/\s+/)[0];
  const initials = (coach.data?.name ?? '').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const restKcal = p.eaten.calories + day.slots.filter((x) => x.logs.length === 0).reduce((t, x) => t + x.kcal, 0);
  const restProtein = p.eaten.protein + day.slots.filter((x) => x.logs.length === 0).reduce((t, x) => t + x.protein, 0);
  const onTarget = !!p.targets && Math.abs(restKcal - p.targets.calories) <= p.targets.calories * 0.05
    && Math.abs(restProtein - p.targets.protein) <= p.targets.protein * 0.05;
  const dayLabel = isToday ? `Today, ${longDay(p.selectedDate)}` : longDay(p.selectedDate);
  // With two or more plans, each meal and the up next card carry a small tag: the plan's dot and name.
  const tag = (x: DaySlot) => (x.plan ? (
    <View style={s.tag} testID={`food-day-tag-${x.key}`}>
      <View style={[s.dot, dotOf(x.planNo)]} />
      <Text style={s.tagText}>{x.plan}</Text>
    </View>
  ) : null);

  const slotRow = (x: DaySlot) => {
    const isDone = x.logs.length > 0;
    const first = [...x.logs].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
    const label = isDone && first?.createdAt ? `${x.label}, ${clock(first.createdAt)}` : x.label;
    const sub = isDone ? x.status : x.usual
      ? `${x.usual.meal.entries.length > 1 ? `${x.usual.meal.entries.length} foods, ` : ''}${n(x.protein)} g protein, last on ${weekday(x.usual.days[0])}`
      : `${n(x.protein)} g protein`;
    const name = !isDone && x.usual ? `Your usual: ${x.name}` : x.name;
    const kcal = n(isDone ? x.logs.reduce((t, l) => t + l.calories, 0) : x.kcal);
    const expanded = open === x.key;
    return (
      <View key={x.key}>
        <HapticPressable intent="light" disableAnimation disabled={!isDone} onPress={() => setOpen(expanded ? null : x.key)}
          accessibilityRole={isDone ? 'button' : undefined} accessibilityState={isDone ? { expanded } : undefined}
          accessibilityLabel={`${label}. ${name}. ${sub}. ${kcal} kcal${x.plan ? `. From ${x.plan}.` : ''}`}
          style={s.slot} testID={`food-day-slot-${x.key}`}>
          <View style={[s.ring, isDone ? s.ringDone : s.ringSoft]}>
            {isDone ? <Ionicons name="checkmark" size={14} color={sc.textOnAccent} /> : null}
          </View>
          <View style={s.grow}>
            <Text style={s.eyebrow}>{label.toUpperCase()}</Text>
            <Text style={s.slotName}>{name}</Text>
            {sub ? <Text style={s.meta}>{sub}</Text> : null}
            {tag(x)}
          </View>
          <Text style={s.kcal}>{kcal}</Text>
        </HapticPressable>
        {expanded ? x.logs.map((l) => (
          <HapticPressable key={l.id} intent="light" disableAnimation onPress={() => p.onEditFood(l)} style={s.food}
            accessibilityRole="button" accessibilityLabel={`${l.foodName}, ${n(l.calories)} kcal`}>
            <Text style={[s.small, s.grow]} numberOfLines={1}>{l.foodName}</Text>
            <Text style={s.smallMuted}>{n(l.calories)}</Text>
          </HapticPressable>
        )) : null}
      </View>
    );
  };

  const nextCard = (x: DaySlot) => (
    <View key={x.key} style={s.now} testID="food-day-next">
      <View style={s.between}>
        <Text style={[s.eyebrow, s.forest, s.shrink]}>{(x.usual ? `Up next, your usual ${x.mealType}` : `Up next, ${x.label}`).toUpperCase()}</Text>
        <Text style={[s.smallMuted, s.fixed]}>{n(x.kcal)} kcal</Text>
      </View>
      <Text style={s.nowName}>{x.name}</Text>
      <Text style={s.smallMuted}>{x.usual ? loggedOn(x.usual.days, yesterday) : `${n(x.protein)} g protein, ${n(x.carbs)} g carbs, ${n(x.fat)} g fat`}</Text>
      {tag(x)}
      {x.foods.length > 0 ? (
        <View style={s.items}>
          {x.foods.map((f, i) => (
            <View key={`${f.name}-${i}`} style={s.between}>
              <Text style={[s.small, s.grow]}>{f.name}</Text>
              {f.portion ? <Text style={s.smallMuted}>{f.portion}</Text> : null}
            </View>
          ))}
        </View>
      ) : null}
      <PrimaryButton label={x.usual ? `Repeat ${dayWord(x.usual.meal.date, yesterday)}'s ${x.mealType}` : 'Ate it as planned'} loading={p.saving}
        haptic={false} wrap style={s.nowPrimary} testID="food-day-primary" onPress={() => (x.usual ? p.onRepeat(x) : p.onLogPlanned(x))} />
      <HapticPressable intent="light" disabled={p.saving} style={s.outline}
        onPress={() => p.onSomethingElse(x.mealType, x.usual ? { fillsUsualMeal: true } : { planSlotId: x.key })}
        accessibilityRole="button" accessibilityLabel="Something else" testID="food-day-something-else">
        <Text style={s.outlineText}>Something else</Text>
      </HapticPressable>
    </View>
  );

  return (
    <View style={s.page} testID="food-day">
      <View style={s.between}>
        <View style={s.dayRow}>
          <HapticPressable intent="light" disableAnimation onPress={() => p.onDateChange(addDays(p.selectedDate, -1))} hitSlop={12}
            accessibilityRole="button" accessibilityLabel="Previous day" style={s.fixed}>
            <Ionicons name="chevron-back" size={20} color={sc.textMuted} />
          </HapticPressable>
          <Pressable onPress={() => { void HapticService.softImpact(); p.onDateChange(today); }} accessibilityRole="button"
            accessibilityLabel={isToday ? 'Viewing today' : `Viewing ${dayLabel}, tap to go to today`} hitSlop={{ top: 16, bottom: 16 }} style={s.shrink}>
            <Text style={[s.eyebrow, s.ink]}>{dayLabel.toUpperCase()}</Text>
          </Pressable>
          <HapticPressable intent="light" disableAnimation onPress={() => p.onDateChange(addDays(p.selectedDate, 1))} hitSlop={12}
            accessibilityRole="button" accessibilityLabel="Next day" style={s.fixed}>
            <Ionicons name="chevron-forward" size={20} color={sc.textMuted} />
          </HapticPressable>
        </View>
        <Pressable onPress={() => navigation.navigate('Home', { screen: 'NotificationCenter', initial: false })}
          hitSlop={10} accessibilityRole="button" accessibilityLabel="Notifications" testID="food-day-bell" style={s.bell}>
          <Ionicons name="notifications-outline" size={24} color={sc.textPrimary} />
        </Pressable>
      </View>
      {isToday ? <Text style={s.title} accessibilityRole="header">Today's meals</Text> : null}

      <View style={s.card} testID="food-day-head">
        {isPlan && assigned && many ? (
          <>
            <View style={s.headRow}>
              {initials ? <View style={s.avatar}><Text style={s.avatarText}>{initials}</Text></View> : null}
              <Text style={[s.smallMd, s.grow]}>{coachFirst ? `${coachFirst}'s plans${isToday ? ' for today' : ''}` : joinNames(plans.map((x) => x.name))}</Text>
            </View>
            {/* One line per plan, newest first, each with its own dot; a coach's note sits under its own plan. */}
            {plans.map((x, i) => (
              <View key={x.id} style={s.planRow} testID={`food-day-plan-${x.id}`}>
                <View style={[s.dot, s.planDot, dotOf(i)]} />
                <View style={s.grow}>
                  <Text style={s.smallMuted}>{`${x.name}, ${n(sumOf(x, 'calories_kcal'))} kcal, ${n(sumOf(x, 'protein_g'))} g protein`}</Text>
                  {x.notes?.trim() ? <Text style={[s.small, s.planNote]}>{`\u201C${x.notes.trim()}\u201D`}</Text> : null}
                </View>
              </View>
            ))}
          </>
        ) : isPlan && assigned ? (
          <>
            <View style={s.headRow}>
              {initials ? <View style={s.avatar}><Text style={s.avatarText}>{initials}</Text></View> : null}
              <View style={s.grow}>
                <Text style={s.smallMd}>{coachFirst ? `${coachFirst}'s plan${isToday ? ' for today' : ''}` : assigned.name}</Text>
                <Text style={s.smallMuted}>{`${assigned.name}, ${n(total ?? 0)} kcal, ${n(day.slots.reduce((t, x) => t + x.protein, 0))} g protein`}</Text>
              </View>
            </View>
            {assigned.notes?.trim() ? <Text style={[s.small, s.quote]}>{`\u201C${assigned.notes.trim()}\u201D`}</Text> : null}
          </>
        ) : (
          <>
            <Text style={s.smallMd}>Your usual day</Text>
            <Text style={s.smallMuted}>{`Built from the meals you logged this week.${total ? ` ${n(total)} kcal target.` : ''}`}</Text>
          </>
        )}
        <View style={s.segs} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {day.slots.map((x) => (
            <View key={x.key} style={[s.seg, x.logs.length > 0 && s.segDone, x === next && s.segNext]}>
              {x === next ? Array.from({ length: 12 }, (_, i) => <View key={i} style={s.tick} />) : null}
            </View>
          ))}
        </View>
        <View style={s.stats}>
          <Text style={s.smallMuted}>{`${done} of ${day.slots.length} meals ${isPlan ? 'done' : 'logged'}`}</Text>
          {total ? <Text style={s.smallMuted}>{`${n(p.eaten.calories)} of ${n(total)} kcal`}</Text> : null}
        </View>
      </View>
      {p.notes}

      <View style={s.list}>{day.slots.map((x) => (x === next ? nextCard(x) : slotRow(x)))}</View>

      {/* An extra goes to the meal up next and never ticks a meal off: only "Something else" does that. */}
      <View style={s.sect}>
        <Text style={s.eyebrow}>{isPlan ? 'EXTRAS, NOT IN THE PLAN' : 'EXTRAS'}</Text>
        <TextLink label="Add" tone="accent" underline={false} testID="food-day-add"
          onPress={() => p.onSomethingElse(next?.mealType ?? 'snack')} />
      </View>
      {/* The water card's top hairline closes this list, so the last extra draws none of its own. */}
      {day.extras.map((l, i) => (
        <HapticPressable key={l.id} intent="light" disableAnimation onPress={() => p.onEditFood(l)}
          style={[s.extra, i < day.extras.length - 1 && s.extraLine]}
          accessibilityRole="button" accessibilityLabel={`${l.foodName}, logged to ${l.mealType}, ${n(l.calories)} kcal`}>
          <Text style={s.time}>{l.createdAt ? clock(l.createdAt) : ''}</Text>
          <View style={s.grow}>
            <Text style={s.smallMd} numberOfLines={1}>{l.foodName}</Text>
            <Text style={s.meta}>{`Logged to ${l.mealType}`}</Text>
          </View>
          <Text style={s.smallMd}>{n(l.calories)}</Text>
        </HapticPressable>
      ))}
      <View style={s.water}>{p.water}</View>

      {isPlan && next && isToday ? (
        <View style={s.quiet} testID="food-day-projection">
          <Text style={s.eyebrow}>IF YOU EAT THE REST AS PLANNED</Text>
          <Text style={s.body}>{`${n(restKcal)} kcal and ${n(restProtein)} g protein.${onTarget ? ' Both on target.' : ''}`}</Text>
        </View>
      ) : null}
      {isPlan ? null : (
        <View style={s.quiet} testID="food-day-join">
          <Text style={s.eyebrow}>MEAL PLANS COME FROM A COACH</Text>
          <Text style={s.body}>A coach can build your day here, meal by meal. Your own logging stays open.</Text>
          <HapticPressable intent="light" onPress={messageCoach} style={[s.outline, s.join]} accessibilityRole="button"
            accessibilityLabel="Join a coach" testID="food-day-join-coach">
            {/* The app's "Join a coach" (JoinCoachState, JoinCoachBanner): the coach-code path. */}
            <Text style={s.outlineText}>Join a coach</Text>
          </HapticPressable>
        </View>
      )}
    </View>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  page: { paddingTop: 6 },
  grow: { flex: 1, minWidth: 0 },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  dayRow: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: layout.touchMin, flexShrink: 1, minWidth: 0 },
  shrink: { flexShrink: 1, minWidth: 0 },
  fixed: { flexShrink: 0 },
  stats: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12 },
  water: { marginTop: 12 },
  bell: { flexShrink: 0, minWidth: layout.touchMin, minHeight: layout.touchMin, alignItems: 'flex-end', justifyContent: 'center' },
  eyebrow: { ...typography.eyebrow, color: sc.textMuted },
  ink: { color: sc.textPrimary },
  forest: { color: sc.accentText },
  title: { ...typography.h2, color: sc.textPrimary, marginTop: 10 },
  card: { marginTop: 14, padding: 16, gap: 2, borderRadius: radius.card, backgroundColor: sc.bgSurface, borderWidth: StyleSheet.hairlineWidth, borderColor: sc.border },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 36, height: 36, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.cream, borderWidth: 1, borderColor: palette.camel },
  avatarText: { ...typography.h4, fontFamily: typography.h2.fontFamily, color: sc.textPrimary },
  quote: { marginTop: 12 },
  planRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 10 },
  planDot: { marginTop: 7 },
  planNote: { marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: radius.chip },
  tag: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', gap: 8, marginTop: 8,
    paddingLeft: 8, paddingRight: 10, paddingVertical: 1, borderRadius: radius.chip, backgroundColor: palette.cream },
  tagText: { ...typography.caption, letterSpacing: 0, color: sc.textPrimary, flexShrink: 1 },
  segs: { flexDirection: 'row', gap: 4, marginTop: 12, marginBottom: 8 },
  seg: { flex: 1, height: 6, borderRadius: radius.chip, backgroundColor: sc.border, overflow: 'hidden', flexDirection: 'row', gap: 3 },
  segDone: { backgroundColor: sc.accent },
  segNext: { backgroundColor: 'transparent', borderWidth: 1, borderColor: sc.accent },
  tick: { width: 4, backgroundColor: sc.accent },
  small: { ...typography.bodySmall, color: sc.textPrimary },
  smallMd: { ...typography.bodySmall, fontFamily: typography.bodyMd.fontFamily, color: sc.textPrimary, fontVariant: ['tabular-nums'] },
  smallMuted: { ...typography.bodySmall, color: sc.textMuted, fontVariant: ['tabular-nums'] },
  meta: { ...typography.bodySmall, color: sc.textMuted, marginTop: 2 },
  body: { ...typography.body, color: sc.textPrimary, marginTop: 6 },
  list: { marginTop: 6 },
  slot: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.border },
  ring: { width: 24, height: 24, borderRadius: radius.chip, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  ringDone: { backgroundColor: sc.accent },
  ringSoft: { borderWidth: 1.5, borderColor: palette.stone },
  slotName: { ...typography.bodyMd, color: sc.textPrimary, marginTop: 4 },
  kcal: { ...typography.bodySmall, fontFamily: typography.bodyMd.fontFamily, color: sc.textMuted, marginTop: 13, fontVariant: ['tabular-nums'] },
  food: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: layout.touchMin, paddingLeft: 38, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.border },
  now: { marginTop: 12, marginBottom: 4, padding: 16, borderRadius: radius.card, backgroundColor: sc.bgSurface, borderWidth: 1.5, borderColor: sc.accent },
  nowName: { ...typography.h3, color: sc.textPrimary, marginTop: 8 },
  items: { marginTop: 10 },
  // Narrow side padding so "Repeat yesterday's snack" stays on its one line at large text on 360 pt.
  nowPrimary: { marginTop: 14, paddingHorizontal: 8 },
  outline: { minHeight: 48, marginTop: 8, borderRadius: radius.button, borderWidth: 1, borderColor: sc.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  outlineText: { ...typography.bodyMd, color: sc.accentText },
  join: { marginTop: 14 },
  sect: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 4 },
  extra: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 8 },
  extraLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.border },
  time: { ...typography.caption, letterSpacing: 0, width: 62, color: sc.textMuted },
  quiet: { marginTop: 20, padding: 16, borderRadius: radius.card, backgroundColor: sc.bgSurface, borderWidth: StyleSheet.hairlineWidth, borderColor: sc.border },
});
