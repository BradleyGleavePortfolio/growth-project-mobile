import React, { useRef, useState } from 'react';
import { View, StyleSheet, type AccessibilityActionEvent, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { colors, radius } from '../../theme/tokens';
import { useTheme } from '../../theme/useTheme';
import { HapticService } from '../../ui/haptics/haptics.service';
import { formatPortion } from '../../utils/log/quickLog';

// STYLEC-916 (C2 C_portion, index.md section 5): one ruler step per unit; grams move by 10 g.
const STEPS: Record<string, number> = { g: 10, oz: 0.5, serving: 0.5, cup: 0.25, tbsp: 0.5, tsp: 0.5 };
export const TICK_GAP = 12;
const MAX_STEPS = 500;
const tidy = (n: number) => Math.round(n * 1000) / 1000;

export const rulerStep = (unit: string) => STEPS[unit] ?? 1;
const clamp = (n: number, step: number) => Math.min(step * MAX_STEPS, Math.max(step, tidy(n)));
const snap = (n: number, step: number) => clamp(Math.round(n / step) * step, step);
/** The next ruler mark above or below a value (a typed 137 g goes to 140 or 130). */
export const stepUp = (n: number, step: number) => clamp(Math.floor(tidy(n / step)) * step + step, step);
export const stepDown = (n: number, step: number) => clamp(Math.ceil(tidy(n / step)) * step - step, step);

interface Props {
  value: number | null;
  unit: string;
  label: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}

/** Drag or tap to move by the unit's step; screen readers swipe up or down (adjustable). React Native views only. */
export default function PortionRuler({ value, unit, label, onChange, disabled = false }: Props) {
  const { semanticColors: sc } = useTheme();
  const [width, setWidth] = useState(0);
  const step = rulerStep(unit);
  const base = value ?? 0;
  const drag = useRef({ startX: 0, atX: 0, from: 0, last: 0, moved: false });

  const emit = (next: number) => {
    if (disabled || next === value) return;
    onChange(next);
    void HapticService.selection();
  };
  const onGrant = (e: GestureResponderEvent) => {
    drag.current = { startX: e.nativeEvent.pageX, atX: e.nativeEvent.locationX, from: base, last: base, moved: false };
  };
  const onMove = (e: GestureResponderEvent) => {
    const dx = e.nativeEvent.pageX - drag.current.startX;
    if (Math.abs(dx) >= 4) drag.current.moved = true;
    if (!drag.current.moved) return;
    const next = snap(drag.current.from - (dx / TICK_GAP) * step, step);
    if (next !== drag.current.last) {
      drag.current.last = next;
      emit(next);
    }
  };
  const onRelease = () => {
    if (drag.current.moved || !width) return;
    emit(snap(drag.current.from + ((drag.current.atX - width / 2) / TICK_GAP) * step, step));
  };
  const onAction = (e: AccessibilityActionEvent) => {
    if (e.nativeEvent.actionName === 'increment') emit(stepUp(base, step));
    if (e.nativeEvent.actionName === 'decrement') emit(stepDown(base, step));
  };

  const ticks: { key: number; x: number; fade: number }[] = [];
  if (width > 0) {
    const half = width / 2;
    const reach = Math.ceil(half / TICK_GAP) + 1;
    const first = Math.floor(base / step);
    for (let i = -reach; i <= reach; i += 1) {
      const mark = tidy((first + i) * step);
      const x = half + ((mark - base) / step) * TICK_GAP;
      if (mark < 0 || x < 0 || x > width) continue;
      ticks.push({ key: mark, x, fade: 1 - Math.min(1, Math.abs(x - half) / half) * 0.8 });
    }
  }

  return (
    <View
      testID="portion-ruler"
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: value == null ? '' : formatPortion(value, unit) }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={onAction}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      onStartShouldSetResponder={() => !disabled}
      onMoveShouldSetResponder={() => !disabled}
      onResponderTerminationRequest={() => false}
      onResponderGrant={onGrant}
      onResponderMove={onMove}
      onResponderRelease={onRelease}
      style={styles.ruler}
    >
      {ticks.map((t) => (
        <View key={t.key} pointerEvents="none" style={[styles.tick, { left: t.x, opacity: t.fade, backgroundColor: sc.textMuted }]} />
      ))}
      <View pointerEvents="none" testID="portion-ruler-needle" style={[styles.needle, width ? { left: width / 2 - 1.5 } : styles.needleCentre]} />
    </View>
  );
}

const styles = StyleSheet.create({
  ruler: { height: 72, justifyContent: 'center', marginTop: 4 },
  tick: { position: 'absolute', top: 8, width: StyleSheet.hairlineWidth * 2, height: 56 },
  needle: { position: 'absolute', top: 0, width: 3, height: 72, borderRadius: radius.control, backgroundColor: colors.forest },
  needleCentre: { alignSelf: 'center' },
});
