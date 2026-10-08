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
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { fastingApi } from '../../services/api';
import { logger } from '../../utils/logger';

import FadeInView from '../../components/FadeInView';
import HapticPressable from '../../components/HapticPressable';
import QuietBar from '../../ui/progress/QuietBar';
import { scheduleFastEndAlert, cancelFastEndAlert } from '../../utils/fastingAlert';
import { bucketDateLocal } from '../../utils/date';
import { useTheme } from '../../theme/ThemeProvider';
import { typography, type SemanticTokens } from '../../theme/tokens';
import { errorMessage } from '../../types/common';

type Protocol = { label: string; hours: number };

const PROTOCOLS: Protocol[] = [
  { label: '12:12', hours: 12 },
  { label: '16:8', hours: 16 },
  { label: '18:6', hours: 18 },
  { label: '20:4', hours: 20 },
  { label: '24h', hours: 24 },
];

// Hours and minutes only (no ticking seconds), so a quarter-minute tick is enough.
const TICK_MS = 15000;

function formatDuration(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(totalMin / 60)}h ${(totalMin % 60).toString().padStart(2, '0')}m`;
}

// A run is two or more local days in a row; a single day is already in Recent fasts.
function runLine(days: number): string | null {
  return days >= 2 ? `${days} days in a row with a completed fast` : null;
}

interface FastSession {
  id: string;
  startTime: string;
  endTime?: string;
  targetHours: number;
  completed: boolean;
}

export default function FastingScreen() {
  const { semanticColors: colors } = useTheme();
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
  const [removingId, setRemovingId] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setProtocol = (hours: number) => setSelectedProtocol(hours);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);
    try {
      if (!currentUser) return;
      const histRes = await fastingApi.getHistory(50);
      type SessionRow = { id: string; start_time?: string; end_time?: string | null; protocol?: string | null; target_hours?: number; completed?: boolean; startTime?: string; endTime?: string | null; targetHours?: number };
      const sessions: FastSession[] = ((histRes.data as SessionRow[] | undefined) || []).map((s) => {
        const startTime = s.start_time || s.startTime || '';
        const endTime = s.end_time || s.endTime || undefined;
        // The production API persists the selected hours in `protocol`,
        // not target_hours. Keep legacy numeric fields compatible.
        const targetHours = s.target_hours || s.targetHours || Number(s.protocol?.split(':')[0]) || 16;
        const elapsedHours = endTime
          ? (new Date(endTime).getTime() - new Date(startTime).getTime()) / (1000 * 60 * 60)
          : 0;
        return {
          id: s.id,
          startTime,
          endTime,
          targetHours,
          // Match the existing local fasting completion rule: 90% of target.
          completed: s.completed ?? (!!endTime && elapsedHours >= targetHours * 0.9),
        };
      });

      // Find active fast (no end time)
      const active = sessions.find((s) => !s.endTime) || null;
      setActiveFast(active);

      // History = every ended fast, completed or ended early
      const completed = sessions.filter((s) => s.endTime);
      setHistory(completed);

      // Average and longest cover every ended fast loaded here, the newest 50
      // (getHistory(50)), so the average is labelled "recent fasts" on screen
      // (B-552-SOL-131-1); the Completed count covers fasts that reached 90%
      // of their target.
      if (completed.length > 0) {
        const hours = completed.map((s) => {
          const startMs = new Date(s.startTime).getTime();
          const endMs = new Date(s.endTime!).getTime();
          return (endMs - startMs) / (1000 * 60 * 60);
        });
        const longestHours = Math.max(...hours);
        const averageHours = hours.reduce((a, b) => a + b, 0) / hours.length;
        setStats({ longestHours, averageHours, totalCompleted: completed.filter((s) => s.completed).length });
      } else {
        setStats({ longestHours: 0, averageHours: 0, totalCompleted: 0 });
      }

      // Compute streak from consecutive days with completed fasts.
      // Bucket by the user's LOCAL calendar day, not UTC: a fast started at
      // 7pm in Hawaii (UTC-10) has a `startTime` whose ISO date is already
      // tomorrow in UTC. Using toISOString() here was silently resetting the
      // streak for AU/HI users every night (P0-4).
      const completedDays = new Set(
        completed.filter((f) => f.completed).map((f) => bucketDateLocal(new Date(f.startTime))),
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
      timerRef.current = setInterval(tick, TICK_MS);
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
      // Scheduled only while Settings > Fasting alerts is on (scheduleFastingAlert
      // checks). The id is persisted so doEndFast can cancel the alert even
      // after a cold start.
      await scheduleFastEndAlert(currentUser.id, selectedProtocol);
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
      // Cancel the scheduled end alert so it does not arrive hours after the
      // fast was ended by hand (P0-3); nothing stored means nothing to cancel.
      await cancelFastEndAlert(currentUser.id);
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
    const elapsedHours = (Date.now() - new Date(activeFast.startTime).getTime()) / (1000 * 60 * 60);
    const pctDone = (elapsedHours / activeFast.targetHours) * 100;
    if (pctDone < 90) {
      Alert.alert(
        'End fast early?',
        `${Math.round(pctDone)}% of the target reached. This fast will be saved in history, but will not count as completed.`,
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

  const doRemoveFast = async (session: FastSession) => {
    if (!currentUser || submitting) return;
    setSubmitting(true);
    setRemovingId(session.id);
    try {
      await fastingApi.deleteFast(session.id);
      // Only the running fast has a scheduled end alert to cancel.
      if (session.id === activeFast?.id) await cancelFastEndAlert(currentUser.id);
      await loadAll();
    } catch {
      Alert.alert("Couldn't remove fast", 'The fast could not be removed. Check the connection and try again.');
    } finally {
      setRemovingId(null);
      setSubmitting(false);
    }
  };

  const handleRemoveFast = (session: FastSession) => {
    if (!currentUser || submitting) return;
    Alert.alert(
      'Remove this fast?',
      session.endTime
        ? 'This fast will be removed from history.'
        : 'This fast will be removed and the running timer will stop.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => doRemoveFast(session) },
      ],
    );
  };

  const removeFastControl = (session: FastSession) => (
    <HapticPressable
      disableAnimation
      intent="warning"
      style={styles.removeButton}
      onPress={() => handleRemoveFast(session)}
      disabled={submitting}
      accessibilityLabel={session.endTime ? `Remove fast from ${new Date(session.startTime).toLocaleDateString()}` : 'Remove this fast'}
      accessibilityState={{ disabled: submitting, busy: removingId === session.id }}
      testID={`remove-fast-${session.id}`}
    >
      <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
      <Text style={styles.removeLabel}>{removingId === session.id ? 'Removing…' : 'Remove this fast'}</Text>
    </HapticPressable>
  );

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPrimary }}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bgPrimary, padding: 24 }}>
        <Text style={[typography.body, { color: colors.textPrimary, marginBottom: 16, textAlign: 'center' }]}>
          Fasting history did not load.
        </Text>
        <TouchableOpacity
          style={{ backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 4 }}
          onPress={() => void loadAll()}
          accessibilityRole="button"
        >
          <Text style={[typography.bodyMd, { color: colors.textOnAccent }]}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Timer progress
  const targetMs = activeFast ? activeFast.targetHours * 60 * 60 * 1000 : selectedProtocol * 60 * 60 * 1000;
  const progress = activeFast ? Math.min(elapsed / targetMs, 1) : 0;

  const remainingMs = activeFast ? Math.max(targetMs - elapsed, 0) : targetMs;

  const run = runLine(streak);

  return (
    <ScrollView
      testID="fasting-scroll"
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
          colors={[colors.accent]}
        />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Fasting</Text>
        {run && <Text style={styles.runText}>{run}</Text>}
      </View>

      {/* Protocol Selector */}
      {!activeFast && (
        <View style={styles.protocolRow}>
          {PROTOCOLS.map((p) => (
            <TouchableOpacity
              key={p.hours}
              style={[styles.protocolBtn, selectedProtocol === p.hours && styles.protocolBtnActive]}
              onPress={() => setProtocol(p.hours)}
              accessibilityRole="button"
              accessibilityState={{ selected: selectedProtocol === p.hours }}
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

      {/* Timer: one serif hero number, no ring */}
      <View style={styles.timerContainer}>
        <Text style={styles.overline}>
          {activeFast ? `${activeFast.targetHours}-hour fast` : 'Fasting window'}
        </Text>
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
          <Text style={styles.timerValue}>{selectedProtocol}h</Text>
        )}
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
            <Text style={styles.actionBtnText}>
              {submitting && !removingId ? 'Ending…' : 'End fast'}
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
            <Text style={styles.actionBtnText}>
              {submitting && !removingId ? 'Starting…' : 'Start fast'}
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
          <QuietBar
            label="Fasting"
            value={`${Math.round(progress * 100)}%`}
            current={elapsed}
            target={targetMs}
          />
          {removeFastControl(activeFast)}
        </View>
      )}

      {/* Stats: shown once a fast has ended; the labels say which fasts each covers */}
      {history.length > 0 && (
      <FadeInView delay={100}>
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Completed</Text>
          <Text testID="fasting-completed-count" style={styles.statValue}>{stats.totalCompleted}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Average, recent fasts</Text>
          <Text style={styles.statValue}>{`${stats.averageHours.toFixed(1)}h`}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Longest</Text>
          <Text style={styles.statValue}>{`${stats.longestHours.toFixed(1)}h`}</Text>
        </View>
        <Text style={styles.historyTarget}>A fast counts as completed at 90 percent of its target.</Text>
      </View>
      </FadeInView>
      )}

      {/* History */}
      {history.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent fasts</Text>
          {history.slice(0, 10).map((session) => {
            const startMs = new Date(session.startTime).getTime();
            const endMs = session.endTime ? new Date(session.endTime).getTime() : 0;
            const hours = endMs ? (endMs - startMs) / (1000 * 60 * 60) : 0;
            return (
              <View key={session.id} style={styles.historyRow}>
                <View style={styles.historyLeft}>
                  <Text style={styles.historyDate}>
                    {new Date(session.startTime).toLocaleDateString()}
                  </Text>
                  <Text style={styles.historyTarget}>
                    {`${session.targetHours}h target · ${session.completed ? 'Completed' : 'Ended early'}`}
                  </Text>
                </View>
                <View style={styles.historyRight}>
                  <Text style={styles.historyDuration}>{hours.toFixed(1)}h</Text>
                  {removeFastControl(session)}
                </View>
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent fasts</Text>
          <Text style={styles.historyTarget}>Each fast you end is saved here.</Text>
        </View>
      )}
    </ScrollView>
  );
}

const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  content: {
    paddingBottom: 100,
  },
  header: {
    gap: 4,
    paddingHorizontal: 24,
    paddingTop: 16,
    marginBottom: 24,
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
  },
  runText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    color: colors.textMuted,
  },
  protocolRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 24,
  },
  protocolBtn: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  protocolBtnActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.textPrimary,
  },
  protocolText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    color: colors.textMuted,
  },
  protocolTextActive: {
    fontFamily: 'Inter_500Medium',
    color: colors.textPrimary,
  },
  timerContainer: {
    alignItems: 'center',
    paddingVertical: 16,
    marginBottom: 24,
  },
  overline: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: 8,
  },
  timerValue: {
    ...typography.display,
    fontVariant: ['tabular-nums'],
    color: colors.textPrimary,
  },
  timerSub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    fontVariant: ['tabular-nums'],
    color: colors.textMuted,
    marginTop: 4,
  },
  actionRow: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  startBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: 4, // radius.lg
    paddingVertical: 16,
  },
  endBtn: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: 4, // radius.lg
    paddingVertical: 16,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  actionBtnText: {
    ...typography.bodyMd,
    color: colors.textOnAccent,
  },
  activeCard: {
    marginHorizontal: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: 16,
    gap: 12,
    marginBottom: 24,
  },
  activeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  activeLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textMuted,
  },
  activeValue: {
    fontFamily: 'Inter_500Medium',
    fontSize: 14,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    color: colors.textPrimary,
  },
  statsRow: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  statCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  statValue: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    color: colors.textPrimary,
  },
  statLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textMuted,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: 12,
  },
  historyRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    minHeight: 44,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  historyLeft: {
    gap: 2,
  },
  historyDate: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  historyTarget: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  historyDuration: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    color: colors.textPrimary,
  },
  historyRight: {
    alignItems: 'flex-end',
  },
  removeButton: {
    minHeight: 44,
    minWidth: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  removeLabel: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textMuted,
  },

  });
