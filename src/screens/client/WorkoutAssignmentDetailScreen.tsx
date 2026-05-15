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
import HapticPressable from '../../components/HapticPressable';
import {
  RouteProp,
  useNavigation,
  useRoute,
  NavigationProp,
  ParamListBase,
} from '@react-navigation/native';
import { useMyWorkoutAssignment } from '../../hooks/useWorkoutBuilder';
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';
import {
  buildActiveWorkoutExercises,
  prettifyExerciseName,
} from '../../utils/workout/buildActiveWorkout';

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

  const handleStart = useCallback(() => {
    if (!data) return;
    const exercises = buildActiveWorkoutExercises(data.workout_plan);
    navigation.navigate('ActiveWorkout', {
      routineId: data.workout_plan.id,
      routineName: data.workout_plan.name,
      exercises: JSON.stringify(exercises),
    });
  }, [data, navigation]);

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={sc.accent} />
      </View>
    );
  }

  if (isError || !data) {
    return (
      <View style={styles.center}>
        <Text style={[typography.body, { color: sc.textMuted }]}>
          Could not load this workout. Pull to retry.
        </Text>
      </View>
    );
  }

  const plan = data.workout_plan;
  const sorted = [...plan.exercises].sort((a, b) => a.order - b.order);
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
        {plan.type}
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
              {ex.order}. {prettifyExerciseName(ex.exercise_external_id)}
            </Text>
            <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
              {ex.sets} sets × {ex.reps_or_duration_seconds} reps
              {ex.weight_lbs ? ` • ${ex.weight_lbs} lbs` : ''}
              {ex.rest_seconds ? ` • ${ex.rest_seconds}s rest` : ''}
            </Text>
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
          style={styles.startBtn}
          onPress={handleStart}
          accessibilityRole="button"
          accessibilityLabel={`Start workout ${plan.name}`}
        >
          <Text style={styles.startBtnText}>Start workout</Text>
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
