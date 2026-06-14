/**
 * ProgressScreen — Client progress dashboard.
 *
 * Displays weight trend, macros for today, body stats, and recent log entries.
 * The weight trend is rendered via ProgressChartCard (ED.4) — the SVG +
 * Reanimated card with a draw-in line, haptic scrubber, and auto-PR flag plus
 * inline Roman commentary on the same data — but ONLY when the
 * romanFirstPaymentBodyweightPolish flag is ON (audit R5 P2). When the flag is
 * OFF the screen falls back to LegacyWeightChart, a calm static SVG line that
 * never mounts the ED.4 card.
 */

import React, {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  Alert,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Circle, G, Path as SvgPath } from 'react-native-svg';
import { weightApi, logApi } from '../../services/api';
import { useMacroTargets } from '../../hooks/useMacroTargets';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import HapticPressable from '../../components/HapticPressable';
import { track } from '../../lib/analytics';
import { AnalyticsEvents } from '../../analytics/events';
import type { ShareCardMilestone } from '../share/ShareCardScreen';
import { useCurrentUser } from '../../hooks/useCurrentUser';

import { shadows as shadowTokens } from '../../theme/tokens';
import { WeightLog } from '../../types';
import { getTodayString, bucketDateLocal } from '../../utils/date';
import FadeInView from '../../components/FadeInView';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import { logger } from '../../utils/logger';
import CoachErrorState from '../../components/community/coach/CoachErrorState';
import ProgressChartCard from './progress/ProgressChartCard';
import { featureFlags } from '../../config/featureFlags';
// §2.7 Streak milestone — Roman marks 3 / 7 / 30-day logging streaks in his
// voice, beside his face (RomanStreakCard co-locates <RomanAvatar />). Gated
// behind featureFlags.romanChat (default OFF), the dedicated Roman flag.
import RomanStreakCard from '../../components/roman/RomanStreakCard';
import type { RomanStreakTier } from '../../lib/roman/copy';

type Period = '7D' | '30D' | '90D' | 'All';

/**
 * §2.7 streak-milestone tier selector. The spec surface is a 3/7/30-day
 * MILESTONE, not a permanent threshold bucket: Roman speaks ONLY on the exact
 * milestone day. Day 8 through 29 returns null (never claims "Seven days"), and
 * day 31+ returns null (never claims "Thirty days") — the 30-day celebration
 * (composed, no exclamation) fires on day 30 only. Every non-milestone
 * day renders nothing rather than invent a celebratory line. Exported so the
 * behaviour is unit-tested directly (host-wiring test) without rendering the
 * full chart-heavy screen.
 */
export function streakMilestoneTier(loggingStreak: number): RomanStreakTier | null {
  if (loggingStreak === 30) return 30;
  if (loggingStreak === 7) return 7;
  if (loggingStreak === 3) return 3;
  return null;
}

/**
 * Typed parser for one weight-history row from the API. The server response is
 * untyped at the boundary and may send either `date` or `created_at`, and
 * either `weight_lbs` or `weight`. This validates the row shape and normalises
 * it into a `WeightLog`, returning `null` for any row missing the fields a
 * `WeightLog` requires (an id and a numeric weight) so callers can drop it
 * instead of force-casting the untyped result through a double assertion (R69).
 * The date is bucketed to the user's LOCAL calendar day so the streak compare
 * is tz-correct on either side of the date line (see audit P0-3).
 */
export function parseWeightLogRow(row: unknown, fallbackUserId: string): WeightLog | null {
  if (typeof row !== 'object' || row === null) return null;
  const r = row as Record<string, unknown>;

  if (typeof r.id !== 'string' || r.id.length === 0) return null;

  const rawWeight = typeof r.weight_lbs === 'number' ? r.weight_lbs : r.weight;
  if (typeof rawWeight !== 'number' || Number.isNaN(rawWeight)) return null;

  const rawDateSource = typeof r.date === 'string' ? r.date : r.created_at;
  const rawDate = typeof rawDateSource === 'string' ? rawDateSource : '';
  const normDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
    ? rawDate.slice(0, 10)
    : bucketDateLocal(new Date(rawDate));

  const createdAt = typeof r.created_at === 'string' ? r.created_at : rawDate;

  return {
    id: r.id,
    userId: typeof r.user_id === 'string' && r.user_id.length > 0 ? r.user_id : fallbackUserId,
    coachId: '',
    date: normDate,
    weight: rawWeight,
    unit: 'lbs',
    notes: typeof r.notes === 'string' ? r.notes : '',
    createdAt,
  };
}

const SCREEN_WIDTH = Dimensions.get('window').width;

function CalorieRing({
  eaten,
  target,
  size = 120,
}: {
  eaten: number;
  target: number;
  size?: number;
}) {
  const { colors } = useTheme();
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = target > 0 ? Math.min(eaten / target, 1) : 0;
  const dashOffset = circumference * (1 - pct);
  const center = size / 2;

  const pctRound = Math.round(pct * 100);
  const a11yLabel =
    target > 0
      ? `Calories: ${Math.round(eaten)} of ${target}, ${pctRound} percent of target`
      : `Calories: ${Math.round(eaten)}, no daily target set`;

  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={a11yLabel}
    >
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${center}, ${center}`}>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={colors.surfaceElevated}
            strokeWidth={strokeWidth}
            fill="none"
          />
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={colors.primary}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text
          style={{
            fontFamily: 'CormorantGaramond_400Regular',
            fontSize: 26,
            lineHeight: 30,
            letterSpacing: 0.4,
            fontWeight: '400',
            color: colors.textPrimary,
          }}
        >
          {Math.round(eaten)}
        </Text>
        <Text
          style={{
            fontFamily: 'Inter_500Medium',
            fontSize: 10,
            letterSpacing: 1.5,
            textTransform: 'uppercase',
            color: colors.textMuted,
            marginTop: 2,
          }}
        >
          / {target} kcal
        </Text>
      </View>
    </View>
  );
}

// Legacy static weight chart (audit R5 P2): the flag-OFF surface. A calm,
// non-animated SVG line — no draw-in, no haptic scrubber, no auto-PR, and
// crucially NO ED.4 ProgressChartCard mount. It plots the same {x: epoch ms,
// y: weight} series the card would, scaled into the given height and the
// available screen width, so the flag-OFF path stays a faithful but quiet
// rendering of the trend.
function LegacyWeightChart({
  data,
  height,
  lineColor,
  testID,
}: {
  data: { x: number; y: number }[];
  height: number;
  lineColor: string;
  testID?: string;
}) {
  // chartContainer has 16px horizontal padding each side inside a 24px screen
  // margin each side, so the inner drawable width is the screen minus those.
  const width = SCREEN_WIDTH - 24 * 2 - 16 * 2;
  const PAD = 8;

  const { path, points } = useMemo(() => {
    if (data.length < 2) {
      return { path: '', points: [] as { cx: number; cy: number }[] };
    }
    const xs = data.map((d) => d.x);
    const ys = data.map((d) => d.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const innerW = width - PAD * 2;
    const innerH = height - PAD * 2;

    const scaled = data.map((d) => {
      const cx = PAD + ((d.x - minX) / spanX) * innerW;
      // Invert Y so a higher weight sits nearer the top of the canvas.
      const cy = PAD + (1 - (d.y - minY) / spanY) * innerH;
      return { cx, cy };
    });

    const d = scaled
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.cx.toFixed(2)},${p.cy.toFixed(2)}`)
      .join(' ');
    return { path: d, points: scaled };
  }, [data, height, width]);

  if (!path) return null;

  return (
    <Svg
      width={width}
      height={height}
      testID={testID}
      accessibilityRole="image"
      accessibilityLabel="Weight trend line chart"
    >
      <SvgPath
        d={path}
        stroke={lineColor}
        strokeWidth={2}
        fill="none"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => (
        <Circle key={i} cx={p.cx} cy={p.cy} r={2.5} fill={lineColor} />
      ))}
    </Svg>
  );
}

export default function ProgressScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const navigation = useNavigation<NavigationProp<ParamListBase>>();
  const currentUser = useCurrentUser();
  const userId = currentUser?.id ?? null;

  // Server-authoritative macro targets (AsyncStorage used only as cache).
  const macroTargets = useMacroTargets();
  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [period, setPeriod] = useState<Period>('30D');
  const [showLogModal, setShowLogModal] = useState(false);
  const [newWeight, setNewWeight] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [todayMacros, setTodayMacros] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [loggingStreak, setLoggingStreak] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  // ED.4 (audit R3 P3): the chart-error retry calls loadData directly, but
  // `refreshing` only reflects pull-to-refresh — so the retry button stayed
  // enabled and could be spammed. Track the direct retry separately and disable
  // the button while it is in flight.
  const [chartRetrying, setChartRetrying] = useState(false);
  // Synchronous re-entrancy latch: state updates are async, so two taps in the
  // SAME tick both observe `chartRetrying === false` and could each start a
  // loadData(). This ref flips synchronously before the state set, so a
  // same-tick second tap early-returns and only one loadData() runs.
  const chartRetryingRef = useRef(false);
  // ED.4 (audit R2 P2): a weight-history fetch failure used to fall through to
  // the benign "log your weight" empty copy, hiding the error from the client.
  // Track it so the chart slot can render an honest Roman-tone retry state.
  const [weightHistoryError, setWeightHistoryError] = useState(false);

  const loadData = useCallback(async () => {
    if (!userId) return;

    const periodDays: Record<Period, number | null> = { '7D': 7, '30D': 30, '90D': 90, All: null };
    const days = periodDays[period] || 365;

    try {
      const res = await weightApi.getHistory(days);
      // The fetch succeeded — clear any prior error so the chart (or honest
      // empty copy) renders instead of the retry state.
      setWeightHistoryError(false);
      // Boundary parse: each untyped server row is validated/normalised into a
      // WeightLog via parseWeightLogRow; rows missing an id or numeric weight
      // are dropped rather than force-cast through a double assertion (R69).
      const rawRows: unknown[] = Array.isArray(res.data) ? res.data : [];
      const logs: WeightLog[] = rawRows
        .map((row) => parseWeightLogRow(row, userId))
        .filter((x): x is WeightLog => x !== null);
      // Sort by date ascending
      logs.sort((a, b) => a.date.localeCompare(b.date));
      setWeightLogs(logs);

      // Calculate logging streak — bucket every comparison day in the user's
      // local timezone so a Sydney user who logs at 09:00 local doesn't see
      // the streak reset because UTC is still on yesterday's date.
      let streak = 0;
      const now = new Date();
      for (let i = 0; i < 60; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = bucketDateLocal(d);
        if (logs.some((l) => l.date === dateStr)) {
          streak++;
        } else if (i > 0) {
          break;
        }
      }
      setLoggingStreak(streak);
    } catch (err) {
      // The weight-history load failed. Record it so the chart slot renders an
      // honest retry state instead of the benign "log your weight" empty copy
      // (audit R2 P2). Never swallow — log via the shared logger (Law #36).
      setWeightHistoryError(true);
      logger.error('progress', 'weight history load failed', {
        reason: errorMessage(err, 'weight history load failed'),
      });
    }

    // Load today's macros from API
    try {
      const today = getTodayString();
      const dailyRes = await logApi.getDaily(today);
      const data = dailyRes.data;
      setTodayMacros({
        calories: data.total_calories || 0,
        protein: data.total_protein_g || 0,
        carbs: data.total_carbs_g || 0,
        fat: data.total_fat_g || 0,
      });
    } catch (err) {
      // Read-only; today's macro summary stays at previous value or zero.
      console.error('ProgressScreen: today macros load failed', err);
    }
  }, [userId, period]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  // Chart-error retry: mark the retry in flight BEFORE the call so the button
  // disables, and clear it once the call settles (success or failure) so a
  // genuine re-retry stays possible. loadData never rejects (it handles its own
  // errors and sets weightHistoryError), but the finally keeps the latch honest
  // even if that changes.
  const onChartRetry = useCallback(async () => {
    // Synchronous guard FIRST so a same-tick double-tap cannot start two loads.
    if (chartRetryingRef.current) return;
    chartRetryingRef.current = true;
    setChartRetrying(true);
    try {
      await loadData();
    } finally {
      chartRetryingRef.current = false;
      setChartRetrying(false);
    }
  }, [loadData]);

  const handleLogWeight = async () => {
    if (!newWeight) return;
    const w = parseFloat(newWeight);
    if (isNaN(w) || w <= 0) {
      Alert.alert('Invalid weight', 'Please enter a valid number.');
      return;
    }
    try {
      await weightApi.log({
        weight_lbs: w,
        date: getTodayString(),
        notes: newNotes || undefined,
      });
    } catch (err) {
      // Destructive write: surface failure so the user can retry before
      // dismissing the modal.
      console.error('ProgressScreen: weight log failed', err);
      Alert.alert("Couldn't log weight", errorMessage(err, 'Please try again.'));
      return;
    }
    setNewWeight('');
    setNewNotes('');
    setShowLogModal(false);
    loadData();
  };

  const latestWeight = weightLogs.length > 0 ? weightLogs[weightLogs.length - 1].weight : null;
  const startWeight = weightLogs.length > 0 ? weightLogs[0].weight : null;
  const goalWeight = macroTargets?.goalWeight || null;
  const change = latestWeight && startWeight ? latestWeight - startWeight : null;

  // BMI calculation — uses latest weight + profile height
  let bmi: number | null = null;
  let bmiCategory: string | null = null;
  let bmiColor = colors.textMuted;
  if (latestWeight && macroTargets?.height) {
    const heightM = macroTargets.height * 0.0254; // inches to meters
    bmi = latestWeight * 0.453592 / (heightM * heightM); // lbs to kg / m^2
    if (bmi < 18.5) { bmiCategory = 'Underweight'; bmiColor = colors.warning; }
    else if (bmi < 25) { bmiCategory = 'Normal'; bmiColor = colors.success; }
    else if (bmi < 30) { bmiCategory = 'Overweight'; bmiColor = colors.warning; }
    else { bmiCategory = 'Obese'; bmiColor = colors.error; }
  }

  // Macro adherence
  const macroData = [
    {
      label: 'P',
      actual: todayMacros.protein,
      target: macroTargets?.protein || 0,
      color: colors.protein,
    },
    {
      label: 'C',
      actual: todayMacros.carbs,
      target: macroTargets?.carbs || 0,
      color: colors.carbs,
    },
    {
      label: 'F',
      actual: todayMacros.fat,
      target: macroTargets?.fat || 0,
      color: colors.fat,
    },
  ];

  // Chart data for ProgressChartCard — x is the *epoch milliseconds* of the log
  // day (parsed as midnight local); the card derives its own ordering and
  // axis from this {x, y} series. See audit P0-6.
  const chartData = useMemo(
    () =>
      weightLogs.map((log) => ({
        x: new Date(`${log.date}T00:00:00`).getTime(),
        y: log.weight,
      })),
    [weightLogs],
  );

  const periods: Period[] = ['7D', '30D', '90D', 'All'];

  // ED.4 flag gate (audit R5 P2): the ProgressChartCard animated surface only
  // mounts when romanFirstPaymentBodyweightPolish is ON. When OFF the screen
  // keeps the legacy static chart/empty state and never mounts the ED.4 card.
  const ed4ChartEnabled = featureFlags.romanFirstPaymentBodyweightPolish;

  // §2.7 Streak milestone tier from the real loggingStreak. See
  // streakMilestoneTier below: Roman speaks ONLY on the exact milestone day.
  const streakTier: RomanStreakTier | null = streakMilestoneTier(loggingStreak);
  const streakFirstName = (currentUser?.firstName ?? '').trim() || 'there';

  return (
    <View style={styles.container}>
      <ScrollView
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
          <Text style={styles.title}>Progress</Text>
          <View style={styles.headerRight}>
            {loggingStreak > 0 && (
              <Text style={styles.runText}>Day {loggingStreak}</Text>
            )}
            {/* Round 3: Progress now lives inside MoreStack, so Report is a sibling —
                navigate directly instead of through the old ProfileStack parent. */}
            {/* Phase 11: Share streak card when streak >= 3 days */}
            {loggingStreak >= 3 && (
              <HapticPressable
                intent="light"
                style={{ marginRight: 8, padding: 4 }}
                onPress={() => {
                  const milestone: ShareCardMilestone = {
                    variant: 'streak',
                    value: String(loggingStreak),
                    label: loggingStreak === 1 ? 'Day Streak' : 'Day Streak',
                  };
                  track(AnalyticsEvents.REFERRAL_SHARE_INITIATED, { source: 'progress_screen' });
                  navigation.navigate('ShareCard', { milestone } as never);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Share ${loggingStreak}-day streak`}
              >
                <Ionicons name="share-social-outline" size={22} color={colors.primary} />
              </HapticPressable>
            )}
            <TouchableOpacity
              onPress={() => navigation.navigate('Report')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="View progress report"
              accessibilityRole="button"
            >
              <Ionicons name="document-text-outline" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* §2.7 Roman streak milestone — voiced beside his face. HIDE-UNTIL-LIVE
            (P1-B-02): `streakTier` is derived from a CLIENT-SIDE recomputed
            logging count (see the loggingStreak fetch/count above), which is
            not an authoritative backend milestone event — a bounded history
            window, local date bucketing, or a stale cache could surface a
            "Thirty days" line that the server cannot vouch for. The card is
            therefore additionally gated behind featureFlags.romanStreakBackendLive
            (default OFF) and stays hidden until the backend exposes an
            authoritative streak-milestone event.
            Follow-up (roman-streak-backend): when the backend exposes an
            authoritative milestone event (event id, date, tier) per
            AI_BUTLER_ROMAN_IDENTITY_SPEC §2.7, drive `streakTier` from that
            event instead of the local count and flip
            romanStreakBackendLive on. Until then, the card is hidden. */}
        {featureFlags.romanChat && featureFlags.romanStreakBackendLive && streakTier !== null && (
          <FadeInView>
            <View style={styles.romanStreakWrap}>
              <RomanStreakCard
                tier={streakTier}
                firstName={streakFirstName}
                mode={streakTier === 3 ? 'default' : 'celebration'}
                testID="roman-streak-card"
              />
            </View>
          </FadeInView>
        )}

        {/* Calorie Ring + Macros */}
        <FadeInView>
          <View style={styles.ringCard}>
            <CalorieRing
              eaten={todayMacros.calories}
              target={macroTargets?.calories || 2000}
            />
            <View style={styles.ringMacros}>
              {macroData.map((m) => {
                const pct = m.target > 0 ? Math.min((m.actual / m.target) * 100, 100) : 0;
                return (
                  <View key={m.label} style={styles.ringMacroItem}>
                    <View style={styles.ringMacroHeader}>
                      <View style={[styles.ringMacroDot, { backgroundColor: m.color }]} />
                      <Text style={styles.ringMacroLabel}>{m.label === 'P' ? 'Protein' : m.label === 'C' ? 'Carbs' : 'Fat'}</Text>
                    </View>
                    <View style={styles.ringMacroTrack}>
                      <View
                        style={[styles.ringMacroFill, { width: `${pct}%`, backgroundColor: m.color }]}
                      />
                    </View>
                    <Text style={styles.ringMacroValue}>
                      {Math.round(m.actual)}/{Math.round(m.target)}g
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        </FadeInView>

        {/* Weight Stats Row */}
        <FadeInView delay={50}>
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{startWeight ? Math.round(startWeight) : '--'}</Text>
            <Text style={styles.statLabel}>Start</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.primary }]}>
              {latestWeight ? Math.round(latestWeight * 10) / 10 : '--'}
            </Text>
            <Text style={styles.statLabel}>Current</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{goalWeight ? Math.round(goalWeight) : '--'}</Text>
            <Text style={styles.statLabel}>Goal</Text>
          </View>
          {change !== null && (
            <View style={styles.statCard}>
              <Text
                style={[
                  styles.statValue,
                  { color: change <= 0 ? colors.success : colors.warning },
                ]}
              >
                {change > 0 ? '+' : ''}
                {change.toFixed(1)}
              </Text>
              <Text style={styles.statLabel}>Change</Text>
            </View>
          )}
        </View>
        </FadeInView>

        {/* Period Selector */}
        <View style={styles.periodRow}>
          {periods.map((p) => (
            <TouchableOpacity
              key={p}
              style={[styles.periodBtn, period === p && styles.periodBtnActive]}
              onPress={() => setPeriod(p)}
              accessibilityLabel={`Show ${p} period`}
              accessibilityRole="button"
            >
              <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                {p}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Goal Progress Card */}
        {latestWeight && goalWeight && startWeight && startWeight !== goalWeight && (
          <FadeInView delay={50}>
            <View style={styles.goalCard}>
              <View style={styles.goalHeader}>
                <View style={styles.goalRule} />
                <Text style={styles.goalTitle}>Goal Progress</Text>
              </View>
              <View style={styles.goalTrack}>
                <View
                  style={[
                    styles.goalFill,
                    {
                      width: `${Math.min(Math.max(((startWeight - latestWeight) / (startWeight - goalWeight)) * 100, 0), 100)}%`,
                    },
                  ]}
                />
              </View>
              <View style={styles.goalLabels}>
                <Text style={styles.goalLabelText}>{Math.round(startWeight)} lbs</Text>
                <Text style={[styles.goalLabelText, { color: colors.primary, fontFamily: 'Inter_500Medium', fontWeight: '500' }]}>
                  {Math.round(Math.min(Math.max(((startWeight - latestWeight) / (startWeight - goalWeight)) * 100, 0), 100))}%
                </Text>
                <Text style={styles.goalLabelText}>{Math.round(goalWeight)} lbs</Text>
              </View>
            </View>
          </FadeInView>
        )}

        {/* Weight Chart — ED.4: ProgressChartCard (draw-in animation, haptic
            scrubber, auto-PR flag + Roman commentary). chartData is already the
            {x: epoch ms, y: weight} shape ProgressChartCard expects, so it maps
            through without an adapter. */}
        {weightHistoryError ? (
          // Honest load-failure state (audit R2 P2): a fetch error must NOT be
          // dressed up as the benign "log your weight" empty copy. CoachErrorState
          // co-mounts Roman's neutral face, an honest one-sentence line in his
          // register (no contractions, no exclamation), and a retry action.
          <View style={styles.chartContainer}>
            <Text style={styles.chartTitle}>Weight Trend</Text>
            <CoachErrorState
              message="That chart did not load. I will try again."
              onRetry={onChartRetry}
              retrying={chartRetrying}
              testID="progress-weight-chart-error"
            />
          </View>
        ) : chartData.length >= 2 ? (
          <View style={styles.chartContainer}>
            <Text style={styles.chartTitle}>Weight Trend</Text>
            <View style={styles.chartInner}>
              {ed4ChartEnabled ? (
                // ED.4 surface (flag ON): the animated ProgressChartCard.
                <ProgressChartCard
                  data={chartData}
                  liftName="Weight"
                  height={180}
                  testID="progress-weight-chart"
                  // Bodyweight is a trend, not a performance record — a rising
                  // weight is not a "personal best" (audit R3 P2). PR detection
                  // / commentary stays OFF here; the path is intact for a
                  // future real lift series.
                  enablePRDetection={false}
                />
              ) : (
                // Legacy surface (flag OFF, audit R5 P2): a calm static line,
                // no draw-in animation, no haptic scrubber, no ED.4 card mount.
                <LegacyWeightChart
                  data={chartData}
                  height={180}
                  lineColor={colors.primary}
                  testID="progress-weight-chart-legacy"
                />
              )}
            </View>
          </View>
        ) : (
          <View style={styles.emptyChart}>
            <Ionicons name="analytics-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyText}>
              {weightLogs.length === 0
                ? 'Log your weight to see your chart'
                : 'Need at least 2 entries for a chart'}
            </Text>
          </View>
        )}

        {/* Body Stats */}
        <FadeInView delay={200}>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Body Stats</Text>
          <View style={styles.bodyStatsGrid}>
            {bmi !== null && (
              <View style={styles.bodyStatCard}>
                <Text style={[styles.bodyStatValue, { color: bmiColor }]}>
                  {bmi.toFixed(1)}
                </Text>
                <Text style={styles.bodyStatLabel}>BMI</Text>
                <Text style={[styles.bodyStatSub, { color: bmiColor }]}>{bmiCategory}</Text>
              </View>
            )}
            {macroTargets?.tdee && (
              <View style={styles.bodyStatCard}>
                <Text style={styles.bodyStatValue}>{Math.round(macroTargets.tdee)}</Text>
                <Text style={styles.bodyStatLabel}>TDEE</Text>
              </View>
            )}
          </View>
        </View>
        </FadeInView>

        {/* Recent Weight Logs */}
        {weightLogs.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Entries</Text>
            {weightLogs
              .slice()
              .reverse()
              .slice(0, 10)
              .map((log) => (
                <View key={log.id} style={styles.logRow}>
                  <Text style={styles.logDate}>{log.date}</Text>
                  <View style={styles.logRight}>
                    <Text style={styles.logWeight}>
                      {log.weight} {log.unit}
                    </Text>
                    {log.notes ? (
                      <Text style={styles.logNotes} numberOfLines={1}>
                        {log.notes}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
          </View>
        )}
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowLogModal(true)}
        activeOpacity={0.85}
        accessibilityLabel="Log weight"
        accessibilityRole="button"
      >
        {/* Round 3: hex → theme token */}
        <Ionicons name="add" size={28} color={colors.textOnPrimary} />
      </TouchableOpacity>

      {/* Weight Log Modal */}
      <Modal visible={showLogModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log Weight</Text>
              <TouchableOpacity
                onPress={() => setShowLogModal(false)}
                accessibilityLabel="Close log weight modal"
                accessibilityRole="button"
              >
                <Ionicons name="close" size={24} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Weight (lbs)"
              placeholderTextColor={colors.textMuted}
              keyboardType="decimal-pad"
              value={newWeight}
              onChangeText={setNewWeight}
              autoFocus
              accessibilityLabel="Enter weight in pounds"
            />
            <TextInput
              style={[styles.input, { marginTop: 12 }]}
              placeholder="Notes (optional)"
              placeholderTextColor={colors.textMuted}
              value={newNotes}
              onChangeText={setNewNotes}
              accessibilityLabel="Enter optional notes"
            />
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={handleLogWeight}
              accessibilityLabel="Save weight log entry"
              accessibilityRole="button"
            >
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 32,
    lineHeight: 35,
    letterSpacing: 0.6,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  runText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    letterSpacing: 0.4,
    color: colors.textSecondary,
  },
  goalRule: {
    width: 18,
    height: 1,
    backgroundColor: colors.border,
  },
  romanStreakWrap: {
    marginHorizontal: 24,
    marginBottom: 16,
  },
  ringCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: colors.surface,
    borderRadius: 4,
    padding: 16,
    gap: 20,
  },
  ringMacros: {
    flex: 1,
    gap: 10,
  },
  ringMacroItem: {
    gap: 3,
  },
  ringMacroHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  ringMacroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  ringMacroLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  ringMacroTrack: {
    height: 6,
    backgroundColor: colors.surfaceElevated,
    borderRadius: 3,
    overflow: 'hidden',
  },
  ringMacroFill: {
    height: '100%',
    borderRadius: 3,
  },
  ringMacroValue: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
    color: colors.textMuted,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 4,
    padding: 14,
    alignItems: 'center',
    gap: 4,
  },
  statValue: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  statLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  periodRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 16,
  },
  periodBtn: {
    flex: 1,
    paddingVertical: 8,
    alignItems: 'center',
    borderRadius: 0,
    backgroundColor: colors.surface,
  },
  periodBtnActive: {
    backgroundColor: colors.primary,
  },
  periodText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.4,
    color: colors.textSecondary,
  },
  periodTextActive: {
    color: colors.textOnPrimary,
  },
  goalCard: {
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: colors.surface,
    borderRadius: 4,
    padding: 16,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  goalTitle: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  goalTrack: {
    height: 10,
    backgroundColor: colors.primaryPale,
    borderRadius: 2,
    overflow: 'hidden',
  },
  goalFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  goalLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  goalLabelText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
  },
  chartContainer: {
    marginHorizontal: 24,
    marginBottom: 24,
    backgroundColor: colors.surface,
    borderRadius: 4,
    padding: 16,
    overflow: 'hidden',
  },
  chartTitle: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 8,
  },
  chartInner: {
    height: 200,
  },
  emptyChart: {
    height: 160,
    marginHorizontal: 24,
    marginBottom: 24,
    backgroundColor: colors.surface,
    borderRadius: 4,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
  section: {
    paddingHorizontal: 24,
    marginBottom: 24,
  },
  sectionTitle: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 12,
  },
  bodyStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  bodyStatCard: {
    backgroundColor: colors.surface,
    borderRadius: 2,
    padding: 16,
    alignItems: 'center',
    minWidth: (SCREEN_WIDTH - 58) / 2,
    flex: 1,
    gap: 2,
  },
  bodyStatValue: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
    textTransform: 'capitalize',
  },
  bodyStatLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    color: colors.textMuted,
  },
  bodyStatSub: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
  },
  logRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  logDate: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  logRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  logWeight: {
    fontFamily: 'Inter_500Medium',
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  logNotes: {
    fontSize: 12,
    color: colors.textMuted,
    maxWidth: 160,
  },
  fab: {
    position: 'absolute',
    bottom: 90,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    ...shadowTokens.md,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(26,26,24,0.5)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 4,
    padding: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontSize: 24,
    lineHeight: 29,
    letterSpacing: 0.5,
    fontWeight: '400',
    color: colors.textPrimary,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 2,
    padding: 14,
    fontSize: 16,
    color: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.border,
  },
  saveBtn: {
    marginTop: 20,
    backgroundColor: colors.primary,
    borderRadius: 2,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: colors.textOnPrimary,
  },
  });
