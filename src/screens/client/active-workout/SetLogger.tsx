import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { SessionSet } from './types';
import type { ActiveWorkoutStyles } from './styles';

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
      <TextInput
        style={[styles.setInput, { flex: 1 }]}
        value={set.weight > 0 ? String(set.weight) : ''}
        onChangeText={(v) => onUpdate(exIdx, setIdx, 'weight', parseFloat(v) || 0)}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={colors.textMuted}
      />
      <TextInput
        style={[styles.setInput, { flex: 1 }]}
        value={String(set.reps)}
        onChangeText={(v) => onUpdate(exIdx, setIdx, 'reps', parseInt(v) || 0)}
        keyboardType="numeric"
        placeholder="0"
        placeholderTextColor={colors.textMuted}
      />
      <HapticPressable
        intent="medium"
        style={[styles.checkBtn, set.completed && styles.checkBtnDone]}
        onPress={() => onToggleComplete(exIdx, setIdx)}
      >
        <Ionicons name="checkmark" size={16} color={set.completed ? colors.textOnPrimary : colors.textMuted} />
      </HapticPressable>
    </View>
  );
}
