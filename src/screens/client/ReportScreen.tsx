import React, { useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCurrentUser } from '../../hooks/useCurrentUser';
import { logApi, weightApi } from '../../services/api';
import { WeightLog } from '../../types';

import { colors as legacyColors } from '../../theme';
import { useTheme, ThemeColors } from '../../theme/ThemeProvider';

export default function ReportScreen({ navigation }: any) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const currentUser = useCurrentUser();
  const [weeklyWeights, setWeeklyWeights] = useState<WeightLog[]>([]);
  const [todayMacros, setTodayMacros] = useState({ calories: 0, protein: 0, carbs: 0, fat: 0 });

  useEffect(() => {
    loadReportData();
  }, []);

  const loadReportData = async () => {
    if (!currentUser) return;
    try {
      const weightRes = await weightApi.getHistory(7);
      const logs = weightRes.data?.logs || weightRes.data || [];
      setWeeklyWeights(logs.slice(-7));
    } catch (err) {
      // Read-only weight history; empty chart is the graceful fallback.
      console.error('ReportScreen: weightApi.getHistory failed', err);
      setWeeklyWeights([]);
    }
    try {
      const today = new Date().toISOString().split('T')[0];
      const logRes = await logApi.getDaily(today);
      const entries = logRes.data?.entries || [];
      let cals = 0, prot = 0, carbs = 0, fat = 0;
      entries.forEach((e: any) => {
        const fi = e.food_item || e.foodItem || {};
        const qty = e.quantity_multiplier || 1;
        cals += (fi.calories || 0) * qty;
        prot += (fi.protein_g || 0) * qty;
        carbs += (fi.carbs_g || 0) * qty;
        fat += (fi.fat_g || 0) * qty;
      });
      setTodayMacros({ calories: cals, protein: prot, carbs, fat });
    } catch (err) {
      // Read-only daily totals; defaults to 0 if the fetch fails.
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
    <View style={styles.wrapper}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.topTitle}>My Report</Text>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {/* Tip Banner */}
        <View style={styles.tipBanner}>
          <Ionicons name="camera-outline" size={16} color={colors.primary} />
          <Text style={styles.tipText}>Screenshot or screen-record to save your report</Text>
        </View>

        {/* Cover */}
        <View style={styles.cover}>
          <View style={styles.coverDot} />
          <Text style={styles.coverTitle}>The Growth Project</Text>
          <Text style={styles.coverSubtitle}>Weekly Progress Report</Text>
          <Text style={styles.coverName}>
            {currentUser?.firstName || currentUser?.name}
          </Text>
          <Text style={styles.coverDate}>{new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</Text>
        </View>

        {/* Macros */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Today's Macros</Text>
          <View style={styles.macroRow}>
            <MacroBox label="Calories" value={`${Math.round(todayMacros.calories)}`} unit="kcal" />
            <MacroBox label="Protein" value={`${Math.round(todayMacros.protein)}`} unit="g" accent />
            <MacroBox label="Carbs" value={`${Math.round(todayMacros.carbs)}`} unit="g" />
            <MacroBox label="Fat" value={`${Math.round(todayMacros.fat)}`} unit="g" />
          </View>
          {currentUser?.profile?.calorie_target && (
            <Text style={styles.targetHint}>
              Target: {currentUser.profile.calorie_target} kcal / day
            </Text>
          )}
        </View>

        {/* Weekly Progress */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Weekly Progress</Text>
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
                <Text style={[styles.statValue, { color: change <= 0 ? colors.primary : legacyColors.feedback.errorText }]}>
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
          <Text style={styles.sectionTitle}>Training Focus</Text>
          <Text style={styles.goalBadge}>{goalLabel}</Text>
          <Text style={styles.bodyText}>
            {currentUser?.profile?.primary_goal?.includes('lose')
              ? 'Focus on maintaining a caloric deficit while keeping protein high to preserve lean mass. Prioritize compound movements and HIIT cardio.'
              : currentUser?.profile?.primary_goal?.includes('gain')
              ? 'Keep surplus calories clean and progressive overload on compound lifts. Rest days are growth days — sleep 7-9 hours.'
              : 'Maintain consistent nutrition habits and stay active. Focus on movement quality and recovery.'}
          </Text>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerDot} />
          <Text style={styles.footerTitle}>The Growth Project</Text>
          <Text style={styles.footerSub}>Consistency beats perfection. Keep showing up.</Text>
        </View>
      </ScrollView>
    </View>
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
  wrapper: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
  },
  backBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  topTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: 60,
  },
  tipBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: legacyColors.feedback.successBg,
    marginHorizontal: 16,
    borderRadius: 4, // radius.lg
    padding: 12,
    marginBottom: 8,
  },
  tipText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primary,
  },
  cover: {
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    borderRadius: 4, // radius.lg
    padding: 32,
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  coverDot: {
    width: 12,
    height: 12,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.primary,
    marginBottom: 16,
  },
  coverTitle: {
    fontSize: 24,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  coverSubtitle: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 4,
  },
  coverName: {
    fontSize: 18,
    fontWeight: '500',
    color: colors.textPrimary,
    marginTop: 20,
  },
  coverDate: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
  },
  section: {
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    borderRadius: 4, // radius.lg
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 14,
  },
  macroRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  macroBox: {
    alignItems: 'center',
    flex: 1,
  },
  macroValue: {
    fontSize: 22,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  macroUnit: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  macroLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  targetHint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 12,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 22,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  statLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },
  weightList: {
    borderTopWidth: 1,
    borderTopColor: colors.divider,
    paddingTop: 12,
  },
  weightRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  weightDate: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  weightVal: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  goalBadge: {
    alignSelf: 'flex-start',
    backgroundColor: legacyColors.feedback.successBg,
    color: colors.primary,
    fontSize: 13,
    fontWeight: '500',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 0, // radius.sm
    overflow: 'hidden',
    marginBottom: 12,
  },
  bodyText: {
    fontSize: 14,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  footer: {
    backgroundColor: colors.surface,
    marginHorizontal: 16,
    borderRadius: 4, // radius.lg
    padding: 24,
    alignItems: 'center',
    marginBottom: 20,
    borderWidth: 1,
    borderColor: colors.border,
  },
  footerDot: {
    width: 10,
    height: 10,
    borderRadius: 2, // radius.md
    backgroundColor: colors.primary,
    marginBottom: 12,
  },
  footerTitle: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  footerSub: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },

  });
