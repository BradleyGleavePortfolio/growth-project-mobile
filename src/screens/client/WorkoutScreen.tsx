import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Dimensions,
  ActivityIndicator,
  Alert,
  AppState,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import {
  useNavigation,
  useRoute,
  useFocusEffect,
  NavigationProp,
  RouteProp,
} from '@react-navigation/native';
import type { WorkoutStackParamList } from '../../navigation/ClientNavigator';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { useCoachlessClient } from '../../hooks/useCoachlessClient';

import { workoutApi } from '../../services/api';
import {
  formatLoggedSets,
  routineToSessionExercises,
  type ApiRoutine,
} from '../../utils/workout/workoutLogging';
import { logger } from '../../utils/logger';
import { buildCompletionLogBase, normalizeError } from './_completionLogging';
import FadeInView from '../../components/FadeInView';
import { useTheme } from '../../theme/ThemeProvider';
import { typography, radius, type SemanticTokens } from '../../theme/tokens';
import { Screen } from '../../ui';
import { QuietOverline } from '../../ui/sections/QuietSection';
import QuietBar from '../../ui/progress/QuietBar';
import CoachErrorState from '../../components/community/coach/CoachErrorState';
import { EmptyStateNoWorkouts, EmptyStateNoData } from '../../ui/empty-states';
// W-3: client needs an entry point to coach-assigned workouts. The
// ClientWorkoutViewer + WorkoutAssignmentDetail screens have been
// registered in MoreStack for a while but no UI surfaced a navigate call,
// so this build hid them from the user entirely.
import { useMyWorkoutAssignments } from '../../hooks/useWorkoutBuilder';
// Clinic tutorial (C08): pinned plan explanation card; flag-gated, renders
// nothing unless featureFlags.clientTutorial and a program exists.
import PlanExplanationCard from '../../components/tutorial/PlanExplanationCard';
import WorkoutSyncCards from '../../components/workout/WorkoutSyncCards';
import { featureFlags } from '../../config/featureFlags';
// §2.8 Workout complete — Roman speaks beside his face (the card co-locates
// <RomanAvatar />). Gated behind featureFlags.romanChat (default OFF), the
// dedicated Roman flag. TRAIN-TAB-FIN-130: a load failure shows CoachErrorState
// (Roman's neutral face, a true line, Try again). The §2.10 banner said retries
// had run and failed, but nothing retries this load (services/api.ts retries
// only 401s).
import RomanWorkoutCompleteCard from '../../components/roman/RomanWorkoutCompleteCard';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 48;

interface WeeklyVolume {
  week: string;
  volume: number;
}

interface MuscleVolume {
  muscle: string;
  volume: number;
}

// ── Pure-RN Bar Chart ─────────────────────────────────────────────────────

function BarChart({ data }: { data: WeeklyVolume[] }) {
  const { semanticColors: sc } = useTheme();
  const chart = useMemo(() => makeChart(sc), [sc]);
  if (!data.length) return null;
  const maxVol = Math.max(...data.map((d) => d.volume), 1);
  const BAR_HEIGHT = 160;
  const BAR_WIDTH = Math.min(28, (CHART_WIDTH - 32) / data.length - 6);

  return (
    <View style={chart.container}>
      {/* Y-axis labels */}
      <View style={chart.yAxis}>
        {[1, 0.5, 0].map((f, i) => (
          <Text key={i} style={chart.yLabel}>
            {f === 0 ? '0' : `${Math.round((maxVol * f) / 1000)}k`}
          </Text>
        ))}
      </View>
      {/* Bars */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
        <View style={[chart.barsContainer, { height: BAR_HEIGHT }]}>
          {data.map((d, i) => {
            const heightPct = maxVol > 0 ? d.volume / maxVol : 0;
            const barH = Math.max(4, heightPct * (BAR_HEIGHT - 24));
            return (
              <View key={i} style={[chart.barWrapper, { width: BAR_WIDTH + 8 }]}>
                <Text style={chart.barLabel}>
                  {d.volume > 0 ? (d.volume >= 1000 ? `${(d.volume / 1000).toFixed(1)}k` : d.volume.toString()) : ''}
                </Text>
                <View style={chart.barTrack}>
                  <View
                    style={[
                      chart.bar,
                      {
                        width: BAR_WIDTH,
                        height: barH,
                        backgroundColor: i === data.length - 1 ? sc.accent : sc.textMuted,
                      },
                    ]}
                  />
                </View>
                <Text style={chart.weekLabel}>{d.week}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// ── Muscle Progress Bars ──────────────────────────────────────────────────

function MuscleBreakdown({ data }: { data: MuscleVolume[] }) {
  if (!data.length) return null;
  const maxVol = Math.max(...data.map((d) => d.volume), 1);
  const MUSCLES_DISPLAY = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'];

  const displayData = MUSCLES_DISPLAY.map((m) => {
    const found = data.find((d) => d.muscle.toLowerCase().includes(m) || m.includes(d.muscle.toLowerCase()));
    return { muscle: m.charAt(0).toUpperCase() + m.slice(1), volume: found?.volume || 0 };
  });

  // TRAIN-TAB-FIN-130: the shared QuietBar row (13 pt tabular label and value).
  return (
    <View style={{ gap: 12, marginTop: 12 }}>
      {displayData.map((item) => (
        <QuietBar
          key={item.muscle}
          label={item.muscle}
          value={item.volume > 0 ? `${item.volume.toLocaleString()} lb` : '–'}
          current={item.volume}
          target={maxVol}
        />
      ))}
    </View>
  );
}

/** TRAIN-TAB-FIN-130: a hairline row for an action that is not the screen's one forest action. */
function QuietRow({ title, meta, label, onPress, testID, styles, iconColor }: {
  title: string;
  meta: string;
  label: string;
  onPress: () => void;
  testID?: string;
  styles: ReturnType<typeof makeStyles>;
  iconColor: string;
}) {
  return (
    <HapticPressable intent="light" onPress={onPress} accessibilityRole="button" accessibilityLabel={label} testID={testID} style={styles.quietRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.routineName}>{title}</Text>
        <Text style={styles.routineExCount}>{meta}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={iconColor} />
    </HapticPressable>
  );
}

interface ApiSession {
  id: string;
  date: string;
  workout_name?: string;
  duration_minutes: number;
  notes: string;
  exercises: Array<{ muscle_group: string; exercise_name: string; sets_completed: number; weight_per_set: number[]; reps_per_set: number[]; notes?: string | null }>;
}

/**
 * Prefix for the durable "this completion has been acknowledged" latch keys in
 * AsyncStorage. The full key is
 * `roman.p3.completion-consumed:${coachUserId||userId}:${justCompletedId}` —
 * scoped by the acting user so two accounts on one device never share latches,
 * and by the concrete workout id so each distinct completion is judged on its
 * own (P1-C-01).
 */
export const ROMAN_COMPLETION_CONSUMED_PREFIX = 'roman.p3.completion-consumed:';

/** Build the durable latch key for a given user + completion id. */
export function romanCompletionConsumedKey(
  userKey: string,
  justCompletedId: string,
): string {
  return `${ROMAN_COMPLETION_CONSUMED_PREFIX}${userKey}:${justCompletedId}`;
}

/**
 * §2.8 one-shot consumption of the `justCompletedId` navigation param.
 *
 * Returns whether Roman's §2.8 "Workout complete" card should show for the
 * CURRENT focus session. ActiveWorkoutScreen sets `route.params.justCompletedId`
 * to the DURABLE server id of the workout just saved, only after a real
 * finish-workout save.
 *
 * The one-shot is keyed on that concrete id and latched in AsyncStorage rather
 * than on a transient boolean (P1-C-01). On focus, if an id is present AND it
 * has not already been recorded under
 * `roman.p3.completion-consumed:${userKey}:${id}`, we flip the local flag,
 * persist the latch, and clear the param. If the id is already latched — e.g.
 * the same param is re-delivered after a remount, a back-then-forward, or a
 * param that survived a process reload — the card does NOT show again. The
 * focus-effect cleanup (on blur) clears the local flag so a refocus without a
 * NEW id leaves the card hidden; a genuinely new completion (a new id) is
 * always honoured.
 *
 * `userKey` is `coachUserId || userId` — the acting user, used to scope latches
 * per account on a shared device. When it is missing (user not yet loaded) the
 * hook holds off rather than write an unscoped latch.
 *
 * `enabled` gates the ENTIRE one-shot. It is the P3 master flag
 * (`featureFlags.romanChat`). When it is false the hook is a true no-op: it
 * never reads AsyncStorage, never writes the `roman.p3.completion-consumed:*`
 * latch, and never clears the nav param — preserving exact pre-P3 behaviour
 * (R11 D-001). Gating only the card render is insufficient: the producer and
 * consumer of the completion signal must both be inert when Roman is off.
 *
 * Extracted and exported so the one-shot behaviour is the single source of
 * truth, exercised directly by romanP3HostWiring.test.tsx without mounting the
 * full chart/sqlite-heavy screen.
 *
 * `logContext` carries the acting-user diagnostics (role, assignment if any)
 * for the completion-path warn sites. The hook composes it with the shared
 * `buildCompletionLogBase` so the consumer latch-write / latch-read warnings
 * log the SAME structured base (route, userRole, userKey, assignmentId,
 * justCompletedId) as the ActiveWorkout producer, plus a per-call `checkpoint`
 * and a normalised `error`. Without it a latch failure cannot be segmented by
 * route/user the way the producer failures can.
 */
export function useJustCompletedOneShot(
  justCompletedId: string | undefined,
  userKey: string | undefined,
  clearParam: () => void,
  enabled: boolean,
  logContext?: { userRole?: string; assignmentId?: string },
): boolean {
  const [justCompleted, setJustCompleted] = useState(false);
  // The completion id currently being decided/celebrated for this focus
  // session. Clearing the nav param re-renders the host and flips the
  // `justCompletedId` arg to undefined, which is a dep of this effect and so
  // re-runs it WHILE STILL FOCUSED (the react-navigation contract: a dep change
  // tears the effect down and immediately re-runs it). That self-triggered
  // teardown — and any other re-render that lands before the latch read
  // resolves — must NOT invalidate the in-flight decision. The previous
  // implementation cleared the param synchronously and gated the resolved read
  // on a run-local `cancelled` boolean, so the teardown set `cancelled = true`
  // before the read resolved and the card never appeared for a real completion
  // (the P1-CODE-01 race). Keying the resolved read on this ref instead lets the
  // decision commit as long as the same id is still the one in flight.
  const consumedIdRef = useRef<string | undefined>(undefined);
  useFocusEffect(
    useCallback(() => {
      // R11 D-001: with the P3 master flag off, the one-shot is fully inert —
      // no AsyncStorage read, no latch write, no param clear, no state change.
      // This is the consumer half of the producer/consumer gating that keeps
      // flag-off behaviour byte-identical to pre-P3.
      if (!enabled) return undefined;
      if (justCompletedId && userKey) {
        // Record the id being processed BEFORE any async work so a re-render —
        // including the one clearParam() will cause below — cannot orphan this
        // decision.
        consumedIdRef.current = justCompletedId;
        const key = romanCompletionConsumedKey(userKey, justCompletedId);
        // Read the durable latch first: only fire the card if THIS id has not
        // been acknowledged before.
        AsyncStorage.getItem(key)
          .then((seen) => {
            // Commit only while this id is still the active completion. A
            // genuine blur or a newer completion replaces consumedIdRef; the
            // param-clear re-render does not, so a real completion survives.
            if (consumedIdRef.current !== justCompletedId) return;
            if (seen == null) {
              setJustCompleted(true);
              // Persist the latch so this exact completion is never celebrated
              // twice, even across a remount or process reload. Best-effort:
              // if the write fails the card still shows this once; surfaced for
              // diagnosis rather than swallowed.
              AsyncStorage.setItem(key, new Date().toISOString()).catch((error: unknown) => {
                logger.warn('mwb.completion.latch-write', {
                  ...buildCompletionLogBase({
                    route: 'Workout',
                    userRole: logContext?.userRole,
                    userKey,
                    assignmentId: logContext?.assignmentId,
                    justCompletedId,
                  }),
                  checkpoint: 'completion-latch-write',
                  error: normalizeError(error),
                });
              });
            }
            // Clear the nav param only AFTER the latch read resolved and the
            // state transition committed (P1-CODE-01). A stale/duplicate param
            // can no longer linger and re-fire, and the re-render this triggers
            // can no longer race ahead of — and kill — the decision.
            clearParam();
          })
          .catch((error: unknown) => {
            // If the latch READ fails we cannot prove the id is unseen, so we
            // deliberately do NOT show the card — favouring "never double-fire"
            // over "never miss one". Surfaced for diagnosis. Still clear the
            // param so an unreadable latch does not leave a sticky signal.
            logger.warn('mwb.completion.latch-read', {
              ...buildCompletionLogBase({
                route: 'Workout',
                userRole: logContext?.userRole,
                userKey,
                assignmentId: logContext?.assignmentId,
                justCompletedId,
              }),
              checkpoint: 'completion-latch-read',
              error: normalizeError(error),
            });
            if (consumedIdRef.current === justCompletedId) clearParam();
          });
      }
      return () => {
        // This cleanup runs on a genuine blur AND on the param-clear re-render
        // this effect triggers while focused. Only end the one-shot for a run
        // that had nothing in flight — i.e. a focus run with no completion id
        // (the param already cleared, or a true blur landing on the idle run).
        // The run that actually consumed an id leaves the card committed so the
        // param-clear teardown cannot undo it; a later blur lands on the idle
        // (id-less) run and resets cleanly, keeping the §2.8 card hidden on a
        // refocus with no new completion.
        if (!justCompletedId || !userKey) {
          consumedIdRef.current = undefined;
          setJustCompleted(false);
        }
      };
    }, [enabled, justCompletedId, userKey, clearParam, logContext?.userRole, logContext?.assignmentId]),
  );
  return justCompleted;
}

export default function WorkoutScreen() {
  const { semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(sc), [sc]);
  const currentUser = useCurrentUser();
  // B22/B29: coach guidelines are package-only on the server, so a client
  // with no coach gets no button that only opens a coach gate.
  const coachless = useCoachlessClient();
  const navigation = useNavigation<NavigationProp<WorkoutStackParamList>>();
  const route = useRoute<RouteProp<WorkoutStackParamList, 'WorkoutMain'>>();
  const [routines, setRoutines] = useState<ApiRoutine[]>([]);
  const [recentSessions, setRecentSessions] = useState<ApiSession[]>([]);
  const [weeklyVolume, setWeeklyVolume] = useState<WeeklyVolume[]>([]);
  const [muscleVolume, setMuscleVolume] = useState<MuscleVolume[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [retrying, setRetrying] = useState(false);
  // FU-WORKLOG-126: workouts in the last 7 days, counted from the 50-workout
  // window the chart reads. The "This Week" tile used to count only the 5
  // most recent workouts, so a 6th session in a week still showed 5.
  const [weekSessionCount, setWeekSessionCount] = useState<number | null>(null);
  // FU-WORKLOG2-126: Recent Workouts listed only the 5 newest, so a client
  // could not see, correct or delete anything older. The 50-workout window
  // the chart already reads is kept for "Show older workouts".
  const [historySessions, setHistorySessions] = useState<ApiSession[]>([]);
  const [showAllHistory, setShowAllHistory] = useState(false);

  // FU-WORKLOG-126: coach-assigned workouts. This tab stays mounted, and the
  // query only refetched after a finished assigned workout, so a workout the
  // coach assigned later never appeared here (not on return to the tab, not
  // on pull-to-refresh, not after reopening the app) until a full restart.
  // Called here, before any early return (Rules of Hooks).
  const assignmentsQuery = useMyWorkoutAssignments();
  const refetchAssignmentsRef = useRef(assignmentsQuery.refetch);
  refetchAssignmentsRef.current = assignmentsQuery.refetch;
  const refreshAssignments = useCallback(async () => {
    try {
      await refetchAssignmentsRef.current?.();
    } catch (err) {
      logger.warn('WorkoutScreen', 'assignments refetch failed', err);
    }
  }, []);

  // Number of weeks shown in the volume chart.
  const CHART_WEEKS = 8;

  const loadVolumeData = useCallback(async () => {
    if (!currentUser) return;
    try {
      // Use the volume API endpoint for the muscle-breakdown card.
      // 'week' reflects the current 7-day window — appropriate for the
      // per-muscle breakdown displayed below the bar chart.
      const volRes = await workoutApi.getVolume('week');
      const volumeData: Array<{ muscle_group: string; total_volume: number; period: string }> = volRes.data || [];

      // Build muscle breakdown from API data
      setMuscleVolume(
        volumeData.map((v) => ({ muscle: v.muscle_group, volume: Math.round(v.total_volume) }))
          .sort((a, b) => b.volume - a.volume)
      );

      // Build weekly volume chart from sessions.
      // Limit: CHART_WEEKS * 7 sessions is a safe upper bound for 8 weeks of
      // daily training (56 sessions). Using 50 instead of 200 avoids pulling
      // years of history for a chart that only shows the last 8 weeks.
      const chartWindowStart = new Date(Date.now() - CHART_WEEKS * 7 * 24 * 60 * 60 * 1000);
      const allRes = await workoutApi.getAll(50);
      setHistorySessions(Array.isArray(allRes.data) ? allRes.data : []);
      const allSessions: ApiSession[] = (allRes.data || []).filter(
        (s: ApiSession) => new Date(s.date) >= chartWindowStart,
      );
      const now = new Date();
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      setWeekSessionCount(allSessions.filter((s) => new Date(s.date) >= weekAgo).length);
      const weeks: WeeklyVolume[] = [];
      for (let w = CHART_WEEKS - 1; w >= 0; w--) {
        const weekEnd = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000);
        const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
        const label = `W${CHART_WEEKS - w}`;
        let vol = 0;
        for (const s of allSessions) {
          const d = new Date(s.date);
          if (d >= weekStart && d < weekEnd) {
            for (const ex of (s.exercises || [])) {
              const weights = ex.weight_per_set || [];
              const reps = ex.reps_per_set || [];
              for (let i = 0; i < Math.min(weights.length, reps.length); i++) {
                vol += (weights[i] || 0) * (reps[i] || 0);
              }
            }
          }
        }
        weeks.push({ week: label, volume: Math.round(vol) });
      }
      setWeeklyVolume(weeks);
    } catch (err) {
      // Chart read-only: a failed volume aggregation just shows an empty chart.
      logger.error('WorkoutScreen', 'loadVolumeData failed', err);
    }
  }, [currentUser]);

  const loadData = useCallback(async () => {
    if (!currentUser) return;
    try {
      const [rRes, sRes] = await Promise.all([
        workoutApi.getRoutines(),
        workoutApi.getAll(5),
      ]);
      setRoutines(rRes.data || []);
      setRecentSessions(sRes.data || []);
      // A later load that succeeds clears an earlier failure.
      setLoadError(false);
    } catch (err) {
      // Read-only data load for the workout landing screen; error state shown.
      logger.error('WorkoutScreen', 'loadData failed', err);
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
    await loadVolumeData();
  }, [currentUser, loadVolumeData]);

  useEffect(() => {
    setIsLoading(true);
    setLoadError(false);
    loadData();
  }, [loadData]);

  // Refresh when the client comes back to this tab (after finishing a
  // workout or saving a routine). Without it the workout just logged and
  // the routine just saved did not appear until a manual pull-to-refresh,
  // which reads as "it did not save". The first focus is covered by the
  // mount load above.
  const hasFocusedOnceRef = useRef(false);
  const isFocusedRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      isFocusedRef.current = true;
      const onBlur = () => {
        isFocusedRef.current = false;
      };
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return onBlur;
      }
      loadData();
      void refreshAssignments();
      return onBlur;
    }, [loadData, refreshAssignments]),
  );

  // FU-WORKLOG-126: reopening the app on this tab shows what the coach
  // assigned (and what synced) while the app was in the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !isFocusedRef.current) return;
      loadData();
      void refreshAssignments();
    });
    return () => sub.remove();
  }, [loadData, refreshAssignments]);

  // §2.8 one-shot "just completed" signal. Set ONLY when ActiveWorkoutScreen
  // returns here with route param `justCompletedId` (the durable server id of
  // the workout just saved) after a real finish-workout save. Consumed for
  // exactly one focus session by useJustCompletedOneShot, which latches the id
  // durably in AsyncStorage (so a re-delivered param can never re-fire the
  // card), clears the param on focus, and clears its local flag on blur.
  const clearJustCompletedParam = useCallback(() => {
    navigation.setParams({ justCompletedId: undefined });
  }, [navigation]);
  // Scope the latch to the acting user (coach id when present, else own id) so
  // two accounts on one device never share a completion latch.
  const completionUserKey = currentUser?.coach_id || currentUser?.id;
  // Mirror the producer's diagnostic context so the consumer latch warnings log
  // the same structured base. The consumer has no assignment in scope, so
  // assignmentId is omitted (it resolves to undefined in the base builder).
  const completionLogContext = useMemo(
    () => ({ userRole: currentUser?.role }),
    [currentUser?.role],
  );
  const justCompleted = useJustCompletedOneShot(
    route.params?.justCompletedId,
    completionUserKey,
    clearJustCompletedParam,
    featureFlags.romanChat,
    completionLogContext,
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadData(), refreshAssignments()]);
    setRefreshing(false);
  }, [loadData, refreshAssignments]);

  const formatDuration = (minutes: number): string => {
    if (!minutes) return '0 min';
    return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };

  const weekSessions = recentSessions.filter((s) => {
    const d = new Date(s.date);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d >= weekAgo;
  });

  const startRoutine = (routine: ApiRoutine) => {
    // Convert API routine exercises to the format ActiveWorkoutScreen expects.
    // The API routine does not carry catalog ids — synthesize a deterministic
    // fallback so downstream writes never persist an empty exerciseId (B2).
    const exercisesForSession = routineToSessionExercises(routine);
    navigation.navigate('ActiveWorkout', { routineId: routine.id, routineName: routine.name, exercises: JSON.stringify(exercisesForSession) });
  };

  // QA P0-W1 shipped DELETE /workouts/:id but no screen called it, so a
  // workout logged twice or by mistake could never be removed.
  const confirmDeleteSession = (session: ApiSession) => {
    Alert.alert(
      'Delete this workout?',
      // TRAIN-TAB-FIN-130 (U5): only a coached client has a coach who sees it.
      `${session.workout_name || session.notes || 'This workout'} will be removed from your history${currentUser?.coach_id ? ' and from what your coach sees' : ''}.`,
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await workoutApi.deleteWorkout(session.id);
              setRecentSessions((prev) => prev.filter((s) => s.id !== session.id));
              setHistorySessions((prev) => prev.filter((s) => s.id !== session.id));
              loadData();
            } catch (err) {
              logger.error('WorkoutScreen', 'deleteWorkout failed', err);
              Alert.alert(
                'Workout not deleted',
                'Check the connection, then try again.',
              );
            }
          },
        },
      ],
    );
  };

  const startQuickWorkout = () => {
    navigation.navigate('ActiveWorkout', { routineName: 'Quick Workout', exercises: '[]' });
  };

  const totalVolumeThisWeek = weeklyVolume[weeklyVolume.length - 1]?.volume || 0;

  // §2.8 Roman's workout-complete line is driven by a REAL just-completed
  // event — the `justCompleted` one-shot signal from the finish-workout path —
  // NOT by the mere presence of a historical completed session. (The R4 audit
  // flagged the previous "any recent completed session" wiring as a false
  // just-completed event that fired on every visit.)
  const showWorkoutComplete = justCompleted;

  // W-3: surface coach-assigned workouts. Falls back to silent when the
  // assignment list is empty / the hook is still loading. Tapping routes
  // through the tab navigator into MoreTab's ClientWorkoutViewer because
  // both the list and detail screens live in MoreStack. The query itself is
  // created at the top of the component (FU-WORKLOG-126).
  const assignmentsList: Array<{
    id: string;
    completed_at: string | null;
    workout_plan?: { name?: string } | null;
  }> = Array.isArray(assignmentsQuery.data)
    ? (assignmentsQuery.data as Array<{
        id: string;
        completed_at: string | null;
        workout_plan?: { name?: string } | null;
      }>)
    : [];
  const pendingAssignments = assignmentsList.filter((a) => !a.completed_at);
  const historyRows =
    showAllHistory && historySessions.length > recentSessions.length ? historySessions : recentSessions;
  const completedAssignments = assignmentsList.length - pendingAssignments.length;
  // Cross-tab navigate: WorkoutScreen lives in WorkoutTab; the assignment
  // screens live in MoreTab. `initial: false` keeps the You menu (MoreIndex)
  // under them when You has not been opened yet (the tab is lazy), so Back
  // and a second tap on You return to the menu (B1 / B-542-SOL-130-1).
  const openInMoreTab = (screen: 'WorkoutAssignmentDetail' | 'ClientWorkoutViewer', params?: { assignmentId: string }) => {
    navigation.getParent()?.navigate('MoreTab', { screen, ...(params ? { params } : {}), initial: false });
  };
  const openAssignedList = () => {
    if (pendingAssignments.length === 1) openInMoreTab('WorkoutAssignmentDetail', { assignmentId: pendingAssignments[0].id });
    else openInMoreTab('ClientWorkoutViewer');
  };
  const retryLoad = async () => {
    setRetrying(true);
    await loadData();
    setRetrying(false);
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={sc.accent} />
      </View>
    );
  }

  // TRAIN-TAB-FIN-130: one forest action per state. After a failed load it is
  // Try again; with a pending coach workout it is that workout; otherwise it
  // is Quick workout. Every other action is a hairline row. A failed load no
  // longer replaces the tab: the header, sync rows, coach workouts, Quick
  // workout and Create a routine stay; only what did not load is replaced.
  const assignedLabel =
    pendingAssignments.length === 1
      ? `Open assigned workout: ${pendingAssignments[0].workout_plan?.name ?? 'Coach-assigned workout'}`
      : `View ${pendingAssignments.length} coach-assigned workouts`;
  const assignedTitle =
    pendingAssignments.length === 1
      ? (pendingAssignments[0].workout_plan?.name ?? 'New workout assigned')
      : `${pendingAssignments.length} workouts waiting`;
  const assignedLeads = !loadError && pendingAssignments.length > 0;
  const quickLeads = !loadError && pendingAssignments.length === 0;
  // U10: completed coach workouts were reachable only with 2+ pending.
  const showAllCoachRow = completedAssignments > 0 && pendingAssignments.length < 2;

  return (
    <Screen
      edges={['top']}
      testID="workout"
      contentStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={sc.accent} colors={[sc.accent]} />}
    >
        <View style={styles.header}>
          <Text style={styles.title}>Workouts</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
            {/* S-REACH: the exercise library (GET /exercise-catalog) had no entry. */}
            <HapticPressable
              intent="light"
              onPress={() => navigation.navigate('ExerciseLibrary')}
              hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
              accessibilityRole="button"
              accessibilityLabel="Exercise library"
              testID="workout-exercise-library"
            >
              <Ionicons name="library-outline" size={22} color={sc.textMuted} />
            </HapticPressable>
            {coachless ? null : (
              <HapticPressable
                intent="light"
                onPress={() => navigation.navigate('CoachGuidelines')}
                hitSlop={{ top: 11, bottom: 11, left: 11, right: 11 }}
                accessibilityRole="button"
                accessibilityLabel="Coach guidelines"
                testID="workout-coach-guidelines"
              >
                <Ionicons name="clipboard-outline" size={22} color={sc.textMuted} />
              </HapticPressable>
            )}
          </View>
        </View>

        <PlanExplanationCard />

        <WorkoutSyncCards userId={currentUser?.id} onSynced={loadData} />

        {assignedLeads ? (
          <View style={styles.hero}>
            <QuietOverline>From your coach</QuietOverline>
            <Text style={styles.heroTitle}>{assignedTitle}</Text>
            <HapticPressable
              intent="medium"
              onPress={openAssignedList}
              accessibilityRole="button"
              accessibilityLabel={assignedLabel}
              style={styles.primaryButton}
            >
              <Text style={styles.primaryLabel}>{pendingAssignments.length === 1 ? 'Open workout' : 'See workouts'}</Text>
            </HapticPressable>
          </View>
        ) : null}

        {/* §2.8 Roman workout-complete — voiced beside his face ONLY after a
            real just-finished workout (the one-shot `justCompleted` signal from
            the finish-workout path), not on every visit with a historical
            completed session. Only when the Roman flag is on. The default line
            is used: a per-session personal-best signal is not yet carried on
            the ApiSession shape, so no celebration is fabricated (documented in
            the report). */}
        {featureFlags.romanChat && showWorkoutComplete ? (
          <FadeInView>
            <View style={styles.romanWorkoutWrap}>
              <RomanWorkoutCompleteCard mode="default" testID="roman-workout-card" />
            </View>
          </FadeInView>
        ) : null}

        {/* Quick workout leads when nothing from the coach waits and the load
            worked; otherwise it is a hairline row beside the coach rows. */}
        {quickLeads ? (
          <View style={styles.hero}>
            <HapticPressable intent="medium" onPress={startQuickWorkout} accessibilityRole="button" accessibilityLabel="Quick workout" style={styles.primaryButton} testID="workout-quick-start">
              <Text style={styles.primaryLabel}>Quick workout</Text>
            </HapticPressable>
            <Text style={styles.heroNote}>Start an empty session</Text>
          </View>
        ) : null}
        {showAllCoachRow || !quickLeads ? (
          <View style={styles.rows}>
            {loadError && pendingAssignments.length > 0 ? (
              <QuietRow title={assignedTitle} meta="From your coach" label={assignedLabel} onPress={openAssignedList} styles={styles} iconColor={sc.textMuted} />
            ) : null}
            {showAllCoachRow ? (
              <QuietRow title="All coach workouts" meta={`${completedAssignments} completed`} label="All coach workouts" onPress={() => openInMoreTab('ClientWorkoutViewer')} testID="workout-all-coach-workouts" styles={styles} iconColor={sc.textMuted} />
            ) : null}
            {quickLeads ? null : (
              <QuietRow title="Quick workout" meta="Start an empty session" label="Quick workout" onPress={startQuickWorkout} testID="workout-quick-start" styles={styles} iconColor={sc.textMuted} />
            )}
          </View>
        ) : null}

        {/* My routines. After a failed load the error stands in for the
            routines, history and charts; Create a routine stays. */}
        <View style={styles.sectionHeader}>
          <QuietOverline style={{ marginBottom: 0 }}>My routines</QuietOverline>
          <HapticPressable intent="medium" onPress={() => navigation.navigate('RoutineBuilder')} accessibilityLabel="Create a routine" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="add-circle-outline" size={24} color={sc.accentText} />
          </HapticPressable>
        </View>

        {loadError ? (
          <CoachErrorState
            message="Your routines and history did not load. Check the connection, then try again."
            onRetry={() => void retryLoad()}
            retrying={retrying}
            testID="workout-load-error"
          />
        ) : routines.length === 0 ? (
          <EmptyStateNoWorkouts onCreate={() => navigation.navigate('RoutineBuilder')} />
        ) : (
          routines.map((routine, index) => {
            const exList = routine.exercises || [];
            return (
              <HapticPressable
                key={routine.id}
                intent="medium"
                style={[styles.routineCard, index > 0 && styles.rowDivider]}
                onPress={() => startRoutine(routine)}
              >
                <View style={styles.routineTop}>
                  <Text style={styles.routineName}>{routine.name}</Text>
                  {/* Shared template routines belong to no client; the server
                      answers 404 to an edit, so only the client's own
                      routines get the pencil. */}
                  {routine.is_template ? null : (
                    <HapticPressable
                      intent="light"
                      onPress={() => navigation.navigate('RoutineBuilder', { routineId: routine.id })}
                      hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
                      accessibilityRole="button"
                      accessibilityLabel={`Edit routine ${routine.name}`}
                    >
                      <Ionicons name="create-outline" size={18} color={sc.textMuted} />
                    </HapticPressable>
                  )}
                </View>
                <Text style={styles.routineExCount}>{exList.length} {exList.length === 1 ? 'exercise' : 'exercises'}</Text>
                <Text style={styles.routineExList} numberOfLines={1}>
                  {exList.map((e) => e.exercise_name).join(' · ')}
                </Text>
              </HapticPressable>
            );
          })
        )}

        {/* Recent workouts */}
        {loadError ? null : <QuietOverline style={styles.sectionOverline}>Recent workouts</QuietOverline>}
        {loadError ? null : historyRows.length === 0 ? (
          <EmptyStateNoData
            headline="No recent workouts"
            body="Complete a workout to see your history here."
          />
        ) : (
          historyRows.map((session, index) => (
            <View key={session.id} style={[styles.historyCard, index > 0 && styles.rowDivider]}>
              <View style={styles.historyHeader}>
                <Text style={styles.historyTitle}>{session.workout_name || session.notes || 'Workout'}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  <Text style={styles.historyDate}>
                    {new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}
                  </Text>
                  <HapticPressable
                    intent="light"
                    onPress={() => navigation.navigate('WorkoutHistoryEdit', { workout: JSON.stringify(session) })}
                    hitSlop={{ top: 13, bottom: 13, left: 13, right: 13 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit workout ${session.workout_name || session.notes || ''}`.trim()}
                  >
                    <Ionicons name="create-outline" size={18} color={sc.textMuted} />
                  </HapticPressable>
                  <HapticPressable
                    intent="warning"
                    onPress={() => confirmDeleteSession(session)}
                    hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Delete workout ${session.workout_name || session.notes || ''}`.trim()}
                    testID={`delete-workout-${session.id}`}
                  >
                    <Ionicons name="trash-outline" size={16} color={sc.textMuted} />
                  </HapticPressable>
                </View>
              </View>
              {session.duration_minutes ? (
                <Text style={styles.historyMeta}>{formatDuration(session.duration_minutes)}</Text>
              ) : null}
              {(session.exercises || []).map((ex, i) => (
                <View key={i} style={styles.historyExercise}>
                  <Text style={styles.exerciseName}>{ex.exercise_name}</Text>
                  <Text style={styles.exerciseSets}>{formatLoggedSets(ex)}</Text>
                  {ex.notes ? <Text style={styles.historyMeta}>{ex.notes}</Text> : null}
                </View>
              ))}
              {/* FU-WORKLOG2-126: the note written at Finish was only visible
                  inside Edit. */}
              {session.workout_name && session.notes ? (
                <Text style={styles.historyMeta} testID={`workout-note-${session.id}`}>Note: {session.notes}</Text>
              ) : null}
            </View>
          ))
        )}
        {!loadError && historySessions.length > recentSessions.length ? (
          <HapticPressable
            intent="light"
            onPress={() => setShowAllHistory((v) => !v)}
            accessibilityRole="button"
            accessibilityLabel={showAllHistory ? 'Show recent workouts only' : 'Show older workouts'}
            testID="workout-history-toggle"
            style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center', marginBottom: 24 }}
          >
            <Text style={{ ...typography.bodyMd, color: sc.accentText }}>
              {showAllHistory ? 'Show recent workouts only' : 'Show older workouts'}
            </Text>
          </HapticPressable>
        ) : null}
        {/* Charts follow every training action; empty charts are one sentence. */}
        {!loadError && (historySessions.length > 0 || recentSessions.length > 0 || routines.length > 0 || assignmentsList.length > 0) ? <FadeInView>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <QuietOverline>This week</QuietOverline>
              <Text style={styles.statValue} testID="workout-week-count">{weekSessionCount ?? weekSessions.length}</Text>
            </View>
            <View style={styles.statCard}>
              <QuietOverline>Routines</QuietOverline>
              <Text style={styles.statValue}>{routines.length}</Text>
            </View>
            {currentUser?.coach_id ? <View style={styles.statCard}>
              <QuietOverline>From coach</QuietOverline>
              <Text style={styles.statValue}>{pendingAssignments.length}</Text>
            </View> : null}
          </View>
        </FadeInView> : null}
        {loadError ? null : <FadeInView delay={80}>
          {weeklyVolume.some((w) => w.volume > 0) ? (
            <View style={styles.chartCard}>
              <View style={styles.chartHeader}>
                <View style={{ flex: 1 }}>
                  <QuietOverline>Training volume</QuietOverline>
                  <Text style={styles.chartSubtitle}>Last 8 weeks, lb lifted</Text>
                </View>
                {totalVolumeThisWeek > 0 && (
                  <View style={styles.chartBadge}>
                    <Text style={styles.chartBadgeText}>{totalVolumeThisWeek.toLocaleString()} lb</Text>
                    <Text style={styles.chartBadgeSub}>this week</Text>
                  </View>
                )}
              </View>
              <BarChart data={weeklyVolume} />
            </View>
          ) : <Text style={styles.chartEmptyText}>Complete workouts to see volume data</Text>}
        </FadeInView>}
        {loadError ? null : <FadeInView delay={120}>
          {muscleVolume.length > 0 ? (
            <View style={styles.muscleCard}>
              <QuietOverline>Muscle breakdown</QuietOverline>
              <Text style={styles.chartSubtitle}>This week's volume by muscle group</Text>
              <MuscleBreakdown data={muscleVolume} />
            </View>
          ) : <Text style={styles.chartEmptyText}>Log a workout to see muscle breakdown</Text>}
        </FadeInView>}
    </Screen>
  );
}

// ── Chart Styles ──────────────────────────────────────────────────────────

// TRAIN-TAB-FIN-130: chart labels at 11 pt (the overline size) with tabular
// figures; they were 8-9 pt.
const chartLabel = { ...typography.eyebrow, letterSpacing: 0, textTransform: 'none' as const, fontVariant: ['tabular-nums' as const] };

const makeChart = (sc: SemanticTokens) =>
  StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginTop: 12,
    height: 180,
  },
  yAxis: {
    width: 32,
    height: 160,
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    paddingBottom: 20,
  },
  yLabel: {
    ...chartLabel,
    color: sc.textMuted,
  },
  barsContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flex: 1,
    paddingBottom: 20,
  },
  barWrapper: {
    alignItems: 'center',
    gap: 2,
  },
  barLabel: {
    ...chartLabel,
    color: sc.textMuted,
    height: 14,
    textAlign: 'center',
  },
  barTrack: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bar: {
    borderTopLeftRadius: radius.control,
    borderTopRightRadius: radius.control,
  },
  weekLabel: {
    ...chartLabel,
    color: sc.textMuted,
    marginTop: 4,
    textAlign: 'center',
  },

  });

// ── Screen Styles ─────────────────────────────────────────────────────────

// TRAIN-TAB-FIN-130 (A23 calm look): bone page, hairlines instead of cream
// boxes, one forest fill, Cormorant only for the title and the numbers.
const makeStyles = (sc: SemanticTokens) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: sc.bgPrimary },
  // Screen owns the inset top (insets.top + 12); sections keep their 24 gutters.
  content: { paddingHorizontal: 0, paddingBottom: 100 },
  romanWorkoutWrap: {
    marginHorizontal: 24,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  title: { ...typography.h1, color: sc.textPrimary },
  hero: { marginHorizontal: 24, marginBottom: 24 },
  heroTitle: { ...typography.h2, color: sc.textPrimary, marginBottom: 16 },
  heroNote: { ...typography.bodySmall, fontSize: 13, color: sc.textMuted, marginTop: 8 },
  primaryButton: { minHeight: 54, borderRadius: radius.button, backgroundColor: sc.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primaryLabel: { ...typography.bodyMd, color: sc.textOnAccent },
  rows: { marginHorizontal: 24, marginBottom: 24, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.border },
  quietRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: sc.border },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.border },
  statsRow: {
    flexDirection: 'row',
    marginHorizontal: 24,
    gap: 8,
    marginBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
  },
  statCard: { flex: 1, paddingVertical: 16 },
  statValue: { ...typography.h2, color: sc.textPrimary, fontVariant: ['tabular-nums'] },
  // Charts
  chartCard: { marginHorizontal: 24, marginBottom: 24, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.border },
  muscleCard: { marginHorizontal: 24, marginBottom: 24, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.border },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  chartSubtitle: { ...typography.bodySmall, fontSize: 13, color: sc.textMuted },
  chartBadge: { alignItems: 'flex-end' },
  chartBadgeText: { ...typography.h3, color: sc.textPrimary, fontVariant: ['tabular-nums'] },
  chartBadgeSub: { ...typography.bodySmall, fontSize: 13, color: sc.textMuted },
  chartEmpty: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 8,
  },
  chartEmptyText: {
    ...typography.bodySmall,
    fontSize: 13,
    color: sc.textMuted,
    textAlign: 'center',
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginHorizontal: 24,
    minHeight: 44,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: sc.border,
  },
  sectionOverline: { marginHorizontal: 24, marginTop: 24, paddingTop: 18, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.border },
  routineCard: {
    marginHorizontal: 24,
    paddingVertical: 14,
  },
  routineTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  routineName: { ...typography.h4, color: sc.textPrimary, flexShrink: 1 },
  routineExCount: { ...typography.bodySmall, fontSize: 13, color: sc.textMuted, marginTop: 2 },
  routineExList: { ...typography.bodySmall, fontSize: 13, color: sc.textMuted, marginTop: 2 },
  historyCard: {
    marginHorizontal: 24,
    paddingVertical: 14,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyTitle: {
    ...typography.h4,
    color: sc.textPrimary,
    flexShrink: 1,
  },
  historyDate: {
    ...typography.bodySmall,
    fontSize: 13,
    color: sc.textMuted,
    fontVariant: ['tabular-nums'],
  },
  historyMeta: {
    ...typography.bodySmall,
    fontSize: 13,
    color: sc.textMuted,
    marginTop: 4,
  },
  historyExercise: {
    marginTop: 8,
  },
  exerciseName: {
    ...typography.bodyMd,
    fontSize: 14,
    lineHeight: 20,
    color: sc.textPrimary,
  },
  exerciseSets: {
    ...typography.bodySmall,
    fontSize: 13,
    color: sc.textMuted,
    marginTop: 2,
    fontVariant: ['tabular-nums'],
  },

  });
