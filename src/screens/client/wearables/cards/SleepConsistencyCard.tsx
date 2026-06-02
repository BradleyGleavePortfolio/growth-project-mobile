/**
 * SleepConsistencyCard — bedtime / wake-time consistency over the last 7 days.
 *
 * CALM language (UX gate §5.2): a wide spread is framed warmly — "Your bedtime
 * is settling in" — NEVER "Inconsistent schedule". No red. The copy adapts to
 * how tight the window is, but always leads with reassurance.
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

/** Reassurance-first copy keyed off the bedtime spread. Tighter = more settled. */
function consistencyCopy(c: ConsistencyView): string {
  if (c.nights === 0 || c.bedtimeSpreadMin === null) {
    return "We'll track how steady your sleep schedule is once a few nights sync";
  }
  if (c.bedtimeSpreadMin <= 45) {
    return 'Your sleep schedule is beautifully steady — your body knows what to expect';
  }
  if (c.bedtimeSpreadMin <= 90) {
    return 'Your bedtime is settling in — you’re finding a rhythm';
  }
  return 'Your bedtime is still finding its rhythm — even small nudges toward a regular time help';
}

export function SleepConsistencyCard({ consistency, colors, revealDelay = 0 }: SleepConsistencyCardProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const copy = consistencyCopy(consistency);

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
