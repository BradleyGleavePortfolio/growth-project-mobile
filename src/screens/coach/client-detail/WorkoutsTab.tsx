import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme, type ThemeColors } from '../../../theme/ThemeProvider';
import type { ClientDetailStyles } from './styles';
import type { SessionExercise, WorkoutSession } from './types';
import { formatCoachSessionSets } from '../../../utils/workout/workoutLogging';
import { AdjustForClientEntry } from '../../../components/coach/ai-entry/AdjustForClient';
import { spacing, typography } from '../../../theme/tokens';

export function WorkoutsTab({
  workoutSessions,
  clientName,
  onBuildWithAi,
  onOpenClientCopy,
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
  const { semanticColors: sc } = useTheme();
  const parseExercises = (json: string): (SessionExercise & { rpe?: number | null })[] => {
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
  const body = { ...typography.bodySmall, color: sc.textMuted };
  const meta = { ...body, fontSize: 13, lineHeight: 20 };
  const heading = { ...typography.h2, color: sc.textPrimary, fontVariant: ['tabular-nums' as const] };
  const rule = { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: sc.border };
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(now.getDate() - (now.getDay() + 6) % 7);
  // This input is workout history, not an assignment ledger. No target or missed days are inferred.
  const weeklyCount = workoutSessions.filter((s) => s.completed && new Date(s.startTime) >= weekStart && new Date(s.startTime) <= now).length;
  const trajectories = new Map<string, { date: string; weight: number }[]>();
  workoutSessions.filter((s) => s.completed).forEach((s) => parseExercises(s.exercises).forEach((e) => {
    const weight = Math.max(0, ...e.sets.filter((set) => set.completed).map((set) => set.weight));
    if (weight > 0) trajectories.set(e.exerciseName, [...(trajectories.get(e.exerciseName) ?? []), { date: s.startTime, weight }]);
  }));
  const strength = [...trajectories.entries()].find(([, points]) => points.length >= 2);
  const points = strength?.[1].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()) ?? [];
  const low = Math.min(...points.map((p) => p.weight));
  const high = Math.max(...points.map((p) => p.weight));
  return (
    <>
      <View style={[rule, { paddingBottom: spacing.xl, marginBottom: spacing.xl }]}>
        <Text style={[meta, { letterSpacing: 1, marginBottom: spacing.sm }]}>THIS WEEK</Text>
        <Text accessibilityRole="header" style={heading}>{`${weeklyCount} shared ${weeklyCount === 1 ? 'workout' : 'workouts'} this week`}</Text>
      </View>
      {onBuildWithAi ? (
        <Pressable
          testID="workouts-build-with-ai"
          accessibilityRole="button"
          accessibilityLabel={`Build a program for ${first} with AI`}
          accessibilityHint="Opens the Coach AI program generator. Nothing reaches the client until you approve it."
          onPress={onBuildWithAi}
          style={{ alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: 4, padding: spacing.lg, backgroundColor: sc.accent, marginBottom: spacing.md }}
        >
          <Text style={[typography.bodyMd, { color: sc.textOnAccent, textAlign: 'center' }]}>{`Build a program for ${first} with AI`}</Text>
        </Pressable>
      ) : null}
      {onOpenClientCopy ? <AdjustForClientEntry firstName={first} onOpened={onOpenClientCopy} /> : null}
      <Text style={[heading, { marginTop: spacing.lg }]}>Recent workouts</Text>
      {workoutSessions.length === 0 ? (
        <View style={[rule, { paddingVertical: spacing.xl }]}>
          <Text style={body}>No shared workout sessions to show</Text>
        </View>
      ) : (
        workoutSessions.map((session) => {
          const exList = parseExercises(session.exercises);
          const totalSets = exList.reduce((s, e) => s + e.sets.length, 0);
          const completedSets = exList.reduce((s, e) => s + e.sets.filter((st) => st.completed).length, 0);
          const duration = formatDuration(session);
          return (
            <View key={session.id} testID={`coach-session-${session.id}`} style={[rule, { backgroundColor: sc.bgPrimary, paddingVertical: spacing.xl }]}>
              <View style={styles.sessionTop}>
                <Ionicons name={session.completed ? 'checkmark-circle-outline' : 'ellipse-outline'} size={24} color={session.completed ? sc.accentText : sc.textMuted} style={{ marginRight: spacing.md }} />
                <View style={{ flex: 1 }}>
                  <Text style={heading}>{session.routineName}</Text>
                  <Text style={meta}>
                    {new Date(session.startTime).toLocaleDateString()}{duration ? ` · ${duration}` : ''}
                  </Text>
                </View>
                {session.completed ? (
                  <Text style={meta}>Done</Text>
                ) : (
                  <Text style={meta}>In progress</Text>
                )}
              </View>
              {/* Exercise breakdown */}
              <View style={styles.sessionStats}>
                <View style={styles.sessionStat}>
                  <Text style={heading}>{exList.length}</Text>
                  <Text style={meta}>Exercises</Text>
                </View>
                <View style={styles.sessionStat}>
                  <Text style={heading}>{completedSets}/{totalSets}</Text>
                  <Text style={meta}>Sets</Text>
                </View>
                <View style={styles.sessionStat}>
                  <Text style={heading}>
                    {Math.round(exList.reduce((s, e) => s + e.sets.reduce((ss, st) => ss + (st.completed ? st.weight * st.reps : 0), 0), 0))}
                  </Text>
                  <Text style={meta}>Volume (lb)</Text>
                </View>
              </View>
              {/* FU-WORKLOG2-126: the coach used to see only counts and a
                  list of names. Each exercise now shows the weight and reps
                  of every set, and the notes the client wrote. */}
              {exList.map((e, i) => (
                <View key={`${e.exerciseId}-${i}`} style={{ marginTop: i === 0 ? 0 : 8 }} testID={`coach-session-${session.id}-exercise-${i}`}>
                  <Text style={[body, { color: sc.textPrimary }]}>{e.exerciseName}</Text>
                  <Text style={body}>{formatCoachSessionSets(e.sets)}</Text>
                  {typeof e.rpe === 'number' ? <Text style={meta}>{`RPE ${e.rpe}`}</Text> : null}
                  {e.notes ? (
                    <Text style={body}>Client note: {e.notes}</Text>
                  ) : null}
                </View>
              ))}
              {session.notes && session.notes !== session.routineName ? (
                <Text style={[body, { marginTop: spacing.md }]} testID={`coach-session-${session.id}-note`}>
                  Workout note: {session.notes}
                </Text>
              ) : null}
            </View>
          );
        })
      )}
      {strength ? (
        <View testID="coach-strength-trajectory" style={{ paddingTop: spacing.xl }}>
          <Text style={heading}>Strength trajectory</Text>
          <Text style={meta}>{`${strength[0]} · top recorded load (lb)`}</Text>
          <View accessible accessibilityRole="image" accessibilityLabel={points.map((p) => `${new Date(p.date).toLocaleDateString()}: ${p.weight} lb`).join(', ')}>
            <Svg height={80} width="100%" viewBox="0 0 300 80">
              <Polyline fill="none" stroke={sc.accent} strokeWidth={2} points={points.map((p, i) => `${8 + i * 284 / (points.length - 1)},${68 - (p.weight - low) * 56 / (high - low || 1)}`).join(' ')} />
            </Svg>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <Text style={meta}>{`${new Date(points[0].date).toLocaleDateString()} · ${points[0].weight} lb`}</Text>
            <Text style={meta}>{`${new Date(points[points.length - 1].date).toLocaleDateString()} · ${points[points.length - 1].weight} lb`}</Text>
          </View>
        </View>
      ) : null}
    </>
  );
}
