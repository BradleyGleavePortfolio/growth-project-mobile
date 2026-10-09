/**
 * RoleChoice: the "How will you use The Growth Project?" rows (prototype
 * screen 01). Two quiet list rows between hairlines, a serif label, an Inter
 * line under it and a radio on the right. A tap only selects; the screen's
 * one Continue commits the choice (B17: the old cards committed on tap and
 * looked like buttons). People who arrive with an invite / QR code never see
 * this; they are always clients.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { Spacing } from '../../theme';
import { lightTokens, radius, typography } from '../../theme/tokens';
import type { IntendedRole } from '../../lib/intendedRole';

export const ROLE_CHOICE_OPTIONS: ReadonlyArray<{ role: IntendedRole; title: string; body: string }> = [
  {
    role: 'client',
    title: "I'm here to train",
    body: 'A plan, daily targets and a coach who knows you.',
  },
  {
    role: 'coach',
    title: 'I coach clients',
    body: 'Your practice in one place: clients, programs and messages.',
  },
];

interface Props {
  selected: IntendedRole | null;
  onSelect: (role: IntendedRole) => void;
  disabled?: boolean;
}

export default function RoleChoice({ selected, onSelect, disabled = false }: Props) {
  const { semanticColors: colors = lightTokens } = useTheme();
  return (
    <View
      testID="role-choice"
      accessibilityRole="radiogroup"
      style={[styles.group, { borderColor: colors.border }]}
    >
      {ROLE_CHOICE_OPTIONS.map((o) => {
        const checked = selected === o.role;
        return (
          <TouchableOpacity
            key={o.role}
            onPress={() => onSelect(o.role)}
            disabled={disabled}
            activeOpacity={0.7}
            accessibilityRole="radio"
            accessibilityLabel={o.title}
            accessibilityHint={o.body}
            accessibilityState={{ checked, disabled }}
            testID={`role-choice-${o.role}`}
            style={[styles.row, { borderColor: colors.border }]}
          >
            <View style={styles.text}>
              <Text style={[styles.title, { color: colors.textPrimary }]}>{o.title}</Text>
              <Text style={[styles.body, { color: colors.textMuted }]}>{o.body}</Text>
            </View>
            <View
              testID={`role-choice-${o.role}-radio`}
              style={[styles.radio, { borderColor: checked ? colors.accent : colors.textMuted }]}
            >
              {checked ? <View style={[styles.radioDot, { backgroundColor: colors.accent }]} /> : null}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const RADIO = 22;

const styles = StyleSheet.create({
  group: { borderTopWidth: StyleSheet.hairlineWidth },
  // Prototype ROLE: rows 88 pt with h3 labels, hairline under each row.
  row: {
    minHeight: 88,
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: Spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  text: { flex: 1, marginRight: Spacing.md },
  // h3 serif role: lineHeight >= 1.25 x size (tokens), descenders never clip.
  title: { ...typography.h3, marginBottom: 2 },
  body: { ...typography.bodySmall },
  radio: {
    width: RADIO,
    height: RADIO,
    borderRadius: radius.chip,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioDot: { width: RADIO / 2, height: RADIO / 2, borderRadius: radius.chip },
});
