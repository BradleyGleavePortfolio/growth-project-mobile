import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { WeightLog } from '../../../types';
import type { ClientDetailStyles } from './styles';

export function ProgressTab({
  weightLogs,
  colors,
  styles,
}: {
  weightLogs: WeightLog[];
  colors: ThemeColors;
  styles: ClientDetailStyles;
}) {
  // The summary sends weight_logs newest first. Order by day explicitly so
  // First is the oldest entry, Latest the newest and Change = latest - first
  // (it read backwards: a client down 10 lb showed +10.0).
  const ascending = [...weightLogs].sort((x, y) => x.date.localeCompare(y.date));
  const first = ascending[0]?.weight;
  const latest = ascending[ascending.length - 1]?.weight;
  const change = (latest ?? 0) - (first ?? 0);
  const newestFirst = [...ascending].reverse();
  return (
    <>
      <Text style={styles.sectionTitle}>Weight (Last 30 Days)</Text>
      {weightLogs.length > 0 ? (
        <>
          <View style={styles.progressStatsRow}>
            <View style={styles.progressStat}>
              <Text style={styles.progressStatValue}>{first ?? '—'}</Text>
              <Text style={styles.progressStatLabel}>First</Text>
            </View>
            <View style={styles.progressStat}>
              <Text style={[styles.progressStatValue, { color: colors.primary }]}>
                {latest ?? '—'}
              </Text>
              <Text style={styles.progressStatLabel}>Latest</Text>
            </View>
            <View style={styles.progressStat}>
              <Text
                style={[
                  styles.progressStatValue,
                  {
                    color: change <= 0 ? colors.success : colors.warning,
                  },
                ]}
              >
                {change > 0 ? '+' : ''}{change.toFixed(1)}
              </Text>
              <Text style={styles.progressStatLabel}>Change</Text>
            </View>
          </View>
          {newestFirst.map((log) => (
            <View key={log.id} style={styles.logItem}>
              <View style={styles.logHeader}>
                <Text style={styles.logMeal}>{log.date}</Text>
                <Text style={styles.logCalories}>{log.weight} {log.unit || 'lbs'}</Text>
              </View>
              {log.notes ? <Text style={styles.logMacros}>{log.notes}</Text> : null}
            </View>
          ))}
        </>
      ) : (
        <View style={styles.emptyCard}>
          <Ionicons name="scale-outline" size={32} color={colors.textMuted} />
          <Text style={styles.emptyText}>No weight logs in the last 30 days</Text>
        </View>
      )}
    </>
  );
}
