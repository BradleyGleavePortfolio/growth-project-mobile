/**
 * PeriodTabs — 7D / 30D / 90D / All as text tabs, underline on the active one
 * (CATALOG patterns: "Filter rows use underline-on-active, no pill backgrounds").
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/ThemeProvider';
import { PERIODS, type Period } from './progressFormat';
import { featureFlags } from '../../config/featureFlags';
import { HapticService } from '../../ui/haptics/haptics.service';

export default function PeriodTabs({
  value,
  onChange,
  variant,
}: {
  value: Period;
  onChange: (period: Period) => void;
  variant?: 'dark';
}): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  if (featureFlags.clientProgressV2 && variant === 'dark') {
    return <View style={styles.row} accessibilityRole="tablist" accessibilityLabel="Weight period">
      {(['7D', '30D', 'All'] as const).map((p, i) => <Pressable key={p} style={styles.tab}
        accessibilityRole="tab" accessibilityLabel={['Week', 'Month', 'All'][i]}
        accessibilityState={{ selected: value === p }} onPress={() => { void HapticService.selection(); onChange(p); }}>
        <Text style={[styles.label, { color: value === p ? sc.textOnAccent : sc.textOnMastheadMuted }]}>{['Week', 'Month', 'All'][i]}</Text>
        <View style={[styles.underline, { backgroundColor: value === p ? sc.data.trend : 'transparent' }]} />
      </Pressable>)}
    </View>;
  }
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {PERIODS.map((p) => {
        const active = p === value;
        return (
          <HapticPressable
            key={p}
            intent="light"
            onPress={() => onChange(p)}
            accessibilityRole="button"
            accessibilityLabel={`Show ${p} period`}
            accessibilityState={{ selected: active }}
            style={styles.tab}
          >
            <Text style={[styles.label, { color: active ? sc.textPrimary : sc.textMuted }]}>{p}</Text>
            <View style={[styles.underline, { backgroundColor: active ? sc.accent : 'transparent' }]} />
          </HapticPressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 28, marginTop: 4, marginBottom: 16 },
  tab: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  label: { fontFamily: 'Inter_500Medium', fontWeight: '500', fontSize: 15, lineHeight: 22, fontVariant: ['tabular-nums'] },
  underline: { height: 1, alignSelf: 'stretch', marginTop: 4 },
});
