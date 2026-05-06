import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme, ThemeColors } from '../theme/ThemeProvider';

interface Props {
  label: string;
  contribution: number;
  observed?: number;
}

export default function FactorRow({ label, contribution, observed }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const isRisk = contribution > 0;
  const accent = isRisk ? colors.error : colors.success;
  const sign = contribution >= 0 ? '+' : '−';
  const magnitude = Math.abs(contribution);
  const contributionLabel = `${sign}${(magnitude * 100).toFixed(0)}%`;
  return (
    <View style={styles.row}>
      <View style={[styles.bar, { backgroundColor: accent }]} />
      <View style={styles.body}>
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
        {typeof observed === 'number' && (
          <Text style={styles.observed}>Observed: {observed}</Text>
        )}
      </View>
      <Text style={[styles.contribution, { color: accent }]}>{contributionLabel}</Text>
    </View>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 12,
      paddingHorizontal: 14,
      backgroundColor: colors.surface,
      borderRadius: 4,
      marginBottom: 8,
      gap: 12,
    },
    bar: {
      width: 3,
      alignSelf: 'stretch',
      borderRadius: 2,
    },
    body: {
      flex: 1,
      gap: 2,
    },
    label: {
      fontFamily: 'Inter_500Medium',
      fontSize: 14,
      color: colors.textPrimary,
    },
    observed: {
      fontFamily: 'Inter_400Regular',
      fontSize: 12,
      color: colors.textSecondary,
    },
    contribution: {
      fontFamily: 'Inter_600SemiBold',
      fontSize: 14,
      minWidth: 44,
      textAlign: 'right',
    },
  });
