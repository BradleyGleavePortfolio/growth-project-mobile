/**
 * QuietSection: the A23 hairline section that Home's supporting cards use
 * instead of a filled, bordered box (DES-K2-128). One hairline above, no
 * fill, no radius, no shadow; spacing matches Home's profile nudge.
 * QuietOverline is the small-caps muted label that opens a section (the one
 * overline: typography.eyebrow, 11 pt, textMuted; exported as Overline from
 * src/ui). Rhythm 18 + 24 comes from layout.sectionPadY / sectionGap. Pass
 * `title` to open the section with its overline (DS-PRIMITIVES-133).
 */
import React from 'react';
import { StyleSheet, Text, View, type TextProps, type ViewProps } from 'react-native';
import { useTheme } from '../../theme/ThemeProvider';
import { layout, typography } from '../../theme/tokens';

export interface QuietSectionProps extends ViewProps {
  /** Overline that opens the section (sentence case in; rendered in small caps). */
  title?: string;
}

export function QuietSection({ style, children, title, ...rest }: QuietSectionProps): React.ReactElement {
  const { semanticColors: sc } = useTheme();
  return (
    <View {...rest} style={[styles.section, { borderTopColor: sc.border }, style]}>
      {title ? <QuietOverline accessibilityRole="header">{title}</QuietOverline> : null}
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
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: layout.sectionPadY, marginBottom: layout.sectionGap },
  overline: { ...typography.eyebrow, marginBottom: 6 },
});
