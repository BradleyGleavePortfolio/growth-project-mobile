/**
 * ClientWorkoutViewerScreen — list of the client's workout
 * assignments, with the next-up assignment surfaced prominently.
 *
 * Reads /assignments/me. Opening a row preserves the assignment detail
 * route, where the client starts or resumes the workout.
 *
 * Empty state: no assignment data, without assuming a coach relationship.
 *
 * STYLE-LOGGING-M: C1 Style C v2 by its nearest picked drawings (no frame draws this list): C2_history for the page,
 * its title, section heads and each card's row with its chevron; C2_today for each card's exercise rows; C2_first for
 * the empty title. Words, data, taps and reads are main's.
 *
 * REFINE-987 (round 2, toward C2_history): the "Train" eyebrow; this week's sessions on the deep forest THIS WEEK card
 * (the ring, one row per session with its mark, day, name and done / planned / missed, each row opening its workout as
 * main's card does, main's exercise lines kept under it); every other workout under main's "To complete" and
 * "Completed"; EARLIER, one row per past week holding a session (its ring, span and "{n} of {total} done", not
 * pressable: there is no week page); the legend. One week rule: trainWeek / workoutWeek (TrainToday.tsx, thisWeek.ts).
 */

import React, { useCallback, useMemo } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  useNavigation,
  type NavigationProp,
  type ParamListBase,
} from '@react-navigation/native';
import type { AssignmentExercise, ClientWorkoutAssignmentWithPlan } from '../../api/workoutBuilderApi';
import { useMyWorkoutAssignments } from '../../hooks/useWorkoutBuilder';
import { useExerciseNames } from '../../hooks/useExerciseNames';
import { Ionicons } from '@expo/vector-icons';
import { colors, layout, radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import { formatPlanType } from '../../utils/workout/formatPlanType';
import { assignmentPrescription } from '../../utils/workout/assignmentPrescription';
import { isTimedRow } from '../../utils/workout/exerciseUnit';
import { readsBW } from '../../utils/workout/bodyWeight';
import { assignmentDay, dayStart } from '../../utils/workout/workoutDay';
import { getTodayString } from '../../utils/date';
import { useScreenInsets } from '../../ui';
import { SegmentedRing, type SegmentState } from '../../ui/charts/StyleCMarks';
import { DAY_NAMES, doneLine, workoutWeek, type WorkoutWeek } from '../coach/client-detail/thisWeek';
import { TRAIN_COPY, trainWeek, type TrainWorkout } from './train/TrainToday';
import { sectionHead } from './workouts/workoutStyleC';

type Assignment = ClientWorkoutAssignmentWithPlan;

export default function ClientWorkoutViewerScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const insets = useScreenInsets();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { data, isLoading, isError, refetch, isRefetching } =
    useMyWorkoutAssignments();

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const sorted = useMemo<ClientWorkoutAssignmentWithPlan[]>(() => {
    return (data ?? [])
      .slice()
      .sort((a, b) => assignmentDay(a).localeCompare(assignmentDay(b)));
  }, [data]);

  // The phone's own today (WorkoutScreen.tsx passes the same to the Train tab's week).
  const today = getTodayString();
  const weeks = useMemo(() => weeksOf(sorted, today), [sorted, today]);
  // This week's sessions open from the card; every other workout stays on main's two lists.
  const pending = sorted.filter((a) => !a.completed_at && !weeks.inThis.has(a.id));
  const completed = sorted.filter((a) => !!a.completed_at && !weeks.inThis.has(a.id));

  const handleOpenAssignment = useCallback(
    (a: ClientWorkoutAssignmentWithPlan) => {
      navigation.navigate('WorkoutAssignmentDetail', { assignmentId: a.id });
    },
    [navigation],
  );

  return (
    <ScrollView
      testID="assigned-workouts-scroll"
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + layout.statusBarGap }]}
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={onRefresh}
          tintColor={sc.accent}
        />
      }
    >
      {/* C2_history "TRAIN" (cap rows 118-133) over the title. */}
      <Text style={styles.eyebrow}>Train</Text>
      <Text style={[typography.h1, { color: sc.textPrimary }]}>
        Your workouts
      </Text>

      {isLoading ? (
        <Text style={[typography.body, styles.state, { color: sc.textMuted }]}>
          Loading...
        </Text>
      ) : isError ? (
        <Text style={[typography.body, styles.state, { color: sc.textMuted }]}>
          Could not load your workouts. Pull to retry.
        </Text>
      ) : sorted.length === 0 ? (
        <View style={styles.empty}>
          <Text style={[typography.h1, { color: sc.textPrimary }]}>
            No workouts assigned
          </Text>
          <Text style={[typography.body, { color: sc.textMuted }]}>
            Assigned workouts appear here when available.
          </Text>
        </View>
      ) : (
        <>
          {weeks.rows.length > 0 ? (
            <View testID="week-card" style={styles.weekCard}>
              {/* C2_history rows 236-367: the eyebrow and the ring (cols 611-696) over the first rule. */}
              <View style={styles.weekHead}>
                <Text style={styles.weekEyebrow}>{TRAIN_COPY.week}</Text>
                <SegmentedRing onDark size={RING} segments={weeks.week.segments} label={doneLine(weeks.week)} testID="week-ring">
                  <Text maxFontSizeMultiplier={1.15} style={styles.weekCount}>{`${weeks.week.done}/${weeks.week.total}`}</Text>
                </SegmentedRing>
              </View>
              {weeks.rows.map((a, i) => (
                <WeekSession
                  key={a.id}
                  a={a}
                  state={weeks.week.segments[i]}
                  styles={styles}
                  sc={sc}
                  onPress={() => handleOpenAssignment(a)}
                />
              ))}
            </View>
          ) : null}

          {pending.length > 0 ? (
            <>
              <Text style={styles.sectionHead}>
                To complete
              </Text>
              {pending.map((a) => (
                <AssignmentCard
                  key={a.id}
                  a={a}
                  styles={styles}
                  sc={sc}
                  onPress={() => handleOpenAssignment(a)}
                />
              ))}
            </>
          ) : null}

          {completed.length > 0 ? (
            <>
              <Text style={styles.sectionHead}>
                Completed
              </Text>
              {completed.map((a) => (
                <AssignmentCard
                  key={a.id}
                  a={a}
                  styles={styles}
                  sc={sc}
                  onPress={() => handleOpenAssignment(a)}
                />
              ))}
            </>
          ) : null}

          {weeks.earlier.length > 0 ? (
            <View testID="week-earlier">
              <Text style={styles.sectionHead}>Earlier</Text>
              {/* C2_history rows 900-1411: a 64 pt row per past week; no chevron, no tap (no week page). */}
              {weeks.earlier.map(({ monday, week }) => (
                <View key={monday} testID={`earlier-${monday}`} style={styles.earlierRow}>
                  <SegmentedRing size={RING} segments={week.segments} label={doneLine(week)} testID={`earlier-ring-${monday}`}>
                    <Text maxFontSizeMultiplier={1.15} style={styles.earlierCount}>{`${week.done}/${week.total}`}</Text>
                  </SegmentedRing>
                  <View style={styles.flex}>
                    <Text style={[typography.h4, { color: sc.textPrimary }]}>{weekSpan(monday)}</Text>
                    <Text style={[typography.body, { color: sc.textMuted }]}>{doneLine(week)}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {weeks.rows.length > 0 || weeks.earlier.length > 0 ? (
            <View testID="week-legend" style={styles.legend}>
              {LEGEND.map((s) => (
                <View key={s} style={styles.legendItem}>
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={[styles.legendMark, s === 'done' ? styles.legendDone : s === 'missed' ? styles.legendMissed : styles.legendPlanned]}
                  />
                  <Text style={[typography.body, { color: sc.textPrimary }]}>{TRAIN_COPY.day[s]}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const RING = 44; // C2_history cols 611-696 (this week) and 52-140 (each earlier week): 44 pt.
const LEGEND: SegmentState[] = ['done', 'planned', 'missed'];

/** Monday (YYYY-MM-DD) of a day, by the Train tab's own week rule. */
const mondayOf = (day: string) => trainWeek([], day).week;

/**
 * This week's sessions in day order with their week (trainWeek: segment i is row i), and every earlier week holding a
 * session, newest first (workoutWeek with the real today, so an open session in a past week reads missed).
 */
function weeksOf(rows: ReadonlyArray<Assignment>, today: string) {
  const thisMonday = mondayOf(today);
  const thisWeek: Assignment[] = [];
  const before = new Map<string, Assignment[]>();
  for (const a of rows) {
    const day = assignmentDay(a);
    if (!day) continue; // an unreadable day stays on main's lists only
    const monday = mondayOf(day);
    if (monday === thisMonday) thisWeek.push(a);
    else if (monday < thisMonday) before.set(monday, [...(before.get(monday) ?? []), a]);
  }
  const earlier = Array.from(before.keys()).sort().reverse().map((monday) => ({
    monday,
    week: workoutWeek({
      week_start: monday,
      today,
      assignments: (before.get(monday) ?? []).map((a) => ({
        day: assignmentDay(a),
        completed_at: a.completed_at,
        skipped_at: (a as TrainWorkout).skipped_at,
      })),
    }),
  }));
  return { rows: thisWeek, week: trainWeek(thisWeek, today), inThis: new Set(thisWeek.map((a) => a.id)), earlier };
}

/** "Mon 12" (C2_history rows 413-433). */
function sessionDay(a: Assignment): string {
  const d = dayStart(assignmentDay(a));
  return d ? `${DAY_NAMES[(d.getDay() + 6) % 7]} ${d.getDate()}` : '';
}

/** "Oct 12 to 18", "Sep 28 to Oct 4" (C2_history rows 930-953). */
function weekSpan(monday: string): string {
  const from = dayStart(monday);
  if (!from) return '';
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 6);
  const md = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${md(from)} to ${to.getMonth() === from.getMonth() ? to.getDate() : md(to)}`;
}

/** Main's line for one prescribed exercise (FIX-928-BW, #197-E10: a body-weight exercise reads "BW prescribed", never "0 lb"). */
function prescriptionText(exercise: AssignmentExercise, bodyWeight: Record<string, boolean> | undefined): string {
  const unit = isTimedRow(exercise) ? 'sec' : 'reps / sec';
  const load = exercise.weight_lbs !== null
    ? ` · ${readsBW(bodyWeight?.[exercise.exercise_external_id], exercise.weight_lbs) ? 'BW' : `${exercise.weight_lbs} lb`} prescribed`
    : '';
  return `${exercise.sets} sets × ${exercise.reps_or_duration_seconds} ${unit}${load}`;
}

/** The prescription and its exercise names, as the detail screen shows and starts them (K3FIX-SNAPSHOT). */
function usePlan(a: Assignment) {
  const plan = useMemo(() => assignmentPrescription(a), [a]);
  const exerciseIds = useMemo(() => plan.exercises.map((e) => e.exercise_external_id), [plan]);
  const { names, bodyWeight } = useExerciseNames(exerciseIds);
  return { plan, prescribed: plan.exercises, names, bodyWeight };
}

/** One session on the THIS WEEK card (C2_history rows 368-817): it opens its workout exactly as main's card does. */
function WeekSession({ a, state, styles, sc, onPress }: {
  a: Assignment; state: SegmentState; styles: Styles; sc: SemanticTokens; onPress: () => void;
}) {
  const { plan, prescribed, names, bodyWeight } = usePlan(a);
  const word = state === 'done' ? sc.data.leaf : state === 'missed' ? sc.data.missedOnDark : sc.textOnMastheadMuted;
  return (
    <Pressable
      testID={`week-row-${a.id}`}
      onPress={onPress}
      style={({ pressed }) => [styles.weekRow, pressed ? { opacity: 0.85 } : null]}
      accessibilityRole="button"
      accessibilityLabel={`Open workout ${plan.name}`}
    >
      <View style={styles.weekLine}>
        <View
          testID={`week-mark-${state}`}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={[styles.mark, state === 'done' ? styles.markDone : state === 'missed' ? styles.markMissed : styles.markPlanned]}
        >
          {state === 'done' ? <Ionicons name="checkmark" size={14} color={colors.ink} /> : null}
        </View>
        <View style={styles.weekWhat}>
          <Text style={styles.weekDay}>{sessionDay(a)}</Text>
          <Text style={styles.weekName}>{plan.name}</Text>
        </View>
        <Text style={[styles.weekWord, { color: word }]}>{TRAIN_COPY.day[state]}</Text>
      </View>
      {/* Main's exercise lines, kept for every workout the list shows (timedSets196Display reads them on the list). */}
      {prescribed.map((exercise, index) => (
        <View key={exercise.order} style={styles.weekLift}>
          <Text style={styles.weekLiftName}>{names[exercise.exercise_external_id] || `Exercise ${index + 1}`}</Text>
          <Text style={styles.weekLiftLine}>{prescriptionText(exercise, bodyWeight)}</Text>
        </View>
      ))}
    </Pressable>
  );
}

function AssignmentCard({
  a,
  styles,
  sc,
  onPress,
}: {
  a: ClientWorkoutAssignmentWithPlan;
  styles: Styles;
  sc: SemanticTokens;
  onPress: () => void;
}) {
  // K3FIX-SNAPSHOT: the same prescription the detail screen shows and starts.
  const { plan, prescribed, names, bodyWeight } = usePlan(a);
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        pressed ? { opacity: 0.85 } : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Open workout ${plan.name}`}
    >
      {/* C2_history's row: the day over the name and its lines, the chevron at the right (cols 708-720). */}
      <View style={[styles.headerRow, prescribed.length > 0 && styles.headerOverRows]}>
        <View style={styles.headerText}>
          <Text style={[typography.eyebrow, { color: sc.textMuted }]}>
            {formatScheduled(a.scheduled_for)}
          </Text>
          <Text style={[typography.h4, { color: sc.textPrimary }]}>
            {plan.name}
          </Text>
          <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
            {formatPlanType(plan.type)}
            {plan.durationMinutes ? ` • about ${plan.durationMinutes} min` : ''}
            {' • '}
            {prescribed.length} exercise{prescribed.length === 1 ? '' : 's'}
          </Text>
          {a.completed_at && a.post_rpe !== null ? (
            <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
              Completed RPE {a.post_rpe}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={20} color={sc.textPrimary} accessibilityElementsHidden importantForAccessibility="no" />
      </View>
      {prescribed.map((exercise, index) => (
        <View key={exercise.order} style={[styles.exerciseRow, index === prescribed.length - 1 && styles.lastRow]}>
          <Text style={[typography.h4, { color: sc.textPrimary }]}>
            {names[exercise.exercise_external_id] || `Exercise ${index + 1}`}
          </Text>
          <Text style={[typography.bodySmall, { color: sc.textMuted, fontVariant: ['tabular-nums'] }]}>
            {prescriptionText(exercise, bodyWeight)}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}

function formatScheduled(iso: string): string {
  // The day it was assigned for (utils/workout/workoutDay assignmentDay).
  const d = dayStart(assignmentDay(iso)) ?? new Date(NaN);
  if (Number.isNaN(d.getTime())) return 'scheduled';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

type Styles = ReturnType<typeof makeStyles>;

function makeStyles(sc: SemanticTokens) {
  const mark = { width: MARK, height: MARK, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' } as const;
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    // C2_history: the 24 pt gutter (col 48); the top clears the status bar by 12 pt (inline, from the insets).
    content: { paddingHorizontal: layout.gutter, paddingBottom: spacing['3xl'] },
    eyebrow: { ...typography.eyebrow, color: sc.textMuted },
    // C2_history "EARLIER" (rows 876-899): the eyebrow over its own hairline; the first card follows the rule.
    sectionHead: { ...sectionHead(sc), marginBottom: 0 },
    // C2_history rows 236-843: deep forest, 16 pt corners (col 50 meets the ground at row 257), 16 pt in (col 80).
    weekCard: {
      marginTop: spacing.sm,
      backgroundColor: sc.surface.masthead,
      borderRadius: radius.card,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg,
      paddingBottom: spacing.md,
    },
    weekHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingBottom: spacing.sm },
    weekEyebrow: { ...typography.eyebrow, color: sc.textOnMastheadMuted, flex: 1 },
    weekCount: { ...typography.bodySmall, fontFamily: typography.micro.fontFamily, color: sc.textOnAccent, fontVariant: ['tabular-nums'] },
    // A 56 pt session row under a 1 pt rule (rules #3B4C40 at rows 368, 480, 592, 704: the forest band on deep).
    weekRow: { borderTopWidth: 1, borderTopColor: sc.surface.forestBand },
    weekLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: layout.rowMinHeight - 1 },
    // Day and name side by side (cols 145 and 269); under 112 pt left for the name, it goes under the day.
    weekWhat: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: spacing.md, paddingVertical: spacing.xs },
    weekDay: { ...typography.body, color: sc.textOnMastheadMuted, minWidth: 52, fontVariant: ['tabular-nums'] },
    weekName: { ...typography.h4, color: sc.textOnAccent, flexGrow: 1, flexShrink: 1, minWidth: 112 },
    weekWord: { ...typography.bodySmall, fontFamily: typography.micro.fontFamily },
    weekLift: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.sm, marginLeft: MARK + spacing.md, paddingBottom: spacing.sm },
    weekLiftName: { ...typography.bodySmall, color: sc.textOnAccent },
    weekLiftLine: { ...typography.bodySmall, color: sc.textOnMastheadMuted, fontVariant: ['tabular-nums'] },
    // The row marks (cols 80-123: 22 pt), from StyleCMarks' on-dark roles.
    mark,
    markDone: { backgroundColor: sc.data.leaf },
    markPlanned: { borderWidth: 1.5, borderColor: sc.data.plannedOnDark },
    markMissed: { borderWidth: 1.5, borderColor: sc.data.missedOnDark, borderStyle: 'dashed' },
    // C2_history rows 900-1027: 64 pt per week, the ring, then the span over its line, a hairline under.
    earlierRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.lg,
      minHeight: layout.rowMinHeight + spacing.sm,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: sc.border,
    },
    earlierCount: { ...typography.bodySmall, fontFamily: typography.micro.fontFamily, color: sc.textPrimary, fontVariant: ['tabular-nums'] },
    flex: { flex: 1 },
    // C2_history rows 1434-1469: 18 pt marks, light ground (StyleCMarks' light roles).
    legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.sm, marginTop: spacing.lg },
    legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: layout.touchMin },
    legendMark: { width: LEGEND_MARK, height: LEGEND_MARK, borderRadius: radius.pill },
    legendDone: { borderWidth: 4, borderColor: sc.data.forest },
    legendPlanned: { borderWidth: 1.5, borderColor: sc.data.planned },
    legendMissed: { borderWidth: 1.5, borderColor: sc.data.missed, borderStyle: 'dashed' },
    // A C2_history row (rows 900-1027): 12 pt above and below, hairline under; the card has no fill.
    card: {
      minHeight: 44,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: sc.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    headerOverRows: { paddingBottom: spacing.md },
    headerText: { flex: 1, gap: 2 },
    // C2_today's exercise rows (rows 864-1007): a hairline above, 12 pt above and below, the name over its line.
    exerciseRow: {
      paddingVertical: spacing.md,
      gap: 2,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: sc.border,
    },
    // The card's own 12 pt closes the last row above its hairline.
    lastRow: { paddingBottom: 0 },
    // C2_first: the serif title over its line, 18 pt under the page title; no rule.
    empty: { marginTop: layout.sectionPadY, gap: spacing.sm },
    state: { marginTop: layout.sectionPadY },
  });
}

const MARK = 22; // C2_history cols 80-123
const LEGEND_MARK = 18; // C2_history cols 48-83
