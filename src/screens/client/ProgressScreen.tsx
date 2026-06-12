/**
 * ProgressScreen — Client progress dashboard.
 *
 * Displays weight trend, macros for today, body stats, and recent log entries.
 * The weight trend is rendered via ProgressChartCard (ED.4) — the SVG +
 * Reanimated card with a draw-in line, haptic scrubber, and auto-PR flag plus
 * inline Roman commentary on the same data.
 */

import React, { useEffect, useState, useCallback, useMemo } from 'react';
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
import Svg, { Circle, G } from 'react-native-svg';
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

type Period = '7D' | '30D' | '90D' | 'All';

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
      type WeightRow = { id: string; user_id?: string; date?: string; created_at?: string; weight_lbs?: number; weight?: number; notes?: string };
      const logs = (((res.data as WeightRow[] | undefined) || []).map((w) => {
        // Server may send either a bare `YYYY-MM-DD` (already a calendar day)
        // or a full ISO timestamp from `created_at`. We normalise both into
        // the user's *local* calendar day so the streak compare below is
        // tz-correct on either side of the date line. See audit P0-3.
        const rawDate = w.date || w.created_at || '';
        const normDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate)
          ? rawDate.slice(0, 10)
          : bucketDateLocal(new Date(rawDate));
        return {
          id: w.id,
          userId: w.user_id || userId,
          coachId: '',
          date: normDate,
          weight: w.weight_lbs || w.weight,
          unit: 'lbs' as const,
          notes: w.notes || '',
        };
      })) as unknown as WeightLog[];
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
              onRetry={loadData}
              retrying={refreshing}
              testID="progress-weight-chart-error"
            />
          </View>
        ) : chartData.length >= 2 ? (
          <View style={styles.chartContainer}>
            <Text style={styles.chartTitle}>Weight Trend</Text>
            <View style={styles.chartInner}>
              <ProgressChartCard
                data={chartData}
                liftName="Weight"
                height={180}
                testID="progress-weight-chart"
              />
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
