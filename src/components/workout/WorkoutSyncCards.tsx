/**
 * WORKOUT-SYNC-124 (agent 124): two small cards at the top of the Workouts
 * tab.
 *
 *   - "Workout in progress": the app was closed or killed mid-workout. The
 *     saved session used to be reachable only by starting some workout and
 *     answering a "Resume?" prompt, so a client reopening the app saw no sign
 *     of the sets already logged. Tapping Resume reopens the same workout
 *     (same name, same coach assignment) with every logged set.
 *   - "Waiting to send": workouts finished without signal. They are stored
 *     on the phone and sent automatically; the row says so and disappears
 *     once they are on the server.
 *
 * TRAIN-TAB-FIN-130: hairline rows instead of cream boxes with a forest
 * border, and the queued line no longer names a coach the client may not
 * have (a coachless client's workouts go to the client's own history).
 *
 * Every focus of the tab also sends queued workouts (a cold start online has
 * no reconnect event to do it).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useFocusEffect,
  useNavigation,
  NavigationProp,
  ParamListBase,
} from '@react-navigation/native';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/ThemeProvider';
import { typography, type SemanticTokens } from '../../theme/tokens';
import { QuietOverline } from '../../ui/sections/QuietSection';
import {
  loadActiveWorkoutSession,
  type PersistedActiveWorkoutSession,
} from '../../storage/activeWorkoutSession';
import {
  countQueuedWorkouts,
  pushQueuedWorkouts,
  workoutSyncEvents,
} from '../../offline';

export function useWorkoutSyncState(
  userId: string | undefined,
  onSynced?: () => void,
) {
  const [session, setSession] = useState<PersistedActiveWorkoutSession | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);

  const refresh = useCallback(async () => {
    if (!userId) return;
    try {
      const result = await loadActiveWorkoutSession(userId);
      setSession(result ? result.session : null);
    } catch {
      setSession(null);
    }
    try {
      await pushQueuedWorkouts();
    } catch {
      // Stays queued; the next focus or reconnect tries again.
    }
    try {
      setQueuedCount(await countQueuedWorkouts(userId));
    } catch {
      setQueuedCount(0);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
      return undefined;
    }, [refresh]),
  );

  useEffect(() => {
    const handler = () => {
      if (!userId) return;
      countQueuedWorkouts(userId)
        .then(setQueuedCount)
        .catch(() => undefined);
      onSynced?.();
    };
    workoutSyncEvents.on('synced', handler);
    return () => {
      workoutSyncEvents.off('synced', handler);
    };
  }, [userId, onSynced]);

  return { session, queuedCount, refresh };
}

function startedAgo(startedAtMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.round((nowMs - startedAtMs) / 60000));
  if (minutes < 1) return 'Started just now';
  if (minutes < 60) return `Started ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `Started ${hours} h ${minutes % 60} min ago`;
}

export function resumeParams(session: PersistedActiveWorkoutSession) {
  return {
    routineName: session.routineName || 'Workout',
    exercises: session.exercisesJson || '[]',
    ...(session.assignmentId ? { assignmentId: session.assignmentId } : {}),
    resume: true,
  };
}

export default function WorkoutSyncCards({
  userId,
  onSynced,
}: {
  userId: string | undefined;
  onSynced?: () => void;
}) {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const { session, queuedCount } = useWorkoutSyncState(userId, onSynced);

  const loggedSets = session
    ? session.sessionExercises.reduce(
        (sum, ex) => sum + ex.sets.filter((s) => s.completed).length,
        0,
      )
    : 0;

  return (
    <>
      {session ? (
        <HapticPressable
          intent="medium"
          onPress={() => navigation.navigate('ActiveWorkout', resumeParams(session))}
          accessibilityRole="button"
          accessibilityLabel={`Resume workout: ${session.routineName || 'Workout'}`}
          style={styles.card}
          testID="workout-resume-card"
        >
          <View style={{ flex: 1 }}>
            <QuietOverline>Workout in progress</QuietOverline>
            <Text style={styles.title}>{session.routineName || 'Workout'}</Text>
            <Text style={styles.detail}>
              {`${startedAgo(session.startedAtMs, Date.now())} · ${loggedSets} ${
                loggedSets === 1 ? 'set' : 'sets'
              } logged`}
            </Text>
          </View>
          <Text style={styles.action}>Resume</Text>
          <Ionicons name="chevron-forward" size={18} color={sc.textMuted} />
        </HapticPressable>
      ) : null}
      {queuedCount > 0 ? (
        <View
          style={styles.card}
          accessibilityRole="text"
          testID="workout-queued-notice"
        >
          <Ionicons name="cloud-upload-outline" size={20} color={sc.textMuted} />
          <Text style={styles.notice}>
            {queuedCount === 1
              ? '1 workout is saved on this phone and will be sent once the phone is back online.'
              : `${queuedCount} workouts are saved on this phone and will be sent once the phone is back online.`}
          </Text>
        </View>
      ) : null}
    </>
  );
}

const makeStyles = (sc: SemanticTokens) =>
  StyleSheet.create({
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: 24,
      marginBottom: 24,
      minHeight: 56,
      paddingVertical: 14,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: sc.border,
      gap: 12,
    },
    title: {
      ...typography.h4,
      color: sc.textPrimary,
    },
    detail: {
      ...typography.bodySmall,
      fontSize: 13,
      color: sc.textMuted,
      marginTop: 2,
      fontVariant: ['tabular-nums'],
    },
    action: {
      ...typography.bodyMd,
      color: sc.accentText,
    },
    notice: {
      ...typography.bodySmall,
      flex: 1,
      fontSize: 13,
      color: sc.textMuted,
    },
  });
