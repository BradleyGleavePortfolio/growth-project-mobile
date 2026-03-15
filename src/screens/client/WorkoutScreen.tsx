import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuthStore } from '../../store/authStore';
import { Colors } from '../../constants/colors';
import {
  getRoutines,
  getWorkoutSessions,
  WorkoutRoutine,
  WorkoutSession,
  RoutineExercise,
  SessionExercise,
} from '../../db/workoutDb';
import FadeInView from '../../components/FadeInView';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_WIDTH = SCREEN_WIDTH - 48;

const MUSCLE_ICONS: Record<string, string> = {
  chest: 'body-outline',
  back: 'body-outline',
  shoulders: 'body-outline',
  legs: 'walk-outline',
  biceps: 'barbell-outline',
  triceps: 'barbell-outline',
  core: 'fitness-outline',
  'full body': 'flash-outline',
  cardio: 'heart-outline',
};

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
                        backgroundColor: i === data.length - 1 ? Colors.primary : Colors.primaryLight,
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

export default function WorkoutScreen() {
  const { currentUser } = useAuthStore();
  const navigation = useNavigation<any>();
  const [routines, setRoutines] = useState<WorkoutRoutine[]>([]);
  const [recentSessions, setRecentSessions] = useState<WorkoutSession[]>([]);
  const [weeklyVolume, setWeeklyVolume] = useState<WeeklyVolume[]>([]);
  const [muscleVolume, setMuscleVolume] = useState<MuscleVolume[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const loadVolumeData = useCallback(async () => {
    if (!currentUser) return;
    try {
      // Get last 8 weeks of sessions
      const allSessions = await getWorkoutSessions(currentUser.id, 200);
      const now = new Date();

      // Build weekly volume buckets
      const weeks: WeeklyVolume[] = [];
      for (let w = 7; w >= 0; w--) {
        const weekEnd = new Date(now.getTime() - w * 7 * 24 * 60 * 60 * 1000);
        const weekStart = new Date(weekEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
        const label = `W${8 - w}`;
        let vol = 0;
        for (const s of allSessions) {
          const d = new Date(s.startTime);
          if (d >= weekStart && d < weekEnd && s.completed) {
            try {
              const exs: SessionExercise[] = JSON.parse(s.exercises);
              for (const ex of exs) {
                for (const set of ex.sets) {
                  if (set.completed) vol += set.weight * set.reps;
                }
              }
            } catch {}
          }
        }
        weeks.push({ week: label, volume: Math.round(vol) });
      }
      setWeeklyVolume(weeks);

      // Muscle breakdown this week
      const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const muscleMap: Record<string, number> = {};
      for (const s of allSessions) {
        if (new Date(s.startTime) < weekAgo) continue;
        if (!s.completed) continue;
        try {
          const exs: SessionExercise[] = JSON.parse(s.exercises);
          for (const ex of exs) {
            // Map exerciseName to muscle via best-effort matching
            const name = ex.exerciseName.toLowerCase();
            let muscle = 'other';
            if (name.includes('press') || name.includes('fly') || name.includes('push') || name.includes('dip')) muscle = 'chest';
            else if (name.includes('row') || name.includes('pull') || name.includes('lat') || name.includes('chin')) muscle = 'back';
            else if (name.includes('shoulder') || name.includes('lateral') || name.includes('overhead') || name.includes('arnold')) muscle = 'shoulders';
            else if (name.includes('curl') || name.includes('tricep') || name.includes('skull') || name.includes('hammer')) muscle = 'arms';
            else if (name.includes('squat') || name.includes('leg') || name.includes('lunge') || name.includes('deadlift') || name.includes('hip') || name.includes('calf')) muscle = 'legs';
            else if (name.includes('plank') || name.includes('crunch') || name.includes('core') || name.includes('ab') || name.includes('twist')) muscle = 'core';
            else if (name.includes('run') || name.includes('row') || name.includes('bike') || name.includes('jump') || name.includes('stair')) muscle = 'cardio';

            for (const set of ex.sets) {
              if (set.completed) {
                muscleMap[muscle] = (muscleMap[muscle] || 0) + set.weight * set.reps;
              }
            }
          }
        } catch {}
      }
      setMuscleVolume(
        Object.entries(muscleMap)
          .map(([muscle, volume]) => ({ muscle, volume: Math.round(volume) }))
          .sort((a, b) => b.volume - a.volume)
      );
    } catch (err) {
      console.warn('loadVolumeData error:', err);
    }
  }, [currentUser]);

  const loadData = useCallback(async () => {
    if (!currentUser) return;
    const [r, s] = await Promise.all([
      getRoutines(currentUser.id),
      getWorkoutSessions(currentUser.id, 5),
    ]);
    setRoutines(r);
    setRecentSessions(s);
    await loadVolumeData();
  }, [currentUser, loadVolumeData]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  const parseExercises = (json: string): RoutineExercise[] | SessionExercise[] => {
    try { return JSON.parse(json); } catch { return []; }
  };

  const formatDuration = (start: string, end?: string): string => {
    if (!end) return 'In progress';
    const ms = new Date(end).getTime() - new Date(start).getTime();
    const min = Math.round(ms / 60000);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
  };

  const weekSessions = recentSessions.filter((s) => {
    const d = new Date(s.startTime);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d >= weekAgo;
  });

  const startRoutine = (routine: WorkoutRoutine) => {
    navigation.navigate('ActiveWorkout', { routineId: routine.id, routineName: routine.name, exercises: routine.exercises });
  };

  const startQuickWorkout = () => {
    navigation.navigate('ActiveWorkout', { routineName: 'Quick Workout', exercises: '[]' });
  };

  const totalVolumeThisWeek = weeklyVolume[weeklyVolume.length - 1]?.volume || 0;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} colors={[Colors.primary]} />}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Workouts</Text>
          <TouchableOpacity onPress={() => navigation.navigate('CoachGuidelines')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="clipboard-outline" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {/* Weekly Stats */}
        <FadeInView>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: Colors.primary }]}>{weekSessions.length}</Text>
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
                <Ionicons name="bar-chart-outline" size={32} color={Colors.textMuted} />
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
        <TouchableOpacity style={styles.quickStart} onPress={startQuickWorkout} activeOpacity={0.8}>
          <View style={styles.quickStartLeft}>
            <View style={styles.quickStartIcon}>
              <Ionicons name="flash" size={24} color="#fff" />
            </View>
            <View>
              <Text style={styles.quickStartTitle}>Quick Workout</Text>
              <Text style={styles.quickStartSub}>Start an empty session</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
        </TouchableOpacity>

        {/* My Routines */}
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>My Routines</Text>
          <TouchableOpacity onPress={() => navigation.navigate('RoutineBuilder')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Ionicons name="add-circle" size={24} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        {routines.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="barbell-outline" size={32} color={Colors.textMuted} />
            <Text style={styles.emptyText}>No routines yet</Text>
            <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('RoutineBuilder')}>
              <Text style={styles.emptyBtnText}>Create Routine</Text>
            </TouchableOpacity>
          </View>
        ) : (
          routines.map((routine) => {
            const exList = parseExercises(routine.exercises) as RoutineExercise[];
            return (
              <TouchableOpacity
                key={routine.id}
                style={styles.routineCard}
                onPress={() => startRoutine(routine)}
                activeOpacity={0.7}
              >
                <View style={styles.routineTop}>
                  <Text style={styles.routineName}>{routine.name}</Text>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('RoutineBuilder', { routineId: routine.id })}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <Ionicons name="create-outline" size={18} color={Colors.textMuted} />
                  </TouchableOpacity>
                </View>
                <Text style={styles.routineExCount}>{exList.length} exercises</Text>
                <Text style={styles.routineExList} numberOfLines={1}>
                  {exList.map((e) => e.exerciseName).join(' · ')}
                </Text>
              </TouchableOpacity>
            );
          })
        )}

        {/* Recent Sessions */}
        {recentSessions.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Recent Sessions</Text>
            {recentSessions.map((session) => {
              const exList = parseExercises(session.exercises) as SessionExercise[];
              return (
                <View key={session.id} style={styles.sessionCard}>
                  <View style={styles.sessionTop}>
                    <Text style={styles.sessionName}>{session.routineName}</Text>
                    {session.completed ? (
                      <View style={styles.completedBadge}>
                        <Ionicons name="checkmark-circle" size={14} color={Colors.success} />
                        <Text style={styles.completedText}>Done</Text>
                      </View>
                    ) : (
                      <Text style={styles.inProgressText}>In progress</Text>
                    )}
                  </View>
                  <Text style={styles.sessionMeta}>
                    {new Date(session.startTime).toLocaleDateString()} · {formatDuration(session.startTime, session.endTime || undefined)} · {exList.length} exercises
                  </Text>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

// ── Chart Styles ──────────────────────────────────────────────────────────

const chart = StyleSheet.create({
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
    color: Colors.textMuted,
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
    color: Colors.textMuted,
    height: 12,
    textAlign: 'center',
  },
  barTrack: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  bar: {
    borderRadius: 5,
  },
  weekLabel: {
    fontSize: 9,
    color: Colors.textMuted,
    fontWeight: '600',
    marginTop: 4,
    textAlign: 'center',
  },
});

const muscle = StyleSheet.create({
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
    fontWeight: '700',
    color: Colors.textSecondary,
    width: 70,
  },
  track: {
    flex: 1,
    height: 8,
    backgroundColor: Colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 4,
    minWidth: 0,
  },
  value: {
    fontSize: 11,
    color: Colors.textMuted,
    width: 70,
    textAlign: 'right',
    fontWeight: '600',
  },
});

// ── Screen Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { paddingBottom: 100 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 20,
  },
  title: { fontSize: 28, fontWeight: '800', color: Colors.textPrimary },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 20,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  statValue: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary },
  statLabel: { fontSize: 11, color: Colors.textSecondary },
  // Charts
  chartCard: {
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  muscleCard: {
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chartHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  chartSubtitle: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  chartBadge: {
    backgroundColor: Colors.primaryPale,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: 'center',
  },
  chartBadgeText: {
    fontSize: 14,
    fontWeight: '800',
    color: Colors.primary,
  },
  chartBadgeSub: {
    fontSize: 9,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  chartEmpty: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 8,
  },
  chartEmptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  // Existing styles
  quickStart: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 24,
    marginBottom: 24,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
  },
  quickStartLeft: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  quickStartIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  quickStartTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  quickStartSub: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  emptyCard: {
    marginHorizontal: 24,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 32,
    alignItems: 'center',
    gap: 10,
  },
  emptyText: { fontSize: 14, color: Colors.textMuted },
  emptyBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    marginTop: 4,
  },
  emptyBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  routineCard: {
    marginHorizontal: 24,
    marginBottom: 10,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
  },
  routineTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  routineName: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  routineExCount: { fontSize: 13, color: Colors.textSecondary, marginTop: 4 },
  routineExList: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
  sessionCard: {
    marginHorizontal: 24,
    marginBottom: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
  },
  sessionTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sessionName: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  completedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  completedText: { fontSize: 12, fontWeight: '600', color: Colors.success },
  inProgressText: { fontSize: 12, fontWeight: '600', color: Colors.warning },
  sessionMeta: { fontSize: 12, color: Colors.textMuted, marginTop: 4 },
});
