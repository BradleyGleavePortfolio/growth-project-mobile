import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';
import type { WeekSummary } from './types';

export function WeeklySummaryTab({
  summaries,
  days,
  expandedWeeks,
  onToggleWeek,
}: {
  summaries: WeekSummary[];
  days: number;
  expandedWeeks: Set<string>;
  onToggleWeek: (weekStart: string) => void;
}) {
  const { colors } = useTheme();
  const wsStyles = useMemo(() => makeWsStyles(colors), [colors]);
  if (summaries.length === 0) {
    return (
      <View style={wsStyles.empty}>
        <Ionicons name="stats-chart-outline" size={40} color={colors.textMuted} />
        <Text style={wsStyles.emptyText}>No data in the last {days} days</Text>
      </View>
    );
  }

  return (
    <View style={wsStyles.container}>
      <Text style={wsStyles.header}>Week-by-Week Summary — Last {days} Days</Text>
      {summaries.map((week) => {
        const isExpanded = expandedWeeks.has(week.weekStart);
        return (
          <TouchableOpacity
            key={week.weekStart}
            style={wsStyles.card}
            onPress={() => onToggleWeek(week.weekStart)}
            activeOpacity={0.85}
          >
            {/* Card Header */}
            <View style={wsStyles.cardHeader}>
              <View style={wsStyles.cardHeaderLeft}>
                <Text style={wsStyles.weekLabel}>{week.weekLabel}</Text>
                <View style={wsStyles.pillRow}>
                  {week.workoutCount > 0 && (
                    <View style={wsStyles.pill}>
                      <Ionicons name="barbell" size={10} color={colors.primary} />
                      <Text style={wsStyles.pillText}>{week.workoutCount} workout{week.workoutCount !== 1 ? 's' : ''}</Text>
                    </View>
                  )}
                  {week.latestWeight !== null && (
                    <View style={[wsStyles.pill, wsStyles.pillGrey]}>
                      <Ionicons name="scale" size={10} color={colors.textSecondary} />
                      <Text style={[wsStyles.pillText, { color: colors.textSecondary }]}>{week.latestWeight} lbs</Text>
                    </View>
                  )}
                </View>
              </View>
              <Ionicons
                name={isExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textMuted}
              />
            </View>

            {/* Quick stats row (always visible) */}
            <View style={wsStyles.statsRow}>
              <View style={wsStyles.statBox}>
                <Text style={wsStyles.statValue}>{Math.round(week.totalCalories).toLocaleString()}</Text>
                <Text style={wsStyles.statLabel}>kcal eaten</Text>
              </View>
              <View style={[wsStyles.statBox, wsStyles.statBoxMiddle]}>
                <Text style={[wsStyles.statValue, { color: colors.protein }]}>{Math.round(week.totalProtein)}g</Text>
                <Text style={wsStyles.statLabel}>protein</Text>
              </View>
              <View style={wsStyles.statBox}>
                <Text style={[wsStyles.statValue, { color: colors.accent }]}>
                  {week.totalWeightMoved > 0 ? `${Math.round(week.totalWeightMoved).toLocaleString()}` : '—'}
                </Text>
                <Text style={wsStyles.statLabel}>vol (lbs)</Text>
              </View>
            </View>

            {/* Expanded detail */}
            {isExpanded && (
              <View style={wsStyles.expandedSection}>
                <View style={wsStyles.divider} />
                <View style={wsStyles.detailRow}>
                  <Ionicons name="restaurant-outline" size={14} color={colors.warning} />
                  <Text style={wsStyles.detailLabel}>Total Calories</Text>
                  <Text style={wsStyles.detailValue}>{Math.round(week.totalCalories).toLocaleString()} kcal</Text>
                </View>
                <View style={wsStyles.detailRow}>
                  <Ionicons name="nutrition-outline" size={14} color={colors.protein} />
                  <Text style={wsStyles.detailLabel}>Total Protein</Text>
                  <Text style={wsStyles.detailValue}>{Math.round(week.totalProtein)}g</Text>
                </View>
                <View style={wsStyles.detailRow}>
                  <Ionicons name="barbell-outline" size={14} color={colors.primary} />
                  <Text style={wsStyles.detailLabel}>Workouts</Text>
                  <Text style={wsStyles.detailValue}>{week.workoutCount}</Text>
                </View>
                <View style={wsStyles.detailRow}>
                  <Ionicons name="trending-up-outline" size={14} color={colors.accent} />
                  <Text style={wsStyles.detailLabel}>Weight Moved</Text>
                  <Text style={wsStyles.detailValue}>
                    {week.totalWeightMoved > 0 ? `${Math.round(week.totalWeightMoved).toLocaleString()} lbs` : 'N/A'}
                  </Text>
                </View>
                <View style={wsStyles.detailRow}>
                  <Ionicons name="scale-outline" size={14} color={colors.info} />
                  <Text style={wsStyles.detailLabel}>Weight Logged</Text>
                  <Text style={wsStyles.detailValue}>
                    {week.latestWeight !== null ? `${week.latestWeight} lbs` : 'Not logged'}
                  </Text>
                </View>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export const makeWsStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  container: {
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 24,
  },
  header: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
    marginBottom: 14,
  },
  empty: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 4, // radius.lg
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardHeaderLeft: {
    flex: 1,
    gap: 4,
  },
  weekLabel: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.primaryPale,
    borderRadius: 4, // radius.lg
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  pillGrey: {
    backgroundColor: colors.surfaceElevated,
  },
  pillText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    fontWeight: '500',
    color: colors.primary,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  statBox: {
    flex: 1,
    backgroundColor: colors.background,
    borderRadius: 4, // radius.lg
    padding: 10,
    alignItems: 'center',
  },
  statBoxMiddle: {
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: colors.divider,
    borderRadius: 0,
  },
  statValue: {
    fontFamily: 'CormorantGaramond_500Medium',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: 0.4,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  statLabel: {
    fontFamily: 'Inter_500Medium',
    fontSize: 10,
    fontWeight: '500',
    letterSpacing: 1.5,
    color: colors.textMuted,
    marginTop: 4,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  expandedSection: {
    marginTop: 12,
    gap: 8,
  },
  divider: {
    height: 1,
    backgroundColor: colors.divider,
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  detailLabel: {
    flex: 1,
    fontFamily: 'Inter_400Regular',
    fontSize: 13,
    color: colors.textSecondary,
  },
  detailValue: {
    fontFamily: 'Inter_500Medium',
    fontSize: 13,
    fontWeight: '500',
    color: colors.textPrimary,
  },

  });
