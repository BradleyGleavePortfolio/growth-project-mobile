/**
 * ClientWorkoutViewerScreen — list of the client's workout
 * assignments, with the next-up assignment surfaced prominently.
 *
 * Reads /assignments/me. Opening a row preserves the assignment detail
 * route, where the client starts or resumes the workout.
 *
 * Empty state: no assignment data, without assuming a coach relationship.
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
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import { formatPlanType } from '../../utils/workout/formatPlanType';
import { overlayRomanAdjustedSets } from '../../utils/workout/romanAdjustedSets';

export default function ClientWorkoutViewerScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { data, isLoading, isError, refetch, isRefetching } =
    useMyWorkoutAssignments();

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const sorted = useMemo<ClientWorkoutAssignmentWithPlan[]>(() => {
    return (data ?? [])
      .slice()
      .sort(
        (a, b) =>
          new Date(a.scheduled_for).getTime() -
          new Date(b.scheduled_for).getTime(),
      );
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
        Your workouts
      </Text>

      {isLoading ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Loading...
        </Text>
      ) : isError ? (
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Could not load your workouts. Pull to retry.
        </Text>
      ) : sorted.length === 0 ? (
        <View style={styles.card}>
          <Text style={[typography.h3, { color: sc.textPrimary }]}>
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
              <Text style={[typography.eyebrow, { color: sc.textMuted }]}>
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
              <Text
                style={[
                  typography.eyebrow,
                  { color: sc.textMuted, marginTop: spacing.lg },
                ]}
              >
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
  const plan = a.workout_plan;
  const exerciseIds = useMemo(() => plan.exercises.map((e) => e.exercise_external_id), [plan.exercises]);
  const { names } = useExerciseNames(exerciseIds);
  const prescribed = overlayRomanAdjustedSets(plan.exercises, a.roman_adjusted_sets).exercises
    .sort((left, right) => left.order - right.order);
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
      <Text style={[typography.eyebrow, { color: sc.textMuted }]}>
        {formatScheduled(a.scheduled_for)}
      </Text>
      <View style={styles.headerRow}>
        <Text style={[typography.h3, { color: sc.textPrimary }]}>
          {plan.name}
        </Text>
      </View>
      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
        {formatPlanType(plan.type)}
        {plan.duration_estimate_minutes
          ? ` • about ${plan.duration_estimate_minutes} min`
          : ''}
        {' • '}
        {plan.exercises.length} exercise{plan.exercises.length === 1 ? '' : 's'}
      </Text>
      {a.completed_at && a.post_rpe !== null ? (
        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
          Completed RPE {a.post_rpe}
        </Text>
      ) : null}
      {prescribed.map((exercise, index) => (
        <View key={exercise.id} style={styles.exerciseRow}>
          <Text style={[typography.bodySmall, { color: sc.textPrimary }]}>
            {names[exercise.exercise_external_id] || `Exercise ${index + 1}`}
          </Text>
          <Text style={[typography.bodySmall, { color: sc.textMuted, fontVariant: ['tabular-nums'] }]}>
            {exercise.sets} sets × {exercise.reps_or_duration_seconds} reps / sec
            {exercise.weight_lbs !== null ? ` · ${exercise.weight_lbs} lb prescribed` : ''}
          </Text>
        </View>
      ))}
    </Pressable>
  );
}

function formatScheduled(iso: string): string {
  const d = new Date(iso);
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
    content: { padding: spacing.xl, paddingBottom: spacing['3xl'], gap: spacing.lg },
    card: {
      minHeight: 44,
      paddingVertical: spacing.lg,
      gap: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: sc.border,
    },
    headerRow: {
      alignItems: 'flex-start',
    },
    exerciseRow: {
      paddingTop: spacing.md,
      marginTop: spacing.xs,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: sc.border,
    },
  });
}
