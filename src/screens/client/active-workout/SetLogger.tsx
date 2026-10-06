import React, { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { SessionSet } from './types';
import type { ActiveWorkoutStyles } from './styles';

/**
 * Clean what the client typed into a weight cell. Keeps digits and ONE
 * decimal separator (a comma is read as a decimal point), so "17.5" and
 * "17,5" both stay 17.5 while the client is still typing "17.".
 */
export function sanitizeWeightText(raw: string): string {
  const normalized = raw.replace(',', '.').replace(/[^0-9.]/g, '');
  const firstDot = normalized.indexOf('.');
  if (firstDot === -1) return normalized;
  return (
    normalized.slice(0, firstDot + 1) +
    normalized.slice(firstDot + 1).replace(/\./g, '')
  );
}

export function sanitizeRepsText(raw: string): string {
  return raw.replace(/[^0-9]/g, '');
}

export function parseWeightText(text: string): number {
  const v = parseFloat(text);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

export function parseRepsText(text: string): number {
  const v = parseInt(text, 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/**
 * A numeric cell that keeps the client's own text while they type.
 *
 * The previous cells were controlled by the parsed number
 * (`value={String(parseFloat(text))}`), which threw away a trailing
 * decimal point: typing 17.5 lb saved 175 lb. The draft text is now the
 * source of what is shown; the parsed number is reported upward on every
 * keystroke. When the number changes from outside (Add Set copies the
 * previous set, a resumed session), the draft follows it.
 */
function NumericCell({
  value,
  sanitize,
  parse,
  onChangeValue,
  style,
  placeholderTextColor,
  keyboardType,
  accessibilityLabel,
  testID,
}: {
  value: number;
  sanitize: (raw: string) => string;
  parse: (text: string) => number;
  onChangeValue: (v: number) => void;
  style: React.ComponentProps<typeof TextInput>['style'];
  placeholderTextColor: string;
  keyboardType: 'decimal-pad' | 'number-pad';
  accessibilityLabel: string;
  testID?: string;
}) {
  const [text, setText] = useState(value > 0 ? String(value) : '');
  useEffect(() => {
    setText((cur) => (parse(cur) === value ? cur : value > 0 ? String(value) : ''));
  }, [value, parse]);
  return (
    <TextInput
      style={style}
      value={text}
      onChangeText={(raw) => {
        const next = sanitize(raw);
        setText(next);
        onChangeValue(parse(next));
      }}
      keyboardType={keyboardType}
      placeholder="0"
      placeholderTextColor={placeholderTextColor}
      selectTextOnFocus
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    />
  );
}

export function SetLogger({
  set,
  setIdx,
  exIdx,
  onUpdate,
  onToggleComplete,
  colors,
  styles,
}: {
  set: SessionSet;
  setIdx: number;
  exIdx: number;
  onUpdate: <K extends keyof SessionSet>(exIdx: number, setIdx: number, field: K, value: SessionSet[K]) => void;
  onToggleComplete: (exIdx: number, setIdx: number) => void;
  colors: ThemeColors;
  styles: ActiveWorkoutStyles;
}) {
  return (
    <View style={[styles.setRow, set.completed && styles.setRowCompleted]}>
      <Text style={[styles.setText, { width: 36 }]}>{setIdx + 1}</Text>
      <NumericCell
        style={[styles.setInput, { flex: 1 }]}
        value={set.weight}
        sanitize={sanitizeWeightText}
        parse={parseWeightText}
        onChangeValue={(v) => onUpdate(exIdx, setIdx, 'weight', v)}
        keyboardType="decimal-pad"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={`Set ${setIdx + 1} weight in pounds`}
        testID={`set-weight-${exIdx}-${setIdx}`}
      />
      <NumericCell
        style={[styles.setInput, { flex: 1 }]}
        value={set.reps}
        sanitize={sanitizeRepsText}
        parse={parseRepsText}
        onChangeValue={(v) => onUpdate(exIdx, setIdx, 'reps', v)}
        keyboardType="number-pad"
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={`Set ${setIdx + 1} reps`}
        testID={`set-reps-${exIdx}-${setIdx}`}
      />
      <HapticPressable
        intent="medium"
        style={[styles.checkBtn, set.completed && styles.checkBtnDone]}
        onPress={() => onToggleComplete(exIdx, setIdx)}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: set.completed }}
        accessibilityLabel={`Mark set ${setIdx + 1} done`}
        testID={`set-done-${exIdx}-${setIdx}`}
      >
        <Ionicons name="checkmark" size={16} color={set.completed ? colors.textOnPrimary : colors.textMuted} />
      </HapticPressable>
    </View>
  );
}
