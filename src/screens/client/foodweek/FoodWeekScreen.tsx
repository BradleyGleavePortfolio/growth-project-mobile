/**
 * FoodWeekScreen: the food week page, C2 Style C frame C_week (the owner's "I like c2 style c"; planning/MOCKUP3/C2,
 * KITCHEN-WEEK-M). You > "Food this week" opens it in the More stack under the stack's Back row on the forest band.
 *
 * The masthead is the Food day's with a week in place of a day: Previous week, the range, Next week on an earlier
 * range, the serif title, the week's average and the gold rule. The paper holds one forest line through the days
 * with entries against the dashed calorie target (today's point gold), then one row per day: its calories and
 * protein and, for a client with a coach while the plan checklist switch is on, one dot per plan meal, filled when
 * done by the Food day's own rule. A client with no coach gets the same page without the coach's parts (C6) and
 * the page makes no plan or daily read for her. Every number is the signed-in client's own read; a read that
 * failed never shows as a zero, an empty dot or "Nothing yet", and a re-read that fails (offline) keeps the last good
 * answer she was shown. Words: the 137-2 table in the PR body.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Navigation from '@react-navigation/native';
import { useQueries, useQuery } from '@tanstack/react-query';
import Svg, { Circle, Line, Polyline } from 'react-native-svg';
import { logApi } from '../../../services/api';
import { mealTemplatesApi } from '../../../api/mealTemplatesApi';
import { useCurrentMacrosForSelf } from '../../../hooks/useMacros';
import { useCurrentUser } from '../../../hooks/useCurrentUser';
import { featureFlags } from '../../../config/featureFlags';
import HapticPressable from '../../../components/HapticPressable';
import { useStatusBarBand } from '../../../components/StatusBarBand';
import { QuietError, loadFailureMessage } from '../../../ui/states/QuietStates';
import { useTheme } from '../../../theme/ThemeProvider';
import { gold, layout, radius, spacing, typography, type SemanticTokens } from '../../../theme/tokens';
import { getTodayString } from '../../../utils/date';
import { mast } from '../mealplan/planStyleC';
import { weekDates } from '../progress/weekReview';
import {
  CHART, averageLine, chartGeometry, chartLabel, legendLine, planDots, rowNumbers, rowSentence, weekAverage, weekRange,
  weekdayName, weeklyTotals, type DayTotals, type PlanDots,
} from './foodWeek';

// C_week rows (2 px = 1 pt): the day word 54 pt wide, dots of 16 pt 4 pt apart from 78 pt, 14 pt Inter (cap 21 px).
const DAY_W = 54;
const DOT = 16;
const DOT_GAP = 4;
const ROW_TEXT = 14;

/** The forest status band follows screen focus, so it needs a navigator (FoodDayView's ForestBand). */
const NO_NAVIGATION = React.createContext<unknown>(undefined);
type Nav = { addListener?: (event: 'focus', cb: () => void) => () => void };
function ForestBand() {
  useStatusBarBand(mast.ground);
  return null;
}

export default function FoodWeekScreen() {
  const user = useCurrentUser();
  // Remount on identity change, so no week, dot or late answer crosses accounts.
  return <FoodWeekPage key={user?.id ?? 'signed-out'} coached={!!user?.coach_id} />;
}

function FoodWeekPage({ coached }: { coached: boolean }) {
  const { semanticColors: sc } = useTheme();
  const { width, fontScale } = useWindowDimensions();
  const s = useMemo(() => makeStyles(sc), [sc]);
  const navigation = React.useContext((Navigation.NavigationContext as React.Context<unknown> | undefined) ?? NO_NAVIGATION) as Nav | undefined;
  const [back, setBack] = useState(0);
  // The pull's spinner shows only for a pull she started, until the week answers (the Food tab's own rule,
  // LogScreen.tsx refreshing); a return read never turns it on (on iOS that moves the page down by the spinner).
  const [pulled, setPulled] = useState(false);
  const today = getTodayString();
  const range = weekRange(today, back);
  // R6: plan meals done only for a client with a coach (LogScreen.tsx:767) while the plan checklist switch is on.
  const withDots = coached && featureFlags.foodPlanChecklist;

  // R5: the page's one new key; never stored on the phone (queryClient.ts shouldDehydrateQuery).
  const weekly = useQuery({
    queryKey: ['food', 'week', range.start],
    queryFn: () => logApi.getWeekly(range.start).then((r) => r.data as unknown),
    meta: { persist: false },
  });
  // R6: each day's log and plans under the keys and shapes the Food day and the meal plan already read them by
  // (useApi.ts useTodayLog, FoodDayView.tsx plan read); mapped after the read, never in the queryFn.
  const daily = useQueries({ queries: range.days.map((day) => ({
    queryKey: ['food', 'log', day],
    queryFn: async () => (await logApi.getDaily(day)).data as unknown,
    enabled: withDots,
  })) });
  const plans = useQueries({ queries: range.days.map((day) => ({
    queryKey: ['meal-plan', 'today', day],
    queryFn: () => mealTemplatesApi.todayForClient(day).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
    enabled: withDots,
  })) });
  // R7: the calorie target, the same resolver the Food day's day log uses; none, or a failed read with no answer: no line.
  const target = useCurrentMacrosForSelf();
  const kcalTarget = typeof target.data?.calories_kcal === 'number' && target.data.calories_kcal > 0
    ? target.data.calories_kcal : null;

  // Every read of the range again: Try again and the pull to refresh.
  const readAll = () => {
    void weekly.refetch();
    if (withDots) [...daily, ...plans].forEach((q) => void q.refetch());
    void target.refetch();
  };
  // Back on the page (she may have logged a food on the Food tab for any shown day): on every range, the weekly
  // read and every day read of the shown range are fresh again, so each row says what the Food day says. A plan read
  // is read again only when it has no answer: the Food tab never writes a plan (it shares the Food day's plan key).
  const onReturn = useRef<() => void>(() => undefined);
  onReturn.current = () => {
    if (!weekly.isFetching) void weekly.refetch();
    if (withDots) [...daily, ...plans.filter((q) => q.data === undefined)].forEach((q) => { if (!q.isFetching) void q.refetch(); });
  };
  useEffect(() => navigation?.addListener?.('focus', () => onReturn.current()), [navigation]);
  useEffect(() => { if (!weekly.isFetching) setPulled(false); }, [weekly.isFetching]);

  // C1 (operator ruling): a re-read that fails keeps the last good answer; S8 and S9 only for a read with no answer.
  const totals = weekly.data !== undefined ? weeklyTotals(weekly.data, range.days) : null;
  const average = totals ? weekAverage(totals, range.days, today) : null;
  const dots: Array<PlanDots | null> = range.days.map((day, i) => (withDots && daily[i].data !== undefined && plans[i].data !== undefined
    ? planDots(plans[i].data, daily[i].data, day) : null));
  const goldAt = range.current && totals?.[6] ? 6 : -1;
  const anyEntry = !!totals?.some(Boolean);
  const legend = legendLine(kcalTarget, goldAt === 6);

  // A row that cannot hold its numbers on one line puts them under the day and dots (the brief's 320 pt rule;
  // C_week_android360_130 keeps one line at 360). The longest numbers at about 0.5 em a character decide it.
  const most = Math.max(0, ...dots.map((d) => d?.total ?? 0));
  const dotsW = most > 0 ? most * DOT + (most - 1) * DOT_GAP + spacing.md : 0;
  const longest = Math.max(...(totals ?? []).map((t) => rowNumbers(t).length), 0);
  const stacked = DAY_W + dotsW + spacing.md + longest * 0.5 * ROW_TEXT * fontScale > width - 2 * layout.gutter;
  const loading = weekly.isPending;

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.content} testID="food-week"
      refreshControl={<RefreshControl refreshing={pulled && weekly.isRefetching && !loading}
        onRefresh={() => { setPulled(true); readAll(); }} tintColor={mast.ink} />}>
      <View style={s.mast} testID="food-week-masthead">
        {navigation ? <ForestBand /> : null}
        {/* iOS overscroll above the masthead stays forest, never a bone strip. */}
        <View style={s.overscroll} importantForAccessibility="no" accessibilityElementsHidden pointerEvents="none" />
        <View style={s.dateRow}>
          <HapticPressable intent="light" disableAnimation onPress={() => setBack((b) => b + 1)} accessibilityRole="button"
            accessibilityLabel="Previous week" style={s.chevron} testID="food-week-previous">
            <Ionicons name="chevron-back" size={24} color={mast.ink} />
          </HapticPressable>
          <View style={s.rangeBox}><Text style={s.range}>{weekDates(range)}</Text></View>
          {range.current ? (
            <View style={s.chevron} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />
          ) : (
            <HapticPressable intent="light" disableAnimation onPress={() => setBack((b) => Math.max(0, b - 1))}
              accessibilityRole="button" accessibilityLabel="Next week" style={s.chevron} testID="food-week-next">
              <Ionicons name="chevron-forward" size={24} color={mast.ink} />
            </HapticPressable>
          )}
        </View>
        <Text style={s.title} accessibilityRole="header">{range.current ? 'This week' : 'Earlier week'}</Text>
        {loading ? <View style={[s.bone, s.boneLine]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden />
          : average ? <Text style={s.line}>{averageLine(average)}</Text> : null}
        <View style={s.rule} importantForAccessibility="no" accessibilityElementsHidden />
      </View>

      <View style={s.paper} testID="food-week-page">
        {loading ? (
          <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your week" testID="food-week-loading">
            <View style={[s.paperBone, s.chartBone]} />
            {range.days.map((day) => <View key={day} style={s.row}><View style={[s.paperBone, s.rowBone]} /></View>)}
          </View>
        ) : weekly.isError && weekly.data === undefined ? (
          <QuietError message={loadFailureMessage(weekly.error, 'Your week')} onRetry={readAll} retrying={weekly.isFetching}
            testID="food-week-error" />
        ) : totals ? (
          <>
            {anyEntry ? (
              <WeekChart totals={totals} width={width - 2 * layout.gutter} target={kcalTarget} goldAt={goldAt} days={range.days} sc={sc} />
            ) : null}
            {anyEntry && legend ? <Text style={s.legend}>{legend}</Text> : null}
            {dots.some(Boolean) ? <Text style={s.eyebrow} accessibilityRole="header">Plan meals done</Text> : null}
            {range.days.map((day, i) => (
              <DayRow key={day} day={day} totals={totals[i]} dots={dots[i]} stacked={stacked} s={s} />
            ))}
            {range.current && average ? <Text style={s.foot}>Average leaves out today until the day ends.</Text> : null}
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

type Styles = ReturnType<typeof makeStyles>;

/** One day: its three letters, its plan meal dots (coached), its numbers. One spoken sentence; not a button. */
function DayRow({ day, totals, dots, stacked, s }: { day: string; totals: DayTotals | null; dots: PlanDots | null; stacked: boolean; s: Styles }) {
  return (
    <View style={s.row} accessible accessibilityLabel={rowSentence(day, totals, dots)} testID={`food-week-row-${day}`}>
      <Text style={s.day}>{weekdayName(day).slice(0, 3)}</Text>
      {dots ? (
        <View style={s.dots} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {Array.from({ length: dots.total }, (_, k) => (
            <View key={k} style={[s.dot, k < dots.done ? s.dotDone : s.dotOpen]} testID={k < dots.done ? 'food-week-dot-done' : 'food-week-dot-open'} />
          ))}
        </View>
      ) : null}
      <Text style={[s.numbers, !totals && s.nothing, stacked && s.numbersUnder]}>{rowNumbers(totals)}</Text>
    </View>
  );
}

/** C_week's line: forest through the days with entries (breaking at a day with none), today's point gold, the dashed target. */
function WeekChart({ totals, width, target, goldAt, days, sc }: {
  totals: Array<DayTotals | null>; width: number; target: number | null; goldAt: number; days: string[]; sc: SemanticTokens;
}) {
  const g = chartGeometry(totals, width, target);
  return (
    <View style={{ height: CHART.height }} accessible accessibilityRole="image" accessibilityLabel={chartLabel(target)} testID="food-week-chart">
      <Svg width={width} height={CHART.height} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {g.targetY !== null ? (
          <Line x1={0} x2={width} y1={g.targetY} y2={g.targetY} stroke={sc.textPrimary} strokeOpacity={0.85} strokeWidth={1}
            strokeDasharray="4 3" testID="food-week-target" />
        ) : null}
        {g.runs.map((run) => (run.length > 1 ? (
          <Polyline key={run[0].i} points={run.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={sc.data.forest}
            strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" testID="food-week-line" />
        ) : null))}
        {g.points.map((p) => (p ? (
          <Circle key={p.i} cx={p.x} cy={p.y} r={p.i === goldAt ? 4 : 3} fill={p.i === goldAt ? gold[300] : sc.data.forest}
            testID={`food-week-point-${days[p.i]}`} />
        ) : null))}
      </Svg>
    </View>
  );
}

const makeStyles = (sc: SemanticTokens) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: sc.bgPrimary },
  content: { flexGrow: 1 },
  // Masthead (values from planStyleC.tsx:307-325 and FoodDayView.tsx:614-617): under the native Back row, no inset.
  mast: { backgroundColor: mast.ground, paddingHorizontal: layout.gutter, paddingTop: spacing.sm, paddingBottom: spacing.xs + radius.sheet },
  overscroll: { position: 'absolute', left: 0, right: 0, top: -1000, height: 1000, backgroundColor: mast.ground },
  dateRow: { flexDirection: 'row', alignItems: 'center', marginHorizontal: -10, minHeight: layout.touchMin },
  chevron: { width: layout.touchMin, height: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  rangeBox: { flex: 1, minHeight: layout.touchMin, alignItems: 'center', justifyContent: 'center' },
  range: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontWeight: '600', lineHeight: 13, letterSpacing: 1.98, color: mast.muted, textAlign: 'center' },
  title: { ...typography.h1, fontFamily: 'CormorantGaramond_500Medium', fontWeight: '500', fontSize: 32, lineHeight: 40, letterSpacing: -0.2, color: mast.ink, marginTop: 6 },
  // C_week: Inter 15 in the masthead's light ink, 8 pt under the title.
  line: { ...typography.body, fontSize: 15, lineHeight: 21, letterSpacing: 0, color: mast.ink, marginTop: spacing.sm },
  rule: { height: 1, alignSelf: 'stretch', backgroundColor: mast.rule, marginTop: spacing.md },
  bone: { borderRadius: radius.button, backgroundColor: sc.data.frameOnDark, opacity: 0.55 },
  boneLine: { height: 16, width: '85%', marginTop: 14 },
  // The paper (radius 24) starts 4 pt under the rule (C_day, C_week); Sunlit sand (owner 203-E86).
  paper: { flexGrow: 1, marginTop: -radius.sheet, paddingHorizontal: layout.gutter, paddingTop: 20, paddingBottom: spacing['3xl'],
    backgroundColor: sc.bgPrimary, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet },
  paperBone: { borderRadius: radius.button, backgroundColor: sc.data.trackLight },
  chartBone: { height: CHART.height - 2 * spacing.lg, marginVertical: spacing.lg },
  rowBone: { height: 14, width: '70%' },
  legend: { ...typography.bodySmall, fontSize: 12, lineHeight: 17, color: sc.textMuted },
  eyebrow: { ...typography.eyebrow, fontFamily: 'Inter_600SemiBold', fontWeight: '600', lineHeight: 14, letterSpacing: 1.98, color: sc.textMuted, marginTop: spacing.md },
  // C_week rows: 48 pt apart, a 1 pt hairline under each; numbers wrap under the day before anything overlaps.
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', alignContent: 'center', minHeight: 48, paddingVertical: spacing.xs,
    borderBottomWidth: 1, borderColor: sc.border },
  day: { ...typography.body, fontSize: ROW_TEXT, lineHeight: 20, letterSpacing: 0, color: sc.textMuted, minWidth: DAY_W },
  dots: { flexDirection: 'row', gap: DOT_GAP, marginRight: spacing.md },
  dot: { width: DOT, height: DOT, borderRadius: radius.chip },
  dotDone: { backgroundColor: sc.data.forest },
  dotOpen: { borderWidth: 1, borderColor: sc.data.planned },
  numbers: { ...typography.bodyMd, fontSize: ROW_TEXT, lineHeight: 20, letterSpacing: 0, color: sc.textPrimary, flexGrow: 1,
    textAlign: 'right', fontVariant: ['tabular-nums'] },
  numbersUnder: { width: '100%', textAlign: 'left', paddingLeft: DAY_W, marginTop: 2 },
  nothing: { ...typography.body, fontSize: ROW_TEXT, lineHeight: 20, letterSpacing: 0, color: sc.textMuted },
  foot: { ...typography.bodySmall, fontSize: 12, lineHeight: 17, color: sc.textMuted, marginTop: spacing.md },
});
