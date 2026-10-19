/**
 * SleepConsistencyCard — bedtime / wake-time consistency over the last 7 days.
 *
 * Copy reports the measured bedtime span, without judging sleep quality.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ThemeColors } from '../../../../theme/ThemeProvider';
import { SrCard } from './SrCard';
import { RECOVERY_PALETTE } from '../recoveryTheme';
import { formatMinutes, type ConsistencyView } from '../recoveryData';

export interface SleepConsistencyCardProps {
  consistency: ConsistencyView;
  colors: ThemeColors;
  revealDelay?: number;
}

export function SleepConsistencyCard({ consistency, colors, revealDelay = 0 }: SleepConsistencyCardProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const copy = consistency.nights === 0 || consistency.bedtimeSpreadMin === null
    ? 'Sleep times appear once your tracker syncs a night'
    : `Bedtimes span ${formatMinutes(consistency.bedtimeSpreadMin)}`;

  return (
    <SrCard
      title="Sleep consistency"
      icon="time-outline"
      colors={colors}
      revealDelay={revealDelay}
      testID="sleep-consistency-card"
    >
      <Text style={styles.copy} testID="consistency-copy">
        {copy}
      </Text>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Bedtime window</Text>
          <Text style={styles.statValue} testID="consistency-bedtime">
            {consistency.bedtimeSpreadMin !== null ? `±${formatMinutes(Math.round(consistency.bedtimeSpreadMin / 2))}` : '—'}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Wake window</Text>
          <Text style={styles.statValue} testID="consistency-wake">
            {consistency.wakeSpreadMin !== null ? `±${formatMinutes(Math.round(consistency.wakeSpreadMin / 2))}` : '—'}
          </Text>
        </View>
      </View>
      <Text style={styles.footnote}>Across the last {consistency.nights} night{consistency.nights === 1 ? '' : 's'}</Text>
    </SrCard>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    copy: { fontSize: 14, color: colors.textPrimary, marginBottom: 14, lineHeight: 20 },
    statsRow: { flexDirection: 'row', gap: 24 },
    stat: { flex: 1 },
    statLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
    statValue: { fontSize: 20, fontWeight: '600', color: RECOVERY_PALETTE.accent, fontVariant: ['tabular-nums'] },
    footnote: { fontSize: 11, color: colors.textSecondary, marginTop: 10 },
  });
}

export default SleepConsistencyCard;
