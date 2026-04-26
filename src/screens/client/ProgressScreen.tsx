import React, { useEffect, useState, useCallback } from 'react';
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
import Svg, { Circle, G, Polyline, Line as SvgLine, Text as SvgText } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { weightApi, logApi } from '../../services/api';
import { useNavigation } from '@react-navigation/native';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { Colors } from '../../constants/colors';
import { WeightLog } from '../../types';
import { getTodayString } from '../../utils/date';
import FadeInView from '../../components/FadeInView';

type Period = '7D' | '30D' | '90D' | 'All';

const SCREEN_WIDTH = Dimensions.get('window').width;

// Pure SVG weight line chart — no Skia dependency
function WeightLineChart({ data }: { data: { x: number; weight: number; dateLabel: string }[] }) {
  const W = SCREEN_WIDTH - 64;
  const H = 180;
  const padL = 40;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const weights = data.map((d) => d.weight);
  const minW = Math.min(...weights) - 2;
  const maxW = Math.max(...weights) + 2;
  const rangeW = maxW - minW || 1;

  const toX = (i: number) => padL + (i / Math.max(data.length - 1, 1)) * plotW;
  const toY = (w: number) => padT + plotH - ((w - minW) / rangeW) * plotH;

  const points = data.map((d) => `${toX(d.x)},${toY(d.weight)}`).join(' ');

  // Choose up to 5 x-label indices
  const step = Math.max(1, Math.floor(data.length / 4));
  const xLabels = data.filter((_, i) => i % step === 0 || i === data.length - 1);

  // Y-axis ticks: 4 labels
  const yTicks = [0, 1, 2, 3].map((i) => minW + (rangeW * i) / 3);

  return (
    <Svg width={W} height={H}>
      {/* Grid lines */}
      {yTicks.map((v, i) => (
        <SvgLine
          key={i}
          x1={padL}
          y1={toY(v)}
          x2={W - padR}
          y2={toY(v)}
          stroke={Colors.border}
          strokeWidth={1}
        />
      ))}
      {/* Y-axis labels */}
      {yTicks.map((v, i) => (
        <SvgText
          key={i}
          x={padL - 4}
          y={toY(v) + 4}
          textAnchor="end"
          fontSize={9}
          fill={Colors.textMuted}
        >
          {Math.round(v)}
        </SvgText>
      ))}
      {/* Line */}
      <Polyline
        points={points}
        fill="none"
        stroke={Colors.primary}
        strokeWidth={2.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Dots */}
      {data.map((d, i) => (
        <Circle key={i} cx={toX(d.x)} cy={toY(d.weight)} r={4} fill={Colors.primary} />
      ))}
      {/* X-axis labels */}
      {xLabels.map((d, i) => (
        <SvgText
          key={i}
          x={toX(d.x)}
          y={H - 6}
          textAnchor="middle"
          fontSize={9}
          fill={Colors.textMuted}
        >
          {d.dateLabel}
        </SvgText>
      ))}
    </Svg>
  );
}

function CalorieRing({
  eaten,
  target,
  size = 120,
}: {
  eaten: number;
  target: number;
  size?: number;
}) {
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = target > 0 ? Math.min(eaten / target, 1) : 0;
  const dashOffset = circumference * (1 - pct);
  const center = size / 2;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size}>
        <G rotation="-90" origin={`${center}, ${center}`}>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={Colors.surfaceElevated}
            strokeWidth={strokeWidth}
            fill="none"
          />
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={Colors.primary}
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={`${circumference}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </G>
      </Svg>
      <View style={{ position: 'absolute', alignItems: 'center' }}>
        <Text style={{ fontSize: 22, fontWeight: '800', color: Colors.textPrimary }}>
          {Math.round(eaten)}
        </Text>
        <Text style={{ fontSize: 10, color: Colors.textMuted }}>
          / {target} kcal
        </Text>
      </View>
    </View>
  );
}

export default function ProgressScreen() {
  const navigation = useNavigation<any>();
  const currentUser = useCurrentUser();
  const userId = currentUser?.id ?? null;

  const [macroTargets, setMacroTargets] = useState<any>(null);
  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [period, setPeriod] = useState<Period>('30D');
  const [showLogModal, setShowLogModal] = useState(false);
  const [newWeight, setNewWeight] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [todayMacros, setTodayMacros] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  const [loggingStreak, setLoggingStreak] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('macro_targets').then((raw) => {
      if (raw) setMacroTargets(JSON.parse(raw));
    }).catch(() => {});
  }, []);

  const loadData = useCallback(async () => {
    if (!userId) return;

    const periodDays: Record<Period, number | null> = { '7D': 7, '30D': 30, '90D': 90, All: null };
    const days = periodDays[period] || 365;

    try {
      const res = await weightApi.getHistory(days);
      const logs: WeightLog[] = (res.data || []).map((w: any) => ({
        id: w.id,
        userId: w.user_id || userId,
        coachId: '',
        date: (w.date || w.created_at || '').split('T')[0],
        weight: w.weight_lbs || w.weight,
        unit: 'lbs',
        notes: w.notes || '',
      }));
      // Sort by date ascending
      logs.sort((a, b) => a.date.localeCompare(b.date));
      setWeightLogs(logs);

      // Calculate logging streak
      let streak = 0;
      const now = new Date();
      for (let i = 0; i < 60; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];
        if (logs.some((l) => l.date === dateStr)) {
          streak++;
        } else if (i > 0) {
          break;
        }
      }
      setLoggingStreak(streak);
    } catch (err) {
      // Best-effort streak compute; if it fails the streak stays at its last
      // good value (or zero on first load) — no user action is useful.
      console.error('ProgressScreen: streak calc failed', err);
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
    } catch (err: any) {
      // Destructive write: surface failure so the user can retry before
      // dismissing the modal.
      console.error('ProgressScreen: weight log failed', err);
      Alert.alert("Couldn't log weight", err?.message || 'Please try again.');
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
  let bmiColor = Colors.textMuted;
  if (latestWeight && macroTargets?.height) {
    const heightM = macroTargets.height * 0.0254; // inches to meters
    bmi = latestWeight * 0.453592 / (heightM * heightM); // lbs to kg / m^2
    if (bmi < 18.5) { bmiCategory = 'Underweight'; bmiColor = Colors.warning; }
    else if (bmi < 25) { bmiCategory = 'Normal'; bmiColor = Colors.success; }
    else if (bmi < 30) { bmiCategory = 'Overweight'; bmiColor = Colors.warning; }
    else { bmiCategory = 'Obese'; bmiColor = Colors.error; }
  }

  // Macro adherence
  const macroData = [
    {
      label: 'P',
      actual: todayMacros.protein,
      target: macroTargets?.protein || 0,
      color: Colors.protein,
    },
    {
      label: 'C',
      actual: todayMacros.carbs,
      target: macroTargets?.carbs || 0,
      color: Colors.carbs,
    },
    {
      label: 'F',
      actual: todayMacros.fat,
      target: macroTargets?.fat || 0,
      color: Colors.fat,
    },
  ];

  // Chart data for weight
  const chartData = weightLogs.map((log, i) => ({
    x: i,
    weight: log.weight,
    dateLabel: log.date.slice(5), // MM-DD
  }));

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
            tintColor={Colors.primary}
            colors={[Colors.primary]}
          />
        }
      >
        <View style={styles.header}>
          <Text style={styles.title}>Progress</Text>
          <View style={styles.headerRight}>
            {loggingStreak > 0 && (
              <View style={styles.streakBadge}>
                <Ionicons name="flame" size={14} color={Colors.warning} />
                <Text style={styles.streakText}>{loggingStreak}d streak</Text>
              </View>
            )}
            {/* Round 3: Progress now lives inside MoreStack, so Report is a sibling —
                navigate directly instead of through the old ProfileStack parent. */}
            <TouchableOpacity
              onPress={() => navigation.navigate('Report')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="share-outline" size={22} color={Colors.textSecondary} />
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
            <Text style={[styles.statValue, { color: Colors.primary }]}>
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
                  { color: change <= 0 ? Colors.success : Colors.warning },
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
                <Ionicons name="trophy-outline" size={18} color={Colors.primary} />
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
                <Text style={[styles.goalLabelText, { color: Colors.primary, fontWeight: '700' }]}>
                  {Math.round(Math.min(Math.max(((startWeight - latestWeight) / (startWeight - goalWeight)) * 100, 0), 100))}%
                </Text>
                <Text style={styles.goalLabelText}>{Math.round(goalWeight)} lbs</Text>
              </View>
            </View>
          </FadeInView>
        )}

        {/* Weight Chart */}
        {chartData.length >= 2 ? (
          <View style={styles.chartContainer}>
            <Text style={styles.chartTitle}>Weight Trend</Text>
            <View style={styles.chartInner}>
              <WeightLineChart data={chartData} />
            </View>
          </View>
        ) : (
          <View style={styles.emptyChart}>
            <Ionicons name="analytics-outline" size={36} color={Colors.textMuted} />
            <Text style={styles.emptyText}>
              {weightLogs.length === 0
                ? 'Log your weight to see your chart'
                : 'Need at least 2 entries for a chart'}
            </Text>
          </View>
        )}

        {/* Spacer between chart and body stats */}

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
      >
        {/* Round 3: hex → theme token */}
        <Ionicons name="add" size={28} color={Colors.textOnPrimary} />
      </TouchableOpacity>

      {/* Weight Log Modal */}
      <Modal visible={showLogModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Log Weight</Text>
              <TouchableOpacity onPress={() => setShowLogModal(false)}>
                <Ionicons name="close" size={24} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Weight (lbs)"
              placeholderTextColor={Colors.textMuted}
              keyboardType="decimal-pad"
              value={newWeight}
              onChangeText={setNewWeight}
              autoFocus
            />
            <TextInput
              style={[styles.input, { marginTop: 12 }]}
              placeholder="Notes (optional)"
              placeholderTextColor={Colors.textMuted}
              value={newNotes}
              onChangeText={setNewNotes}
            />
            <TouchableOpacity style={styles.saveBtn} onPress={handleLogWeight}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
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
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  ringCard: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
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
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  ringMacroTrack: {
    height: 6,
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 3,
    overflow: 'hidden',
  },
  ringMacroFill: {
    height: '100%',
    borderRadius: 3,
  },
  ringMacroValue: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 24,
    gap: 8,
    marginBottom: 16,
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
    borderRadius: 8,
    backgroundColor: Colors.surface,
  },
  periodBtnActive: {
    backgroundColor: Colors.primary,
  },
  periodText: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  periodTextActive: {
    color: Colors.textOnPrimary, // Round 3: hex → token
  },
  goalCard: {
    marginHorizontal: 24,
    marginBottom: 16,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
  },
  goalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  goalTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  goalTrack: {
    height: 10,
    backgroundColor: Colors.primaryPale,
    borderRadius: 5,
    overflow: 'hidden',
  },
  goalFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 5,
  },
  goalLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  goalLabelText: {
    fontSize: 12,
    color: Colors.textSecondary,
  },
  chartContainer: {
    marginHorizontal: 24,
    marginBottom: 24,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    overflow: 'hidden',
  },
  chartTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    marginBottom: 8,
  },
  chartInner: {
    height: 200,
  },
  emptyChart: {
    height: 160,
    marginHorizontal: 24,
    marginBottom: 24,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: 20,
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
  bodyStatsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  bodyStatCard: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    minWidth: (SCREEN_WIDTH - 58) / 2,
    flex: 1,
    gap: 2,
  },
  bodyStatValue: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.textPrimary,
    textTransform: 'capitalize',
  },
  bodyStatLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  bodyStatSub: {
    fontSize: 11,
    fontWeight: '600',
  },
  logRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  logDate: {
    fontSize: 14,
    color: Colors.textSecondary,
  },
  logRight: {
    alignItems: 'flex-end',
    gap: 2,
  },
  logWeight: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  logNotes: {
    fontSize: 12,
    color: Colors.textMuted,
    maxWidth: 160,
  },
  fab: {
    position: 'absolute',
    bottom: 90,
    right: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: Colors.textPrimary, // Round 3: hex → token
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.10,
    shadowRadius: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.surfaceElevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
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
    fontSize: 20,
    fontWeight: '700',
    color: Colors.textPrimary,
  },
  input: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  saveBtn: {
    marginTop: 20,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textOnPrimary, // Round 3: hex → token
  },
});
