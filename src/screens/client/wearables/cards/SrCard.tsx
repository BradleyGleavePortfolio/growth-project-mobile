/**
 * SrCard — shared chrome for every Sleep & Recovery card: a cool-toned surface
 * with a title row, wrapped in `CalmSlowReveal` so it performs the 600ms
 * ease-out reveal on first mount (UX gate §5.4). Keeps the individual cards
 * focused on their content instead of repeating layout + animation wiring.
 */

import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../../theme/ThemeProvider';
import type { IoniconName } from '../../../../types/common';
import { CalmSlowReveal } from '../components/CalmSlowReveal';

export interface SrCardProps {
  title: string;
  icon: IoniconName;
  colors: ThemeColors;
  /** Stagger the reveal so a column cascades gently. */
  revealDelay?: number;
  /** Optional trailing element in the title row (e.g. a value chip). */
  trailing?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}

export function SrCard({
  title,
  icon,
  colors,
  revealDelay = 0,
  trailing,
  children,
  testID,
}: SrCardProps) {
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <CalmSlowReveal delay={revealDelay} style={styles.reveal} testID={testID ? `${testID}-reveal` : undefined}>
      <View style={styles.card} testID={testID}>
        <View style={styles.titleRow}>
          <View style={styles.titleLeft}>
            <Ionicons name={icon} size={16} color={colors.textSecondary} />
            <Text style={styles.title}>{title}</Text>
          </View>
          {trailing}
        </View>
        {children}
      </View>
    </CalmSlowReveal>
  );
}

function makeStyles(colors: ThemeColors) {
  return StyleSheet.create({
    reveal: { width: '100%' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      padding: 16,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    titleLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { fontSize: 13, fontWeight: '600', color: colors.textSecondary, letterSpacing: 0.4 },
  });
}

export default SrCard;
