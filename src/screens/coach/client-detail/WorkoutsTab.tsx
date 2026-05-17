import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { ClientDetailStyles } from './styles';
import type { SessionExercise, WorkoutSession } from './types';

export function WorkoutsTab({
  workoutSessions,
  colors,
  styles,
}: {
  workoutSessions: WorkoutSession[];
  colors: ThemeColors;
  styles: ClientDetailStyles;
}) {
  const parseExercises = (json: string): SessionExercise[] => {
    try { return JSON.parse(json); } catch { return []; }
  };

  const formatDuration = (start: string, end?: string): string => {
    if (!end) return 'In progress';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const min = Math.round(ms / 60000);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
  };

  return (
    <>
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
          return (
            <View key={session.id} style={styles.sessionCard}>
              <View style={styles.sessionTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.sessionName}>{session.routineName}</Text>
                  <Text style={styles.sessionDate}>
                    {new Date(session.startTime).toLocaleDateString()} · {formatDuration(session.startTime, session.endTime || undefined)}
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
              {/* Exercise names */}
              <Text style={styles.sessionExercises} numberOfLines={2}>
                {exList.map((e) => e.exerciseName).join(' · ')}
              </Text>
            </View>
          );
        })
      )}
    </>
  );
}
