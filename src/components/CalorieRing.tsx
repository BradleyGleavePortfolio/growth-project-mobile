import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { Colors } from '../constants/colors';

interface CalorieRingProps {
  consumed: number;
  target: number;
  size?: number;
  strokeWidth?: number;
}

export default function CalorieRing({
  consumed,
  target,
  size = 200,
  strokeWidth = 14,
}: CalorieRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(consumed / (target || 1), 1);
  const strokeDashoffset = circumference * (1 - progress);
  const remaining = Math.max(target - consumed, 0);
  const isOver = consumed > target;

  return (
    // Round 3: ring is purely visual — expose as a single a11y element with summary text
    <View
      style={[styles.container, { width: size, height: size }]}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Daily calories"
      accessibilityValue={{
        min: 0,
        max: target,
        now: consumed,
        text: isOver
          ? `${consumed} calories eaten, over target of ${target}`
          : `${consumed} of ${target} calories eaten, ${remaining} remaining`,
      }}
    >
      <Svg width={size} height={size} accessible={false}>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={Colors.border}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={isOver ? Colors.error : Colors.primary}
          strokeWidth={strokeWidth}
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.center}>
        <Text style={styles.remaining}>{isOver ? 0 : remaining}</Text>
        <Text style={styles.label}>remaining</Text>
        <Text style={styles.consumed}>{consumed} eaten</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  center: {
    position: 'absolute',
    alignItems: 'center',
  },
  remaining: {
    fontSize: 40,
    fontWeight: '800',
    color: Colors.textPrimary,
  },
  label: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  consumed: {
    fontSize: 12,
    color: Colors.textMuted,
    marginTop: 4,
  },
});
