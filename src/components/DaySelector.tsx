import React from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { formatDate, getTodayString, addDays } from '../utils/date';
import { useTheme } from '../theme/useTheme';
import { QuietText as Text } from '../ui/progress/QuietBar';

interface DaySelectorProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
}

export default function DaySelector({
  selectedDate,
  onDateChange,
}: DaySelectorProps) {
  const isToday = selectedDate === getTodayString();
  const { semanticColors: sc } = useTheme();
  const displayLabel = isToday ? 'Today' : formatDate(selectedDate);

  return (
    <View
      style={styles.container}
      accessible={false}
    >
      <TouchableOpacity
        style={styles.arrow}
        onPress={() => onDateChange(addDays(selectedDate, -1))}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Previous day"
      >
        <Ionicons name="chevron-back" size={22} color={Colors.textSecondary} />
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.dateButton}
        onPress={() => onDateChange(getTodayString())}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={isToday ? 'Viewing today' : `Viewing ${displayLabel}, tap to go to today`}
        accessibilityHint={isToday ? undefined : 'Double tap to jump back to today'}
      >
        <Text style={[styles.dateText, { color: selectedDate > getTodayString() ? sc.textMuted : sc.textPrimary }]}>{displayLabel}</Text>
        {isToday ? <View testID="today-dot" style={styles.todayDot} /> : null}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.arrow}
        onPress={() => {
          if (!isToday) onDateChange(addDays(selectedDate, 1));
        }}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        disabled={isToday}
        accessibilityRole="button"
        accessibilityLabel="Next day"
        accessibilityState={{ disabled: isToday }}
      >
        <Ionicons
          name="chevron-forward"
          size={22}
          color={isToday ? Colors.border : Colors.textSecondary}
        />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 8,
  },
  arrow: {
    minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center',
    padding: 4,
  },
  dateText: {
    fontSize: 16,
    fontWeight: '500',
    color: Colors.textPrimary,
    minWidth: 120,
    textAlign: 'center',
  },
  dateButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  todayDot: { width: 4, height: 4, borderRadius: 2, backgroundColor: Colors.primary, marginTop: 4 },
});
