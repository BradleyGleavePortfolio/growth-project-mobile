import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../../../theme/ThemeProvider';
import { layout } from '../../../theme/tokens';
import { Overline } from '../../../ui';

/** A visible group, never a disclosure control or another navigation step. */
export default function SettingsSection({
  title, id, children,
}: { title: React.ReactNode; id: string; children: React.ReactNode }) {
  const { semanticColors: sc } = useTheme();
  return (
    <View style={styles.section} testID={`settings-section-${id}`}>
      <Overline accessibilityRole="header" style={styles.title}>
        {title}
      </Overline>
      <View style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: sc.border }}>
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: layout.sectionGap + 12 },
  title: { marginBottom: 10 },
});
