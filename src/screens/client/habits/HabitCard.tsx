import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { ThemeColors } from '../../../theme/ThemeProvider';
import type { IoniconName } from '../../../types/common';
import { DAY_LABELS, type HabitView } from './constants';
import type { HabitsStyles } from './styles';

export function HabitCard({
  habit,
  onToggle,
  onLongPress,
  colors,
  styles,
}: {
  habit: HabitView;
  onToggle: (habit: HabitView) => void;
  onLongPress: (habit: HabitView) => void;
  colors: ThemeColors;
  styles: HabitsStyles;
}) {
  return (
    <TouchableOpacity
      style={styles.habitCard}
      onPress={() => onToggle(habit)}
      onLongPress={() => onLongPress(habit)}
      activeOpacity={0.7}
    >
      <View style={styles.habitLeft}>
        <View style={[styles.habitIconBox, { backgroundColor: habit.color + '20' }]}>
          <Ionicons
            name={(habit.icon || 'checkmark-circle') as IoniconName}
            size={22}
            color={habit.color}
          />
        </View>
        <View style={styles.habitInfo}>
          <Text style={[styles.habitName, habit.log?.completed && styles.habitNameDone]}>
            {habit.name}
          </Text>
          <View style={styles.habitMeta}>
            {habit.runDays > 0 && (
              <Text style={styles.runText}>· {habit.runDays}d</Text>
            )}
            <Text style={styles.habitTarget}>
              {habit.targetCount > 1
                ? `${habit.log?.count || 0}/${habit.targetCount} ${habit.unit}`
                : habit.unit}
            </Text>
          </View>
          <View style={styles.weekDots}>
            {habit.weekDots.map((done, i) => (
              <View key={i} style={styles.weekDotCol}>
                <View
                  style={[
                    styles.weekDot,
                    done && { backgroundColor: habit.color },
                  ]}
                />
                <Text style={styles.weekDotLabel}>{DAY_LABELS[i]}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
      <View
        style={[
          styles.checkCircle,
          habit.log?.completed && { backgroundColor: habit.color, borderColor: habit.color },
        ]}
      >
        {habit.log?.completed && (
          <Ionicons name="checkmark" size={18} color={colors.textOnPrimary} />
        )}
      </View>
    </TouchableOpacity>
  );
}
