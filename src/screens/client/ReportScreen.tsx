import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { logApi, weightApi } from '../../services/api';
import { parseWeightLogRow, weightHistoryRows } from './progress/weightHistory';
import { WeightLog } from '../../types';
import { getTodayString } from '../../utils/date';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';
import { Colors } from '../../constants/colors';
import { typography, radius } from '../../theme/tokens';
import { Screen } from '../../ui';

// Pastel feedback backgrounds previously sourced from the legacy `colors`
// barrel. Inlined as constants so this file no longer depends on the
// legacy theme/index.ts grouped export. Values match
// theme/index.ts feedback.* exactly.
const FEEDBACK_ERROR_TEXT = Colors.noticeCriticalAccent;

export default function ReportScreen({ navigation }: { navigation: NavigationProp<ParamListBase> }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  const [weeklyWeights, setWeeklyWeights] = useState<WeightLog[]>([]);
  const [todayMacros, setTodayMacros] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  // Until today's log has been read the totals are unknown, not zero.
  const [macrosRead, setMacrosRead] = useState(false);

  useEffect(() => {
    loadReportData();
  }, []);

  const loadReportData = async () => {
    if (!currentUser) return;
    try {
      const weightRes = await weightApi.getHistory(7);
      // Rows carry weight_lbs and an ISO date; normalise them with the same
      // parser the Progress screen uses so the report shows real numbers.
      const uid = currentUser.id;
      const logs = weightHistoryRows(weightRes.data)
        .map((row) => parseWeightLogRow(row, uid))
        .filter((x): x is WeightLog => x !== null)
        .sort((a, b) => a.date.localeCompare(b.date));
      setWeeklyWeights(logs.slice(-7));
    } catch (err) {
      // Read-only weight history; empty chart is the graceful fallback.
      console.error('ReportScreen: weightApi.getHistory failed', err);
      setWeeklyWeights([]);
    }
    try {
      // Use the local-tz bucket so this matches the day the user is actually
      // looking at on their device.
      const today = getTodayString();
      const logRes = await logApi.getDaily(today);
      type Entry = {
        food_item?: { calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number };
        foodItem?: { calories?: number; protein_g?: number; carbs_g?: number; fat_g?: number };
        quantity_multiplier?: number;
      };
      const entries: Entry[] = (logRes.data?.entries as Entry[] | undefined) || [];
      let cals = 0, prot = 0, carbs = 0, fat = 0;
      entries.forEach((e) => {
        const fi = e.food_item || e.foodItem || {};
        const qty = e.quantity_multiplier || 1;
        cals += (fi.calories || 0) * qty;
        prot += (fi.protein_g || 0) * qty;
        carbs += (fi.carbs_g || 0) * qty;
        fat += (fi.fat_g || 0) * qty;
      });
      setTodayMacros({ calories: cals, protein: prot, carbs, fat });
      setMacrosRead(true);
    } catch (err) {
      // Read-only daily totals; they stay unknown (--) if the fetch fails.
      console.error('ReportScreen: logApi.getDaily failed', err);
    }
  };

  const latestWeight = weeklyWeights.length > 0 ? weeklyWeights[weeklyWeights.length - 1].weight : currentUser?.profile?.current_weight;
  const startWeight = currentUser?.profile?.current_weight;
  const change = latestWeight && startWeight ? latestWeight - startWeight : null;

  const goalLabel = (() => {
    switch (currentUser?.profile?.primary_goal) {
      case 'lose_fast': return 'Aggressive Fat Loss';
      case 'lose_moderate': return 'Moderate Weight Loss';
      case 'maintain': return 'Maintenance';
      case 'gain': return 'Lean Bulk';
      case 'gain_fast': return 'Mass Gain';
      case 'mobility': return 'Mobility & Wellness';
      default: return 'General Fitness';
    }
  })();

  return (
    <Screen
      edges={['top']}
      testID="report"
      contentStyle={styles.content}
      header={<View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle} accessibilityRole="header">Weekly report</Text>
        <View style={styles.backBtn} />
      </View>}
    >
        {/* Tip Banner */}
        <View style={styles.tipBanner}>
          <Ionicons name="camera-outline" size={16} color={colors.textSecondary} />
          <Text style={styles.tipText}>Take a screenshot to keep this report.</Text>
        </View>

        {/* Cover */}
        <View style={styles.cover}>
          <View style={styles.coverDot} />
          <Text style={styles.coverTitle}>The Growth Project</Text>
          <Text style={styles.coverSubtitle}>Weekly progress report</Text>
          <Text style={styles.coverName}>
            {currentUser?.firstName || currentUser?.name}
          </Text>
          <Text style={styles.coverDate}>{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</Text>
        </View>

        {/* Macros */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Today's macros</Text>
          <View style={styles.macroRow}>
            <MacroBox label="Calories" value={macrosRead ? `${Math.round(todayMacros.calories)}` : '--'} unit="kcal" />
            <MacroBox label="Protein" value={macrosRead ? `${Math.round(todayMacros.protein)}` : '--'} unit="g" accent />
            <MacroBox label="Carbs" value={macrosRead ? `${Math.round(todayMacros.carbs)}` : '--'} unit="g" />
            <MacroBox label="Fat" value={macrosRead ? `${Math.round(todayMacros.fat)}` : '--'} unit="g" />
          </View>
          {currentUser?.profile?.calorie_target && (
            <Text style={styles.targetHint}>
              Target: {currentUser.profile.calorie_target} kcal / day
            </Text>
          )}
        </View>

        {/* Weekly Progress */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Weekly progress</Text>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statValue}>{startWeight ? `${Math.round(startWeight)}` : '--'}</Text>
              <Text style={styles.statLabel}>Start (lbs)</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={[styles.statValue, { color: colors.primary }]}>
                {latestWeight ? `${(Math.round(latestWeight * 10) / 10)}` : '--'}
              </Text>
              <Text style={styles.statLabel}>Current (lbs)</Text>
            </View>
            {change !== null && (
              <View style={styles.statBox}>
                <Text style={[styles.statValue, { color: change <= 0 ? colors.primary : FEEDBACK_ERROR_TEXT }]}>
                  {change > 0 ? '+' : ''}{change.toFixed(1)}
                </Text>
                <Text style={styles.statLabel}>Change</Text>
              </View>
            )}
          </View>
          {weeklyWeights.length > 0 && (
            <View style={styles.weightList}>
              {weeklyWeights.map((w) => (
                <View key={w.id} style={styles.weightRow}>
                  <Text style={styles.weightDate}>{w.date}</Text>
                  <Text style={styles.weightVal}>{w.weight} {w.unit}</Text>
                </View>
              ))}
            </View>
          )}
        </View>

        {/* Training Focus */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>General guidance for {goalLabel}</Text>
          <Text style={styles.goalBadge}>{goalLabel}</Text>
          <Text style={styles.bodyText}>
            {currentUser?.profile?.primary_goal?.includes('lose')
              ? 'Focus on maintaining a caloric deficit while keeping protein high to preserve lean mass. Prioritize compound movements and HIIT cardio.'
              : currentUser?.profile?.primary_goal?.includes('gain')
              ? 'Keep surplus calories clean and progressive overload on compound lifts. Rest days are growth days. Sleep 7-9 hours.'
              : 'Maintain consistent nutrition habits and stay active. Focus on movement quality and recovery.'}
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerDot} />
          <Text style={styles.footerTitle}>The Growth Project</Text>
        </View>
    </Screen>
  );
}

function MacroBox({ label, value, unit, accent }: { label: string; value: string; unit: string; accent?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.macroBox}>
      <Text style={[styles.macroValue, accent && { color: colors.primary }]}>{value}</Text>
      <Text style={styles.macroUnit}>{unit}</Text>
      <Text style={styles.macroLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  // Screen owns the inset top (insets.top + 12) and the page colour.
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  backBtn: {
    width: 44,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topTitle: { ...typography.eyebrow, color: colors.textSecondary },
  content: {
    paddingHorizontal: 24,
    paddingBottom: 60,
  },
  tipBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    marginBottom: 8,
  },
  tipText: { ...typography.bodySmall, flex: 1, color: colors.textSecondary },
  // Cover: the screenshot's title block. Serif, centred, no box.
  cover: {
    paddingVertical: 32,
    alignItems: 'center',
  },
  coverDot: {
    width: 8,
    height: 8,
    borderRadius: radius.chip,
    backgroundColor: colors.primary,
    marginBottom: 20,
  },
  coverTitle: { ...typography.h1, color: colors.textPrimary, textAlign: 'center' },
  coverSubtitle: { ...typography.eyebrow, color: colors.textSecondary, marginTop: 8 },
  coverName: { ...typography.h3, color: colors.textPrimary, marginTop: 24 },
  coverDate: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 4, fontVariant: ['tabular-nums'] },
  // Hairline sections, never boxed cards (CATALOG progress-details).
  section: {
    paddingVertical: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  sectionTitle: { ...typography.eyebrow, color: colors.textSecondary, marginBottom: 16 },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  macroBox: {
    alignItems: 'center',
    flex: 1,
  },
  macroValue: { ...typography.h2, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  macroUnit: { ...typography.bodySmall, color: colors.textSecondary },
  macroLabel: { ...typography.eyebrow, color: colors.textSecondary, marginTop: 4 },
  targetHint: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 16,
    fontVariant: ['tabular-nums'],
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: { ...typography.h2, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  statLabel: { ...typography.eyebrow, color: colors.textSecondary, marginTop: 4 },
  weightList: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  weightRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  weightDate: { ...typography.bodySmall, color: colors.textSecondary, fontVariant: ['tabular-nums'] },
  weightVal: { ...typography.bodyMd, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  goalBadge: {
    ...typography.bodySmall,
    alignSelf: 'flex-start',
    color: colors.textPrimary,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.chip,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    marginBottom: 12,
  },
  bodyText: { ...typography.body, color: colors.textSecondary },
  footer: {
    paddingVertical: 32,
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  footerDot: {
    width: 6,
    height: 6,
    borderRadius: radius.chip,
    backgroundColor: colors.primary,
    marginBottom: 12,
  },
  footerTitle: { ...typography.h3, color: colors.textPrimary },
  });
