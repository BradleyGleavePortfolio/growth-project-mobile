import React, { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme, ThemeColors } from '../../../theme/ThemeProvider';

export function DateRangeSelector({
  selectedDays,
  onSelect,
}: {
  selectedDays: 7 | 30 | 90;
  onSelect: (days: 7 | 30 | 90) => void;
}) {
  const { colors } = useTheme();
  const drStyles = useMemo(() => makeDrStyles(colors), [colors]);
  const options: { label: string; value: 7 | 30 | 90 }[] = [
    { label: '7 days', value: 7 },
    { label: '30 days', value: 30 },
    { label: '90 days', value: 90 },
  ];
  return (
    <View style={drStyles.row}>
      {options.map((opt) => (
        <TouchableOpacity
          key={opt.value}
          style={[
            drStyles.chip,
            selectedDays === opt.value && drStyles.chipActive,
          ]}
          onPress={() => onSelect(opt.value)}
        >
          <Text
            style={[
              drStyles.chipText,
              selectedDays === opt.value && drStyles.chipTextActive,
            ]}
          >
            {opt.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export const makeDrStyles = (colors: ThemeColors) =>
  StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  chip: {
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 4, // radius.lg
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    fontFamily: 'Inter_500Medium',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.4,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.textOnPrimary, // Round 3: hex → token
  },

  });
