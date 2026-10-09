/**
 * ProgressScreen — Client progress dashboard.
 *
 * Displays weight trend, macros for today, body stats, and recent log entries.
 * The weight trend is rendered via ProgressChartCard (ED.4) — the SVG +
 * Reanimated card with a draw-in line, haptic scrubber, and auto-PR flag plus
 * inline Roman commentary on the same data — but ONLY when the
 * romanFirstPaymentBodyweightPolish flag is ON (audit R5 P2). When the flag is
 * OFF (the shipped build) the screen shows WeightTrendChart, a calm static
 * line drawn like progress-details/luxury.jpg, which never mounts the ED.4 card.
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
  RefreshControl,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Pressable,
  InputAccessoryView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { weightApi, logApi } from '../../services/api';
import { useMacroTargets } from '../../hooks/useMacroTargets';
import { useNavigation, NavigationProp, ParamListBase } from '@react-navigation/native';
import HapticPressable from '../../components/HapticPressable';
import { track } from '../../lib/analytics';
import { AnalyticsEvents } from '../../analytics/events';
import type { ShareCardMilestone } from '../share/ShareCardScreen';
import { useCurrentUser } from '../../hooks/useCurrentUser';

import { radius, shadows as shadowTokens, typography, type SemanticTokens } from '../../theme/tokens';
import { WeightLog } from '../../types';
import { getTodayString, bucketDateLocal } from '../../utils/date';
import { parseWeightLogRow, weightHistoryRows } from './progress/weightHistory';

export { parseWeightLogRow, weightHistoryRows };
import FadeInView from '../../components/FadeInView';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { errorMessage } from '../../types/common';
import { logger } from '../../utils/logger';
import CoachErrorState from '../../components/community/coach/CoachErrorState';
import ProgressChartCard from './progress/ProgressChartCard';
import PeriodTabs from '../../components/progress/PeriodTabs';
import WeightTrendChart from '../../components/progress/WeightTrendChart';
import { periodSummary, type Period } from '../../components/progress/progressFormat';
import TodayFood, { type TodayState } from '../../components/progress/TodayFood';
import WeighInRows from '../../components/progress/WeighInRows';
import { Headline, Lede, PrimaryButton, QuietOverline, QuietRow, QuietSection } from '../../ui';
import { featureFlags } from '../../config/featureFlags';
// §2.7 Streak milestone — Roman marks 3 / 7 / 30-day logging streaks in his
// voice, beside his face (RomanStreakCard co-locates <RomanAvatar />). Gated
// behind featureFlags.romanChat (default OFF), the dedicated Roman flag.
import RomanStreakCard from '../../components/roman/RomanStreakCard';
import type { RomanStreakTier } from '../../lib/roman/copy';

// "All" asks for every weigh-in (the server has no cap), not the last year.
const ALL_DAYS = 3650;

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

/** Server bounds for weight_lbs (backend weight DTO); checked before sending. */
const WEIGHT_MIN_LBS = 40;
const WEIGHT_MAX_LBS = 1500;
const WEIGHT_KEYBOARD_ACCESSORY_ID = 'progress-log-weight-keyboard';
const LOG_DATE_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LOG_DATE_MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * U9 (FW-BODY-128): "2026-10-07" -> "Wed 7 Oct". The value is a calendar day,
 * so it is read as local Y-M-D (no UTC shift). Anything else passes through.
 */
export function formatLogDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return date;
  return `${LOG_DATE_WEEKDAYS[d.getDay()]} ${d.getDate()} ${LOG_DATE_MONTHS[d.getMonth()]}`;
}

export default function ProgressScreen() {
  const { colors, semanticColors: sc } = useTheme();
  const styles = useMemo(() => makeStyles(colors, sc), [colors, sc]);
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
  // B1 (FW-BODY-128): Save is disabled while the POST is in flight so a
  // second tap cannot create a duplicate entry.
  const [savingWeight, setSavingWeight] = useState(false);
  const savingWeightRef = useRef(false);
  const [todayMacros, setTodayMacros] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  // U3 (WEIGH-KB-128): until today's read lands (or if it fails) no number is claimed.
  const [todayState, setTodayState] = useState<TodayState>('loading');
  // U2: the history response carries the profile height for BMI.
  const [heightCm, setHeightCm] = useState<number | null>(null);
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

    const periodDays: Record<Period, number> = { '7D': 7, '30D': 30, '90D': 90, All: ALL_DAYS };
    const days = periodDays[period];

    try {
      const res = await weightApi.getHistory(days);
      // The fetch succeeded — clear any prior error so the chart (or honest
      // empty copy) renders instead of the retry state.
      setWeightHistoryError(false);
      // Boundary parse: each untyped server row is validated/normalised into a
      // WeightLog via parseWeightLogRow; rows missing an id or numeric weight
      // are dropped rather than force-cast through a double assertion (R69).
      const rawRows: unknown[] = weightHistoryRows(res.data);
      const logs: WeightLog[] = rawRows
        .map((row) => parseWeightLogRow(row, userId))
        .filter((x): x is WeightLog => x !== null);
      // Sort by date ascending
      logs.sort((a, b) => a.date.localeCompare(b.date));
      setWeightLogs(logs);
      const h = (res.data as { height_cm?: unknown } | null)?.height_cm;
      setHeightCm(typeof h === 'number' && h > 0 ? h : null);

      // Calculate logging streak — bucket every comparison day in the user's
      // local timezone so a Sydney user who logs at 09:00 local doesn't see
      // the streak reset because UTC is still on yesterday's date.
      const runLogs = days >= 60 ? logs : weightHistoryRows((await weightApi.getHistory(60)).data)
        .map((row) => parseWeightLogRow(row, userId)).filter((row): row is WeightLog => row !== null);
      let streak = 0;
      const now = new Date();
      for (let i = 0; i < 60; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = bucketDateLocal(d);
        if (runLogs.some((l) => l.date === dateStr)) {
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
      setTodayState('ready');
    } catch (err) {
      // Read-only: say it did not load instead of showing zeros as fact.
      setTodayState('error');
      logger.error('progress', 'today food load failed', {
        reason: errorMessage(err, 'today food load failed'),
      });
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

  const closeLogModal = () => {
    Keyboard.dismiss();
    setShowLogModal(false);
  };

  const handleLogWeight = async () => {
    if (savingWeightRef.current) return;
    const w = parseFloat(newWeight.replace(',', '.'));
    if (isNaN(w)) {
      Alert.alert('Weight not saved', 'Enter your weight as a number.');
      return;
    }
    // U6 (FW-BODY-128): the server rejects values outside 40-1,500 lb with a
    // raw "Bad Request"; say the real range before sending.
    if (w < WEIGHT_MIN_LBS || w > WEIGHT_MAX_LBS) {
      Alert.alert('Weight not saved', 'Enter a weight between 40 and 1,500 lb.');
      return;
    }
    Keyboard.dismiss();
    savingWeightRef.current = true;
    setSavingWeight(true);
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
    } finally {
      savingWeightRef.current = false;
      setSavingWeight(false);
    }
    setNewWeight('');
    setNewNotes('');
    setShowLogModal(false);
    loadData();
  };

  const latestWeight = weightLogs.length > 0 ? weightLogs[weightLogs.length - 1].weight : null;
  const startWeight = weightLogs.length > 0 ? weightLogs[0].weight : null;
  // U1 (FW-BODY-128): the consultation saves the goal on the profile
  // (target_weight_lbs); the macro-target cache never carried it.
  const goalWeight =
    currentUser?.profile?.target_weight_lbs || macroTargets?.goalWeight || null;
  const change = latestWeight && startWeight ? latestWeight - startWeight : null;
  const runCount = loggingStreak === 60 ? '60+' : String(loggingStreak);
  const runLabel = `${runCount} days in a row with a weigh-in`;

  // BMI (U2): server height first (height_cm on the history response), then
  // the cached macro-target height in inches. Monochrome: a category is a
  // word, not a warning colour.
  let bmi: number | null = null;
  let bmiCategory: string | null = null;
  const heightM = heightCm ? heightCm / 100 : macroTargets?.height ? macroTargets.height * 0.0254 : null;
  if (latestWeight && heightM) {
    bmi = latestWeight * 0.453592 / (heightM * heightM); // lbs to kg / m^2
    if (bmi < 18.5) bmiCategory = 'Underweight';
    else if (bmi < 25) bmiCategory = 'Normal';
    else if (bmi < 30) bmiCategory = 'Overweight';
    else bmiCategory = 'Obese';
  }
  const tdee = macroTargets?.tdee ? Math.round(macroTargets.tdee) : null;

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

  // The line under the chart reads the period's own first and last entry.
  const summary =
    weightLogs.length >= 2
      ? periodSummary(weightLogs[0].weight, weightLogs[weightLogs.length - 1].weight, period, null)
      : null;

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
                    value: runCount,
                    label: 'days in a row with a weigh-in',
                  };
                  track(AnalyticsEvents.REFERRAL_SHARE_INITIATED, { source: 'progress_screen' });
                  navigation.navigate('ShareCard', { milestone } as never);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Share ${runLabel}`}
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
        {loggingStreak > 0 && <Text style={[styles.runText, { marginHorizontal: 24, marginBottom: 8 }]}>{runLabel}</Text>}

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
                style={styles.statValue}
                testID="progress-weight-change"
              >
                {change > 0 ? '+' : ''}
                {change.toFixed(1)}
              </Text>
              <Text style={styles.statLabel}>Change</Text>
            </View>
          )}
        </View>
        </FadeInView>

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

        {/* Weight trend — ED.4: ProgressChartCard (draw-in animation, haptic
            scrubber, auto-PR flag + Roman commentary) when its flag is on;
            chartData is already the {x: epoch ms, y: weight} shape it expects. */}
        <QuietSection style={styles.trend}>
          <QuietOverline>Weight trend</QuietOverline>
          <PeriodTabs value={period} onChange={setPeriod} />
          {weightHistoryError ? (
            // Honest load-failure state (audit R2 P2): a fetch error must NOT be
            // dressed up as the benign empty copy. CoachErrorState co-mounts
            // Roman's neutral face, an honest one-sentence line in his register
            // (no contractions, no exclamation), and a retry action.
            <CoachErrorState
              message="The weight chart did not load. Pull down to try again."
              onRetry={onChartRetry}
              retrying={chartRetrying}
              testID="progress-weight-chart-error"
            />
          ) : chartData.length >= 2 ? (
            <View>
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
                // Static surface (flag OFF, audit R5 P2; the shipped build): a
                // calm line, no draw-in, no scrubber, no ED.4 card mount.
                <WeightTrendChart data={chartData} testID="progress-weight-chart-legacy" />
              )}
              {summary ? (
                <View style={styles.summary}>
                  <Text style={styles.summaryHeadline}>{summary.headline}</Text>
                  <Text style={styles.summaryDetail}>{summary.detail}</Text>
                </View>
              ) : null}
            </View>
          ) : (
            <Lede size="small" style={styles.trendNote}>
              {weightLogs.length === 0
                ? 'No weigh-ins in this period.'
                : 'One weigh-in in this period. The line appears after the second.'}
            </Lede>
          )}
        </QuietSection>

        {/* Measures (U2): only rows that have a value; no empty heading. */}
        {bmi !== null || tdee !== null ? (
          <QuietSection title="Body" style={styles.gutter}>
            {bmi !== null && <QuietRow label="BMI" detail={bmiCategory ?? undefined} value={bmi.toFixed(1)} />}
            {tdee !== null && <QuietRow label="Daily energy need" value={`${tdee.toLocaleString('en-US')} kcal`} />}
          </QuietSection>
        ) : null}

        {/* Recent weigh-ins, read-only rows like "Recent check-ins". */}
        {weightLogs.length > 0 && (
          <QuietSection title="Recent weigh-ins" style={styles.gutter}>
            <WeighInRows
              rows={weightLogs
                .slice()
                .reverse()
                .slice(0, 10)
                .map((log) => ({ id: log.id, day: formatLogDate(log.date), weight: log.weight, notes: log.notes }))}
            />
          </QuietSection>
        )}

        {/* Today's food, against the targets that exist (U3). */}
        <QuietSection title="Today's food" style={styles.gutter}>
          <TodayFood
            state={todayState}
            totals={todayMacros}
            targets={{
              calories: macroTargets?.calories,
              protein: macroTargets?.protein,
              carbs: macroTargets?.carbs,
              fat: macroTargets?.fat,
            }}
          />
        </QuietSection>
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

      {/* Weight Log Modal. B1 (FW-BODY-128): the sheet rides above the
          iPhone number pad (KeyboardAvoidingView), tapping outside the fields
          or "Done" dismisses the pad, and Save is disabled while saving. */}
      <Modal
        visible={showLogModal}
        transparent
        animationType="slide"
        onRequestClose={closeLogModal}
      >
        <KeyboardAvoidingView
          style={styles.modalAvoider}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          testID="log-weight-keyboard-avoider"
        >
          <Pressable
            style={styles.modalOverlay}
            onPress={Keyboard.dismiss}
            accessible={false}
            testID="log-weight-backdrop"
          >
            <Pressable
              style={styles.modalSheet}
              onPress={Keyboard.dismiss}
              accessible={false}
              testID="log-weight-sheet"
            >
              <View style={styles.modalHeader}>
                <Headline level="h2">Log weight</Headline>
                <TouchableOpacity
                  onPress={closeLogModal}
                  style={styles.modalClose}
                  accessibilityLabel="Close log weight modal"
                  accessibilityRole="button"
                >
                  <Ionicons name="close" size={24} color={colors.textMuted} />
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
                inputAccessoryViewID={WEIGHT_KEYBOARD_ACCESSORY_ID}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                accessibilityLabel="Enter weight in pounds"
                testID="log-weight-input"
              />
              <TextInput
                style={[styles.input, styles.inputGap]}
                placeholder="Notes (optional)"
                placeholderTextColor={colors.textMuted}
                value={newNotes}
                onChangeText={setNewNotes}
                maxLength={500}
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                accessibilityLabel="Enter optional notes"
              />
              <PrimaryButton
                // The doctrine parity test presses this by its label; a
                // shorter visible "Save" waits on a PrimaryButton
                // accessibilityLabel prop (NEED in ops/reports/REDO-PROGRESS-133.md).
                label={savingWeight ? 'Saving' : 'Save weight log entry'}
                onPress={() => {
                  void handleLogWeight();
                }}
                disabled={!newWeight.trim()}
                loading={savingWeight}
                testID="log-weight-save"
                style={styles.saveBtn}
              />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
        {Platform.OS === 'ios' ? (
          <InputAccessoryView nativeID={WEIGHT_KEYBOARD_ACCESSORY_ID}>
            <View style={styles.keyboardBar}>
              <TouchableOpacity
                onPress={Keyboard.dismiss}
                style={styles.keyboardDone}
                accessibilityLabel="Done"
                accessibilityRole="button"
                testID="log-weight-keyboard-done"
              >
                <Text style={styles.keyboardDoneText}>Done</Text>
              </TouchableOpacity>
            </View>
          </InputAccessoryView>
        ) : null}
      </Modal>
    </View>
  );
}

const makeStyles = (colors: ThemeColors, sc: SemanticTokens) =>
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
  trend: {
    marginHorizontal: 24,
  },
  summary: {
    marginTop: 20,
  },
  summaryHeadline: {
    fontFamily: 'CormorantGaramond_400Regular',
    fontWeight: '400',
    fontSize: 28,
    lineHeight: 36,
    fontVariant: ['lining-nums', 'tabular-nums'],
    color: colors.textPrimary,
  },
  summaryDetail: {
    ...typography.bodySmall,
    color: colors.textMuted,
  },
  trendNote: {
    marginTop: 16,
  },
  gutter: {
    marginHorizontal: 24,
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
  modalAvoider: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: sc.overlay,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: sc.bgSurface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 40,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalClose: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  input: {
    ...typography.body,
    backgroundColor: sc.bgPrimary,
    borderRadius: radius.input,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: colors.textPrimary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: sc.border,
  },
  inputGap: {
    marginTop: 12,
  },
  saveBtn: {
    marginTop: 24,
  },
  keyboardBar: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    backgroundColor: sc.bgSurface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: sc.border,
    paddingHorizontal: 16,
  },
  keyboardDone: {
    minHeight: 44,
    minWidth: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardDoneText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 16,
    fontWeight: '500',
    color: colors.primary,
  },
  });
