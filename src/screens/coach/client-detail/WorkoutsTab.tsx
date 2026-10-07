import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { ClientDetailStyles } from './styles';
import type { SessionExercise, WorkoutSession } from './types';
import { formatCoachSessionSets } from '../../../utils/workout/workoutLogging';
import { AdjustForClientEntry } from '../../../components/coach/ai-entry/AdjustForClient';

export function WorkoutsTab({
  workoutSessions,
  clientName,
  onBuildWithAi,
  onOpenClientCopy,
  colors,
  styles,
}: {
  workoutSessions: WorkoutSession[];
  /** AIB-6: "Build a program with AI" opens the existing per-client generator (AIWorkoutDraft review). */
  clientName?: string;
  onBuildWithAi?: () => void;
  /** AIB-FINISH-127 job 6: "Adjust a saved workout for <first name>" opens the client's copy in the builder with Ask AI. */
  onOpenClientCopy?: (planId: string) => void;
  colors: ThemeColors;
  styles: ClientDetailStyles;
}) {
  const parseExercises = (json: string): SessionExercise[] => {
    try { return JSON.parse(json); } catch { return []; }
  };

  // FU-WORKLOG2-126: a workout saved without a duration used to read
  // "0 min". The duration is shown only when the client's phone recorded it.
  const formatDuration = (session: WorkoutSession): string | null => {
    let min: number | null = null;
    if (typeof session.durationMinutes === 'number') {
      min = session.durationMinutes;
    } else if (session.durationMinutes === undefined && session.endTime) {
      min = Math.round((new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 60000);
    }
    if (min === null || !Number.isFinite(min) || min <= 0) return null;
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
  };

  const first = clientName?.trim().split(/\s+/)[0] || 'this client';
  return (
    <>
      {onBuildWithAi ? (
        <Pressable
          testID="workouts-build-with-ai"
          accessibilityRole="button"
          accessibilityLabel={`Build a program for ${first} with AI`}
          accessibilityHint="Opens the Coach AI program generator. Nothing reaches the client until you approve it."
          onPress={onBuildWithAi}
          style={[styles.emptyCard, { flexDirection: 'row', justifyContent: 'center', padding: 16, marginBottom: 12 }]}
        >
          <Ionicons name="sparkles-outline" size={20} color={colors.primary} />
          <Text style={[styles.emptyText, { color: colors.textPrimary, marginTop: 0 }]}>{`Build a program for ${first} with AI`}</Text>
        </Pressable>
      ) : null}
      {onOpenClientCopy ? <AdjustForClientEntry firstName={first} onOpened={onOpenClientCopy} /> : null}
      <Text style={styles.sectionTitle}>Recent Workouts</Text>
      {workoutSessions.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="barbell-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyText}>No workout sessions yet</Text>
        </View>
      ) : (
        workoutSessions.map((session) => {
          const exList = parseExercises(session.exercises);
          const totalSets = exList.reduce((s, e) => s + e.sets.length, 0);
          const completedSets = exList.reduce((s, e) => s + e.sets.filter((st) => st.completed).length, 0);
          const duration = formatDuration(session);
          return (
            <View key={session.id} style={styles.sessionCard}>
              <View style={styles.sessionTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sessionName}>{session.routineName}</Text>
                  <Text style={styles.sessionDate}>
                    {new Date(session.startTime).toLocaleDateString()}{duration ? ` · ${duration}` : ''}
                  </Text>
                </View>
                {session.completed ? (
                  <View style={styles.completedBadge}>
                    <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                    <Text style={styles.completedText}>Done</Text>
                  </View>
                ) : (
                  <Text style={styles.inProgressText}>In progress</Text>
                )}
              </View>
              {/* Exercise breakdown */}
              <View style={styles.sessionStats}>
                <View style={styles.sessionStat}>
                  <Text style={styles.sessionStatValue}>{exList.length}</Text>
                  <Text style={styles.sessionStatLabel}>Exercises</Text>
                </View>
                <View style={styles.sessionStat}>
                  <Text style={styles.sessionStatValue}>{completedSets}/{totalSets}</Text>
                  <Text style={styles.sessionStatLabel}>Sets</Text>
                </View>
                <View style={styles.sessionStat}>
                  <Text style={styles.sessionStatValue}>
                    {Math.round(exList.reduce((s, e) => s + e.sets.reduce((ss, st) => ss + (st.completed ? st.weight * st.reps : 0), 0), 0))}
                  </Text>
                  <Text style={styles.sessionStatLabel}>Volume (lbs)</Text>
                </View>
              </View>
              {/* FU-WORKLOG2-126: the coach used to see only counts and a
                  list of names. Each exercise now shows the weight and reps
                  of every set, and the notes the client wrote. */}
              {exList.map((e, i) => (
                <View key={`${e.exerciseId}-${i}`} style={{ marginTop: i === 0 ? 0 : 8 }} testID={`coach-session-${session.id}-exercise-${i}`}>
                  <Text style={[styles.sessionExercises, { color: colors.textPrimary }]}>{e.exerciseName}</Text>
                  <Text style={styles.sessionExercises}>{formatCoachSessionSets(e.sets)}</Text>
                  {e.notes ? (
                    <Text style={styles.sessionExercises}>Client note: {e.notes}</Text>
                  ) : null}
                </View>
              ))}
              {session.notes && session.notes !== session.routineName ? (
                <Text style={[styles.sessionExercises, { marginTop: 10 }]} testID={`coach-session-${session.id}-note`}>
                  Workout note: {session.notes}
                </Text>
              ) : null}
            </View>
          );
        })
      )}
    </>
  );
}
