import React from 'react';
import { Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import HapticPressable from '../../../components/HapticPressable';
import type { SemanticTokens } from '../../../theme/tokens';
import { DAY_LABELS, type HabitView } from './constants';
import type { HabitsStyles } from './styles';

/** "3 of 8 glasses", "Once a day", "1 glass". */
export function habitTargetLabel(habit: HabitView): string {
  if (habit.targetCount > 1) return `${habit.log?.count || 0} of ${habit.targetCount} ${habit.unit}`;
  return habit.unit === 'times' ? 'Once a day' : `1 ${habit.unit}`;
}

/**
 * One habit as a hairline row (clientfile-workouts reference): outline
 * circle that fills with a check when done, serif name, the target in
 * tabular figures and this week as seven dots. Tap toggles; hold deletes.
 */
export function HabitCard({
  habit,
  todayIndex,
  onToggle,
  onLongPress,
  sc,
  styles,
}: {
  habit: HabitView;
  /** Index of today in the Monday-first week, or -1. */
  todayIndex: number;
  onToggle: (habit: HabitView) => void;
  onLongPress: (habit: HabitView) => void;
  sc: SemanticTokens;
  styles: HabitsStyles;
}) {
  const done = habit.log?.completed ?? false;
  return (
    <HapticPressable
      intent="light"
      disableAnimation
      accessibilityRole="checkbox"
      accessibilityLabel={habit.name}
      accessibilityHint="Marks it done for today. Hold to delete."
      accessibilityState={{ checked: done }}
      style={({ pressed }) => [styles.habitRow, pressed && styles.pressed]}
      onPress={() => onToggle(habit)}
      onLongPress={() => onLongPress(habit)}
      testID={`habit-row-${habit.id}`}
    >
      <View style={[styles.checkCircle, done && styles.checkCircleDone]}>
        {done ? <Ionicons name="checkmark" size={16} color={sc.accentText} /> : null}
      </View>
      <View style={styles.habitInfo}>
        <Text style={[styles.habitName, done && styles.habitNameDone]}>{habit.name}</Text>
        <Text style={styles.habitTarget}>{habitTargetLabel(habit)}</Text>
        <View style={styles.weekDots}>
          {habit.weekDots.map((dayDone, i) => (
            <View key={i} style={styles.weekDotCol}>
              <Text style={[styles.weekDotLabel, i === todayIndex && styles.weekDotLabelToday]}>{DAY_LABELS[i]}</Text>
              <View
                testID={`habit-week-${habit.id}-${i}`}
                accessibilityLabel={`${DAY_LABELS[i]}: ${dayDone ? 'completed' : 'not completed'}`}
                style={[styles.weekDot, i === todayIndex && styles.weekDotToday, dayDone && styles.weekDotDone]}
              />
            </View>
          ))}
        </View>
      </View>
    </HapticPressable>
  );
}
