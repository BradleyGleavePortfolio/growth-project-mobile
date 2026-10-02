/**
 * RoleChoice: first signup step for people without an invite code.
 * Two quiet rows, no imagery, no celebration (QUIET_LUXURY_DOCTRINE.md).
 * People who arrive with an invite / QR code never see this; they are
 * always clients.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeProvider';
import { Typography, Spacing, Radius } from '../../theme';
import type { IntendedRole } from '../../lib/intendedRole';

const OPTIONS: Array<{ role: IntendedRole; title: string; body: string; icon: 'barbell-outline' | 'people-outline' }> = [
  {
    role: 'client',
    title: "I'm here to train",
    body: 'Work with a coach on training, food and habits.',
    icon: 'barbell-outline',
  },
  {
    role: 'coach',
    title: 'I coach clients',
    body: 'Run your coaching practice and your clients from one place.',
    icon: 'people-outline',
  },
];

export default function RoleChoice({ onChoose }: { onChoose: (role: IntendedRole) => void }) {
  const { colors } = useTheme();
  return (
    <View testID="role-choice">
      {OPTIONS.map((o) => (
        <TouchableOpacity
          key={o.role}
          onPress={() => onChoose(o.role)}
          accessibilityRole="button"
          accessibilityLabel={o.title}
          accessibilityHint={o.body}
          testID={`role-choice-${o.role}`}
          style={[styles.row, { borderColor: colors.border, backgroundColor: colors.surface }]}
        >
          <Ionicons name={o.icon} size={22} color={colors.textPrimary} />
          <View style={styles.text}>
            <Text style={[styles.title, { color: colors.textPrimary }]}>{o.title}</Text>
            <Text style={[styles.body, { color: colors.textSecondary }]}>{o.body}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Radius.sm,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  text: { flex: 1, marginHorizontal: Spacing.md },
  title: { ...Typography.h3, marginBottom: 2 },
  body: { ...Typography.body },
});
