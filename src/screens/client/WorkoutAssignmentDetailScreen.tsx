/**
 * WorkoutAssignmentDetailScreen — open a coach-assigned workout, review
 * the prescribed exercises, and start the live workout.
 *
 * Reads /assignments/:id (which includes the full WorkoutPlan), maps
 * the prescribed exercises into the ActiveWorkout session shape, then
 * navigates to ActiveWorkout. exercise_external_id is preserved so the
 * downstream write is not corrupted with empty ids.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SkeletonScreen } from '../../ui/skeletons/Skeleton';
import { Headline, Lede, Overline, PrimaryButton, QuietTextButton, Screen } from '../../ui';
import TutorialTarget from '../../components/tutorial/TutorialTarget';
import {
  RouteProp,
  useNavigation,
  useRoute,
  NavigationProp,
  ParamListBase,
} from '@react-navigation/native';
import { useMyWorkoutAssignment } from '../../hooks/useWorkoutBuilder';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { loadActiveWorkoutSession } from '../../storage/activeWorkoutSession';
import { useExerciseNames } from '../../hooks/useExerciseNames';
import { formatPlanType } from '../../utils/workout/formatPlanType';
import { layout, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
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
  const route =
    useRoute<RouteProp<RouteParams, 'WorkoutAssignmentDetail'>>();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { assignmentId } = route.params;
  const { data, isLoading, isError, refetch, isRefetching } =
    useMyWorkoutAssignment(assignmentId);
  const userId = useCurrentUser()?.id;
  const [canResume, setCanResume] = useState(false);

  // Read the existing session on entry and when returning from the live workout.
  // This changes the label only; ActiveWorkout still owns resume and persistence.
  useEffect(() => {
    let cancelled = false;
    const checkResume = async () => {
      setCanResume(false);
      if (!userId) return;
      try {
        const saved = await loadActiveWorkoutSession(userId);
        if (!cancelled) {
          setCanResume(saved?.session.assignmentId === assignmentId);
        }
      } catch {
        if (!cancelled) setCanResume(false);
      }
    };
    void checkResume();
    const unsubscribe = navigation.addListener?.('focus', () => { void checkResume(); });
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [navigation, userId, assignmentId]);

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
    // This screen lives in MoreStack; `ActiveWorkout` lives in WorkoutStack.
    // MoreStack's parent is the client tab navigator (ClientNavigator renders
    // the tabs directly under the NavigationContainer, with no root stack), so
    // one getParent() reaches the tabs. The old two-level lookup was always
    // undefined in the app, and the MoreStack fallback below is silently dropped
    // by React Navigation in production, so Start did nothing.
    const tabNav = navigation.getParent();
    if (tabNav) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (tabNav as any).navigate('WorkoutTab', {
        screen: 'ActiveWorkout',
        initial: false,
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
      <Screen edges={['top']} scroll={false} centerContent>
        <Headline level="h2">This workout did not load.</Headline>
        <Lede>Check the connection, then try again.</Lede>
        <QuietTextButton
          label={isRefetching ? 'Loading' : 'Try again'}
          onPress={onRefresh}
          disabled={isRefetching}
          accessibilityHint="Loads the workout again"
          testID="assignment-retry"
          style={styles.retry}
        />
      </Screen>
    );
  }

  const plan = data.workout_plan;
  const sorted = [...overlay.exercises].sort((a, b) => a.order - b.order);
  const isCompleted = !!data.completed_at;
  const actionLabel = canResume ? 'Resume workout' : 'Start workout';

  // REDO-LIVE-133 (reference: clientfile-workouts): overline, serif title,
  // numbered hairline rows, and the one forest action pinned at the bottom.
  return (
    <Screen
      edges={['top']}
      keyboardAware={false}
      testID="assignment-detail"
      refreshControl={
        <RefreshControl
          refreshing={isRefetching}
          onRefresh={onRefresh}
          tintColor={sc.accent}
        />
      }
      footer={
        isCompleted ? undefined : (
          <PrimaryButton
            label={namesLoading ? 'Loading exercise names' : actionLabel}
            onPress={handleStart}
            loading={namesLoading}
            accessibilityHint={`Opens ${plan.name} as a live workout`}
            testID="assignment-start"
          />
        )
      }
    >
      <Overline>{formatPlanType(plan.type)}</Overline>
      <Headline level="h1">{plan.name}</Headline>
      <Lede size="small" style={styles.tabular}>
        {plan.duration_estimate_minutes
          ? `About ${plan.duration_estimate_minutes} min · `
          : ''}
        {sorted.length} exercise{sorted.length === 1 ? '' : 's'}
      </Lede>
      {isCompleted ? (
        <View style={styles.completed}>
          <Ionicons name="checkmark-circle-outline" size={18} color={sc.textMuted} />
          <Text style={[typography.bodySmall, styles.tabular, { color: sc.textMuted }]}>
            Completed{data.post_rpe ? ` · RPE ${data.post_rpe}` : ''}
          </Text>
        </View>
      ) : null}

      <View style={[styles.list, { borderTopColor: sc.border }]}>
        <Overline style={styles.listOverline}>Exercises</Overline>
        {sorted.map((ex, i) => (
          // TOUR-133: the tour's first-exercise beat spotlights the first row.
          <TutorialTarget key={ex.id} id={i === 0 ? 'first-exercise' : undefined}>
          <View style={[styles.exerciseRow, { borderBottomColor: sc.border }]} testID={`assignment-row-${ex.order}`}>
            <Text style={[styles.index, { color: sc.textMuted }]} accessible={false} importantForAccessibility="no">
              {ex.order}
            </Text>
            <View style={styles.exerciseText}>
              <Text style={[typography.h3, { color: sc.textPrimary }]}>
                {nameFor(ex.exercise_external_id)}
              </Text>
              <Text style={[typography.bodySmall, styles.tabular, { color: sc.textMuted }]}>
                {ex.sets} sets × {ex.reps_or_duration_seconds} reps
                {ex.weight_lbs ? ` · ${ex.weight_lbs} lb` : ''}
                {ex.rest_seconds ? ` · ${ex.rest_seconds}s rest` : ''}
              </Text>
              {overlay.adjustedOrders.has(ex.order) ? (
                <Text
                  style={[typography.bodySmall, { color: sc.accentText, marginTop: 2 }]}
                  testID={`assignment-adjusted-${ex.order}`}
                >
                  Updated by your coach
                </Text>
              ) : null}
              {ex.notes ? (
                <Text style={[typography.bodySmall, { color: sc.textMuted, marginTop: 2 }]}>
                  {ex.notes}
                </Text>
              ) : null}
            </View>
          </View>
          </TutorialTarget>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  retry: { marginTop: spacing.md },
  tabular: { fontVariant: ['tabular-nums'] },
  completed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  list: { marginTop: spacing.xl, paddingTop: layout.sectionPadY, borderTopWidth: StyleSheet.hairlineWidth },
  listOverline: { marginBottom: spacing.xs },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    minHeight: layout.rowMinHeight,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Serif tabular index, as in the reference's numbered rows; decorative for screen readers.
  index: { ...typography.h3, fontVariant: ['tabular-nums'], minWidth: 18 },
  exerciseText: { flex: 1, gap: 2 },
});
