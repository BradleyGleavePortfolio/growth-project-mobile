import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { fastingApi } from '../../services/api';
import { Colors } from '../../constants/colors';
import EmptyState from '../../components/EmptyState';
import FadeInView from '../../components/FadeInView';
import { scheduleFastingAlert } from '../../utils/notifications';

type Protocol = { label: string; hours: number };

const PROTOCOLS: Protocol[] = [
  { label: '12:12', hours: 12 },
  { label: '16:8', hours: 16 },
  { label: '18:6', hours: 18 },
  { label: '20:4', hours: 20 },
  { label: '24h', hours: 24 },
];

const TIMER_SIZE = 220;
const STROKE_WIDTH = 12;
const RADIUS = (TIMER_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

interface FastSession {
  id: string;
  startTime: string;
  endTime?: string;
  targetHours: number;
  completed: boolean;
}

export default function FastingScreen() {
  const currentUser = useCurrentUser();

  const [activeFast, setActiveFast] = useState<FastSession | null>(null);
  const [selectedProtocol, setSelectedProtocol] = useState(16);
  const [history, setHistory] = useState<FastSession[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [streak, setStreak] = useState(0);
  const [stats, setStats] = useState({ longestHours: 0, averageHours: 0, totalCompleted: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setProtocol = (hours: number) => setSelectedProtocol(hours);

  const loadAll = useCallback(async () => {
    if (!currentUser) return;
    try {
      const histRes = await fastingApi.getHistory(50);
      const sessions: FastSession[] = (histRes.data || []).map((s: any) => ({
        id: s.id,
        startTime: s.start_time || s.startTime,
        endTime: s.end_time || s.endTime,
        targetHours: s.target_hours || s.targetHours || 16,
        completed: s.completed ?? (s.end_time != null),
      }));

      // Find active fast (no end time)
      const active = sessions.find((s) => !s.endTime) || null;
      setActiveFast(active);

      // History = completed fasts
      const completed = sessions.filter((s) => s.endTime);
      setHistory(completed);

      // Compute stats from completed sessions
      if (completed.length > 0) {
        const hours = completed.map((s) => {
          const startMs = new Date(s.startTime).getTime();
          const endMs = new Date(s.endTime!).getTime();
          return (endMs - startMs) / (1000 * 60 * 60);
        });
        const longestHours = Math.max(...hours);
        const averageHours = hours.reduce((a, b) => a + b, 0) / hours.length;
        setStats({ longestHours, averageHours, totalCompleted: completed.filter((s) => s.completed).length });
      }

      // Compute streak from consecutive days with completed fasts
      let s = 0;
      const now = new Date();
      for (let i = 0; i < 60; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        if (completed.some((f) => f.startTime.startsWith(dateStr))) {
          s++;
        } else if (i > 0) {
          break;
        }
      }
      setStreak(s);
    } catch (err) {
      // Read-only streak aggregation; streak stays at its last good value.
      console.error('FastingScreen: loadAll failed', err);
    }
  }, [currentUser]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  }, [loadAll]);

  // Timer tick
  useEffect(() => {
    if (activeFast) {
      const tick = () => {
        const startMs = new Date(activeFast.startTime).getTime();
        setElapsed(Date.now() - startMs);
      };
      tick();
      timerRef.current = setInterval(tick, 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    } else {
      setElapsed(0);
    }
  }, [activeFast]);

  const handleStart = async () => {
    if (!currentUser) return;
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await fastingApi.start({ protocol: `${selectedProtocol}:${24 - selectedProtocol}` });
      const endTime = new Date(Date.now() + selectedProtocol * 60 * 60 * 1000);
      await scheduleFastingAlert(endTime);
    } catch (err: any) {
      // Destructive write: surface so the user knows the fast didn't start.
      console.error('FastingScreen: handleStart failed', err);
      Alert.alert("Couldn't start fast", err?.message || 'Please try again.');
      return;
    }
    loadAll();
  };

  const doEndFast = async () => {
    try {
      await fastingApi.end();
    } catch (err: any) {
      // Destructive write: surface so they know the fast wasn't ended. We
      // still call loadAll() so the UI reflects whatever the backend actually
      // recorded.
      console.error('FastingScreen: doEndFast failed', err);
      Alert.alert("Couldn't end fast", err?.message || 'Please try again.');
    }
    loadAll();
  };

  const handleEnd = async () => {
    if (!currentUser || !activeFast) return;
    const elapsedHours = elapsed / (1000 * 60 * 60);
    const pctDone = (elapsedHours / activeFast.targetHours) * 100;
    if (pctDone < 50) {
      Alert.alert(
        'End fast early?',
        `You're only ${Math.round(pctDone)}% through. This won't count as completed.`,
        [
          { text: 'Keep going', style: 'cancel' },
          {
            text: 'End anyway',
            style: 'destructive',
            onPress: async () => {
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              await doEndFast();
            },
          },
        ]
      );
      return;
    }
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await doEndFast();
  };

  // Timer progress
  const targetMs = activeFast ? activeFast.targetHours * 60 * 60 * 1000 : selectedProtocol * 60 * 60 * 1000;
  const progress = activeFast ? Math.min(elapsed / targetMs, 1) : 0;
  const strokeDashoffset = CIRCUMFERENCE * (1 - progress);

  const remainingMs = activeFast ? Math.max(targetMs - elapsed, 0) : targetMs;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={Colors.primary}
          colors={[Colors.primary]}
        />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>Fasting</Text>
        {streak > 0 && (
          <View style={styles.streakBadge}>
            <Ionicons name="flame" size={14} color={Colors.warning} />
            <Text style={styles.streakText}>{streak} streak</Text>
          </View>
        )}
      </View>

      {/* Protocol Selector */}
      {!activeFast && (
        <View style={styles.protocolRow}>
          {PROTOCOLS.map((p) => (
            <TouchableOpacity
              key={p.hours}
              style={[styles.protocolBtn, selectedProtocol === p.hours && styles.protocolBtnActive]}
              onPress={() => setProtocol(p.hours)}
            >
              <Text
                style={[
                  styles.protocolText,
                  selectedProtocol === p.hours && styles.protocolTextActive,
                ]}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Timer */}
      <View style={styles.timerContainer}>
        <Svg width={TIMER_SIZE} height={TIMER_SIZE}>
          {/* Background ring */}
          <Circle
            cx={TIMER_SIZE / 2}
            cy={TIMER_SIZE / 2}
            r={RADIUS}
            stroke={Colors.surfaceElevated}
            strokeWidth={STROKE_WIDTH}
            fill="none"
          />
          {/* Progress ring */}
          <Circle
            cx={TIMER_SIZE / 2}
            cy={TIMER_SIZE / 2}
            r={RADIUS}
            stroke={progress >= 0.9 ? Colors.success : Colors.primary}
            strokeWidth={STROKE_WIDTH}
            fill="none"
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            rotation="-90"
            origin={`${TIMER_SIZE / 2}, ${TIMER_SIZE / 2}`}
          />
        </Svg>
        <View style={styles.timerCenter}>
          {activeFast ? (
            <>
              <Text style={styles.timerValue}>{formatDuration(elapsed)}</Text>
              <Text style={styles.timerSub}>
                {remainingMs > 0
                  ? `${formatDuration(remainingMs)} remaining`
                  : 'Target reached!'}
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.timerValue}>{selectedProtocol}h</Text>
              <Text style={styles.timerSub}>fast</Text>
            </>
          )}
        </View>
      </View>

      {/* Start / End Button */}
      <View style={styles.actionRow}>
        {activeFast ? (
          <TouchableOpacity style={styles.endBtn} onPress={handleEnd}>
            <Ionicons name="stop-circle" size={22} color={Colors.textOnPrimary} />
            <Text style={styles.actionBtnText}>End Fast</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.startBtn} onPress={handleStart}>
            <Ionicons name="play-circle" size={22} color={Colors.textOnPrimary} />
            <Text style={styles.actionBtnText}>Start Fast</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Active fast info */}
      {activeFast && (
        <View style={styles.activeCard}>
          <View style={styles.activeRow}>
            <Text style={styles.activeLabel}>Started</Text>
            <Text style={styles.activeValue}>
              {new Date(activeFast.startTime).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
          </View>
          <View style={styles.activeRow}>
            <Text style={styles.activeLabel}>Target</Text>
            <Text style={styles.activeValue}>{activeFast.targetHours}h</Text>
          </View>
          <View style={styles.activeRow}>
            <Text style={styles.activeLabel}>Progress</Text>
            <Text style={[styles.activeValue, { color: Colors.primary }]}>
              {Math.round(progress * 100)}%
            </Text>
          </View>
        </View>
      )}

      {/* Stats Row */}
      <FadeInView delay={100}>
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{stats.totalCompleted}</Text>
          <Text style={styles.statLabel}>Completed</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {stats.averageHours > 0 ? stats.averageHours.toFixed(1) : '0'}
          </Text>
          <Text style={styles.statLabel}>Avg Hours</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>
            {stats.longestHours > 0 ? stats.longestHours.toFixed(1) : '0'}
          </Text>
          <Text style={styles.statLabel}>Longest</Text>
        </View>
      </View>
      </FadeInView>

      {/* History */}
      {history.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent Fasts</Text>
          {history.slice(0, 10).map((session) => {
            const startMs = new Date(session.startTime).getTime();
            const endMs = session.endTime ? new Date(session.endTime).getTime() : 0;
            const hours = endMs ? (endMs - startMs) / (1000 * 60 * 60) : 0;
            return (
              <View key={session.id} style={styles.historyRow}>
                <View style={styles.historyLeft}>
                  <Ionicons
                    name={session.completed ? 'checkmark-circle' : 'close-circle'}
                    size={20}
                    color={session.completed ? Colors.success : Colors.error}
                  />
                  <View>
                    <Text style={styles.historyDate}>
                      {new Date(session.startTime).toLocaleDateString()}
                    </Text>
                    <Text style={styles.historyTarget}>
                      {session.targetHours}h target
                    </Text>
                  </View>
                </View>
                <Text style={styles.historyDuration}>{hours.toFixed(1)}h</Text>
              </View>
            );
          })}
        </View>
      ) : (
        <EmptyState
          icon="timer-outline"
          title="No fasting history"
          subtitle="Start your first fast to begin tracking your progress"
        />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingBottom: 100,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 60,
    marginBottom: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  streakBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.surface,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
  },
  streakText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.warning,
  },
  protocolRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 24,
  },
  protocolBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: Colors.surface,
  },
  protocolBtnActive: {
    backgroundColor: Colors.primary,
  },
  protocolText: {
    fontSize: 13,
    fontWeight: '700',
    color: Colors.textSecondary,
  },
  protocolTextActive: {
    color: Colors.textOnPrimary,
  },
  timerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    height: TIMER_SIZE,
  },
  timerCenter: {
    position: 'absolute',
    alignItems: 'center',
  },
  timerValue: {
    fontSize: 36,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  timerSub: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 4,
  },
  actionRow: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 16,
  },
  endBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.error,
    borderRadius: 14,
    paddingVertical: 16,
  },
  actionBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textOnPrimary,
  },
  activeCard: {
    marginHorizontal: 24,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 10,
    marginBottom: 24,
  },
  activeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  activeLabel: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  activeValue: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 12,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyDate: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  historyTarget: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  historyDuration: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.primary,
  },
});
