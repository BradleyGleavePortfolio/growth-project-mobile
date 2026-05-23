import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { fastingApi } from '../../services/api';
import { logger } from '../../utils/logger';

import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import EmptyState from '../../components/EmptyState';
import FadeInView from '../../components/FadeInView';
import { scheduleFastingAlert } from '../../utils/notifications';
import { bucketDateLocal } from '../../utils/date';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';

// User-scoped per R15: a shared device must not let user A's scheduled
// "Fast Complete" notification id be cancelled by user B's session, nor
// leak across users on logout/login.
const fastingNotifIdKey = (userId: string) =>
  `fasting:scheduled_notification_id:${userId}`;

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
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();

  const [activeFast, setActiveFast] = useState<FastSession | null>(null);
  const [selectedProtocol, setSelectedProtocol] = useState(16);
  const [history, setHistory] = useState<FastSession[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [streak, setStreak] = useState(0);
  const [stats, setStats] = useState({ longestHours: 0, averageHours: 0, totalCompleted: 0 });
  const [refreshing, setRefreshing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  // submitting locks Start/End buttons across the in-flight network round-trip
  // so a double-tap can't create two server-side fasts (P0-3).
  const [submitting, setSubmitting] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setProtocol = (hours: number) => setSelectedProtocol(hours);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      if (!currentUser) return;
      const histRes = await fastingApi.getHistory(50);
      type SessionRow = { id: string; start_time?: string; end_time?: string | null; target_hours?: number; completed?: boolean; startTime?: string; endTime?: string | null; targetHours?: number };
      const sessions: FastSession[] = ((histRes.data as SessionRow[] | undefined) || []).map((s) => ({
        id: s.id,
        startTime: s.start_time || s.startTime || '',
        endTime: s.end_time || s.endTime || undefined,
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

      // Compute streak from consecutive days with completed fasts.
      // Bucket by the user's LOCAL calendar day, not UTC: a fast started at
      // 7pm in Hawaii (UTC-10) has a `startTime` whose ISO date is already
      // tomorrow in UTC. Using toISOString() here was silently resetting the
      // streak for AU/HI users every night (P0-4).
      const completedDays = new Set(
        completed.map((f) => bucketDateLocal(new Date(f.startTime))),
      );
      let s = 0;
      const now = new Date();
      for (let i = 0; i < 60; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = bucketDateLocal(d);
        if (completedDays.has(dateStr)) {
          s++;
        } else if (i > 0) {
          break;
        }
      }
      setStreak(s);
    } catch (err) {
      logger.error('FastingScreen', err);
      setLoadError(true);
    } finally {
      setIsLoading(false);
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
    if (!currentUser || submitting) return;
    // Lock the button BEFORE awaiting anything so a rapid double-tap (haptic
    // queued + render not flushed) can't fire two POST /fasting/start calls
    // (P0-3). There's no server-side idempotency key on this endpoint yet,
    // so the client is the only thing standing between a slow network and a
    // duplicate fast row.
    setSubmitting(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await fastingApi.start({ protocol: `${selectedProtocol}:${24 - selectedProtocol}` });
      const endTime = new Date(Date.now() + selectedProtocol * 60 * 60 * 1000);
      const notifId = await scheduleFastingAlert(endTime);
      // Persist the id so doEndFast can cancel the scheduled "Fast Complete"
      // push even after the screen has been unmounted (cold start) before
      // the user ends the fast.
      if (notifId) {
        try {
          await AsyncStorage.setItem(fastingNotifIdKey(currentUser.id), notifId);
        } catch (err) {
          // Best-effort cache write. Failing here just means the worst case
          // is a stale "Fast Complete" push once the target time arrives —
          // not a destructive bug, so we don't surface it.
          console.warn('FastingScreen: failed to persist notification id', err);
        }
      }
    } catch (err) {
      // Destructive write: surface so the user knows the fast didn't start.
      console.error('FastingScreen: handleStart failed', err);
      Alert.alert("Couldn't start fast", errorMessage(err, 'Please try again.'));
      setSubmitting(false);
      return;
    }
    try {
      await loadAll();
    } finally {
      setSubmitting(false);
    }
  };

  const doEndFast = async () => {
    if (submitting) return;
    if (!currentUser) return;
    setSubmitting(true);
    try {
      await fastingApi.end();
      // Cancel the scheduled "Fast Complete" push so the user doesn't get a
      // notification hours after they manually ended the fast (P0-3). If the
      // id was never persisted (cold start lost it, or scheduling failed),
      // there's nothing to cancel — quietly skip.
      try {
        const key = fastingNotifIdKey(currentUser.id);
        const notifId = await AsyncStorage.getItem(key);
        if (notifId) {
          await Notifications.cancelScheduledNotificationAsync(notifId);
          await AsyncStorage.removeItem(key);
        }
      } catch (err) {
        // Cancellation is best-effort; an orphan push is annoying, not broken.
        console.warn('FastingScreen: failed to cancel scheduled notification', err);
      }
    } catch (err) {
      // Destructive write: surface so they know the fast wasn't ended. We
      // still call loadAll() so the UI reflects whatever the backend actually
      // recorded.
      console.error('FastingScreen: doEndFast failed', err);
      Alert.alert("Couldn't end fast", errorMessage(err, 'Please try again.'));
    }
    try {
      await loadAll();
    } finally {
      setSubmitting(false);
    }
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

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.background, padding: 24 }}>
        <Text style={{ fontSize: 16, color: colors.textPrimary, marginBottom: 16, textAlign: 'center' }}>
          Could not load fasting data.
        </Text>
        <TouchableOpacity
          style={{ backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 }}
          onPress={() => void loadAll()}
        >
          <Text style={{ color: colors.textOnPrimary, fontWeight: '500' }}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

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
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>Fasting</Text>
        {streak > 0 && (
          <Text style={styles.runText}>Day {streak}</Text>
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
            stroke={colors.surfaceElevated}
            strokeWidth={STROKE_WIDTH}
            fill="none"
          />
          {/* Progress ring */}
          <Circle
            cx={TIMER_SIZE / 2}
            cy={TIMER_SIZE / 2}
            r={RADIUS}
            stroke={progress >= 0.9 ? colors.success : colors.primary}
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
                  : 'Target reached'}
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
          <TouchableOpacity
            style={[styles.endBtn, submitting && styles.btnDisabled]}
            onPress={handleEnd}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting }}
            accessibilityLabel="End fast"
          >
            <Ionicons name="stop-circle" size={22} color={colors.textOnPrimary} />
            <Text style={styles.actionBtnText}>
              {submitting ? 'Ending…' : 'End Fast'}
            </Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.startBtn, submitting && styles.btnDisabled]}
            onPress={handleStart}
            disabled={submitting}
            accessibilityRole="button"
            accessibilityState={{ disabled: submitting }}
            accessibilityLabel="Start fast"
          >
            <Ionicons name="play-circle" size={22} color={colors.textOnPrimary} />
            <Text style={styles.actionBtnText}>
              {submitting ? 'Starting…' : 'Start Fast'}
            </Text>
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
            <Text style={[styles.activeValue, { color: colors.primary }]}>
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
                    color={session.completed ? colors.success : colors.error}
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

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
    fontWeight: '500',
    color: colors.textPrimary,
  },
  runText: {
    fontSize: 13,
    fontWeight: '400',
    color: colors.textSecondary,
    letterSpacing: 0.4,
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
    borderRadius: 4, // radius.lg
    backgroundColor: colors.surface,
  },
  protocolBtnActive: {
    backgroundColor: colors.primary,
  },
  protocolText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  protocolTextActive: {
    color: colors.textOnPrimary,
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
    fontWeight: '500',
    color: colors.textPrimary,
  },
  timerSub: {
    fontSize: 13,
    color: colors.textSecondary,
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
    backgroundColor: colors.primary,
    borderRadius: 4, // radius.lg
    paddingVertical: 16,
  },
  endBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.error,
    borderRadius: 4, // radius.lg
    paddingVertical: 16,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  actionBtnText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textOnPrimary,
  },
  activeCard: {
    marginHorizontal: 24,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
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
    color: colors.textSecondary,
  },
  activeValue: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 10,
    marginBottom: 24,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  historyLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  historyDate: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  historyTarget: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  historyDuration: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.primary,
  },

  });
