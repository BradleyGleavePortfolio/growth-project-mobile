/**
 * PeriodTabs — 7D / 30D / 90D / All as text tabs, underline on the active one
 * (CATALOG patterns: "Filter rows use underline-on-active, no pill backgrounds").
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import HapticPressable from '../HapticPressable';
import { useTheme } from '../../theme/ThemeProvider';
import { PERIODS, type Period } from './progressFormat';
import { featureFlags } from '../../config/featureFlags';
import { HapticService } from '../../ui/haptics/haptics.service';
import { useReduceMotion } from '../../screens/client/wearables/components/useReduceMotion';

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
    return <WeightPeriodTabs value={value} onChange={onChange} />;
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

function WeightPeriodTabs({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const { semanticColors: sc } = useTheme();
  const reduceMotion = useReduceMotion();
  const layouts = useRef<Record<string, { x: number; width: number }>>({});
  const left = useRef(new Animated.Value(0)).current;
  const width = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const target = layouts.current[value];
    if (!target) return;
    if (reduceMotion) { left.setValue(target.x); width.setValue(target.width); return; }
    const animation = Animated.parallel([
      Animated.timing(left, { toValue: target.x, duration: 200, useNativeDriver: false }),
      Animated.timing(width, { toValue: target.width, duration: 200, useNativeDriver: false }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [value, reduceMotion, left, width]);
  return <View style={styles.row} accessibilityRole="tablist" accessibilityLabel="Weight period">
    {(['7D', '30D', 'All'] as const).map((p, i) => <Pressable key={p} style={styles.tab}
      onLayout={({ nativeEvent: { layout } }) => {
        layouts.current[p] = layout;
        if (p === value) { left.setValue(layout.x); width.setValue(layout.width); }
      }}
      accessibilityRole="tab" accessibilityLabel={['Week', 'Month', 'All'][i]}
      accessibilityState={{ selected: value === p }}
      onPress={() => { void HapticService.selection(); onChange(p); }}>
      <Text style={[styles.label, { color: value === p ? sc.textOnAccent : sc.textOnMastheadMuted }]}>{['Week', 'Month', 'All'][i]}</Text>
    </Pressable>)}
    <Animated.View pointerEvents="none" style={{ position: 'absolute', bottom: 0, left, width, height: 1, backgroundColor: sc.data.trend }} />
  </View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 28, marginTop: 4, marginBottom: 16 },
  tab: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' },
  label: { fontFamily: 'Inter_500Medium', fontWeight: '500', fontSize: 15, lineHeight: 22, fontVariant: ['tabular-nums'] },
  underline: { height: 1, alignSelf: 'stretch', marginTop: 4 },
});
