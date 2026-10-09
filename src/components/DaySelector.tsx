import React from 'react';
import { View, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDate, getTodayString, addDays } from '../utils/date';
import { useTheme } from '../theme/useTheme';
import { layout, radius, typography } from '../theme/tokens';
import HapticPressable from './HapticPressable';

interface DaySelectorProps {
  selectedDate: string;
  onDateChange: (date: string) => void;
}

/**
 * The Food log headline: the selected day in serif, today marked with the
 * forest dot, previous and next as two quiet chevrons on the right. Same
 * three controls as before (previous, jump to today, next).
 */
export default function DaySelector({
  selectedDate,
  onDateChange,
}: DaySelectorProps) {
  const today = getTodayString();
  const isToday = selectedDate === today;
  const { semanticColors: sc } = useTheme();
  const styles = makeStyles(sc);
  const displayLabel = isToday ? 'Today' : formatDate(selectedDate);

  return (
    <View style={styles.container} accessible={false}>
      <View style={styles.dateCell}>
        <HapticPressable
          intent="light"
          disableAnimation
          style={styles.dateButton}
          onPress={() => onDateChange(today)}
          accessibilityRole="button"
          accessibilityLabel={isToday ? 'Viewing today' : `Viewing ${displayLabel}, tap to go to today`}
          accessibilityHint={isToday ? undefined : 'Double tap to jump back to today'}
        >
          <Text
            style={[styles.dateText, { color: selectedDate > today ? sc.textMuted : sc.textPrimary }]}
            numberOfLines={2}
            maxFontSizeMultiplier={1.4}
          >
            {displayLabel}
          </Text>
          {isToday ? <View testID="today-dot" style={styles.todayDot} /> : null}
        </HapticPressable>
      </View>

      <View style={styles.arrows}>
        <HapticPressable
          intent="light"
          disableAnimation
          style={styles.arrow}
          onPress={() => onDateChange(addDays(selectedDate, -1))}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
        >
          <Ionicons name="chevron-back" size={20} color={sc.textMuted} />
        </HapticPressable>

        <HapticPressable
          intent="light"
          disableAnimation
          style={styles.arrow}
          onPress={() => {
            if (!isToday) onDateChange(addDays(selectedDate, 1));
          }}
          disabled={isToday}
          accessibilityRole="button"
          accessibilityLabel="Next day"
          accessibilityState={{ disabled: isToday }}
        >
          <Ionicons name="chevron-forward" size={20} color={isToday ? sc.border : sc.textMuted} />
        </HapticPressable>
      </View>
    </View>
  );
}

const makeStyles = (sc: ReturnType<typeof useTheme>['semanticColors']) => StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: layout.sectionGap,
  },
  dateCell: { flex: 1 },
  dateButton: {
    minHeight: layout.touchMin,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dateText: {
    ...typography.h1,
    fontVariant: ['lining-nums'],
    flexShrink: 1,
  },
  todayDot: { width: 6, height: 6, borderRadius: radius.chip, backgroundColor: sc.accent },
  arrows: { flexDirection: 'row', marginRight: -12 },
  arrow: {
    minHeight: layout.touchMin,
    minWidth: layout.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
