/**
 * QuietSection: the A23 hairline section that Home's supporting cards use
 * instead of a filled, bordered box (DES-K2-128). One hairline above, no
 * fill, no radius, no shadow; spacing matches Home's profile nudge.
 * QuietOverline is the small-caps muted label that opens a section.
 */
import React from 'react';
import { StyleSheet, Text, View, type TextProps, type ViewProps } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { typography } from '../../theme/tokens';

export function QuietSection({ style, children, ...rest }: ViewProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  return (
    <View {...rest} style={[styles.section, { borderTopColor: sc.border }, style]}>
      {children}
    </View>
  );
}

export function QuietOverline({ style, children, ...rest }: TextProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  return (
    <Text {...rest} style={[styles.overline, { color: sc.textMuted }, style]}>
      {children}
    </Text>
  );
}

/** Text actions inside a section: forest label for the section's primary, textMuted for the rest; 44 pt targets. */
export const quietActions = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 8 },
  action: { minHeight: 44, justifyContent: 'center', marginRight: 24 },
  label: { ...typography.bodyMd },
});

const styles = StyleSheet.create({
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 18, marginBottom: 24 },
  overline: { ...typography.eyebrow, marginBottom: 6 },
});
