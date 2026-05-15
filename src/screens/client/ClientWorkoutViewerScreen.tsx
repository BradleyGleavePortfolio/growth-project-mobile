/**
 * ClientWorkoutViewerScreen — list of the client's workout
 * assignments, with the next-up assignment surfaced prominently.
 *
 * Reads /assignments/me. Pure read; the "mark complete" mutation
 * lives on a future detail screen (out of Sprint B-2 scope).
 *
 * Empty state: an honest message when the coach has not assigned a
 * workout yet. No fabricated suggestions.
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
import { spacing, typography } from '../../theme/tokens';
import { useTheme } from '../../theme/ThemeProvider';
import type { SemanticTokens } from '../../theme/tokens';

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

  const upcoming = sorted.filter((a) => !a.completed_at);
  const completed = sorted.filter((a) => !!a.completed_at);

  const handleOpenAssignment = useCallback(
    (a: ClientWorkoutAssignmentWithPlan) => {
      navigation.navigate('WorkoutAssignmentDetail', { assignmentId: a.id });
    },
    [navigation],
  );

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
            Your coach has not assigned a workout yet. Once they do, the
            schedule will appear here.
          </Text>
        </View>
      ) : (
        <>
          {upcoming.length > 0 ? (
            <>
              <Text style={[typography.eyebrow, { color: sc.textMuted }]}>
                Upcoming
              </Text>
              {upcoming.map((a) => (
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
                  faded
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
  faded,
  onPress,
}: {
  a: ClientWorkoutAssignmentWithPlan;
  styles: Styles;
  sc: SemanticTokens;
  faded?: boolean;
  onPress: () => void;
}) {
  const plan = a.workout_plan;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        faded ? { opacity: 0.6 } : null,
        pressed ? { opacity: 0.85 } : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Open workout ${plan.name}`}
    >
      <View style={styles.headerRow}>
        <Text style={[typography.h3, { color: sc.textPrimary }]}>
          {plan.name}
        </Text>
        <Text style={[typography.bodySmall, { color: sc.accent }]}>
          {plan.type}
        </Text>
      </View>
      <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
        {formatScheduled(a.scheduled_for)}
        {plan.duration_estimate_minutes
          ? ` • about ${plan.duration_estimate_minutes} min`
          : ''}
        {' • '}
        {plan.exercises.length} exercise{plan.exercises.length === 1 ? '' : 's'}
      </Text>
      {a.post_rpe !== null ? (
        <Text style={[typography.bodySmall, { color: sc.textMuted }]}>
          Completed RPE {a.post_rpe}
        </Text>
      ) : null}
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
    content: { padding: spacing.lg, gap: spacing.sm },
    card: {
      backgroundColor: sc.bgSurface,
      borderRadius: 12,
      padding: spacing.lg,
      gap: spacing.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
    },
    headerRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'baseline',
    },
  });
}
