import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Dimensions,
} from 'react-native';
import HapticPressable from '../../components/HapticPressable';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';

import { workoutApi } from '../../services/api';
import { routineExerciseId } from '../../utils/workout/exerciseId';
import FadeInView from '../../components/FadeInView';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { EmptyStateNoWorkouts, EmptyStateNoData } from '../../ui/empty-states';
// W-3: client needs an entry point to coach-assigned workouts. The
// ClientWorkoutViewer + WorkoutAssignmentDetail screens have been
// registered in MoreStack for a while but no UI surfaced a navigate call,
// so this build hid them from the user entirely.
import { useMyWorkoutAssignments } from '../../hooks/useWorkoutBuilder';

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

export default function WorkoutScreen() {
  const { colors } = useTheme();
  const chart = useMemo(() => makeChart(colors), [colors]);
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const [routines, setRoutines] = useState<ApiRoutine[]>([]);
  const [recentSessions, setRecentSessions] = useState<ApiSession[]>([]);
  const [weeklyVolume, setWeeklyVolume] = useState<WeeklyVolume[]>([]);
  const [muscleVolume, setMuscleVolume] = useState<MuscleVolume[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadVolumeData = useCallback(async () => {
    if (!currentUser) return;
    try {
      // Use the volume API endpoint
      const volRes = await workoutApi.getVolume('week');
      const volumeData: Array<{ muscle_group: string; total_volume: number; period: string }> = volRes.data || [];

      // Build muscle breakdown from API data
      setMuscleVolume(
        volumeData.map((v) => ({ muscle: v.muscle_group, volume: Math.round(v.total_volume) }))
          .sort((a, b) => b.volume - a.volume)
      );

      // Build weekly volume from sessions (compute from last 8 weeks)
      const allRes = await workoutApi.getAll(200);
      const allSessions: ApiSession[] = allRes.data || [];
      const now = new Date();
      const weeks: WeeklyVolume[] = [];
      for (let w = 7; w >= 0; w--) {
        const weekEnd = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000);
        const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
        const label = `W${8 - w}`;
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
      console.error('WorkoutScreen: loadVolumeData failed', err);
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
      // Read-only data load for the workout landing screen; empty list is the
      // graceful degrade. Retry via pull-to-refresh.
      console.error('WorkoutScreen: loadData failed', err);
    }
    await loadVolumeData();
  }, [currentUser, loadVolumeData]);

  useEffect(() => { loadData(); }, [loadData]);

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

  // W-3: surface coach-assigned workouts. Falls back to silent when the
  // assignment list is empty / the hook is still loading. Tapping routes
  // through the tab navigator into MoreTab's ClientWorkoutViewer because
  // both the list and detail screens live in MoreStack.
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

