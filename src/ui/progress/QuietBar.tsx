import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, type TextProps, View } from 'react-native';
import { useTheme } from '../../theme/useTheme';
import { colors } from '../../theme/tokens';
import { useReducedMotion } from '../../hooks/useReducedMotion';
export const QuietText = ({ style, ...props }: TextProps) => <Text {...props} style={[{ fontFamily: 'Inter_400Regular' }, style]} />;
interface Props { label: string; value: string; current: number; target?: number; }
export default function QuietBar({ label, value, current, target }: Props) {
  const { semanticColors: sc } = useTheme();
  const reduced = useReducedMotion();
  const fraction = target && target > 0 ? Math.max(0, Math.min(current / target, 1)) : 0;
  const fill = useRef(new Animated.Value(fraction)).current;
  const previous = useRef(fraction);
  useEffect(() => {
    const animation = !reduced && previous.current !== fraction
      ? Animated.timing(fill, { toValue: fraction, duration: 250, useNativeDriver: false }) : null;
    previous.current = fraction;
    if (animation) animation.start(); else fill.setValue(fraction);
    return () => animation?.stop();
  }, [fill, fraction, reduced]);
  return (
    <View style={{ gap: 6 }}>
      <View style={styles.row}>
        <QuietText style={[styles.text, { color: sc.textPrimary }]}>{label}</QuietText>
        <QuietText style={[styles.text, { color: sc.textMuted, flexShrink: 1, textAlign: 'right' }]}>{value}</QuietText>
      </View>
      <View accessibilityRole="progressbar" accessibilityLabel={`${label} progress`}
        accessibilityValue={target ? { min: 0, max: target, now: Math.min(current, target), text: value } : { text: value }}
        style={{ height: 4, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: sc.border }}>
        <Animated.View testID={`quiet-bar-${label}`} style={{ height: 4, backgroundColor: colors.forest,
          width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
      </View>
    </View>
  );
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  text: { fontSize: 13, fontVariant: ['tabular-nums'] } });
