import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { typography } from '../../../theme/tokens';

/** A visible group, never a disclosure control or another navigation step. */
export default function SettingsSection({
  title, id, children,
}: { title: string; id: string; children: React.ReactNode }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={styles.section} testID={`settings-section-${id}`}>
      <Text accessibilityRole="header" style={[styles.title, { color: sc.textMuted }]}>
        {title}
      </Text>
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.border }}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: 28 },
  title: { ...typography.eyebrow, fontSize: 13, lineHeight: 18, marginBottom: 10 },
});
