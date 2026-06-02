/**
 * RespirationCard — respiratory rate (RESPIRATORY_RATE_BRPM) + blood-oxygen
 * (SPO2_PCT). Lives in the "More" expandable section, off the above-the-fold
 * cap (brief §5.1).
 *
 * Bradley LAW / "NEVER medicalize" (UNIFIED_BUILD_PLAN lock): no diagnosis
 * nouns, no treatment verbs. When SpO2 is sustained below the threshold, append
 * a SOFT clinician-referral suffix (mirrors the HK-4 prompt rules) and switch
 * the only-permitted escalation accent (soft amber) — never red.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { ThemeColors } from '../../../../theme/ThemeProvider';
import { SrCard } from './SrCard';
import { RECOVERY_PALETTE } from '../recoveryTheme';
import { SPO2_ATTENTION_THRESHOLD, type RespirationView } from '../recoveryData';

export interface RespirationCardProps {
  respiration: RespirationView;
  colors: ThemeColors;
  revealDelay?: number;
}

export function RespirationCard({ respiration, colors, revealDelay = 0 }: RespirationCardProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const { respiratoryRate, spo2, spo2NeedsAttention } = respiration;

  const hasAny = respiratoryRate !== null || spo2 !== null;

  // Reassurance-first copy. Soft clinician-referral suffix ONLY when SpO2 is
  // sustained below threshold — phrased as a gentle suggestion, not a verdict.
  const copy = !hasAny
    ? "We'll show your breathing and blood-oxygen once your tracker syncs overnight"
    : spo2NeedsAttention
      ? `Your overnight readings are in. Blood oxygen has been dipping a little lower than usual — it may be worth mentioning to your clinician next time you chat.`
      : 'Your breathing and blood oxygen look settled through the night';

  const spo2Color = spo2NeedsAttention ? RECOVERY_PALETTE.attention : colors.textPrimary;

  return (
    <SrCard
      title="Breathing & blood oxygen"
      icon="leaf-outline"
      colors={colors}
      revealDelay={revealDelay}
      testID="respiration-card"
    >
      <Text style={[styles.copy, spo2NeedsAttention ? { color: colors.textPrimary } : null]} testID="respiration-copy">
        {copy}
      </Text>
      <View style={styles.statsRow}>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Breathing rate</Text>
          <Text style={styles.statValue} testID="respiration-rate">
            {respiratoryRate !== null ? `${respiratoryRate.toFixed(1)}` : '—'}
            {respiratoryRate !== null ? <Text style={styles.statUnit}> br/min</Text> : null}
          </Text>
        </View>
        <View style={styles.stat}>
          <Text style={styles.statLabel}>Blood oxygen</Text>
          <Text style={[styles.statValue, { color: spo2Color }]} testID="respiration-spo2">
            {spo2 !== null ? `${Math.round(spo2)}` : '—'}
            {spo2 !== null ? <Text style={[styles.statUnit, { color: spo2Color }]}>%</Text> : null}
          </Text>
        </View>
      </View>
      {spo2NeedsAttention ? (
        <Text style={[styles.threshold, { color: RECOVERY_PALETTE.attention }]} testID="respiration-attention">
          Below {SPO2_ATTENTION_THRESHOLD}% overnight
        </Text>
      ) : null}
    </SrCard>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    copy: { fontSize: 14, color: colors.textPrimary, marginBottom: 14, lineHeight: 20 },
    statsRow: { flexDirection: 'row', gap: 24 },
    stat: { flex: 1 },
    statLabel: { fontSize: 12, color: colors.textSecondary, marginBottom: 4 },
    statValue: { fontSize: 22, fontWeight: '600', color: colors.textPrimary, fontVariant: ['tabular-nums'] },
    statUnit: { fontSize: 12, fontWeight: '600', color: colors.textSecondary },
    threshold: { fontSize: 12, marginTop: 10, fontWeight: '600' },
  });
}

export default RespirationCard;
