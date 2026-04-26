import React from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  label: string;
  selected: boolean;
  onPress: () => void;
}

export default function MultiSelectChip({ label, selected, onPress }: Props) {
  return (
    <TouchableOpacity
      style={[styles.chip, selected && styles.chipSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.text, selected && styles.textSelected]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 4, // radius.lg
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginRight: 8,
    marginBottom: 8,
  },
  chipSelected: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(26, 158, 95, 0.1)',
  },
  text: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSecondary,
  },
  textSelected: {
    color: Colors.primary,
  },
});
