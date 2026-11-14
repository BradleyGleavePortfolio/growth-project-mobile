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
import type { ClientWorkoutAssignmentWithPlan } from '../../api/workoutBuilderApi';
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
import { useScreenInsets } from '../../ui';
import { sectionHead } from './workouts/workoutStyleC';

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

  const pending = sorted.filter((a) => !a.completed_at);
  const completed = sorted.filter((a) => !!a.completed_at);

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
  const plan = useMemo(() => assignmentPrescription(a), [a]);
  const prescribed = plan.exercises;
  const exerciseIds = useMemo(() => prescribed.map((e) => e.exercise_external_id), [prescribed]);
  const { names, bodyWeight } = useExerciseNames(exerciseIds);
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
            {exercise.sets} sets × {exercise.reps_or_duration_seconds} {isTimedRow(exercise) ? 'sec' : 'reps / sec'}
            {/* FIX-928-BW (#197-E10): a body-weight exercise reads "BW prescribed", never "0 lb". */}
            {exercise.weight_lbs !== null
              ? ` · ${readsBW(bodyWeight?.[exercise.exercise_external_id], exercise.weight_lbs) ? 'BW' : `${exercise.weight_lbs} lb`} prescribed`
              : ''}
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
    // C2_history "EARLIER" (rows 876-899): the eyebrow over its own hairline; the first card follows the rule.
    sectionHead: { ...sectionHead(sc), marginBottom: 0 },
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
