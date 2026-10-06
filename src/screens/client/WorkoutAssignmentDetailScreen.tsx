/**
 * WorkoutAssignmentDetailScreen — open a coach-assigned workout, review
 * the prescribed exercises, and start the live workout.
 *
 * Reads /assignments/:id (which includes the full WorkoutPlan), maps
 * the prescribed exercises into the ActiveWorkout session shape, then
 * navigates to ActiveWorkout. exercise_external_id is preserved so the
 * downstream write is not corrupted with empty ids.
 */

import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import HapticPressable from '../../components/HapticPressable';
import {
  RouteProp,
  useNavigation,
  useRoute,
  NavigationProp,
  ParamListBase,
} from '@react-navigation/native';
import { useMyWorkoutAssignment } from '../../hooks/useWorkoutBuilder';
import { useExerciseNames } from '../../hooks/useExerciseNames';
import { formatPlanType } from '../../utils/workout/formatPlanType';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import {
  buildActiveWorkoutExercises,
  prettifyExerciseName,
} from '../../utils/workout/buildActiveWorkout';
import { overlayRomanAdjustedSets } from '../../utils/workout/romanAdjustedSets';

type RouteParams = {
  WorkoutAssignmentDetail: { assignmentId: string };
};

export default function WorkoutAssignmentDetailScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);
  const route =
    useRoute<RouteProp<RouteParams, 'WorkoutAssignmentDetail'>>();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { assignmentId } = route.params;
  const { data, isLoading, isError, refetch, isRefetching } =
    useMyWorkoutAssignment(assignmentId);

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  // B-ROMANADJ-125: set counts the coach approved from Roman's Action Queue
  // are laid over the live plan by `order`, for the list and for Start. No
  // field (older server) = the live plan exactly as before.
  const overlay = useMemo(
    () =>
      overlayRomanAdjustedSets(
        data?.workout_plan?.exercises ?? [],
        data?.roman_adjusted_sets,
      ),
    [data],
  );

  // The plan stores only catalog ids (e.g. "0025" or "seed:push-001"). The
  // screen used to prettify the id, so a client saw "1. Exercise" or
  // "1. Push 001" instead of "Barbell Bench Press". Resolve the real names
  // from GET /exercises/:id; fall back to the prettified id while loading.
  const exerciseIds = useMemo(
    () => (data?.workout_plan?.exercises ?? []).map((e) => e.exercise_external_id),
    [data],
  );
  // Start waits while the names are still loading: the session copies the
  // names at Start, so starting early used to freeze "Push 001" / "Exercise"
  // into the live workout and its saved history. A failed or offline
  // lookup does not block Start; it keeps the prettified fallback.
  const { names: exerciseNames, loading: namesLoading } = useExerciseNames(exerciseIds);
  const nameFor = useCallback(
    (externalId: string) =>
      exerciseNames[externalId] || prettifyExerciseName(externalId) || 'Exercise',
    [exerciseNames],
  );

  const handleStart = useCallback(() => {
    if (!data || namesLoading) return;
    const exercises = buildActiveWorkoutExercises({ exercises: overlay.exercises }).map((e) => ({
      ...e,
      // Saved with the workout, shown in history and to the coach.
      exerciseName: exerciseNames[e.exerciseId] || e.exerciseName,
    }));
    const params = {
      routineId: data.workout_plan.id,
      routineName: data.workout_plan.name,
      exercises: JSON.stringify(exercises),
      assignmentId: data.id,
    };
    // W-4 fix: this screen lives in MoreStack; `ActiveWorkout` lives in
    // WorkoutStack. A plain `navigation.navigate('ActiveWorkout', ...)`
    // throws "screen not found" under React Navigation v7 because the
    // target is not registered in the current navigator. Jump up to the
    // tab navigator and re-enter the Workout tab targeting the right
    // nested screen. Fallback to the local navigator only if the parent
    // chain isn't mounted yet (defensive — should not happen in practice).
    const tabNav = navigation.getParent()?.getParent?.();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parentAny = tabNav as any;
    if (parentAny?.navigate) {
      parentAny.navigate('WorkoutTab', {
        screen: 'ActiveWorkout',
        params,
      });
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (navigation as any).navigate('ActiveWorkout', params);
  }, [data, navigation, exerciseNames, namesLoading, overlay]);

  if (isLoading) {
    return <SkeletonScreen count={5} />;
  }

  if (isError || !data) {
    // The old copy said "Pull to retry" on a screen that cannot be pulled.
    return (
      <View style={styles.center}>
        <Text style={[typography.body, { color: sc.textMuted, textAlign: 'center' }]}>
          This workout did not load. Check the connection, then try again.
        </Text>
        <HapticPressable
          intent="light"
          style={styles.retryBtn}
          onPress={onRefresh}
          disabled={isRefetching}
          accessibilityRole="button"
          accessibilityLabel="Try loading the workout again"
          testID="assignment-retry"
        >
          <Text style={styles.retryBtnText}>{isRefetching ? 'Loading' : 'Try again'}</Text>
        </HapticPressable>
      </View>
    );
  }

  const plan = data.workout_plan;
  const sorted = [...overlay.exercises].sort((a, b) => a.order - b.order);
  const isCompleted = !!data.completed_at;

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
        {plan.name}
      </Text>
      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
        {formatPlanType(plan.type)}
        {plan.duration_estimate_minutes
          ? ` • about ${plan.duration_estimate_minutes} min`
          : ''}
        {' • '}
        {sorted.length} exercise{sorted.length === 1 ? '' : 's'}
      </Text>

      <View style={styles.list}>
        {sorted.map((ex) => (
          <View key={ex.id} style={styles.exerciseRow}>
            <Text style={[typography.h3, { color: sc.textPrimary }]}>
              {ex.order}. {nameFor(ex.exercise_external_id)}
            </Text>
            <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
              {ex.sets} sets × {ex.reps_or_duration_seconds} reps
              {ex.weight_lbs ? ` • ${ex.weight_lbs} lbs` : ''}
              {ex.rest_seconds ? ` • ${ex.rest_seconds}s rest` : ''}
            </Text>
            {overlay.adjustedOrders.has(ex.order) ? (
              <Text
                style={[typography.bodySmall, { color: sc.accent, marginTop: 4 }]}
                testID={`assignment-adjusted-${ex.order}`}
              >
                Updated by your coach
              </Text>
            ) : null}
            {ex.notes ? (
              <Text
                style={[typography.bodySmall, { color: sc.textMuted, marginTop: 4 }]}
              >
                {ex.notes}
              </Text>
            ) : null}
          </View>
        ))}
      </View>

      {isCompleted ? (
        <View style={styles.completedBadge}>
          <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
            Completed{data.post_rpe ? ` • RPE ${data.post_rpe}` : ''}
          </Text>
        </View>
      ) : (
        <HapticPressable
          intent="success"
          style={[styles.startBtn, namesLoading && { opacity: 0.6 }]}
          onPress={handleStart}
          disabled={namesLoading}
          accessibilityRole="button"
          accessibilityState={{ disabled: namesLoading, busy: namesLoading }}
          accessibilityLabel={namesLoading ? 'Loading exercise names' : `Start workout ${plan.name}`}
          testID="assignment-start"
        >
          {namesLoading ? (
            <ActivityIndicator color={sc.bgPrimary} />
          ) : (
            <Text style={styles.startBtnText}>Start workout</Text>
          )}
        </HapticPressable>
      )}
    </ScrollView>
  );
}

function makeStyles(sc: SemanticTokens) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: sc.bgPrimary },
    center: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: sc.bgPrimary,
    },
    content: { padding: spacing.lg, gap: spacing.sm },
    retryBtn: {
      marginTop: spacing.md,
      minHeight: 44,
      paddingHorizontal: spacing.lg,
      justifyContent: 'center',
      borderRadius: 4,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
    },
    retryBtnText: { color: sc.textPrimary, fontSize: 14, fontWeight: '600' },
    list: {
      marginTop: spacing.md,
      gap: spacing.sm,
    },
    exerciseRow: {
      backgroundColor: sc.bgSurface,
      borderRadius: 12,
      padding: spacing.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
    },
    startBtn: {
      backgroundColor: sc.accent,
      borderRadius: 4,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
    startBtnText: {
      color: sc.bgPrimary,
      fontSize: 14,
      fontWeight: '600',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
    },
    completedBadge: {
      backgroundColor: sc.bgSurface,
      borderRadius: 4,
      paddingVertical: 12,
      alignItems: 'center',
      marginTop: spacing.lg,
    },
  });
}
