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
 * REFINE-987 (round 2): the "Train" eyebrow (C2_history).
 *
 * REFINE-987R3 (round 3, owner #203-E80 on 203-D38: two screens in one flow): main's cards for this week and the two
 * after (WINDOW-1, workouts/workoutWeeks.tsx: this Monday to the Sunday two weeks after, Monday first, the phone's own
 * today; a workout whose day cannot be read stays listed), "Full program" under the title opening Your weeks
 * (workouts/YourWeeksScreen.tsx). Your weeks' week rows open this page for one week (the `week` parameter, a Monday):
 * that week's workouts on main's cards under its span, no "Full program".
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
import { layout, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import { formatPlanType } from '../../utils/workout/formatPlanType';
import { assignmentPrescription } from '../../utils/workout/assignmentPrescription';
import { isTimedRow } from '../../utils/workout/exerciseUnit';
import { readsBW } from '../../utils/workout/bodyWeight';
import { assignmentDay, dayStart } from '../../utils/workout/workoutDay';
import { getTodayString } from '../../utils/date';
import { useScreenInsets } from '../../ui';
import { QuietRow } from '../../ui/rows/QuietRow';
import { sectionHead } from './workouts/workoutStyleC';
import { ListState, listRows, weekParam, weekSpan } from './workouts/workoutWeeks';

type Assignment = ClientWorkoutAssignmentWithPlan;

/** `week`: a Monday (YYYY-MM-DD) from a Your weeks row; anything else shows the default window. */
export default function ClientWorkoutViewerScreen({ route }: { route?: { params?: { week?: string } } }) {
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
  const week = weekParam(route?.params?.week);
  // WINDOW-1, or the one week a Your weeks row opened; then main's two lists in main's order.
  const shown = useMemo(() => listRows(sorted, today, week), [sorted, today, week]);
  const pending = shown.filter((a) => !a.completed_at);
  const completed = shown.filter((a) => !!a.completed_at);

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
      {/* C2_history "TRAIN" (cap rows 118-133) over the title; one week's page names its span there. */}
      <Text style={styles.eyebrow}>{week ? weekSpan(week) : 'Train'}</Text>
      <Text style={[typography.h1, { color: sc.textPrimary }]}>
        Your workouts
      </Text>

      {isLoading ? (
        <ListState state="loading" sc={sc} />
      ) : isError ? (
        <ListState state="failed" sc={sc} />
      ) : sorted.length === 0 ? (
        <ListState state="empty" sc={sc} />
      ) : (
        <>
          {/* FULL-1: the kit's row, the first thing under the title, whenever the read holds a workout. */}
          {week ? null : (
            <QuietRow label="Full program" onPress={() => undefined} testID="workout-full-program" style={styles.fullProgram} />
          )}
          {!week && shown.length === 0 ? (
            <Text style={[typography.body, styles.state, { color: sc.textMuted }]}>
              Nothing planned in the next three weeks.
            </Text>
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
        </>
      )}
    </ScrollView>
  );
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
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    // C2_history: the 24 pt gutter (col 48); the top clears the status bar by 12 pt (inline, from the insets).
    content: { paddingHorizontal: layout.gutter, paddingBottom: spacing['3xl'] },
    eyebrow: { ...typography.eyebrow, color: sc.textMuted },
    // C2_history "EARLIER" (rows 876-899): the eyebrow over its own hairline; the first card follows the rule.
    sectionHead: { ...sectionHead(sc), marginBottom: 0 },
    // The kit's QuietRow under the title (FULL-1), clear of it by the section gap.
    fullProgram: { marginTop: spacing.sm },
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
    // The line of R3-W3 in main's state role (workoutWeeks.tsx ListState).
    state: { marginTop: layout.sectionPadY },
  });
}
