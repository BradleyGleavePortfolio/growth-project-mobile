import React, { useMemo } from 'react';
import { Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { makeStyles } from './styles';

export function MacroCard({ label, value, target, unit, color }: {
  label: string; value: number; target?: number; unit: string; color: string;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const pct = target && target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  return (
    <View style={styles.macroCard}>
      <Text style={[styles.macroCardValue, { color }]}>{Math.round(value)}{unit}</Text>
      <Text style={styles.macroCardLabel}>{label}</Text>
      {target ? (
        <>
          <View style={styles.macroBarBg}>
            <View style={[styles.macroBarFill, { width: `${pct}%`, backgroundColor: color }]} />
          </View>
          <Text style={styles.macroCardTarget}>{target}{unit}</Text>
        </>
      ) : null}
    </View>
  );
}
