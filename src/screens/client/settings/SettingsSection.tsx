import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { typography } from '../../../theme/tokens';

/** A visible group, never a disclosure control or another navigation step. */
export default function SettingsSection({
  title, id, children,
}: { title: React.ReactNode; id: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.section} testID={`settings-section-${id}`}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.textMuted }]}>
        {title}
      </Text>
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 28 },
  title: { ...typography.eyebrow, fontSize: 13, lineHeight: 18, marginBottom: 10 },
});
