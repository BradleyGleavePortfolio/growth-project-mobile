import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Dimensions,
  ActivityIndicator,
  TouchableOpacity,
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

import { workoutApi } from '../../services/api';
import { routineExerciseId } from '../../utils/workout/exerciseId';
import { logger } from '../../utils/logger';
import { buildCompletionLogBase, normalizeError } from './_completionLogging';
import FadeInView from '../../components/FadeInView';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { EmptyStateNoWorkouts, EmptyStateNoData } from '../../ui/empty-states';
// W-3: client needs an entry point to coach-assigned workouts. The
// ClientWorkoutViewer + WorkoutAssignmentDetail screens have been
// registered in MoreStack for a while but no UI surfaced a navigate call,
// so this build hid them from the user entirely.
import { useMyWorkoutAssignments } from '../../hooks/useWorkoutBuilder';
import { featureFlags } from '../../config/featureFlags';
// §2.8 Workout complete + §2.10 generic error — Roman speaks beside his face
// (both components co-locate <RomanAvatar />). Gated behind
// featureFlags.romanChat (default OFF), the dedicated Roman flag.
import RomanWorkoutCompleteCard from '../../components/roman/RomanWorkoutCompleteCard';
import RomanErrorBanner from '../../components/roman/RomanErrorBanner';

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
  const { colors } = useTheme();
  const chart = useMemo(() => makeChart(colors), [colors]);
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
                        backgroundColor: i === data.length - 1 ? colors.primary : colors.primaryLight,
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
  const { colors } = useTheme();
  const muscle = useMemo(() => makeMuscle(colors), [colors]);
  if (!data.length) return null;
  const maxVol = Math.max(...data.map((d) => d.volume), 1);
  const MUSCLES_DISPLAY = ['chest', 'back', 'shoulders', 'arms', 'legs', 'core'];

  const displayData = MUSCLES_DISPLAY.map((m) => {
    const found = data.find((d) => d.muscle.toLowerCase().includes(m) || m.includes(d.muscle.toLowerCase()));
    return { muscle: m.charAt(0).toUpperCase() + m.slice(1), volume: found?.volume || 0 };
  }).filter((d) => d.volume > 0 || true);

  return (
    <View style={muscle.container}>
      {displayData.map((item) => {
        const pct = maxVol > 0 ? item.volume / maxVol : 0;
        return (
          <View key={item.muscle} style={muscle.row}>
            <Text style={muscle.label}>{item.muscle}</Text>
            <View style={muscle.track}>
              <View style={[muscle.fill, { width: `${Math.round(pct * 100)}%` }]} />
            </View>
            <Text style={muscle.value}>{item.volume > 0 ? `${item.volume.toLocaleString()} lbs` : '–'}</Text>
          </View>
        );
      })}
    </View>
  );
}

interface ApiRoutine {
  id: string;
  name: string;
  exercises: Array<{ exercise_name: string; muscle_group: string; sets_target: number; reps_target: number }>;
  is_template?: boolean;
}

interface ApiSession {
  id: string;
  date: string;
  duration_minutes: number;
  notes: string;
  completed?: boolean;
  exercises: Array<{ muscle_group: string; exercise_name: string; sets_completed: number; weight_per_set: number[]; reps_per_set: number[] }>;
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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  const navigation = useNavigation<NavigationProp<WorkoutStackParamList>>();
  const route = useRoute<RouteProp<WorkoutStackParamList, 'WorkoutMain'>>();
  const [routines, setRoutines] = useState<ApiRoutine[]>([]);
  const [recentSessions, setRecentSessions] = useState<ApiSession[]>([]);
  const [weeklyVolume, setWeeklyVolume] = useState<WeeklyVolume[]>([]);
  const [muscleVolume, setMuscleVolume] = useState<MuscleVolume[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

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
      const allSessions: ApiSession[] = (allRes.data || []).filter(
        (s: ApiSession) => new Date(s.date) >= chartWindowStart,
      );
      const now = new Date();
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
    await loadData();
    setRefreshing(false);
  }, [loadData]);

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
    const exercisesForSession = routine.exercises.map((e) => ({
      exerciseId: routineExerciseId(routine.id, e.exercise_name),
      exerciseName: e.exercise_name,
      sets: e.sets_target || 3,
      reps: e.reps_target || 10,
      restSec: 60,
    }));
    navigation.navigate('ActiveWorkout', { routineId: routine.id, routineName: routine.name, exercises: JSON.stringify(exercisesForSession) });
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
  // both the list and detail screens live in MoreStack.
  // NOTE: hook must be called unconditionally before any conditional returns
  // (Rules of Hooks).
  const assignmentsQuery = useMyWorkoutAssignments();
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
  const openAssignedList = () => {
    // Cross-tab navigate: WorkoutScreen lives in WorkoutTab; the assignment
    // viewer lives in MoreTab. Same shape as the W-4 fix.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parentAny = (navigation as any).getParent?.();
    if (parentAny?.navigate) {
      parentAny.navigate('MoreTab', {
        screen:
          pendingAssignments.length === 1
            ? 'WorkoutAssignmentDetail'
            : 'ClientWorkoutViewer',
        params:
          pendingAssignments.length === 1
            ? { assignmentId: pendingAssignments[0].id }
            : undefined,
      });
    }
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center', padding: 24 }]}>
        {/* §2.10 Roman generic-error — voiced beside his face on the full error
            screen. Only when the Roman flag is on; otherwise the plain copy
            below carries the message (the failure is never swallowed). */}
        {featureFlags.romanChat ? (
          <RomanErrorBanner mode="error" surface="screen" testID="roman-workout-error" />
        ) : (
          <Text style={{ fontSize: 16, color: colors.textPrimary, marginBottom: 16, textAlign: 'center' }}>
            Could not load workout data.
          </Text>
        )}
        <TouchableOpacity
          style={{ backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}
          onPress={() => { setLoadError(false); setIsLoading(true); loadData(); }}
        >
          <Text style={{ color: colors.textOnPrimary, fontWeight: '500' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Workouts</Text>
          <HapticPressable intent="light" onPress={() => navigation.navigate('CoachGuidelines')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="clipboard-outline" size={22} color={colors.textSecondary} />
          </HapticPressable>
        </View>

        {pendingAssignments.length > 0 ? (
          <HapticPressable
            intent="medium"
            onPress={openAssignedList}
            accessibilityRole="button"
            accessibilityLabel={
              pendingAssignments.length === 1
                ? `Open assigned workout: ${pendingAssignments[0].workout_plan?.name ?? 'Coach-assigned workout'}`
                : `View ${pendingAssignments.length} coach-assigned workouts`
            }
            style={styles.assignedCta}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.assignedCtaLabel}>From your coach</Text>
              <Text style={styles.assignedCtaTitle}>
                {pendingAssignments.length === 1
                  ? (pendingAssignments[0].workout_plan?.name ?? 'New workout assigned')
                  : `${pendingAssignments.length} workouts waiting`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.primary} />
          </HapticPressable>
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

        {/* Weekly Stats */}
        <FadeInView>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: colors.primary }]}>{weekSessions.length}</Text>
              <Text style={styles.statLabel}>This Week</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{routines.length}</Text>
              <Text style={styles.statLabel}>Routines</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{recentSessions.filter(s => s.completed).length}</Text>
              <Text style={styles.statLabel}>Completed</Text>
            </View>
          </View>
        </FadeInView>

        {/* Volume Bar Chart */}
        <FadeInView delay={80}>
          <View style={styles.chartCard}>
            <View style={styles.chartHeader}>
              <View>
                <Text style={styles.chartTitle}>Training Volume</Text>
                <Text style={styles.chartSubtitle}>Last 8 weeks (lbs lifted)</Text>
              </View>
              {totalVolumeThisWeek > 0 && (
                <View style={styles.chartBadge}>
                  <Text style={styles.chartBadgeText}>{totalVolumeThisWeek.toLocaleString()} lbs</Text>
                  <Text style={styles.chartBadgeSub}>this week</Text>
                </View>
              )}
            </View>
            {weeklyVolume.some((w) => w.volume > 0) ? (
              <BarChart data={weeklyVolume} />
            ) : (
              <View style={styles.chartEmpty}>
                <Ionicons name="bar-chart-outline" size={32} color={colors.textMuted} />
                <Text style={styles.chartEmptyText}>Complete workouts to see volume data</Text>
              </View>
            )}
          </View>
        </FadeInView>

        {/* Muscle Group Breakdown */}
        <FadeInView delay={120}>
          <View style={styles.muscleCard}>
            <Text style={styles.chartTitle}>Muscle Breakdown</Text>
            <Text style={styles.chartSubtitle}>This week's volume by muscle group</Text>
            <MuscleBreakdown data={muscleVolume} />
            {muscleVolume.length === 0 && (
              <View style={styles.chartEmpty}>
                <Text style={styles.chartEmptyText}>Log a workout to see muscle breakdown</Text>
              </View>
            )}
          </View>
        </FadeInView>

        {/* Quick Start */}
        <HapticPressable intent="medium" style={styles.quickStart} onPress={startQuickWorkout}>
          <View style={styles.quickStartLeft}>
            <View style={styles.quickStartIcon}>
              <Ionicons name="flash" size={24} color={colors.textOnPrimary} />
            </View>
            <View>
              <Text style={styles.quickStartTitle}>Quick Workout</Text>
              <Text style={styles.quickStartSub}>Start an empty session</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
        </HapticPressable>

        {/* My Routines */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>My Routines</Text>
          <HapticPressable intent="medium" onPress={() => navigation.navigate('RoutineBuilder')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="add-circle" size={24} color={colors.primary} />
          </HapticPressable>
        </View>

        {routines.length === 0 ? (
          <EmptyStateNoWorkouts />
        ) : (
          routines.map((routine) => {
            const exList = routine.exercises || [];
            return (
              <HapticPressable
                key={routine.id}
                intent="medium"
                style={styles.routineCard}
                onPress={() => startRoutine(routine)}
              >
                <View style={styles.routineTop}>
                  <Text style={styles.routineName}>{routine.name}</Text>
                  <HapticPressable
                    intent="light"
                    onPress={() => navigation.navigate('RoutineBuilder', { routineId: routine.id })}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="create-outline" size={18} color={colors.textMuted} />
                  </HapticPressable>
                </View>
                <Text style={styles.routineExCount}>{exList.length} exercises</Text>
                <Text style={styles.routineExList} numberOfLines={1}>
                  {exList.map((e) => e.exercise_name).join(' · ')}
                </Text>
              </HapticPressable>
            );
          })
        )}

        {/* Recent Workouts */}
        <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Recent Workouts</Text>
        {recentSessions.length === 0 ? (
          <EmptyStateNoData
            headline="No recent workouts"
            body="Complete a workout to see your history here."
          />
        ) : (
          recentSessions.map((session) => (
            <View key={session.id} style={styles.historyCard}>
              <View style={styles.historyHeader}>
                <Text style={styles.historyTitle}>{session.notes || 'Workout'}</Text>
                <Text style={styles.historyDate}>
                  {new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </Text>
              </View>
              {session.duration_minutes ? (
                <Text style={styles.historyMeta}>{formatDuration(session.duration_minutes)}</Text>
              ) : null}
              {(session.exercises || []).map((ex, i) => (
                <View key={i} style={styles.historyExercise}>
                  <Text style={styles.exerciseName}>{ex.exercise_name}</Text>
                  <Text style={styles.exerciseSets}>
                    {ex.sets_completed} sets{ex.weight_per_set?.length ? ` · ${ex.weight_per_set.map((w) => `${w} lbs`).join(', ')}` : ''}
                  </Text>
                </View>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ── Chart Styles ──────────────────────────────────────────────────────────

const makeChart = (colors: ThemeColors) =>
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
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: '600',
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
    fontSize: 8,
    color: colors.textMuted,
    height: 12,
    textAlign: 'center',
  },
  barTrack: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bar: {
    borderRadius: 2, // radius.md
  },
  weekLabel: {
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },

  });

const makeMuscle = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    gap: 10,
    marginTop: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    width: 70,
  },
  track: {
    flex: 1,
    height: 8,
    backgroundColor: colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 4,
    minWidth: 0,
  },
  value: {
    fontSize: 11,
    color: colors.textMuted,
    width: 70,
    textAlign: 'right',
    fontWeight: '600',
  },

  });

// ── Screen Styles ─────────────────────────────────────────────────────────

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { paddingBottom: 100 },
  romanWorkoutWrap: {
    marginHorizontal: 24,
    marginBottom: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 20,
  },
  title: { fontSize: 28, fontWeight: '500', color: colors.textPrimary },
  assignedCta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginBottom: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 4,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  assignedCtaLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 2,
  },
  assignedCtaTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  statValue: { fontSize: 22, fontWeight: '500', color: colors.textPrimary },
  statLabel: { fontSize: 11, color: colors.textSecondary },
  // Charts
  chartCard: {
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  muscleCard: {
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  chartSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  chartBadge: {
    backgroundColor: colors.primaryPale,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
  },
  chartBadgeText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.primary,
  },
  chartBadgeSub: {
    fontSize: 9,
    color: colors.textMuted,
    fontWeight: '600',
  },
  chartEmpty: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 8,
  },
  chartEmptyText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
  // Existing styles
  quickStart: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 24,
    marginBottom: 24,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
  },
  quickStartLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  quickStartIcon: {
    width: 44,
    height: 44,
    borderRadius: 2, // radius.md
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickStartTitle: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },
  quickStartSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.textPrimary,
    paddingHorizontal: 24,
    marginBottom: 12,
  },

  routineCard: {
    marginHorizontal: 24,
    marginBottom: 10,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
  },
  routineTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  routineName: { fontSize: 16, fontWeight: '500', color: colors.textPrimary },
  routineExCount: { fontSize: 13, color: colors.textSecondary, marginTop: 4 },
  routineExList: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  historyCard: {
    marginHorizontal: 24,
    marginBottom: 10,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  historyTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  historyDate: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  historyMeta: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 4,
  },
  historyExercise: {
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  exerciseName: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  exerciseSets: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },

  });

