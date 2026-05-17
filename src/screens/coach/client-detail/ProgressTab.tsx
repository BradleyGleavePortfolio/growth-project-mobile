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
  return (
    <>
      <Text style={styles.sectionTitle}>Weight (Last 30 Days)</Text>
      {weightLogs.length > 0 ? (
        <>
          <View style={styles.progressStatsRow}>
            <View style={styles.progressStat}>
              <Text style={styles.progressStatValue}>{weightLogs[0]?.weight || '—'}</Text>
              <Text style={styles.progressStatLabel}>First</Text>
            </View>
            <View style={styles.progressStat}>
              <Text style={[styles.progressStatValue, { color: colors.primary }]}>
                {weightLogs[weightLogs.length - 1]?.weight || '—'}
              </Text>
              <Text style={styles.progressStatLabel}>Latest</Text>
            </View>
            <View style={styles.progressStat}>
              <Text
                style={[
                  styles.progressStatValue,
                  {
                    color:
                      (weightLogs[weightLogs.length - 1]?.weight || 0) - (weightLogs[0]?.weight || 0) <= 0
                        ? colors.success
                        : colors.warning,
                  },
                ]}
              >
                {((weightLogs[weightLogs.length - 1]?.weight || 0) - (weightLogs[0]?.weight || 0)).toFixed(1)}
              </Text>
              <Text style={styles.progressStatLabel}>Change</Text>
            </View>
          </View>
          {weightLogs.map((log) => (
            <View key={log.id} style={styles.logItem}>
              <View style={styles.logHeader}>
                <Text style={styles.logMeal}>{log.date}</Text>
                <Text style={styles.logCalories}>{log.weight} {log.unit}</Text>
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
