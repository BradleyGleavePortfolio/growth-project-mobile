import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

interface MacroBarProps {
  label: string;
  current: number;
  target: number;
  color: string;
  unit?: string;
}

export default function MacroBar({
  label,
  current,
  target,
  color,
  unit = 'g',
}: MacroBarProps) {
  const progress = Math.min(current / (target || 1), 1);

  // Round 3: a11y — whole row is a progressbar announcing macro/current/target/unit
  return (
    <View
      style={styles.container}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: target, now: current, text: `${current} of ${target}${unit}` }}
    >
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.values}>
          <Text style={{ color }}>{current}</Text>
          <Text style={styles.target}> / {target}{unit}</Text>
        </Text>
      </View>
      <View style={styles.trackOuter}>
        <View
          style={[
            styles.trackFill,
            { width: `${progress * 100}%`, backgroundColor: color },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  values: {
    fontSize: 13,
    fontWeight: '500',
  },
  target: {
    color: Colors.textMuted,
  },
  trackOuter: {
    height: 8,
    backgroundColor: Colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    borderRadius: 4,
  },
});
