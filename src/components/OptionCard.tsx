import React from 'react';
import { TouchableOpacity, Text, StyleSheet, View } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  label: string;
  description?: string;
  icon?: string;
  selected: boolean;
  onPress: () => void;
}

export default function OptionCard({
  label,
  description,
  icon,
  selected,
  onPress,
}: Props) {
  return (
    <TouchableOpacity
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      <View style={styles.textContainer}>
        <Text style={[styles.label, selected && styles.labelSelected]}>
          {label}
        </Text>
        {description ? (
          <Text style={styles.description}>{description}</Text>
        ) : null}
      </View>
      {selected ? (
        <View style={styles.checkmark}>
          <Text style={styles.checkmarkText}>✓</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 4, // radius.lg
    padding: 16,
    marginBottom: 10,
    gap: 14,
  },
  cardSelected: {
    borderColor: Colors.primary,
    backgroundColor: 'rgba(26, 158, 95, 0.08)',
  },
  icon: {
    fontSize: 24,
  },
  textContainer: {
    flex: 1,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textPrimary,
  },
  labelSelected: {
    color: Colors.primary,
  },
  description: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 3,
    lineHeight: 18,
  },
  checkmark: {
    width: 24,
    height: 24,
    borderRadius: 2, // radius.md
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkmarkText: {
    color: Colors.textOnPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
});
