import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { fastingApi } from '../../services/api';
import { logger } from '../../utils/logger';

import FadeInView from '../../components/FadeInView';
import HapticPressable from '../../components/HapticPressable';
import Svg, { Circle } from 'react-native-svg';
import { scheduleFastEndAlert, cancelFastEndAlert } from '../../utils/fastingAlert';
import { bucketDateLocal } from '../../utils/date';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, radius, spacing, typography, type SemanticTokens } from '../../theme/tokens';
import { clockOf } from '../../utils/log/foodTimeline';
import { mast, PaperPage, PlanMasthead, planStyleC } from './mealplan/planStyleC';

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
      Alert.alert("Couldn't start fast", 'The fast did not start. Check the connection and try again.');
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
      Alert.alert("Couldn't end fast", 'The fast did not end. Check the connection and try again.');
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
      <View style={styles.container}>
        <PlanMasthead title="Fasting" testID="fasting-masthead" foot="short" />
        <PaperPage bg={colors.bgSurface}>
          {/* Loading bones are shapes only, so readers skip them (LO-927 C1: no unnamed progress bar);
              the block around them says main's "Loading" (LO-927R2 C3). */}
          <View accessible accessibilityLabel="Loading" testID="fasting-loading-label">
            <View style={styles.skeleton} testID="fasting-loading" importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
              <View style={[styles.bone, { width: '70%' }]} />
              <View style={[styles.bone, styles.boneTall]} />
              <View style={[styles.bone, { width: '45%' }]} />
            </View>
          </View>
        </PaperPage>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={styles.container}>
        <PlanMasthead title="Fasting" testID="fasting-masthead" foot="short" />
        <PaperPage bg={colors.bgSurface}>
          <View style={[planStyleC.card, styles.card]} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={[typography.body, { color: colors.textPrimary, marginBottom: 16 }]}>
              Fasting history did not load.
            </Text>
            <TouchableOpacity
              style={[planStyleC.primary, { backgroundColor: colors.accent }]}
              onPress={() => void loadAll()}
              accessibilityRole="button"
            >
              <Text style={[typography.bodyMd, { color: colors.textOnAccent }]}>Try again</Text>
            </TouchableOpacity>
          </View>
        </PaperPage>
      </View>
    );
  }

  // Timer progress
  const targetMs = activeFast ? activeFast.targetHours * 60 * 60 * 1000 : selectedProtocol * 60 * 60 * 1000;
  const progress = activeFast ? Math.min(elapsed / targetMs, 1) : 0;

  const remainingMs = activeFast ? Math.max(targetMs - elapsed, 0) : targetMs;

  const run = runLine(streak);
  const runText = run ? <Text style={styles.sideMuted}>{run}</Text> : null;

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
          // Forest pull-down above the masthead: the light ink on iOS (LO-927R2 B1);
          // Android's spinner sits on its own light disc, so it keeps the accent.
          tintColor={mast.ink}
          colors={[colors.accent]}
        />
      }
    >
      {/* C8 C_fasting: a short masthead, the title only; the fast itself is on the paper. */}
      <PlanMasthead title="Fasting" titleTestID="fasting-title" testID="fasting-masthead" foot="short" />

      <PaperPage bg={colors.bgSurface}>
      {activeFast ? (
        // C8 C_fasting: the gold ring with the elapsed time and the target inside, Ends, Started and the run beside it.
        <View style={styles.ringRow}>
          <View testID="fasting-timer" accessible accessibilityRole="progressbar"
            accessibilityValue={{ text: `${Math.round(progress * 100)} percent` }}>
            <FastRing share={progress} track={colors.border} arc={colors.data.goal}>
              <Text style={styles.ringTime}>{formatDuration(elapsed)}</Text>
              <Text style={styles.ringOf}>{`of ${activeFast.targetHours} h`}</Text>
            </FastRing>
          </View>
          <View style={styles.side} testID="fasting-side">
            <Text style={styles.sideLead}>
              {remainingMs > 0 ? `Ends ${clockAt(new Date(activeFast.startTime).getTime() + targetMs)}` : 'Target reached'}
            </Text>
            <Text style={styles.sideMuted}>{`Started ${weekdayOf(activeFast.startTime)}, ${clockAt(new Date(activeFast.startTime).getTime())}`}</Text>
            {run ? <View style={styles.sideRun}>{runText}</View> : null}
          </View>
        </View>
      ) : (
        <>
          {/* No fast running: main's window on the paper (no drawing of its own; no empty ring). */}
          <View style={styles.window} accessible testID="fasting-timer">
            <Text style={styles.windowLabel}>Fasting window</Text>
            <Text style={styles.windowValue}>{selectedProtocol}h</Text>
            {runText}
          </View>
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
        </>
      )}

      {/* Start / End: outlined, forest words on the paper (C8 C_fasting's End fast) */}
      <View style={styles.actionRow}>
        {activeFast ? (
          <TouchableOpacity
            style={[planStyleC.outline, styles.actionBtn, submitting && styles.btnDisabled]}
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
            style={[planStyleC.outline, styles.actionBtn, submitting && styles.btnDisabled]}
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
        {/* The running fast keeps its remove control, under its End fast. */}
        {activeFast ? <View style={styles.runRemove}>{removeFastControl(activeFast)}</View> : null}
      </View>
      {/* C8 C_fasting's gold hairline under the action. */}
      <View style={styles.goldRule} testID="fasting-gold-rule" importantForAccessibility="no" accessibilityElementsHidden />

      {/* Recent fasts: C8's plain rows, the date left and the hours right, a hairline between */}
      {history.length > 0 ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Recent fasts</Text>
          {history.slice(0, 10).map((session) => {
            const startMs = new Date(session.startTime).getTime();
            const endMs = session.endTime ? new Date(session.endTime).getTime() : 0;
            const hours = endMs ? (endMs - startMs) / (1000 * 60 * 60) : 0;
            return (
              <View key={session.id} style={styles.histRow} testID={`fasting-history-${session.id}`}>
                <View style={styles.histLine}>
                  <Text style={styles.histDate}>{shortDateOf(session.startTime)}</Text>
                  <Text style={styles.histHours}>{`${hours.toFixed(1)} h`}</Text>
                </View>
                {/* Main's meta (the drawing has no place for it) in the row's muted line, with the remove control. */}
                <View style={styles.histMeta}>
                  <Text style={[styles.historyTarget, styles.histMetaText]}>
                    {`${session.targetHours}h target · ${session.completed ? 'Completed' : 'Ended early'}`}
                  </Text>
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

      {/* Stats: shown once a fast has ended; plain rows (no frame in C8), the labels say which fasts each covers */}
      {history.length > 0 && (
      <FadeInView delay={100}>
      <View style={styles.statsRows}>
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
      </PaperPage>
    </ScrollView>
  );
}

const RING = 140;
const STROKE = 4;

/**
 * C8 C_fasting's ring (x 36-260 px, a 13 px stroke at 1.5x): 150 pt across, the stone track and the gold share of
 * the target from 12 o'clock, clockwise; the words sit inside it. Non-text: its share is the block's value.
 */
function FastRing({ share, track, arc, children }: { share: number; track: string; arc: string; children: React.ReactNode }) {
  const r = (RING - STROKE) / 2;
  const c = 2 * Math.PI * r;
  const s = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
  return (
    <View style={ringStyles.box} testID="fasting-ring">
      <Svg width={RING} height={RING} style={ringStyles.svg}>
        <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={track} strokeWidth={STROKE} fill="none" />
        {s > 0 ? (
          <Circle cx={RING / 2} cy={RING / 2} r={r} stroke={arc} strokeWidth={STROKE} fill="none"
            strokeLinecap={s < 1 ? 'round' : 'butt'} strokeDasharray={`${c * s} ${c}`} />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

const ringStyles = StyleSheet.create({
  box: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  svg: { position: 'absolute', left: 0, top: 0, transform: [{ rotate: '-90deg' }] },
});

/** The phone's clock as the app draws it ("2:00 pm", foodTimeline's clockOf). */
function clockAt(ms: number): string {
  const d = new Date(ms);
  return clockOf(d.getHours() * 60 + d.getMinutes());
}
const weekdayOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'long' });
/** C8's short date: "Tue, Oct 13". */
const shortDateOf = (iso: string) => new Date(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

const makeStyles = (colors: SemanticTokens) =>
  StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bgPrimary,
  },
  content: {
    flexGrow: 1,
    paddingBottom: 52,
  },
  card: {
    backgroundColor: colors.bgPrimary,
    borderColor: colors.border,
  },
  skeleton: { gap: spacing.md },
  bone: { height: 14, borderRadius: radius.control, backgroundColor: colors.border },
  boneTall: { height: layout.buttonHeight, borderRadius: radius.button, width: '100%' },
  // C8 C_fasting: the ring at the page's left, the side column 16 pt to its right (x 285 px); at 320 pt and
  // 130 percent the column wraps under the ring.
  ringRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.lg, rowGap: spacing.lg },
  ringTime: { ...typography.h2, letterSpacing: 1, color: colors.textPrimary, textAlign: 'center' },
  ringOf: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18, color: colors.textMuted, textAlign: 'center' },
  side: { flexGrow: 1, flexBasis: 140, minWidth: 0 },
  // C8: "Ends 2:00 pm" Inter 600 17, then the muted 16 pt lines on a 22 pt pitch.
  sideLead: { fontFamily: 'Inter_600SemiBold', fontWeight: '600', fontSize: 17, lineHeight: 22, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  sideMuted: { fontFamily: 'Inter_400Regular', fontSize: 16, lineHeight: 22, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  sideRun: { marginTop: 6 },
  window: { marginBottom: spacing.lg },
  windowLabel: { ...typography.eyebrow, color: colors.textMuted, marginBottom: spacing.sm },
  windowValue: {
    ...typography.display,
    fontSize: 60,
    lineHeight: 72,
    letterSpacing: 0,
    fontVariant: ['lining-nums', 'tabular-nums'],
    color: colors.textPrimary,
  },
  // The chips wrap to a second row at large text sizes so "12:12" never runs past its chip (320 pt at 130%).
  protocolRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  protocolBtn: {
    flexGrow: 1,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgPrimary,
  },
  protocolBtnActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  protocolText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    fontVariant: ['tabular-nums'],
    color: colors.textMuted,
  },
  protocolTextActive: {
    fontFamily: 'Inter_500Medium',
    color: colors.textOnAccent,
  },
  // C8: the button 16 pt under the ring (y 497 to 519 px).
  actionRow: {
    marginTop: spacing.lg,
  },
  actionBtn: {
    borderColor: colors.accent,
  },
  btnDisabled: {
    opacity: 0.6,
  },
  actionBtnText: {
    ...planStyleC.outlineLabel,
    color: colors.accentText,
  },
  runRemove: {
    alignItems: 'flex-start',
  },
  // C8: a 1 pt gold hairline 20 pt under the button (y 599 to 630 px).
  goldRule: {
    height: 1,
    backgroundColor: colors.data.goal,
    marginTop: 20,
    marginBottom: spacing.xl,
  },
  statsRows: {
    marginTop: spacing.xl,
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
    marginBottom: 0,
  },
  sectionTitle: {
    ...typography.eyebrow,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  // C8 C_fasting's rows (y 653-850 px): the date and the hours on one line, a hairline under each row.
  histRow: {
    paddingTop: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  histLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing.md,
  },
  histDate: {
    flex: 1,
    minWidth: 0,
    fontFamily: 'Inter_400Regular',
    fontSize: 16,
    lineHeight: 22,
    color: colors.textPrimary,
  },
  histHours: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
    color: colors.textPrimary,
  },
  histMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: spacing.md,
  },
  histMetaText: {
    flexShrink: 1,
    marginTop: 0,
  },
  historyTarget: {
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
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
