/**
 * WorkoutAssignmentDetailScreen — open a coach-assigned workout, review
 * the prescribed exercises, and start the live workout.
 *
 * Reads /assignments/:id, takes the assignment's own prescription (the
 * frozen snapshot when the server has one, K3FIX-SNAPSHOT), maps it into
 * the ActiveWorkout session shape, then
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
import { layout, radius, spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import {
  buildActiveWorkoutExercises,
  prettifyExerciseName,
} from '../../utils/workout/buildActiveWorkout';
import { assignmentPrescription } from '../../utils/workout/assignmentPrescription';
import { countWord } from '../../utils/workout/exerciseUnit';
import { blocksOf } from './train/TrainToday';
import { sectionHead, useCoachItalic, wsc } from './workouts/workoutStyleC';

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

  // K3FIX-SNAPSHOT: one prescription for the rows, names, header and Start:
  // the frozen snapshot when the server sends one, later live-plan edits
  // ignored, with coach-approved Roman sets (B-ROMANADJ-125) laid over it.
  const prescription = useMemo(() => (data ? assignmentPrescription(data) : null), [data]);

  // The plan stores only catalog ids (e.g. "0025" or "seed:push-001"). The
  // screen used to prettify the id, so a client saw "1. Exercise" or
  // "1. Push 001" instead of "Barbell Bench Press". Resolve the real names
  // from GET /exercises/:id; fall back to the prettified id while loading.
  const exerciseIds = useMemo(
    () => (prescription?.exercises ?? []).map((e) => e.exercise_external_id),
    [prescription],
  );
  // Start waits while the names are still loading: the session copies the
  // names at Start, so starting early used to freeze "Push 001" / "Exercise"
  // into the live workout and its saved history. A failed or offline
  // lookup does not block Start; it keeps the prettified fallback.
  const { names: exerciseNames, loading: namesLoading } = useExerciseNames(exerciseIds);
  // C1 v2 lettered blocks (C2_today): each row shows its block's letter; rows next to each other in one superset
  // share it (TrainDay's blocksOf). Rows stay one per exercise for their test ids and the tour's first row.
  const letters = useMemo(() => {
    const out = new Map<number, string>();
    blocksOf(prescription?.exercises ?? []).forEach((b) => b.rows.forEach((r) => out.set(r.order, b.letter)));
    return out;
  }, [prescription]);
  const italic = useCoachItalic();
  const nameFor = useCallback(
    (externalId: string) =>
      exerciseNames[externalId] || prettifyExerciseName(externalId) || 'Exercise',
    [exerciseNames],
  );

  const handleStart = useCallback(() => {
    if (!data || !prescription || namesLoading) return;
    const exercises = buildActiveWorkoutExercises({ exercises: prescription.exercises }).map((e) => ({
      ...e,
      // Saved with the workout, shown in history and to the coach.
      exerciseName: exerciseNames[e.exerciseId] || e.exerciseName,
    }));
    const params = {
      routineId: data.workout_plan.id,
      routineName: prescription.name,
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
  }, [data, navigation, exerciseNames, namesLoading, prescription]);

  if (isLoading) {
    return <SkeletonScreen count={5} />;
  }

  if (isError || !data || !prescription) {
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

  const plan = prescription;
  const sorted = prescription.exercises;
  const isCompleted = !!data.completed_at;
  const actionLabel = canResume ? 'Resume workout' : 'Start workout';

  // REDO-LIVE-133, restyled to C1 Style C v2 (STYLE-WORKOUTS-M, C2_today and C2_adjusted): overline, serif title,
  // lettered hairline rows, a coach-changed row on sage, and the one forest action pinned at the bottom.
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
        {plan.durationMinutes ? `About ${plan.durationMinutes} min · ` : ''}
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

      <View>
        <Overline style={[sectionHead(sc), styles.listOverline]}>Exercises</Overline>
        {sorted.map((ex, i) => {
          const changed = plan.adjustedOrders.has(ex.order);
          return (
          // TOUR-133: the tour's first-exercise beat spotlights the first row.
          // Keyed by `order`: frozen rows have no database id.
          <TutorialTarget key={ex.order} id={i === 0 ? 'first-exercise' : undefined}>
          <View style={[styles.exerciseRow, { borderBottomColor: sc.border }]} testID={`assignment-row-${ex.order}`}>
            {/* The block letter in the moss chip; decorative for screen readers, as the numeral was. */}
            <View style={[styles.letter, { borderColor: sc.data.moss }]}>
              <Text maxFontSizeMultiplier={1.15} style={[typography.h3, { color: sc.textPrimary }]} accessible={false} importantForAccessibility="no">
                {letters.get(ex.order) ?? ''}
              </Text>
            </View>
            <View style={[styles.exerciseText, changed && [styles.changed, { backgroundColor: sc.surface.sage, borderLeftColor: sc.data.forest }]]}>
              <Text style={[typography.h4, { color: sc.textPrimary }]}>
                {nameFor(ex.exercise_external_id)}
              </Text>
              <Text style={[typography.bodySmall, styles.tabular, { color: sc.textMuted }]}>
                {ex.sets} sets × {ex.reps_or_duration_seconds} {countWord(ex)}
                {ex.weight_lbs ? ` · ${ex.weight_lbs} lb` : ''}
                {ex.rest_seconds ? ` · ${ex.rest_seconds}s rest` : ''}
              </Text>
              {changed ? (
                <Text
                  style={[typography.bodySmall, styles.mark, { color: sc.accentText }]}
                  testID={`assignment-adjusted-${ex.order}`}
                >
                  Updated by your coach
                </Text>
              ) : null}
              {ex.notes ? (
                <Text style={[typography.h3, italic, styles.note, { color: sc.textPrimary }]}>
                  {ex.notes}
                </Text>
              ) : null}
            </View>
          </View>
          </TutorialTarget>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  retry: { marginTop: spacing.md },
  tabular: { fontVariant: ['tabular-nums'] },
  completed: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
  // "EXERCISES" is the eyebrow over the hairline above row A (C2_today rows 864-865); the rows follow the rule.
  listOverline: { marginBottom: 0 },
  // C2_today rows 866-1007: 12 pt above and below, chip and name top-aligned, 14 pt from chip to name.
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: wsc.letterGap,
    minHeight: layout.rowMinHeight,
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // C2_today cols 48-103: the 28 pt moss letter chip, 6 pt corners (TrainDay's chip, TrainToday.tsx:327).
  letter: {
    width: wsc.letterChip,
    height: wsc.letterChip,
    borderRadius: radius.control,
    borderWidth: wsc.letterLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exerciseText: { flex: 1, gap: 2 },
  // C2_adjusted cols 128-133, rows 1040-1203: sage, a 3 pt forest edge, 16 pt right corners, 4 pt from the rules.
  changed: {
    borderLeftWidth: wsc.changedEdge,
    borderTopRightRadius: radius.card,
    borderBottomRightRadius: radius.card,
    marginVertical: -spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  // The coach's mark and words as TrainDay draws them (TrainToday.tsx:322, :281, :313).
  mark: { fontFamily: 'Inter_600SemiBold' },
  note: { marginTop: spacing.xs },
});
